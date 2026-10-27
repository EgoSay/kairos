import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ArrowUpRightIcon } from "lucide-react";
import MemoContent from "@/components/MemoContent";
import { AttachmentGallery, AttachmentRows } from "@/components/MemoMetadata/Attachment/AttachmentListView";
import { separateAttachments } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import { useImagePreview } from "@/components/MemoView/hooks/useImagePreview";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { Button } from "@/components/ui/button";
import { useMemo } from "@/hooks/useMemoQueries";
import { useNearViewport } from "@/hooks/useNearViewport";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { filterInlineManagedAttachments } from "@/utils/managed-attachment";
import { useRecordReading } from "./RecordReadingContext";

/** Full original content, without recursively expanding this record's relations. */
export function RecordReadingCard({ memo, sourceName }: { memo: Memo; sourceName?: string }) {
  const reader = useRecordReading();
  const date = memo.createTime ? timestampDate(memo.createTime) : undefined;
  const attachments = separateAttachments(filterInlineManagedAttachments(memo.content, memo.attachments));
  const { previewState, openPreview, setPreviewOpen } = useImagePreview();
  return (
    <article className="min-w-0 space-y-5 rounded-xl border border-border/50 bg-background p-5 sm:p-6" data-reading-record={memo.name}>
      <header className="flex min-h-8 items-center justify-between gap-3 text-xs text-muted-foreground">
        <time dateTime={date?.toISOString()}>{date?.toLocaleString("zh-CN", { dateStyle: "long", timeStyle: "short" })}</time>
        {sourceName && reader.enabled && (
          <button
            type="button"
            className="flex min-h-8 shrink-0 items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2"
            onClick={(event) => reader.open(memo.name, event.currentTarget, sourceName)}
          >
            查看关联
            <ArrowUpRightIcon aria-hidden className="size-3" />
          </button>
        )}
      </header>
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
      <AttachmentGallery visual={attachments.visual} onImagePreview={openPreview} />
      <AttachmentRows audio={attachments.audio} docs={attachments.docs} />
      {previewState.items.length > 0 && (
        <PreviewImageDialog
          open={previewState.open}
          onOpenChange={setPreviewOpen}
          items={previewState.items}
          initialIndex={previewState.index}
        />
      )}
    </article>
  );
}

export function RecordReadingState({ query }: { query: ReturnType<typeof useMemo> }) {
  if (query.isFetching || !query.isFetchedAfterMount)
    return (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        正在读取记录…
      </p>
    );
  if (query.isUnavailable)
    return (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        记录不可用，可能已删除或没有访问权限。
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="space-y-3 p-5">
        <p className="text-sm">暂时无法读取记录，当前草稿仍然保留。</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          重试
        </Button>
      </div>
    );
  return null;
}

/** Permission is checked again before showing cached text, including in the second column. */
export function RelatedRecordCard({ name, sourceName, eager = false }: { name: string; sourceName: string; eager?: boolean }) {
  const { ref, isNearViewport } = useNearViewport<HTMLDivElement>();
  const enabled = eager || isNearViewport;
  const query = useMemo(name, { enabled, revalidate: true });
  const memo = enabled && query.isFetchedAfterMount && !query.isFetching && !query.isError && !query.isUnavailable ? query.data : undefined;
  return (
    <div ref={ref} className="min-h-32" data-related-record={name}>
      <RecordReadingState query={query} />
      {memo && <RecordReadingCard memo={memo} sourceName={sourceName} />}
    </div>
  );
}
