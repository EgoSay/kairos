import { Code } from "@connectrpc/connect";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MemoCandidateList, {
  candidateRowId,
  useCandidateLoadingIndicator,
  useMemoCandidateNavigation,
} from "@/components/MemoCandidateList";
import { createMemoNavigationState } from "@/components/MemoView/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { Textarea } from "@/components/ui/textarea";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { type FilterFactor, getFilterSearch, isSearchFilter, type MemoFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useSpaceContext } from "@/contexts/SpaceContext";
import { useView } from "@/contexts/ViewContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useMemoCandidateSearch } from "@/hooks/useMemoCandidateSearch";
import { buildMemoFilter } from "@/hooks/useMemoFilters";
import { useAllUserStats, useMemoViews } from "@/hooks/useUserQueries";
import { combineCELFilters } from "@/lib/cel-filter";
import { hasConnectCode } from "@/lib/error";
import { journalDate } from "@/lib/journal";
import { searchIncludesArchived } from "@/lib/memo-search";
import { getMemoViewId, isMemoCollectionRoute } from "@/lib/memo-views";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { extractSpaceUidFromName, formatSpaceUidForDisplay } from "@/lib/space-display";
import { cn } from "@/lib/utils";
import { emptyViewScope, mergeScopes, parseViewFilter, scopeFromFilters } from "@/lib/view-scope";
import { getCollectionCreator, withCollectionCreator } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { getRouteActionPolicy, getSidebarRouteKind } from "./routes";
import SearchFacetPanel, { searchDateError } from "./SearchFacetPanel";

export type QuickFindMode = "text" | "cel";

const buildSearchFilters = (query: string, mode: QuickFindMode): MemoFilter[] => {
  const trimmed = query.trim();
  if (mode === "cel") return trimmed ? [{ factor: "celSearch", value: trimmed }] : [];
  return Array.from(new Set(trimmed.split(/\s+/).filter(Boolean))).map((value) => ({ factor: "contentSearch", value }));
};

export const buildQuickFindFilters = (
  query: string,
  currentFilters: MemoFilter[],
  preserveCurrentScope: boolean,
  mode: QuickFindMode,
): MemoFilter[] => {
  const scopeFilters = preserveCurrentScope ? currentFilters.filter((filter) => !isSearchFilter(filter)) : [];
  return [...scopeFilters, ...buildSearchFilters(query, mode)];
};

/** The inverse of buildQuickFindFilters: the query and mode that the active filters were submitted with. */
export const readQuickFindQuery = (filters: MemoFilter[]): { query: string; mode: QuickFindMode } => {
  const celSearch = filters.find((filter) => filter.factor === "celSearch");
  if (celSearch) return { query: celSearch.value, mode: "cel" };
  return {
    query: filters
      .filter((filter) => filter.factor === "contentSearch")
      .map((filter) => filter.value)
      .join(" "),
    mode: "text",
  };
};

export interface QuickFindSubmission {
  filters: MemoFilter[];
  destination?: string;
}

export const resolveQuickFindSubmission = (
  pathname: string,
  query: string,
  currentFilters: MemoFilter[],
  mode: QuickFindMode,
  search = "",
): QuickFindSubmission => {
  const routePolicy = getRouteActionPolicy(pathname, search);
  const filters = buildQuickFindFilters(query, currentFilters, routePolicy.searchScope !== "all", mode);
  return {
    filters,
    destination: routePolicy.searchDestination
      ? `${routePolicy.searchDestination}${withCollectionCreator(getFilterSearch(filters), routePolicy.searchScope === "route-collection" ? getCollectionCreator(search) : undefined)}`
      : undefined,
  };
};

const getScopeLabel = (pathname: string, t: ReturnType<typeof useTranslate>) => {
  const routeKind = getSidebarRouteKind(pathname);
  if (routeKind === "archived") return t("common.archived");
  if (routeKind === "explore") return t("common.explore");
  return t("common.memos");
};

const FACET_LABELS: Partial<Record<FilterFactor, string>> = {
  untagged: "未添加标签",
  "property.hasImage": "有图片",
  "property.hasAudio": "有音频",
  "property.hasAttachment": "有附件",
  "property.hasLocation": "有位置",
  "property.hasLink": "有链接",
  "property.hasCode": "有代码",
  "property.hasTaskList": "有待办",
  includeArchived: "包含归档",
  pinned: "已置顶",
  tagExact: "仅标签本身",
  tagMatch: "任一标签",
};

const facetLabel = (filter: MemoFilter) => {
  if (filter.factor === "tagSearch") return `#${filter.value}`;
  if (filter.factor === "tagExclude") return `排除 #${filter.value}`;
  if (filter.factor === "dateStart") return `从 ${filter.value}`;
  if (filter.factor === "dateEnd") return `至 ${filter.value}`;
  if (filter.factor === "partition") return filter.value ? "指定分区" : "未分区";
  if (filter.factor === "tagMatch") return filter.value === "any" ? "任一标签" : "全部标签";
  return FACET_LABELS[filter.factor] || filter.value || filter.factor;
};

const quickChipClass = cn(
  "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-transparent px-3 text-xs text-muted-foreground hover:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground",
  FOCUS_VISIBLE_OUTLINE_CLASSES,
);

interface SearchDraft {
  origin: string;
  owner?: string;
  query: string;
  mode: QuickFindMode;
  facets: MemoFilter[];
  allOwn: boolean;
}

const QuickFindDialog = () => {
  const t = useTranslate();
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const memoViewsQuery = useMemoViews(currentUser?.name);
  const memoViews = memoViewsQuery.data ?? [];
  const { filters, setFilters, setMemoView, memoView } = useMemoFilterContext();
  const { duplicateSpaceTitles, selectedSpace, selectedSpaceName, memoFilter, isSpaceReady } = useSpaceContext();
  const { quickFindOpen, setQuickFindOpen, setViewComposer } = useAppSidebar();
  const { timeBasis } = useView();
  const { data: preferences } = useJournalPreferences();
  const timezone = preferences?.timezone ?? "Asia/Shanghai";
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<QuickFindMode>("text");
  const [facets, setFacets] = useState<MemoFilter[]>([]);
  const [showFacets, setShowFacets] = useState(false);
  const [allOwn, setAllOwn] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [dateDraftError, setDateDraftError] = useState<string>();
  const retainedDraft = useRef<SearchDraft | undefined>(undefined);
  const initializedSource = useRef<string | undefined>(undefined);
  const [readySource, setReadySource] = useState<string>();
  const hintId = useId();
  const listId = useId();
  const viewApplies = isMemoCollectionRoute(location.pathname);
  const selectedMemoView = viewApplies ? memoViews.find((item) => getMemoViewId(item.name) === memoView) : undefined;
  const lensLabel = selectedMemoView?.title || getScopeLabel(location.pathname, t);
  const selectedSpaceUid = selectedSpaceName ? extractSpaceUidFromName(selectedSpaceName) : "";
  const selectedSpaceUidDisplay = selectedSpaceName ? formatSpaceUidForDisplay(selectedSpaceName) : "";
  const showSelectedSpaceUid = selectedSpace ? duplicateSpaceTitles.has(selectedSpace.title) : Boolean(selectedSpaceName);
  const selectedSpaceLabel = `${selectedSpace?.title || t("space.current")}${showSelectedSpaceUid && selectedSpaceUid ? ` (${selectedSpaceUid})` : ""}`;
  const compactSelectedSpaceLabel = `${selectedSpace?.title || t("space.current")}${showSelectedSpaceUid && selectedSpaceUidDisplay ? ` (${selectedSpaceUidDisplay})` : ""}`;
  const scopeLabel = selectedSpaceName ? `${selectedSpaceLabel} · ${lensLabel}` : lensLabel;
  const compactScopeLabel = selectedSpaceName ? `${compactSelectedSpaceLabel} · ${lensLabel}` : lensLabel;
  const activeScopeLabel = allOwn ? "本人记录" : compactScopeLabel;
  const origin = `${location.pathname}${location.search}`;
  const sourceKey = `${currentUser?.name ?? "anonymous"}:${origin}`;
  const routePolicy = getRouteActionPolicy(location.pathname, location.search);
  const defaultAllOwn =
    Boolean(currentUser) &&
    !selectedSpaceName &&
    !(viewApplies && memoView) &&
    !getCollectionCreator(location.search) &&
    getSidebarRouteKind(location.pathname) !== "archived";
  const archived = !allOwn && getSidebarRouteKind(location.pathname) === "archived";
  const scopeFilter =
    allOwn || routePolicy.searchScope === "user-collection"
      ? buildMemoCreatorFilter(currentUser?.name ?? "")
      : routePolicy.searchScope === "route-collection"
        ? memoFilter
        : undefined;
  const selectedFilters = buildQuickFindFilters(query, facets, true, mode);
  const candidateFilter = combineCELFilters(
    scopeFilter,
    buildMemoFilter({
      filters: selectedFilters,
      includePinned: !archived,
      selectedMemoViewFilter: allOwn ? undefined : selectedMemoView?.filter,
      timezone,
      timeBasis,
    }),
  );
  const dateError = dateDraftError || searchDateError(facets);
  const searchEnabled =
    quickFindOpen &&
    readySource === sourceKey &&
    Boolean(currentUser) &&
    !dateError &&
    (allOwn || isSpaceReady) &&
    (allOwn || !memoView || !memoViewsQuery.isPending);
  const candidates = useMemoCandidateSearch({
    filter: candidateFilter,
    enabled: searchEnabled,
    isComposing,
    includeArchived: !archived && searchIncludesArchived(facets),
    state: archived ? State.ARCHIVED : State.NORMAL,
  });
  const showLoading = useCandidateLoadingIndicator(candidates.isFetching);
  const searchError = hasConnectCode(candidates.error, Code.InvalidArgument)
    ? "筛选条件暂时无法使用，请检查高级表达式或日期范围。"
    : hasConnectCode(candidates.error, Code.PermissionDenied, Code.Unauthenticated)
      ? "当前无法访问这些记录，请重新登录或调整范围。"
      : "暂时没能搜索，关键词和筛选条件已保留。";
  const stats = useAllUserStats(
    {
      filter: combineCELFilters(scopeFilter, allOwn ? undefined : selectedMemoView?.filter),
      state: archived ? State.ARCHIVED : State.NORMAL,
      includeArchived: !archived && searchIncludesArchived(facets),
    },
    { enabled: searchEnabled && mode === "text" },
  );
  const matchingTags =
    !searchEnabled || candidates.isError || stats.isError || stats.isFetching || mode !== "text" || isComposing || !query.trim()
      ? []
      : [...new Set(stats.data?.flatMap((item) => Object.keys(item.tagCount)) ?? [])]
          .filter((tag) => tag.toLocaleLowerCase().includes(query.trim().replace(/^#/, "").toLocaleLowerCase()))
          .sort()
          .slice(0, 3);

  useEffect(() => {
    if (!quickFindOpen) {
      initializedSource.current = undefined;
      setReadySource(undefined);
      return;
    }
    if (initializedSource.current === sourceKey) return;
    initializedSource.current = sourceKey;
    const retained = retainedDraft.current;
    if (retained && retained.origin === origin && retained.owner === currentUser?.name) {
      setQuery(retained.query);
      setMode(retained.mode);
      setFacets(retained.facets);
      setAllOwn(retained.allOwn);
      retainedDraft.current = undefined;
    } else {
      const active = readQuickFindQuery(filters);
      setMode(active.mode);
      setQuery(active.query);
      setFacets(routePolicy.searchScope === "all" ? [] : filters.filter((filter) => !isSearchFilter(filter)));
      setAllOwn(defaultAllOwn);
    }
    setShowFacets(false);
    setIsComposing(false);
    setReadySource(sourceKey);
    // A draft is initialized when the layer opens or its source URL changes, not
    // when a background view fetch or local scope toggle completes.
  }, [quickFindOpen, filters, origin, currentUser?.name, sourceKey, routePolicy.searchScope, defaultAllOwn]);

  const openMemo = (memo: Memo) => {
    if (candidates.isFetching || candidates.isError || !candidates.memos.some((item) => item.name === memo.name)) return;
    retainedDraft.current = { origin, owner: currentUser?.name, query, mode, facets, allOwn };
    setQuickFindOpen(false);
    navigate(`/${memo.name}`, { state: createMemoNavigationState(origin) });
  };
  const navigation = useMemoCandidateNavigation(candidates.memos, `${candidateFilter}:${archived}:${isComposing}`, openMemo);

  const submitQuery = () => {
    if (dateError || isComposing) return;
    const submission = resolveQuickFindSubmission(location.pathname, query, facets, mode, location.search);
    submission.filters = selectedFilters;
    if (allOwn) submission.destination = `/${getFilterSearch(selectedFilters)}`;
    else if (submission.destination) {
      submission.destination = `${routePolicy.searchDestination}${withCollectionCreator(getFilterSearch(selectedFilters), routePolicy.searchScope === "route-collection" ? getCollectionCreator(location.search) : undefined)}`;
    }
    retainedDraft.current = undefined;
    if (submission.destination) {
      // Calendar/map searches move to a list in the same collection. Keep the
      // view that constrained the candidates; only a broader own-record scope
      // (or a source where views do not apply) should discard it.
      if (allOwn || !viewApplies) setMemoView(undefined);
      navigate(submission.destination);
    } else setFilters(submission.filters);
    setQuickFindOpen(false);
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitQuery();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isComposing || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Escape") event.stopPropagation();
      return;
    }
    if (mode === "text" && navigation.onKeyDown(event)) return;
    if (event.key !== "Enter" || (mode === "cel" && event.shiftKey)) return;
    event.preventDefault();
    submitQuery();
  };
  const toggleFacet = (factor: FilterFactor) => {
    const active = facets.some((filter) => filter.factor === factor);
    setFacets([
      ...facets.filter((filter) => filter.factor !== factor && !(factor === "untagged" && !active && filter.factor === "tagSearch")),
      ...(active ? [] : [{ factor, value: "true" }]),
    ]);
  };
  const applyDateShortcut = (kind: "week" | "month") => {
    const end = journalDate(new Date(), timezone);
    const startDate = new Date(`${end}T00:00:00Z`);
    if (kind === "week") startDate.setUTCDate(startDate.getUTCDate() - 6);
    else startDate.setUTCDate(1);
    setFacets([
      ...facets.filter((filter) => !["dateStart", "dateEnd", "displayTime"].includes(filter.factor)),
      { factor: "dateStart", value: startDate.toISOString().slice(0, 10) },
      { factor: "dateEnd", value: end },
    ]);
  };
  const fieldProps = {
    autoFocus: true,
    value: query,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setQuery(event.target.value),
    onKeyDown: handleKeyDown,
    onCompositionStart: () => setIsComposing(true),
    onCompositionEnd: () => setIsComposing(false),
  };

  return (
    <Dialog open={quickFindOpen} onOpenChange={setQuickFindOpen}>
      <DialogContent
        size="lg"
        className="top-[8vh]! max-h-[84dvh] translate-y-0! overflow-y-auto border-border/70 p-0! shadow-xl [&>div:first-child]:gap-0!"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">查找记录</DialogTitle>
        <DialogDescription className="sr-only">输入关键词即显示匹配记录。当前范围：{activeScopeLabel}。</DialogDescription>
        <form onSubmit={handleSubmit}>
          <div className="flex min-h-16 items-center gap-2.5 px-4">
            <SearchIcon className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
            {mode === "text" ? (
              <input
                {...fieldProps}
                role="combobox"
                aria-expanded={quickFindOpen}
                aria-controls={listId}
                aria-haspopup="grid"
                aria-autocomplete="list"
                aria-activedescendant={navigation.activeName ? candidateRowId(listId, navigation.activeName) : undefined}
                className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                placeholder="找回一句话、一个片段……"
                aria-label={`搜索 ${allOwn ? "本人记录" : scopeLabel}`}
              />
            ) : (
              <div className="min-w-0 flex-1 py-3">
                <Textarea
                  {...fieldProps}
                  rows={3}
                  placeholder={'"work" in tags && !has_image'}
                  aria-label={t("search.expression")}
                  aria-describedby={hintId}
                />
              </div>
            )}
            <button
              type="button"
              aria-label="关闭搜索"
              onClick={() => setQuickFindOpen(false)}
              className={cn(
                "flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent",
                FOCUS_VISIBLE_OUTLINE_CLASSES,
              )}
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1 border-y border-border/50 px-3 py-1">
            <button
              type="button"
              className={quickChipClass}
              aria-pressed={facets.some((item) => item.factor === "untagged")}
              onClick={() => toggleFacet("untagged")}
            >
              未添加标签
            </button>
            <button
              type="button"
              className={quickChipClass}
              aria-pressed={facets.some((item) => item.factor === "property.hasImage")}
              onClick={() => toggleFacet("property.hasImage")}
            >
              有图片
            </button>
            <button type="button" className={quickChipClass} onClick={() => applyDateShortcut("week")}>
              最近 7 天
            </button>
            <button type="button" className={quickChipClass} onClick={() => applyDateShortcut("month")}>
              本月
            </button>
            <button type="button" className={quickChipClass} aria-expanded={showFacets} onClick={() => setShowFacets(!showFacets)}>
              <SlidersHorizontalIcon className="size-3.5" />
              更多筛选
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1 px-3 py-2">
            <span className="px-2 text-xs text-muted-foreground" title={allOwn ? "本人正常记录；可选择包含归档" : scopeLabel}>
              {activeScopeLabel}
            </span>
            {!allOwn && currentUser && (
              <button type="button" className={quickChipClass} onClick={() => setAllOwn(true)}>
                改为全部本人记录
              </button>
            )}
            {mode === "cel" && (
              <button type="button" className={quickChipClass} onClick={() => setMode("text")}>
                高级表达式 · 切回关键词
              </button>
            )}
            {facets.map((filter) => (
              <button
                key={`${filter.factor}:${filter.value}`}
                type="button"
                className={cn(quickChipClass, "border-border bg-muted/50")}
                aria-label={`移除条件 ${facetLabel(filter)}`}
                onClick={() => setFacets(facets.filter((item) => item !== filter))}
              >
                <span className="truncate">{facetLabel(filter)}</span>
                <XIcon className="size-3 shrink-0" />
              </button>
            ))}
          </div>
          {showFacets && (
            <div className="border-y border-border/50">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                {currentUser && (
                  <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                    搜索范围
                    <select
                      aria-label="搜索范围"
                      className="min-h-11 max-w-48 rounded-lg border bg-background px-2 text-foreground"
                      value={allOwn ? "own" : "current"}
                      onChange={(event) => setAllOwn(event.target.value === "own")}
                    >
                      <option value="own">全部本人记录</option>
                      <option value="current">当前范围：{compactScopeLabel}</option>
                    </select>
                  </label>
                )}
                <Button type="button" variant="ghost" onClick={() => setMode(mode === "text" ? "cel" : "text")}>
                  {mode === "text" ? "高级表达式" : "使用关键词"}
                </Button>
              </div>
              <SearchFacetPanel
                filters={facets}
                onChange={setFacets}
                scopeFilter={combineCELFilters(scopeFilter, allOwn ? undefined : selectedMemoView?.filter)}
                state={archived ? State.ARCHIVED : State.NORMAL}
                onDateValidationChange={setDateDraftError}
              />
            </div>
          )}
          {mode === "cel" && (
            <p id={hintId} className="px-4 pb-3 text-xs text-muted-foreground">
              {t("search.keyboard-hint")}{" "}
              <a
                href="https://github.com/EgoSay/kairos/blob/main/docs/usage.md#搜索"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {t("search.syntax-help")}
              </a>
            </p>
          )}
          {matchingTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 px-4 pb-2" aria-label="匹配标签">
              <span className="mr-1 text-xs text-muted-foreground">标签</span>
              {matchingTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={quickChipClass}
                  onClick={() => {
                    setFacets([
                      ...facets.filter(
                        (filter) => filter.factor !== "untagged" && !(filter.factor === "tagSearch" && filter.value === tag),
                      ),
                      { factor: "tagSearch", value: tag },
                    ]);
                    setQuery("");
                  }}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-36 px-2 pb-2" aria-busy={candidates.isFetching}>
            <p className="px-3 py-1 text-xs text-muted-foreground">
              {query.trim() || facets.length ? "匹配记录" : "最近记录"} · 按记录日期
            </p>
            {dateError && !showFacets && (
              <p role="alert" className="px-3 py-4 text-sm text-destructive">
                {dateError}
              </p>
            )}
            {showLoading && (
              <p role="status" className="px-3 py-5 text-sm text-muted-foreground">
                正在查找…
              </p>
            )}
            {candidates.isError && (
              <div role="alert" className="space-y-2 px-3 py-4 text-sm">
                <p>{searchError}</p>
                <Button type="button" variant="outline" onClick={() => void candidates.retry()}>
                  重试搜索
                </Button>
              </div>
            )}
            {searchEnabled && !candidates.isFetching && !candidates.isError && !candidates.memos.length && (
              <p className="px-3 py-5 text-sm text-muted-foreground">没有匹配的记录，试试更短的关键词或移除筛选条件。</p>
            )}
            <MemoCandidateList
              id={listId}
              memos={candidates.memos}
              query={mode === "text" ? query : ""}
              activeName={navigation.activeName}
              onSelect={openMemo}
              action="打开"
              timezone={timezone}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2">
            <span className="text-xs text-muted-foreground">↑↓ 选择 · Enter 查看全部</span>
            <span className="flex items-center gap-1">
              {currentUser && selectedFilters.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setViewComposer({
                      scope: mergeScopes(
                        scopeFromFilters(selectedFilters),
                        !allOwn && selectedMemoView ? parseViewFilter(selectedMemoView.filter, timezone) : emptyViewScope(),
                      ),
                    })
                  }
                >
                  {t("view.save-as")}
                </Button>
              )}
              <Button type="submit" variant="ghost" disabled={Boolean(dateError) || isComposing}>
                查看全部匹配记录
              </Button>
            </span>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default QuickFindDialog;
