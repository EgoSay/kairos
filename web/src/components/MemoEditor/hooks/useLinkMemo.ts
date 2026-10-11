import { create } from "@bufbuild/protobuf";
import { useEffect, useMemo, useState } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useMemoCandidateSearch } from "@/hooks/useMemoCandidateSearch";
import { buildMemoFilter } from "@/hooks/useMemoFilters";
import { useMemo as useMemoRecord } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
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
  requestedMemoName?: string;
  requestId?: number;
}

export const useLinkMemo = ({
  isOpen,
  currentMemoName,
  existingRelations,
  onAddRelation,
  requestedMemoName,
  requestId,
}: UseLinkMemoParams) => {
  const user = useCurrentUser();
  const [searchText, setSearchValue] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [dismissedRequest, setDismissedRequest] = useState<string>();
  const requestKey = `${requestId ?? 0}:${requestedMemoName ?? ""}`;
  const exactName = requestedMemoName && dismissedRequest !== requestKey ? requestedMemoName : undefined;
  const canReadExact = Boolean(user && exactName && /^memos\/[A-Za-z0-9_-]+$/.test(exactName));
  useEffect(() => {
    if (!isOpen) {
      setSearchValue("");
      setIsComposing(false);
      setDismissedRequest(undefined);
    }
  }, [isOpen]);
  const exact = useMemoRecord(exactName ?? "", {
    enabled: isOpen && canReadExact,
    revalidate: true,
  });
  const query = useMemoCandidateSearch({
    includeArchived: true,
    enabled: isOpen && Boolean(user) && !exactName,
    isComposing,
    filter: buildMemoFilter({
      creatorName: user?.name,
      includePinned: false,
      filters: [...new Set(searchText.trim().split(/\s+/).filter(Boolean))].map((value) => ({ factor: "contentSearch", value })),
    }),
  });
  const linkedMemoNames = useMemo(() => new Set(existingRelations.map((relation) => relation.relatedMemo?.name)), [existingRelations]);
  const isFetching = exactName ? isOpen && canReadExact && (exact.isPending || exact.isFetching) : query.isFetching;
  const readableTarget =
    exact.data &&
    exact.data.name === exactName &&
    exact.data.creator === user?.name &&
    !exact.data.parent &&
    exact.data.name !== currentMemoName &&
    (exact.data.state === State.NORMAL || exact.data.state === State.ARCHIVED);
  const filteredMemos = exactName
    ? isOpen && !isFetching && !exact.isError && readableTarget
      ? [exact.data!]
      : []
    : query.memos.filter((memo) => memo.name !== currentMemoName);
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
    setSearchText: (text: string) => {
      setDismissedRequest(requestKey);
      setSearchValue(text);
    },
    setIsComposing,
    isFetching,
    filteredMemos,
    addMemoRelation,
    isAlreadyLinked: (name: string) => linkedMemoNames.has(name),
    isTargeted: Boolean(exactName),
    error: exactName
      ? isOpen && !isFetching && (exact.isError || !readableTarget)
        ? "这条记录暂时无法关联，可能已删除、属于他人或就是当前记录。"
        : undefined
      : query.isError
        ? "关联记录暂时无法读取。"
        : undefined,
    retry: () => (exactName ? (canReadExact ? exact.refetch() : undefined) : query.retry()),
    hasNextPage: !exactName && query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => query.fetchNextPage(),
  };
};
