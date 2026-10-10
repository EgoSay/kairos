import { uniqBy } from "lodash-es";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { isImage } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { buildManagedAttachmentMarkdown, canInlineAttachment } from "@/utils/managed-attachment";
import { errorService, uploadService } from "../services";
import { useEditorContext, useEditorStore } from "../state";
import type { LocalFile } from "../types/attachment";
import type { EditorController } from "../types/editorController";

interface UploadEntry {
  localFile: LocalFile;
  attachment?: Attachment;
}

interface UploadJob {
  id: string;
  entries: UploadEntry[];
  representativeIndexes: number[];
  active: boolean;
  controller?: AbortController;
  position: number;
}

interface InlineLocalFileSplit {
  /** Files that become inline Markdown images; motion groups stay contiguous. */
  inline: LocalFile[];
  /** Indexes into `inline` of the file each reference is written for (the still of a motion group). */
  representativeIndexes: number[];
  /** Everything else, which stays in the attachment list. */
  attachments: LocalFile[];
}

/** Single source of truth for which picked files can be inlined and which file represents a motion group. */
export const splitInlineLocalFiles = (localFiles: LocalFile[]): InlineLocalFileSplit => {
  const inline: LocalFile[] = [];
  const representativeIndexes: number[] = [];
  const attachments: LocalFile[] = [];
  const consumedGroups = new Set<string>();

  for (const localFile of localFiles) {
    const groupID = localFile.motionMedia?.groupId;
    if (!groupID) {
      if (isImage(localFile.file.type)) {
        representativeIndexes.push(inline.length);
        inline.push(localFile);
      } else {
        attachments.push(localFile);
      }
      continue;
    }

    if (consumedGroups.has(groupID)) continue;
    consumedGroups.add(groupID);
    const group = localFiles.filter((candidate) => candidate.motionMedia?.groupId === groupID);
    const representative = group.find((candidate) => isImage(candidate.file.type));
    if (!representative) {
      attachments.push(...group);
      continue;
    }
    representativeIndexes.push(inline.length + group.indexOf(representative));
    inline.push(...group);
  }

  return { inline, representativeIndexes, attachments };
};

const createJob = (localFiles: LocalFile[]): UploadJob | undefined => {
  const { inline, representativeIndexes } = splitInlineLocalFiles(localFiles);
  if (inline.length === 0) return undefined;
  return {
    id: uuidv4(),
    entries: inline.map((localFile) => ({ localFile: { ...localFile, clientId: localFile.clientId ?? uuidv4().replaceAll("-", "") } })),
    representativeIndexes,
    active: false,
    position: 0,
  };
};

export const useInlineImageUpload = (editorRef: RefObject<EditorController | null>) => {
  const t = useTranslate();
  const store = useEditorStore();
  const { actions, dispatch, getState } = useEditorContext();
  const jobsRef = useRef(new Map<string, UploadJob>());
  const disposedRef = useRef(false);
  const runJobRef = useRef<(id: string) => Promise<void>>(async () => undefined);
  const [uploadingLocalFileURLs, setUploadingLocalFileURLs] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    disposedRef.current = false;
    // Strict Mode replays effects. Resume a cancelled job with its stable IDs,
    // while each old async continuation stays bound to its aborted controller.
    const first = jobsRef.current.keys().next().value;
    if (first) queueMicrotask(() => void runJobRef.current(first));
    return () => {
      disposedRef.current = true;
      for (const job of jobsRef.current.values()) {
        job.controller?.abort();
        job.controller = undefined;
        job.active = false;
      }
    };
  }, []);

  /** Publishes everything derived from the live job map; call after any mutation of it. */
  const syncJobState = useCallback(() => {
    const jobs = Array.from(jobsRef.current.values());
    const state = getState();
    const persisted = jobs.flatMap((job) => {
      job.position = editorRef.current?.getUploadAnchorPosition?.(job.id) ?? job.position;
      return job.entries.map((entry, index) => ({
        ...entry.localFile,
        inlineUpload: {
          id: job.id,
          position: job.position,
          representative: job.representativeIndexes.includes(index),
          attachment: entry.attachment,
        },
      }));
    });
    const nonInline = state.localFiles.filter(
      (file) => !file.inlineUpload && !persisted.some((entry) => entry.previewUrl === file.previewUrl),
    );
    dispatch(actions.setLocalFiles([...nonInline, ...persisted]));
    if (state.ui.pendingInlineImageInsertions !== jobs.length) {
      dispatch(actions.setPendingInlineImageInsertions(jobs.length));
    }
    const isUploading = jobs.some((job) => job.active);
    if (state.ui.isLoading.uploading !== isUploading) {
      dispatch(actions.setLoading("uploading", isUploading));
    }

    const uploadingURLs = new Set(
      jobs.flatMap((job) =>
        job.active ? job.entries.filter((entry) => !entry.attachment).map((entry) => entry.localFile.previewUrl) : [],
      ),
    );
    setUploadingLocalFileURLs((previous) =>
      previous.size === uploadingURLs.size && [...uploadingURLs].every((url) => previous.has(url)) ? previous : uploadingURLs,
    );
  }, [actions, dispatch, getState, editorRef]);

  const appendAttachment = useCallback(
    (attachment: Attachment) => {
      const state = getState();
      dispatch(actions.setMetadata({ attachments: uniqBy([...state.metadata.attachments, attachment], (item) => item.name) }));
      // Keep the Blob and stable ID durable until the entire inline job resolves.
    },
    [actions, dispatch, getState],
  );

  const finishJob = useCallback(
    (job: UploadJob) => {
      jobsRef.current.delete(job.id);
      syncJobState();
      const next = jobsRef.current.keys().next().value;
      if (next) queueMicrotask(() => void runJobRef.current(next));
    },
    [syncJobState],
  );

  const dismissJob = useCallback(
    (id: string) => {
      const job = jobsRef.current.get(id);
      if (!job || job.active) return;
      editorRef.current?.cancelUploadAnchor(id);
      const kept = job.entries.filter((entry) => !entry.attachment).map((entry) => ({ ...entry.localFile, inlineUpload: undefined }));
      dispatch(actions.setLocalFiles([...getState().localFiles.filter((file) => file.inlineUpload?.id !== id), ...kept]));
      finishJob(job);
    },
    [actions, dispatch, editorRef, finishJob, getState],
  );

  const retryJob = useCallback((id: string) => void runJobRef.current(id), []);

  const descriptorFor = useCallback(
    (job: UploadJob, status: "uploading" | "failed") => {
      const completed = job.entries.filter((entry) => entry.attachment).length;
      return {
        id: job.id,
        status,
        completed,
        total: job.entries.length,
        previewUrl: job.entries[job.representativeIndexes[0]]?.localFile.previewUrl,
        message: !navigator.onLine
          ? "等待联网上传；本机保存状态见编辑器下方"
          : t(status === "uploading" ? "editor.insert-menu.uploading-images" : "editor.insert-menu.image-upload-stopped", {
              completed,
              total: job.entries.length,
            }),
        retryLabel: t("editor.insert-menu.retry-image-upload"),
        // Partially-uploaded jobs keep what landed; a job with nothing uploaded is just cancelled.
        keepLabel: t(completed > 0 ? "editor.insert-menu.keep-as-attachments" : "common.cancel"),
        onRetry: status === "failed" ? () => retryJob(job.id) : undefined,
        onKeepAttachments: status === "failed" ? () => dismissJob(job.id) : undefined,
      };
    },
    [dismissJob, retryJob, t],
  );

  const runJob = useCallback(
    async (id: string) => {
      const job = jobsRef.current.get(id);
      if (!job || job.active || disposedRef.current || jobsRef.current.keys().next().value !== id) return;
      if (!navigator.onLine) {
        editorRef.current?.updateUploadAnchor(descriptorFor(job, "failed"));
        syncJobState();
        return;
      }
      const controller = new AbortController();
      job.controller = controller;
      const stopped = () => disposedRef.current || controller.signal.aborted || job.controller !== controller;
      job.active = true;
      syncJobState();
      editorRef.current?.updateUploadAnchor(descriptorFor(job, "uploading"));

      let lastError: unknown;
      for (const entry of job.entries) {
        if (stopped()) return;
        if (entry.attachment) continue;
        try {
          const attachment = await uploadService.uploadFile(entry.localFile, controller.signal);
          if (stopped()) return;
          entry.attachment = attachment;
          appendAttachment(attachment);
          syncJobState();
          editorRef.current?.updateUploadAnchor(descriptorFor(job, "uploading"));
        } catch (error) {
          if (stopped()) return;
          lastError = error;
        }
      }

      job.active = false;
      job.controller = undefined;
      if (disposedRef.current) return;
      syncJobState();

      if (job.entries.some((entry) => !entry.attachment)) {
        editorRef.current?.updateUploadAnchor(descriptorFor(job, "failed"));
        toast.error(errorService.getErrorMessage(lastError) || t("editor.insert-menu.image-upload-failed"));
        return;
      }

      const markdown = job.representativeIndexes
        .map((index) => buildManagedAttachmentMarkdown(job.entries[index]!.attachment!))
        .join("\n\n");
      editorRef.current?.resolveUploadAnchor(job.id, markdown);
      finishJob(job);
    },
    [appendAttachment, descriptorFor, editorRef, finishJob, syncJobState, t],
  );
  runJobRef.current = runJob;

  const insertLocalImages = useCallback(
    (localFiles: LocalFile[], position?: number) => {
      if (getState().ui.isLoading.saving) return;
      const editor = editorRef.current;
      const existing = new Set(
        Array.from(jobsRef.current.values()).flatMap((job) => job.entries.map((entry) => entry.localFile.previewUrl)),
      );
      const job = createJob(localFiles.filter((file) => !existing.has(file.previewUrl)));
      if (!editor || !job) return;
      job.position = position ?? editor.getCursor?.() ?? 0;
      jobsRef.current.set(job.id, job);
      editor.createUploadAnchor(descriptorFor(job, "uploading"), position);
      syncJobState();
      void runJob(job.id);
    },
    [descriptorFor, editorRef, getState, runJob, syncJobState],
  );

  const insertRemoteImages = useCallback(
    (attachments: Attachment[]) => {
      if (getState().ui.isLoading.saving) return;
      const markdown = attachments.filter(canInlineAttachment).map(buildManagedAttachmentMarkdown).join("\n\n");
      editorRef.current?.insertMarkdown(markdown);
    },
    [editorRef, getState],
  );

  // A restored draft carries the original Blob, position and upload ID. Rebuild
  // widgets only after the single EditorController is mounted.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const grouped = new Map<string, LocalFile[]>();
    for (const file of getState().localFiles) {
      if (!file.inlineUpload || jobsRef.current.has(file.inlineUpload.id)) continue;
      const group = grouped.get(file.inlineUpload.id) ?? [];
      group.push(file);
      grouped.set(file.inlineUpload.id, group);
    }
    for (const [id, files] of grouped) {
      const job: UploadJob = {
        id,
        position: files[0].inlineUpload!.position,
        active: false,
        entries: files.map((localFile) => ({ localFile, attachment: localFile.inlineUpload?.attachment })),
        representativeIndexes: files.flatMap((file, index) => (file.inlineUpload?.representative ? [index] : [])),
      };
      jobsRef.current.set(id, job);
      editor.createUploadAnchor(descriptorFor(job, "failed"), job.position);
    }
    for (const job of jobsRef.current.values()) {
      if (editor.getUploadAnchorPosition && editor.getUploadAnchorPosition(job.id) === undefined) {
        editor.createUploadAnchor(descriptorFor(job, job.active ? "uploading" : "failed"), job.position);
      }
    }
    if (grouped.size) {
      syncJobState();
      const first = jobsRef.current.keys().next().value;
      if (first) void runJob(first);
    }
  });

  useEffect(() => {
    let content = getState().content;
    return store.subscribe(() => {
      const next = getState().content;
      if (next === content) return;
      content = next;
      if (jobsRef.current.size) syncJobState();
    });
  }, [getState, store, syncJobState]);

  useEffect(() => {
    const resume = () => {
      const first = jobsRef.current.keys().next().value;
      if (first) void runJobRef.current(first);
    };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, []);

  return { insertLocalImages, insertRemoteImages, uploadingLocalFileURLs };
};
