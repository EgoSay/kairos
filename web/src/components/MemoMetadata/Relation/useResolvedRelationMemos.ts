import { create } from "@bufbuild/protobuf";
import { useQueries } from "@tanstack/react-query";
import { memoDetailQueryOptions } from "@/hooks/useMemoQueries";
import { recordExcerpt } from "@/lib/memo-reference";
import { type MemoRelation_Memo, MemoRelation_MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

export const useResolvedRelationMemos = (memoNames: string[], options?: { enabled?: boolean }) => {
  const names = Array.from(new Set(memoNames.filter(Boolean)));
  const queries = useQueries({
    queries: names.map((name) => ({
      ...memoDetailQueryOptions(name),
      enabled: options?.enabled ?? true,
      staleTime: 0,
      refetchOnMount: "always" as const,
    })),
  });
  const resolved: Record<string, MemoRelation_Memo | null> = {};
  queries.forEach((query, index) => {
    if (query.data === null || query.isError) resolved[names[index]] = null;
    else if (query.data && !query.isFetching && options?.enabled !== false) {
      resolved[names[index]] = create(MemoRelation_MemoSchema, { name: query.data.name, snippet: recordExcerpt(query.data) });
    }
  });
  return resolved;
};
