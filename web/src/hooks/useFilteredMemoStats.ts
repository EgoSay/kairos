import { timestampDate } from "@bufbuild/protobuf/wkt";
import { countBy } from "lodash-es";
import { useMemo } from "react";
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
  /** Explicit archived inclusion (e.g. a day reader's scope snapshot); defaults to the search facets. */
  includeArchived?: boolean;
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
  const { userName, context, enabled = true, filter, includeArchived: includeArchivedOption } = options;
  const currentUser = useCurrentUser();
  const { timeBasis } = useView();
  const preferences = useJournalPreferences();
  const timezone = preferences.data?.timezone ?? "Asia/Shanghai";
  const { filters } = useMemoFilterContext();
  const includeArchived = includeArchivedOption ?? (searchIncludesArchived(filters) && context !== "archived");

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

  const data = useMemo(() => {
    const loading = isLoadingUserStats || isLoadingAllUserStats;
    let activityStats: Record<string, number> = {};
    let tagCount: Record<string, number> = mergeTagCounts();

    if (context === "collection" || context === "archived") {
      const displayDates: string[] = [];
      tagCount = mergeTagCounts(...allUserStats.map((stats) => stats.tagCount));
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
        tagCount = mergeTagCounts(userStats.tagCount);
      }
    }

    return { statistics: { activityStats, timeBasis }, tags: tagCount, loading };
  }, [context, userName, userStats, allUserStats, isLoadingUserStats, isLoadingAllUserStats, timeBasis, timezone]);

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
