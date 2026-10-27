import { ArrowLeftIcon, ArrowUpRightIcon, XIcon } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { getRelationBuckets } from "@/components/MemoMetadata/Relation/relationHelpers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMemo } from "@/hooks/useMemoQueries";
import { RecordReadingCard, RecordReadingState, RelatedRecordCard } from "./RecordReadingCard";
import type { ReadingEntry } from "./RecordReadingProvider";

interface Props {
  entries: ReadingEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onBack: () => void;
  returnFocus: () => HTMLElement | false;
}

export default function RecordReadingDialog({ entries, scrollRef, onClose, onBack, returnFocus }: Props) {
  const entry = entries[entries.length - 1];
  const query = useMemo(entry.name, { revalidate: true });
  const memo = query.isFetchedAfterMount && !query.isFetching && !query.isError && !query.isUnavailable ? query.data : undefined;
  const title = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const relations = getRelationBuckets(memo?.relations ?? [], entry.name);
  // Show the record we arrived from first, even when an old body link has no saved index.
  // Each neighbour appears once; its own relations only expand after explicit navigation.
  const related = new Map<string, string>();
  if (entry.sourceName && entry.sourceName !== entry.name) related.set(entry.sourceName, "从这里读起");
  for (const relation of relations.referenced) {
    const name = relation.memo?.name;
    if (name && !related.has(name)) related.set(name, "引用了当前记录");
  }
  for (const relation of relations.referencing) {
    const name = relation.relatedMemo?.name;
    if (name && !related.has(name)) related.set(name, "当前记录引用了");
  }
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !content.current || !memo) return;
    // The second column may finish after the target. Restore once its full height
    // exists, otherwise the browser clamps a saved position to the loading state.
    const observer = new ResizeObserver(() => restore());
    const stop = () => observer.disconnect();
    const restore = () => {
      scroller.scrollTop = entry.scrollTop;
      if (scroller.scrollTop >= entry.scrollTop) stop();
    };
    observer.observe(content.current);
    restore();
    scroller.addEventListener("wheel", stop, { passive: true });
    scroller.addEventListener("pointerdown", stop);
    scroller.addEventListener("keydown", stop);
    return () => {
      stop();
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("pointerdown", stop);
      scroller.removeEventListener("keydown", stop);
    };
  }, [entry, memo, scrollRef]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="full"
        className="h-[min(56rem,90dvh)] max-w-7xl p-0 sm:p-0 md:max-w-7xl max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-full max-sm:rounded-none [&>div:first-child]:gap-0 [&>div:first-child]:overflow-hidden"
        initialFocus={title}
        finalFocus={returnFocus}
        showCloseButton={false}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-4 pr-14 sm:px-7 sm:pr-14">
          {entries.length > 1 && (
            <Button variant="ghost" size="icon" aria-label="返回上一条记录" onClick={onBack}>
              <ArrowLeftIcon className="size-4" />
            </Button>
          )}
          <DialogTitle ref={title} tabIndex={-1} className="flex-1 outline-none">
            关联记录
          </DialogTitle>
          <a
            href={`/${entry.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            独立打开
            <ArrowUpRightIcon className="size-3" />
          </a>
          <DialogClose
            aria-label="关闭关联记录"
            className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2"
          >
            <XIcon className="size-4" />
          </DialogClose>
        </header>
        <DialogDescription className="sr-only">关闭后返回原处，保留当前阅读位置和草稿。</DialogDescription>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-5 sm:px-6 sm:py-6"
          data-record-reading-body
        >
          <RecordReadingState query={query} />
          {memo && (
            <div ref={content} className="grid items-start gap-6 lg:grid-cols-2">
              <section className="min-w-0 space-y-3" aria-label="当前记录">
                <h2 className="px-1 text-sm text-muted-foreground">当前记录</h2>
                <RecordReadingCard memo={memo} />
              </section>
              <aside className="min-w-0 space-y-6" aria-label="关联记录正文">
                {[...related].map(([name, label], index) => (
                  <section key={name} className="space-y-3">
                    <h2 className="px-1 text-sm text-muted-foreground">{label}</h2>
                    <RelatedRecordCard name={name} sourceName={memo.name} eager={index === 0} />
                  </section>
                ))}
                {!related.size && <p className="px-1 text-sm text-muted-foreground">暂无其他关联记录</p>}
              </aside>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
