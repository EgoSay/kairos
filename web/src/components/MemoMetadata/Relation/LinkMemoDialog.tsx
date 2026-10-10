import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useEffect, useState } from "react";
import MemoContent from "@/components/MemoContent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

interface LinkMemoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchText: string;
  onSearchChange: (text: string) => void;
  filteredMemos: Memo[];
  isFetching: boolean;
  onSelectMemo: (memo: Memo) => void;
  isAlreadyLinked: (memoName: string) => boolean;
  error?: string;
  onRetry?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  onReturnToEditor?: () => void;
}

export const LinkMemoDialog = (props: LinkMemoDialogProps) => {
  const t = useTranslate();
  const [previewName, setPreviewName] = useState<string>();
  useEffect(() => {
    if (!props.open) setPreviewName(undefined);
  }, [props.open]);
  const preview = props.filteredMemos.find((memo) => memo.name === previewName);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        size="lg"
        className="overflow-y-auto"
        finalFocus={() => {
          props.onReturnToEditor?.();
          return false;
        }}
      >
        <DialogTitle title={t("tooltip.link-memo")}>关联记录</DialogTitle>
        <DialogDescription>搜索、预览并关联自己的旧记录；包括归档，排除最近删除。</DialogDescription>
        <Input
          aria-label="搜索关联记录"
          placeholder={t("reference.search-placeholder")}
          value={props.searchText}
          onChange={(event) => props.onSearchChange(event.target.value)}
          autoFocus
        />
        {props.isFetching && (
          <p role="status" className="text-sm text-muted-foreground">
            正在查找…
          </p>
        )}
        {props.error && (
          <div role="alert" className="text-sm">
            <p>{props.error}</p>
            <Button type="button" variant="outline" onClick={props.onRetry}>
              重试
            </Button>
          </div>
        )}
        {!props.isFetching && !props.error && !props.filteredMemos.length && (
          <p className="py-5 text-center text-sm text-muted-foreground">{t("reference.no-memos-found")}</p>
        )}
        <div className="max-h-[40dvh] divide-y overflow-y-auto" aria-label="可关联记录">
          {props.filteredMemos.map((memo) => (
            <div key={memo.name} className="flex items-start gap-2 py-3">
              <button
                type="button"
                className="min-w-0 flex-1 rounded p-1 text-left hover:bg-accent"
                aria-label={`预览 ${memo.snippet || memo.name}`}
                aria-expanded={previewName === memo.name}
                onClick={() => setPreviewName(previewName === memo.name ? undefined : memo.name)}
              >
                <time className="text-xs text-muted-foreground">{memo.createTime && timestampDate(memo.createTime).toLocaleString()}</time>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm">{memo.snippet || "附件记录"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{memo.tags.map((tag) => `#${tag}`).join(" ")}</p>
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 shrink-0"
                disabled={props.isAlreadyLinked(memo.name)}
                onClick={() => props.onSelectMemo(memo)}
              >
                {props.isAlreadyLinked(memo.name) ? "已关联" : "关联"}
              </Button>
            </div>
          ))}
        </div>
        {preview && (
          <section className="max-h-[35dvh] overflow-auto rounded border p-3" aria-label="记录预览">
            <MemoContent memoName={preview.name} content={preview.content} attachments={preview.attachments} readonly />
          </section>
        )}
        {props.hasNextPage && (
          <Button type="button" variant="outline" disabled={props.isFetchingNextPage} onClick={props.onLoadMore}>
            {props.isFetchingNextPage ? "正在加载…" : "继续加载记录"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
          返回继续写作
        </Button>
      </DialogContent>
    </Dialog>
  );
};
