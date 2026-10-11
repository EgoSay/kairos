import { toast } from "react-hot-toast";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/** Both record surfaces share the same persisted operation and failure feedback. */
export function useMemoPin(memo: Memo) {
  const update = useUpdateMemo();
  return {
    pending: update.isPending,
    toggle: async () => {
      if (update.isPending) return;
      try {
        await update.mutateAsync({ update: { name: memo.name, pinned: !memo.pinned }, updateMask: ["pinned"] });
        toast.success(memo.pinned ? "已取消置顶" : "已置顶");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "置顶状态保存失败，请重试。");
      }
    },
  };
}
