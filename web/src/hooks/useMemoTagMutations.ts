import { useMutation, useQueryClient } from "@tanstack/react-query";
import { memoServiceClient } from "@/connect";
import type { BatchUpdateMemoTagsRequest, DeleteTagRequest, RenameTagRequest } from "@/types/proto/api/v1/memo_service_pb";
import { memoKeys } from "./useMemoQueries";

// Tag organization rewrites memo content, so every memo list/detail cache is stale.
const useInvalidateMemos = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: memoKeys.all });
};

export const useBatchUpdateMemoTags = () => {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: (request: BatchUpdateMemoTagsRequest) => memoServiceClient.batchUpdateMemoTags(request),
    onSettled: invalidate,
  });
};

export const useRenameTag = () => {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: (request: RenameTagRequest) => memoServiceClient.renameTag(request),
    onSettled: invalidate,
  });
};

export const useDeleteTag = () => {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: (request: DeleteTagRequest) => memoServiceClient.deleteTag(request),
    onSettled: invalidate,
  });
};
