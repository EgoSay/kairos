import MemoContent from "@/components/MemoContent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMemo } from "@/hooks/useMemoQueries";

/** Reading a linked record in the editor never navigates away from its draft. */
export default function RelatedRecordPreview({ name, onClose }: { name?: string; onClose: () => void }) {
  const query = useMemo(name ?? "", { enabled: Boolean(name), revalidate: true });
  return (
    <Dialog
      open={Boolean(name)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="lg" className="overflow-y-auto">
        <DialogTitle>关联记录预览</DialogTitle>
        <DialogDescription>关闭后继续当前草稿。</DialogDescription>
        {query.isFetching && <p role="status">正在读取…</p>}
        {query.isUnavailable && <p role="status">该记录已删除或不可访问，保存当前草稿时会忽略此关联。</p>}
        {query.isError && (
          <div role="alert">
            <p>记录暂时无法读取。</p>
            <Button variant="outline" onClick={() => query.refetch()}>
              重试
            </Button>
          </div>
        )}
        {!query.isFetching && !query.isError && query.data && (
          <MemoContent memoName={query.data.name} content={query.data.content} attachments={query.data.attachments} readonly />
        )}
        <Button variant="ghost" onClick={onClose}>
          返回当前草稿
        </Button>
      </DialogContent>
    </Dialog>
  );
}
