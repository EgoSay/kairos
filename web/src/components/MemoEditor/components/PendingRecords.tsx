import { useQueryClient } from "@tanstack/react-query";
import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { memoServiceClient } from "@/connect";
import { type JournalDraft, journalDrafts, restoreJournalState } from "@/lib/journal-drafts";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { loadMemoEditor } from "../loader";
import { cacheService } from "../services/cacheService";
import { memoService } from "../services/memoService";
import { resolvePendingInlineImages } from "../services/pendingInlineImages";
import { useEditorContext } from "../state";
import type { MemoEditorProps } from "../types";

const processing = new Map<string, AbortController>();

/** Explicitly saved local records are separate from drafts until every upload succeeds. */
export function PendingRecords({ owner, draftKey }: { owner: string; draftKey: string }) {
  const { getState, dispatch, actions } = useEditorContext();
  const [entries, setEntries] = useState<JournalDraft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumed, setResumed] = useState<{ Component: ComponentType<MemoEditorProps>; memo: Memo }>();
  const [resumeSaving, setResumeSaving] = useState(false);
  const mounted = useRef(true);
  const lifetime = useRef(new AbortController());
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    const controller = lifetime.current;
    void journalDrafts
      .list(owner)
      .then((items) => {
        if (mounted.current && lifetime.current === controller && !controller.signal.aborted)
          setEntries(
            items.filter(
              (item) =>
                item.kind === "pending" ||
                (item.key.startsWith("offline:") &&
                  (item.state.content || item.state.localFiles.length || item.state.metadata.attachments.length)),
            ),
          );
      })
      .catch(() => undefined);
  }, [owner]);
  const synchronize = useCallback(async () => {
    const controller = lifetime.current;
    const { signal } = controller;
    const active = () => mounted.current && lifetime.current === controller && !signal.aborted;
    const existing = processing.get(owner);
    if (!owner || !navigator.onLine || signal.aborted || (existing && !existing.signal.aborted)) return;
    processing.set(owner, controller);
    setBusy(true);
    setError("");
    try {
      const process = async () => {
        for (const entry of await journalDrafts.pending(owner)) {
          signal.throwIfAborted();
          const original = restoreJournalState(entry);
          try {
            const state = await resolvePendingInlineImages(
              original,
              (next) => journalDrafts.save(entry.key, owner, next, entry.options, "pending"),
              signal,
            );
            signal.throwIfAborted();
            await memoService.save(state, entry.options ?? {}, signal);
            signal.throwIfAborted();
            await journalDrafts.remove(entry.key);
          } catch (failure) {
            if (signal.aborted) throw failure;
            if (active()) setError(failure instanceof Error ? failure.message : "同步未完成，记录和原文件仍保存在此设备。");
          } finally {
            for (const file of original.localFiles) URL.revokeObjectURL(file.previewUrl);
          }
        }
      };
      if (navigator.locks) await navigator.locks.request(`memos-pending:${owner}`, { signal }, process);
      else await process();
      signal.throwIfAborted();
      await queryClient.invalidateQueries({ queryKey: ["memos"] });
      await queryClient.invalidateQueries({ queryKey: ["journal"] });
    } catch (failure) {
      if (active()) setError(failure instanceof Error ? failure.message : "同步未完成，记录和原文件仍保存在此设备。");
    } finally {
      if (processing.get(owner) === controller) processing.delete(owner);
      if (active()) {
        setBusy(false);
        refresh();
      }
    }
  }, [owner, queryClient, refresh]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    lifetime.current = controller;
    refresh();
    void synchronize();
    const online = () => {
      void synchronize();
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; kind?: string }>).detail;
      if (!detail || detail.kind === "pending" || detail.key?.startsWith("offline:") || !detail.kind) refresh();
    };
    window.addEventListener("online", online);
    window.addEventListener("journal-drafts-changed", changed);
    return () => {
      mounted.current = false;
      controller.abort();
      window.removeEventListener("online", online);
      window.removeEventListener("journal-drafts-changed", changed);
    };
  }, [refresh, synchronize]);
  const continueDraft = async (entry: JournalDraft) => {
    const current = getState();
    if (current.content || current.localFiles.length || current.metadata.attachments.length) {
      setError("请先保存或清空当前编辑框，再继续这份离线草稿。两份内容都仍保留。");
      return;
    }
    if (entry.options?.memoName || entry.state.baselineMemo) {
      setError("这是一份已有记录的编辑草稿，请打开对应记录继续编辑。");
      return;
    }
    setBusy(true);
    const state = restoreJournalState(entry);
    try {
      // Commit the destination before removing the source, and only after an
      // explicit click, so reconnecting cannot replace another local draft.
      await journalDrafts.save(draftKey, owner, state, entry.options);
      dispatch(actions.restoreDraft(state));
      await journalDrafts.remove(entry.key);
      setError("");
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "草稿仍保留在此设备，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const resumePendingEdit = async (entry: JournalDraft) => {
    const name = entry.options?.memoName;
    if (!name || busy || processing.has(owner)) return;
    setBusy(true);
    const controller = lifetime.current;
    processing.set(owner, controller);
    const state = restoreJournalState(entry);
    try {
      const key = cacheService.key(owner, `edit:${name}`);
      const existing = await journalDrafts.get(key);
      if (existing && existing.state.clientId !== state.clientId) {
        throw new Error("原记录已有另一份编辑草稿。请先处理它，这份待同步修改仍会保留。");
      }
      const memo = await memoServiceClient.getMemo({ name });
      const module = await loadMemoEditor();
      await journalDrafts.save(key, owner, state, entry.options);
      await journalDrafts.remove(entry.key);
      setResumed({ Component: module.default, memo });
      setError("");
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法继续编辑，待同步内容仍保留在此设备。");
    } finally {
      for (const file of state.localFiles) URL.revokeObjectURL(file.previewUrl);
      if (processing.get(owner) === controller) processing.delete(owner);
      setBusy(false);
    }
  };
  if (!entries.length && !resumed) return null;
  return (
    <div className="w-full rounded border border-border/60 p-3 text-sm space-y-2">
      {resumed && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !resumeSaving) setResumed(undefined);
          }}
        >
          <DialogContent size="xl">
            <DialogHeader>
              <DialogTitle>继续处理这份修改</DialogTitle>
              <DialogDescription>本地修改已转为编辑草稿。保存时会与服务端版本比较，关闭仍会保留草稿。</DialogDescription>
            </DialogHeader>
            <resumed.Component
              memo={resumed.memo}
              onSavingChange={setResumeSaving}
              onConfirm={() => setResumed(undefined)}
              onCancel={() => setResumed(undefined)}
            />
          </DialogContent>
        </Dialog>
      )}
      {entries.length > 0 && <p role="status">{busy ? "正在同步…" : `${entries.length} 份本地记录与草稿`}</p>}
      {entries.map((entry) => (
        <details key={entry.key}>
          <summary className="cursor-pointer py-1">
            {entry.kind === "draft" ? "离线草稿" : "等待同步"} · {entry.state.content.slice(0, 60) || "照片或录音记录"} ·{" "}
            {entry.state.localFiles.length} 个本地附件
          </summary>
          <p className="whitespace-pre-wrap break-words py-2">{entry.state.content}</p>
          {entry.kind === "pending" && entry.options?.memoName && (
            <button type="button" className="underline min-h-10" disabled={busy} onClick={() => void resumePendingEdit(entry)}>
              继续处理这份修改
            </button>
          )}
          {entry.kind === "draft" && (
            <button type="button" className="underline min-h-10" disabled={busy} onClick={() => void continueDraft(entry)}>
              继续写这份草稿
            </button>
          )}
          {entry.state.localFiles.map((file) => (
            <button
              type="button"
              key={file.clientId ?? file.file.name}
              className="block underline py-1"
              onClick={() => {
                const url = URL.createObjectURL(file.file);
                const link = document.createElement("a");
                link.href = url;
                link.download = file.file.name;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              保存原文件：{file.file.name}
            </button>
          ))}
          <button type="button" className="underline py-1" onClick={() => void navigator.clipboard.writeText(entry.state.content)}>
            复制本地文字
          </button>
        </details>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {entries.some((entry) => entry.kind === "pending") && (
        <button type="button" className="underline min-h-10" disabled={busy} onClick={() => void synchronize()}>
          重试同步
        </button>
      )}
    </div>
  );
}
