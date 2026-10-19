import { timestampDate } from "@bufbuild/protobuf/wkt";
import { countBy } from "lodash-es";
import { useMemo, useRef } from "react";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { type MemoTimeBasis, useView } from "@/contexts/ViewContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useAllUserStats, useUserStats } from "@/hooks/useUserQueries";
import { journalDate } from "@/lib/journal";
import { searchIncludesArchived } from "@/lib/memo-search";
import { mergeTagCounts } from "@/lib/tag";
import { State } from "@/types/proto/api/v1/common_pb";
import type { UserStats } from "@/types/proto/api/v1/user_service_pb";
import type { StatisticsData } from "@/types/statistics";

export interface FilteredMemoStats {
  statistics: StatisticsData;
  tags: Record<string, number>;
  loading: boolean;
  error: Error | null;
  retrying: boolean;
  retry: () => void;
}

export type MemoStatsContext = "home" | "collection" | "archived";

export interface UseFilteredMemoStatsOptions {
  userName?: string;
  context?: MemoStatsContext;
  enabled?: boolean;
  filter?: string;
  /**
   * Filter for the tag-count surface when it should differ from `filter` — e.g. the
   * sidebar tag tree ignores the tag facet itself so picking a tag doesn't collapse it.
   */
  tagFilter?: string;
}

const timestampsForBasis = (stats: UserStats, basis: MemoTimeBasis) => {
  const createdArray = stats.memoCreatedTimestamps ?? [];
  const updatedArray = stats.memoUpdatedTimestamps ?? [];
  const wantUpdated = basis === "update_time";
  const oldServerFallback = wantUpdated && updatedArray.length === 0 && createdArray.length > 0;
  if (oldServerFallback) {
    console.warn("UserStats.memo_updated_timestamps not present; falling back to memo_created_timestamps");
  }
  return wantUpdated && !oldServerFallback ? updatedArray : createdArray;
};

export const useFilteredMemoStats = (options: UseFilteredMemoStatsOptions = {}): FilteredMemoStats => {
  const { userName, context, enabled = true, filter, tagFilter } = options;
  const currentUser = useCurrentUser();
  const { timeBasis } = useView();
  const preferences = useJournalPreferences();
  const timezone = preferences.data?.timezone ?? "Asia/Shanghai";
  const { filters } = useMemoFilterContext();
  const includeArchived = searchIncludesArchived(filters) && context !== "archived";

  // Legacy personal collections use backend per-user stats.
  const userStatsQuery = useUserStats(userName, { enabled, filter });
  const { data: userStats, isLoading: isLoadingUserStats } = userStatsQuery;
  // Collection and Archived fetch grouped stats and aggregate them locally.
  // ListAllUserStats AND's the request filter with the server's auth filter, so
  // private memos are not included unless explicitly visible to the current user.
  const allUserStatsRequest =
    context === "collection"
      ? { state: State.NORMAL, filter, includeArchived }
      : context === "archived"
        ? { state: State.ARCHIVED, filter }
        : {};
  const shouldFetchAllUserStats = context === "collection" || (context === "archived" && !!currentUser?.name);
  const allStatsQuery = useAllUserStats(allUserStatsRequest, {
    enabled: enabled && shouldFetchAllUserStats,
  });
  const { data: allUserStats = [], isLoading: isLoadingAllUserStats } = allStatsQuery;

  // Tag counts can need a different filter than the activity stats; only fetch a
  // second stats result when it actually differs — same filter shares the cache.
  const separateTagQuery = tagFilter !== undefined && tagFilter !== filter;
  const tagUserStatsQuery = useUserStats(userName, { enabled: enabled && separateTagQuery && !!userName, filter: tagFilter });
  const { data: tagUserStats } = tagUserStatsQuery;
  const tagAllStatsQuery = useAllUserStats(
    context === "collection"
      ? { state: State.NORMAL, filter: tagFilter, includeArchived }
      : context === "archived"
        ? { state: State.ARCHIVED, filter: tagFilter }
        : {},
    { enabled: enabled && separateTagQuery && shouldFetchAllUserStats },
  );
  const { data: tagAllUserStats = [] } = tagAllStatsQuery;
  const tagStatsInFlight = separateTagQuery && (tagAllStatsQuery.isFetching || tagUserStatsQuery.isFetching);

  // The tag tree is a navigation surface: while its dedicated stats reload, keep
  // showing the last real counts instead of flashing an empty tree.
  const stableTagCountRef = useRef<Record<string, number>>({});

  const data = useMemo(() => {
    const loading = isLoadingUserStats || isLoadingAllUserStats;
    let activityStats: Record<string, number> = {};
    let tagCount: Record<string, number> = mergeTagCounts();

    if (context === "collection" || context === "archived") {
      const displayDates: string[] = [];
      tagCount = mergeTagCounts(...(separateTagQuery ? tagAllUserStats : allUserStats).map((stats) => stats.tagCount));
      for (const stats of allUserStats) {
        displayDates.push(
          ...timestampsForBasis(stats, timeBasis)
            .map((ts) => (ts ? timestampDate(ts) : undefined))
            .filter((date): date is Date => date !== undefined)
            .map((date) => journalDate(date, timezone)),
        );
      }
      activityStats = countBy(displayDates);
    } else if (userName && userStats) {
      // Legacy personal collections use backend per-user stats.
      const sourceArray = timestampsForBasis(userStats, timeBasis);
      if (sourceArray.length > 0) {
        activityStats = countBy(
          sourceArray
            .map((ts) => (ts ? timestampDate(ts) : undefined))
            .filter((date): date is Date => date !== undefined)
            .map((date) => journalDate(date, timezone)),
        );
      }
      if (userStats.tagCount) {
        tagCount = mergeTagCounts((separateTagQuery && tagUserStats ? tagUserStats : userStats).tagCount);
      }
    }

    if (Object.keys(tagCount).length > 0 || !tagStatsInFlight) {
      stableTagCountRef.current = tagCount;
    }
    return { statistics: { activityStats, timeBasis }, tags: stableTagCountRef.current, loading };
  }, [
    context,
    userName,
    userStats,
    allUserStats,
    separateTagQuery,
    tagUserStats,
    tagAllUserStats,
    isLoadingUserStats,
    isLoadingAllUserStats,
    tagStatsInFlight,
    timeBasis,
    timezone,
  ]);

  const query = context === "collection" || context === "archived" ? allStatsQuery : userStatsQuery;
  return {
    ...data,
    error: query.error ?? null,
    retrying: query.isFetching,
    retry: () => {
      void query.refetch();
    },
  };
};
