import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ArrowLeftIcon, ArrowUpRightIcon, XIcon } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import MemoContent from "@/components/MemoContent";
import { AttachmentGallery, AttachmentRows } from "@/components/MemoMetadata/Attachment/AttachmentListView";
import { separateAttachments } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import { getRelationBuckets } from "@/components/MemoMetadata/Relation/relationHelpers";
import { useImagePreview } from "@/components/MemoView/hooks/useImagePreview";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useMemo } from "@/hooks/useMemoQueries";
import { filterInlineManagedAttachments } from "@/utils/managed-attachment";
import type { ReadingEntry } from "./RecordReadingProvider";
import RecordReference from "./RecordReference";

interface Props {
  entries: ReadingEntry[];
  sourceName?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onBack: () => void;
  returnFocus: () => HTMLElement | false;
}

export default function RecordReadingDialog({ entries, sourceName, scrollRef, onClose, onBack, returnFocus }: Props) {
  const entry = entries[entries.length - 1];
  const query = useMemo(entry.name, { revalidate: true });
  const memo = !query.isFetching && !query.isError && !query.isUnavailable ? query.data : undefined;
  const title = useRef<HTMLHeadingElement>(null);
  const wide = useMediaQuery("lg");
  const { previewState, openPreview, setPreviewOpen } = useImagePreview();
  const attachments = memo ? separateAttachments(filterInlineManagedAttachments(memo.content, memo.attachments)) : undefined;
  const relations = getRelationBuckets(memo?.relations ?? [], entry.name);
  const date = memo?.createTime ? timestampDate(memo.createTime) : undefined;
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = entry.scrollTop;
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
        className="h-[min(52rem,90dvh)] max-w-5xl p-0 sm:p-0 md:max-w-5xl max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-full max-sm:rounded-none [&>div:first-child]:gap-0 [&>div:first-child]:overflow-hidden"
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
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8"
          data-record-reading-body
        >
          {query.isFetching && (
            <p role="status" className="text-sm text-muted-foreground">
              正在读取记录…
            </p>
          )}
          {query.isUnavailable && (
            <p role="status" className="text-sm text-muted-foreground">
              记录不可用，可能已删除或没有访问权限。
            </p>
          )}
          {query.isError && (
            <div role="alert" className="space-y-3">
              <p>暂时无法读取记录，当前草稿仍然保留。</p>
              <Button variant="outline" onClick={() => query.refetch()}>
                重试
              </Button>
            </div>
          )}
          {memo && (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-10">
              <article className="min-w-0 space-y-5">
                <time dateTime={date?.toISOString()} className="block text-sm text-muted-foreground">
                  {date?.toLocaleString("zh-CN", { dateStyle: "long", timeStyle: "short" })}
                </time>
                <MemoContent
                  memoName={memo.name}
                  content={memo.content}
                  attachments={memo.attachments}
                  readonly
                  onClick={(event) => {
                    if (event.target instanceof HTMLImageElement && !event.target.closest("a")) openPreview(event.target.src);
                  }}
                />
                {!memo.content && !memo.attachments.length && <p className="text-muted-foreground">空白记录</p>}
                {attachments && (
                  <>
                    <AttachmentGallery visual={attachments.visual} onImagePreview={openPreview} />
                    <AttachmentRows audio={attachments.audio} docs={attachments.docs} />
                  </>
                )}
              </article>
              <aside className="min-w-0 border-t border-border/60 pt-5 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
                <details open={wide} className="space-y-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground">关联脉络</summary>
                  {sourceName && sourceName !== entry.name && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">从这里读起</p>
                      <RecordReference name={sourceName} href={`/${sourceName}`} />
                    </div>
                  )}
                  {relations.referencing.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">引用了 {relations.referencing.length} 条记录</p>
                      {relations.referencing.map((relation) => (
                        <div key={relation.relatedMemo!.name}>
                          <RecordReference
                            name={relation.relatedMemo!.name}
                            href={`/${relation.relatedMemo!.name}`}
                            sourceName={memo.name}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {relations.referenced.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">被 {relations.referenced.length} 条记录引用</p>
                      {relations.referenced.map((relation) => (
                        <div key={relation.memo!.name}>
                          <RecordReference name={relation.memo!.name} href={`/${relation.memo!.name}`} sourceName={memo.name} />
                        </div>
                      ))}
                    </div>
                  )}
                  {!relations.referencing.length && !relations.referenced.length && (
                    <p className="text-xs text-muted-foreground">暂无其他关联记录</p>
                  )}
                </details>
              </aside>
            </div>
          )}
        </div>
      </DialogContent>
      {previewState.items.length > 0 && (
        <PreviewImageDialog
          open={previewState.open}
          onOpenChange={setPreviewOpen}
          items={previewState.items}
          initialIndex={previewState.index}
        />
      )}
    </Dialog>
  );
}
