import { create } from "@bufbuild/protobuf";
import { useEffect, useMemo, useState } from "react";
import { useDebouncedEffect } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useInfiniteMemos } from "@/hooks/useMemoQueries";
import { combineCELFilters } from "@/lib/cel-filter";
import { DEFAULT_LIST_MEMOS_PAGE_SIZE } from "@/lib/constants";
import { keywordSearchFilter } from "@/lib/memo-search";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import {
  type Memo,
  type MemoRelation,
  MemoRelation_MemoSchema,
  MemoRelation_Type,
  MemoRelationSchema,
} from "@/types/proto/api/v1/memo_service_pb";

interface UseLinkMemoParams {
  isOpen: boolean;
  currentMemoName?: string;
  existingRelations: MemoRelation[];
  onAddRelation: (relation: MemoRelation) => void;
}

export const useLinkMemo = ({ isOpen, currentMemoName, existingRelations, onAddRelation }: UseLinkMemoParams) => {
  const user = useCurrentUser();
  const [searchText, setSearchText] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  useEffect(() => {
    if (isOpen) {
      setSearchText("");
      setSettledSearch("");
    }
  }, [isOpen]);
  useDebouncedEffect(() => setSettledSearch(searchText), 250, [searchText]);
  const settling = settledSearch !== searchText;
  const query = useInfiniteMemos(
    {
      pageSize: DEFAULT_LIST_MEMOS_PAGE_SIZE,
      includeArchived: true,
      orderBy: "create_time desc",
      filter: combineCELFilters(buildMemoCreatorFilter(user?.name ?? ""), keywordSearchFilter(settledSearch)),
    },
    { enabled: isOpen && Boolean(user) && !settling, staleTime: 0 },
  );
  const linkedMemoNames = useMemo(() => new Set(existingRelations.map((relation) => relation.relatedMemo?.name)), [existingRelations]);
  const isFetching = settling || query.isPending || query.isRefetching;
  // Query keys isolate late responses, and no previous keyword's results remain selectable.
  const filteredMemos =
    !isOpen || isFetching || query.isError
      ? []
      : [...new Map(query.data?.pages.flatMap((page) => page.memos).map((memo) => [memo.name, memo]) ?? []).values()].filter(
          (memo) => memo.name !== currentMemoName,
        );
  const addMemoRelation = (memo: Memo) => {
    if (
      isFetching ||
      memo.name === currentMemoName ||
      linkedMemoNames.has(memo.name) ||
      !filteredMemos.some((item) => item.name === memo.name)
    )
      return;
    onAddRelation(
      create(MemoRelationSchema, {
        type: MemoRelation_Type.REFERENCE,
        relatedMemo: create(MemoRelation_MemoSchema, { name: memo.name, snippet: memo.snippet }),
      }),
    );
  };
  return {
    searchText,
    setSearchText,
    isFetching,
    filteredMemos,
    addMemoRelation,
    isAlreadyLinked: (name: string) => linkedMemoNames.has(name),
    error: query.isError ? "关联记录暂时无法读取。" : undefined,
    retry: () => (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()),
    hasNextPage: query.hasNextPage && !settling,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => query.fetchNextPage(),
  };
};
