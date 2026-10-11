import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import MemoContent from "@/components/MemoContent";
import { Button } from "@/components/ui/button";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/** Use body text around the first literal match, even when the stored snippet misses it. */
export function candidateSnippet(memo: Pick<Memo, "content" | "snippet">, query: string, limit = 220): string {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const plainSnippet = memo.snippet.replace(/\s+/g, " ").trim();
  const source = (
    plainSnippet && terms.every((term) => plainSnippet.toLocaleLowerCase().includes(term)) ? plainSnippet : memo.content || memo.snippet
  )
    .replace(/\s+/g, " ")
    .trim();
  const offsets = terms.map((term) => source.toLocaleLowerCase().indexOf(term)).filter((offset) => offset >= 0);
  const start = Math.max(0, (offsets.length ? Math.min(...offsets) : 0) - 48);
  return `${start ? "…" : ""}${source.slice(start, start + limit)}${source.length > start + limit ? "…" : ""}`;
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const expression = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  let offset = 0;
  return text.split(expression).map((part, index) => {
    const key = offset;
    offset += part.length;
    return index % 2 ? (
      <mark key={key} className="rounded-sm bg-accent text-accent-foreground">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

/** Shared keyboard behavior; typing or changing scope clears the active selection. */
export function useMemoCandidateNavigation(
  memos: Memo[],
  resetKey: string,
  onSelect: (memo: Memo) => void,
  isDisabled: (name: string) => boolean = () => false,
) {
  const [selection, setSelection] = useState({ key: resetKey, name: "" });
  const selectable = memos.filter((memo) => !isDisabled(memo.name));
  const activeName = selection.key === resetKey && selectable.some((memo) => memo.name === selection.name) ? selection.name : "";
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!selectable.length) return true;
      const index = selectable.findIndex((memo) => memo.name === activeName);
      const next = event.key === "ArrowDown" ? (index + 1) % selectable.length : (index <= 0 ? selectable.length : index) - 1;
      setSelection({ key: resetKey, name: selectable[next]?.name ?? "" });
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const memo = selectable.find((item) => item.name === activeName);
      if (memo) {
        event.preventDefault();
        onSelect(memo);
        return true;
      }
    }
    return false;
  };
  return { activeName, onKeyDown };
}

interface Props {
  id: string;
  memos: Memo[];
  query: string;
  activeName?: string;
  onSelect: (memo: Memo) => void;
  action: "打开" | "关联";
  timezone?: string;
  isDisabled?: (name: string) => boolean;
  allowPreview?: boolean;
}

export const candidateRowId = (id: string, name: string) => `${id}-${encodeURIComponent(name)}`;

/** Fast queries stay quiet; a slow lookup announces its state without exposing old candidates. */
export function useCandidateLoadingIndicator(isFetching: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!isFetching) {
      setVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(timeout);
  }, [isFetching]);
  return isFetching && visible;
}

/** Search and association show the same date, match context and optional in-place preview. */
export default function MemoCandidateList({
  id,
  memos,
  query,
  activeName,
  onSelect,
  action,
  timezone = "Asia/Shanghai",
  isDisabled = () => false,
  allowPreview = false,
}: Props) {
  const [previewName, setPreviewName] = useState<string>();
  const previewId = useId();
  useEffect(() => {
    if (activeName) document.getElementById(candidateRowId(id, activeName))?.scrollIntoView?.({ block: "nearest" });
  }, [id, activeName]);
  return (
    <div id={id} role="grid" aria-label={action === "关联" ? "可关联记录" : "匹配记录"} className="divide-y divide-border/50">
      {memos.map((memo) => {
        const disabled = isDisabled(memo.name);
        const snippet = candidateSnippet(memo, query) || "附件记录";
        const previewOpen = previewName === memo.name;
        return (
          <div key={memo.name} role="row" id={candidateRowId(id, memo.name)} aria-selected={activeName === memo.name}>
            <div className={cn("flex items-center gap-1 rounded-lg", activeName === memo.name && "bg-accent/60")}>
              <div role="gridcell" className="min-w-0 flex-1">
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`${disabled ? "已关联" : action} ${memo.snippet || snippet}`}
                  onClick={() => onSelect(memo)}
                  className={cn(
                    "w-full min-h-11 rounded-lg px-3 py-3 text-left hover:bg-accent/40 disabled:opacity-50",
                    FOCUS_VISIBLE_OUTLINE_CLASSES,
                  )}
                >
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <time dateTime={memo.createTime && timestampDate(memo.createTime).toISOString()}>
                      {memo.createTime &&
                        timestampDate(memo.createTime).toLocaleDateString(undefined, { timeZone: timezone, dateStyle: "medium" })}
                    </time>
                    {memo.state === State.ARCHIVED && <span>已归档</span>}
                    {disabled && <span>已关联</span>}
                  </span>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    <HighlightedSnippet text={snippet} query={query} />
                  </p>
                  {memo.tags.length > 0 && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {memo.tags
                        .slice(0, 3)
                        .map((tag) => `#${tag}`)
                        .join(" ")}
                    </p>
                  )}
                </button>
              </div>
              {allowPreview && (
                <div role="gridcell" className="pr-1">
                  <button
                    type="button"
                    aria-label={`预览 ${memo.snippet || snippet}`}
                    aria-expanded={previewOpen}
                    aria-controls={previewOpen ? previewId : undefined}
                    onClick={() => setPreviewName(previewOpen ? undefined : memo.name)}
                    className={cn(
                      "flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent",
                      FOCUS_VISIBLE_OUTLINE_CLASSES,
                    )}
                  >
                    {previewOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                  </button>
                </div>
              )}
            </div>
            {previewOpen && (
              <div role="gridcell" className="px-3 pb-3">
                <section id={previewId} aria-label="记录预览" className="max-h-52 overflow-auto rounded-lg border p-3">
                  <MemoContent memoName={memo.name} content={memo.content} attachments={memo.attachments} readonly />
                </section>
                <div className="pt-2">
                  <Button type="button" variant="secondary" disabled={disabled} onClick={() => onSelect(memo)}>
                    {disabled ? "已关联" : `${action}这条记录`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
