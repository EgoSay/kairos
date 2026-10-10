import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { isEqual } from "lodash-es";
import { getEditorReferenceRelations } from "@/components/MemoMetadata/Relation/relationHelpers";
import { memoServiceClient } from "@/connect";
import { getMemoPartition } from "@/hooks/useJournalPartitionQueries";
import { journalRecordVersion } from "@/lib/journal-record-version";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { JournalPartitionSelectionSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import type { EditorState } from "../state";
import { uploadService } from "./uploadService";

/**
 * Converts attachments to reference format for API requests.
 * The backend only needs the attachment name to link it to a memo.
 */
function toAttachmentReferences(attachments: Attachment[]): Attachment[] {
  return attachments.map((a) => create(AttachmentSchema, { name: a.name }));
}

function buildUpdateMask(
  prevMemo: Memo,
  state: EditorState,
  allAttachments: typeof state.metadata.attachments,
): { mask: Set<string>; patch: Partial<Memo> } {
  const mask = new Set<string>();
  const patch: Partial<Memo> = {
    name: prevMemo.name,
    content: state.content,
  };

  if (!isEqual(state.content, prevMemo.content)) {
    mask.add("content");
    patch.content = state.content;
  }
  if (!isEqual(state.metadata.visibility, prevMemo.visibility)) {
    mask.add("visibility");
    patch.visibility = state.metadata.visibility;
  }
  // Placement and audience are validated together: a move always states the
  // audience it lands with, so a Space-only audience never follows it implicitly.
  if ((state.metadata.space || undefined) !== (prevMemo.space || undefined)) {
    mask.add("space");
    mask.add("visibility");
    patch.space = state.metadata.space ?? "";
    patch.visibility = state.metadata.visibility;
  }
  if (!isEqual(allAttachments, prevMemo.attachments)) {
    mask.add("attachments");
    patch.attachments = toAttachmentReferences(allAttachments);
  }
  const previousReferenceRelations = getEditorReferenceRelations(prevMemo.relations, prevMemo.name);
  const nextReferenceRelations = getEditorReferenceRelations(state.metadata.relations, prevMemo.name);
  if (!isEqual(nextReferenceRelations, previousReferenceRelations)) {
    mask.add("relations");
    patch.relations = nextReferenceRelations;
  }
  if (!isEqual(state.metadata.location, prevMemo.location)) {
    mask.add("location");
    patch.location = state.metadata.location;
  }

  // Auto-update timestamp if content changed
  if (["content", "attachments", "relations", "location"].some((key) => mask.has(key))) {
    mask.add("update_time");
  }

  // Handle custom timestamps
  if (state.timestamps.createTime) {
    const prevCreateTime = prevMemo.createTime ? timestampDate(prevMemo.createTime) : undefined;
    if (!isEqual(state.timestamps.createTime, prevCreateTime)) {
      mask.add("create_time");
      patch.createTime = timestampFromDate(state.timestamps.createTime);
    }
  }
  if (state.timestamps.updateTime) {
    const prevUpdateTime = prevMemo.updateTime ? timestampDate(prevMemo.updateTime) : undefined;
    if (!isEqual(state.timestamps.updateTime, prevUpdateTime)) {
      mask.add("update_time");
      patch.updateTime = timestampFromDate(state.timestamps.updateTime);
    }
  }

  return { mask, patch };
}

/** The saved response is authoritative when a relation target changed during editing. */
function relationSaveWarning(requested: Memo["relations"], saved: Memo): string | undefined {
  const wanted = getEditorReferenceRelations(requested, saved.name)
    .map((relation) => relation.relatedMemo?.name)
    .filter(Boolean);
  const actual = new Set(getEditorReferenceRelations(saved.relations, saved.name).map((relation) => relation.relatedMemo?.name));
  return wanted.some((name) => !actual.has(name)) ? "正文已保存；部分关联记录已删除或不可访问，未保留这些关联。" : undefined;
}

/** A stable ID only acknowledges the same attempted record, never later local edits. */
async function creationMatchesRetry(existing: Memo, requested: Memo, signal?: AbortSignal): Promise<boolean> {
  if (
    existing.content !== requested.content ||
    existing.visibility !== requested.visibility ||
    (existing.space ?? "") !== (requested.space ?? "") ||
    !isEqual(existing.location, requested.location) ||
    // The store persists timestamps in seconds; omitted timestamps are assigned by the server.
    (requested.createTime && existing.createTime?.seconds !== requested.createTime.seconds) ||
    (requested.updateTime && existing.updateTime?.seconds !== requested.updateTime.seconds) ||
    !isEqual(existing.attachments.map((item) => item.name).sort(), requested.attachments.map((item) => item.name).sort())
  )
    return false;

  const targets = (relations: Memo["relations"]) =>
    new Set(
      getEditorReferenceRelations(relations, existing.name).flatMap((relation) =>
        relation.relatedMemo?.name ? [relation.relatedMemo.name] : [],
      ),
    );
  const wanted = targets(requested.relations);
  const actual = targets(existing.relations);
  if ([...actual].some((name) => !wanted.has(name))) return false;
  for (const name of wanted) {
    if (actual.has(name)) continue;
    try {
      // Saving may legitimately omit a target deleted or made private. Only
      // that verified case can settle a retry with the existing warning.
      signal?.throwIfAborted();
      await memoServiceClient.getMemo({ name }, signal ? { signal } : undefined);
      return false;
    } catch (error) {
      if (![Code.NotFound, Code.PermissionDenied].includes(ConnectError.from(error).code)) throw error;
    }
  }
  return true;
}

export const memoService = {
  async save(
    state: EditorState,
    options: {
      memoName?: string;
      parentMemoName?: string;
      space?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ memoName: string; hasChanges: boolean; moved?: boolean; syncError?: string; relationWarning?: string }> {
    const requestOptions = signal ? ([{ signal }] as const) : ([] as const);
    // 1. Upload local files first
    signal?.throwIfAborted();
    const newAttachments = await uploadService.uploadFiles(state.localFiles, signal);
    signal?.throwIfAborted();
    const allAttachments = [...state.metadata.attachments, ...newAttachments];

    // 2. Update existing memo
    if (options.memoName) {
      const prevMemo = await memoServiceClient.getMemo({ name: options.memoName }, signal ? { signal } : undefined);
      signal?.throwIfAborted();
      const baseline = state.baselineMemo ?? prevMemo;
      if (
        state.baselineMemo &&
        (!isEqual(prevMemo.content, baseline.content) ||
          !isEqual(prevMemo.attachments, baseline.attachments) ||
          !isEqual(prevMemo.location, baseline.location) ||
          !isEqual(prevMemo.createTime, baseline.createTime) ||
          prevMemo.visibility !== baseline.visibility ||
          prevMemo.space !== baseline.space)
      ) {
        throw new ConnectError(
          "这条记录已在其他页面或设备修改。当前输入已保留，请复制后重新打开记录，查看双方内容再决定如何合并。",
          Code.Aborted,
        );
      }
      const { mask, patch } = buildUpdateMask(baseline, state, allAttachments);

      let journalPartition;
      let partitionChanged = false;
      if (
        state.metadata.journalPartitionId !== undefined &&
        (!state.metadata.journalPartitionSuspended || state.metadata.journalPartitionExplicit)
      ) {
        const mapping = await getMemoPartition(prevMemo.name);
        signal?.throwIfAborted();
        if (state.metadata.journalPartitionVersion !== undefined && mapping.version !== state.metadata.journalPartitionVersion) {
          throw new ConnectError("分区已在其他页面或设备修改。当前输入已保留，请重新比较后保存。", Code.Aborted);
        }
        // Old durable drafts may predate the mapping baseline. Preserve current
        // assignment unless the user explicitly selected a destination.
        const partitionId =
          state.metadata.journalPartitionExplicit || state.metadata.journalPartitionVersion !== undefined
            ? state.metadata.journalPartitionId
            : mapping.partitionId;
        partitionChanged = Boolean(state.metadata.journalPartitionExplicit && (partitionId !== mapping.partitionId || mapping.suspended));
        if (!mapping.suspended || state.metadata.journalPartitionExplicit) {
          journalPartition = create(JournalPartitionSelectionSchema, { partitionId, expectedVersion: BigInt(mapping.version) });
        }
      }
      if (mask.size === 0 && !partitionChanged) {
        return { memoName: prevMemo.name, hasChanges: false };
      }

      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(baseline.content));
      const expectedContent = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const expectedRecord = await journalRecordVersion(baseline);
      signal?.throwIfAborted();
      const memo = await memoServiceClient.updateMemo(
        {
          memo: create(MemoSchema, patch as Record<string, unknown>),
          updateMask: create(FieldMaskSchema, { paths: Array.from(mask) }),
          journalPartition,
        },
        {
          ...(signal ? { signal } : {}),
          headers: {
            "X-Memos-Expected-Content-Sha256": expectedContent,
            "X-Memos-Expected-Record-Sha256": expectedRecord,
          },
        },
      );
      return {
        memoName: memo.name,
        hasChanges: true,
        moved: mask.has("space"),
        relationWarning: relationSaveWarning(state.metadata.relations, memo),
      };
    }

    // 3. Create new memo or comment
    const memoData = create(MemoSchema, {
      content: state.content,
      visibility: state.metadata.visibility,
      attachments: toAttachmentReferences(allAttachments),
      relations: state.metadata.relations,
      location: state.metadata.location,
      createTime: state.timestamps.createTime ? timestampFromDate(state.timestamps.createTime) : undefined,
      updateTime: state.timestamps.updateTime ? timestampFromDate(state.timestamps.updateTime) : undefined,
      space: options.parentMemoName ? undefined : (options.space ?? state.metadata.space),
    });

    let memo: Memo;
    try {
      memo = options.parentMemoName
        ? await memoServiceClient.createMemoComment(
            {
              name: options.parentMemoName,
              comment: memoData,
            },
            ...requestOptions,
          )
        : await memoServiceClient.createMemo(
            {
              memo: memoData,
              memoId: state.clientId,
              journalPartition:
                state.metadata.journalPartitionId !== undefined && !state.metadata.journalPartitionSuspended
                  ? create(JournalPartitionSelectionSchema, { partitionId: state.metadata.journalPartitionId, expectedVersion: 0n })
                  : undefined,
            },
            ...requestOptions,
          );
    } catch (error) {
      if (options.parentMemoName || !state.clientId || ConnectError.from(error).code !== Code.AlreadyExists) throw error;
      // A lost success response is resolved by the stable client ID. Never
      // claim a mismatched record as this save's result.
      signal?.throwIfAborted();
      const existing = await memoServiceClient.getMemo({ name: `memos/${state.clientId}` }, signal ? { signal } : undefined);
      if (!(await creationMatchesRetry(existing, memoData, signal))) {
        throw new ConnectError(
          "这条记录已经创建，但正文、位置、日期或关联等内容与本地不同。草稿仍保留，请打开已创建的记录比较后再保存。",
          Code.AlreadyExists,
        );
      }
      if (state.metadata.journalPartitionId !== undefined && !state.metadata.journalPartitionSuspended) {
        const mapping = await getMemoPartition(existing.name);
        signal?.throwIfAborted();
        if (mapping.partitionId !== state.metadata.journalPartitionId || mapping.suspended) throw error;
      }
      memo = existing;
    }

    return { memoName: memo.name, hasChanges: true, relationWarning: relationSaveWarning(state.metadata.relations, memo) };
  },

  /**
   * Build the INIT_MEMO payload from an already-loaded Memo entity (no network
   * request). Returns only the fields the reducer's INIT_MEMO case consumes —
   * UI state (mode, loading flags, …) is owned by the reducer, not by memos.
   */
  fromMemo(memo: Memo): Pick<EditorState, "content" | "metadata" | "timestamps" | "baselineMemo"> {
    return {
      baselineMemo: memo,
      content: memo.content,
      metadata: {
        visibility: memo.visibility,
        space: memo.space || undefined,
        attachments: memo.attachments,
        relations: memo.relations,
        location: memo.location,
      },
      timestamps: {
        createTime: memo.createTime ? timestampDate(memo.createTime) : undefined,
        updateTime: memo.updateTime ? timestampDate(memo.updateTime) : undefined,
      },
    };
  },
};
