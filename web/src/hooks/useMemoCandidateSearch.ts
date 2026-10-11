import { useEffect, useState } from "react";
import { useInfiniteMemos } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";

interface Options {
  filter?: string;
  enabled: boolean;
  isComposing?: boolean;
  includeArchived?: boolean;
  state?: State;
  pageSize?: number;
}

/** A small first page, with the same server query and continuation tokens as the full list. */
export function useMemoCandidateSearch({
  filter,
  enabled,
  isComposing = false,
  includeArchived = false,
  state = State.NORMAL,
  pageSize = 8,
}: Options) {
  const requestKey = JSON.stringify({ filter, includeArchived, state, pageSize });
  const [settledKey, setSettledKey] = useState(requestKey);
  useEffect(() => {
    if (!enabled || isComposing) return;
    const timeout = window.setTimeout(() => setSettledKey(requestKey), 200);
    return () => window.clearTimeout(timeout);
  }, [requestKey, enabled, isComposing]);
  const settling = isComposing || requestKey !== settledKey;
  // Do not use placeholderData: a late response or a previous owner's cache must
  // never remain selectable while the user is looking at a different query.
  const query = useInfiniteMemos(
    { filter, includeArchived, state, pageSize, orderBy: "create_time desc" },
    { enabled: enabled && !settling, staleTime: 0 },
  );
  const isFetching = enabled && (settling || query.isPending || query.isRefetching);
  const memos =
    !enabled || isFetching || query.isError
      ? []
      : [...new Map(query.data?.pages.flatMap((page) => page.memos).map((memo) => [memo.name, memo]) ?? []).values()];
  return {
    memos,
    isFetching,
    isError: enabled && !settling && query.isError,
    error: query.error,
    hasNextPage: enabled && !settling && query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    retry: () => (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()),
    fetchNextPage: () => query.fetchNextPage(),
  };
}
