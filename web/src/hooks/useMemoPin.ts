import { toast } from "react-hot-toast";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import i18n from "@/i18n";
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
        toast.success(i18n.t(memo.pinned ? "memo.unpinned" : "memo.pinned"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : i18n.t("memo.pin-error"));
      }
    },
  };
}
