import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ArrowUpRightIcon, LinkIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useMemo } from "@/hooks/useMemoQueries";
import { useNearViewport } from "@/hooks/useNearViewport";
import { recordExcerpt } from "@/lib/memo-reference";
import { cn } from "@/lib/utils";
import { isOrdinaryActivation, useRecordReading } from "./RecordReadingContext";

interface Props {
  name: string;
  href: string;
  label?: ReactNode;
  block?: boolean;
  sourceName?: string;
  restoreFocus?: () => void;
  onResize?: () => void;
}

/** A live reading affordance; the authored Markdown is never replaced. */
export default function RecordReference({ name, href, label, block = false, sourceName, restoreFocus, onResize }: Props) {
  const reader = useRecordReading();
  const { ref, isNearViewport } = useNearViewport<HTMLSpanElement>();
  const query = useMemo(name, { enabled: reader.enabled && isNearViewport, revalidate: true });
  // Never revive cached private content while a new permission check is in flight or failed.
  const memo =
    reader.enabled && isNearViewport && query.isFetchedAfterMount && !query.isFetching && !query.isError && !query.isUnavailable
      ? query.data
      : undefined;
  const status = query.isUnavailable ? "记录不可用" : query.isError ? "暂时无法读取" : "正在读取记录…";
  const date = memo?.createTime ? timestampDate(memo.createTime) : undefined;
  useEffect(() => onResize?.(), [memo, query.isFetching, query.isError, onResize]);

  return (
    <span ref={ref} className={cn(block ? "my-3 block" : "inline")} data-record-reference={name}>
      <a
        href={href}
        title={href}
        className={cn(
          "group rounded-sm text-primary no-underline focus-visible:outline-2 focus-visible:outline-offset-4",
          block
            ? "flex w-full items-start gap-3 rounded-lg border border-border/70 bg-muted/25 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
            : "inline-flex max-w-full items-baseline gap-1 border-b border-primary/30 align-baseline hover:border-primary",
        )}
        onMouseDown={(event) => {
          if (restoreFocus && isOrdinaryActivation(event)) event.preventDefault();
        }}
        onClick={(event) => {
          if (!reader.enabled || !isOrdinaryActivation(event)) return;
          event.preventDefault();
          event.stopPropagation();
          reader.open(name, event.currentTarget, sourceName, restoreFocus);
        }}
      >
        <LinkIcon aria-hidden className={cn("shrink-0", block ? "mt-1 size-4 text-primary/70" : "size-3")} />
        <span className="min-w-0 flex-1">
          {block && (
            <span className="mb-1 block font-sans text-xs text-muted-foreground">
              {date ? date.toLocaleDateString("zh-CN") : "关联记录"}
            </span>
          )}
          <span
            className={cn(block ? "line-clamp-2 font-content text-base leading-6 text-foreground" : "line-clamp-1 max-w-[28em] text-sm")}
          >
            {label || (memo ? recordExcerpt(memo) : status)}
          </span>
        </span>
        {block && <ArrowUpRightIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />}
      </a>
      {query.isError && (
        <button
          type="button"
          className="ml-2 min-h-9 text-xs text-muted-foreground underline underline-offset-4"
          onClick={() => query.refetch()}
        >
          重试
        </button>
      )}
    </span>
  );
}
