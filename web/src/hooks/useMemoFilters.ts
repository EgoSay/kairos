import { useMemo } from "react";
import { type MemoFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { type MemoTimeBasis, useView } from "@/contexts/ViewContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useMemoViews } from "@/hooks/useUserQueries";
import { buildTimestampRangeFilter, getTimeBasisField } from "@/lib/calendar-utils";
import { combineCELFilters } from "@/lib/cel-filter";
import { journalDayRange } from "@/lib/journal";
import { buildSearchFacetConditions } from "@/lib/memo-search";
import { getMemoViewId } from "@/lib/memo-views";
import { buildMemoCreatorFilter, getVisibilityName } from "@/lib/resource-names";
import { dynamicRangePreset } from "@/lib/view-scope";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useJournalPreferences } from "./useJournalQueries";

const escapeFilterValue = (value: string): string => JSON.stringify(value);

export interface UseMemoFiltersOptions {
  creatorName?: string;
  includeMemoViews?: boolean;
  includePinned?: boolean;
  visibilities?: Visibility[];
  /** Interactive factors to drop — e.g. tag stats ignore the tag dimension itself. */
  excludeFactors?: readonly MemoFilter["factor"][];
}

interface BuildMemoFilterOptions {
  creatorName?: string;
  filters: MemoFilter[];
  includePinned: boolean;
  selectedMemoViewFilter?: string;
  visibilities?: Visibility[];
  /** Interactive factors to drop before serialization. */
  excludeFactors?: readonly MemoFilter["factor"][];
  /** Which timestamp a `displayTime` day filter selects on; defaults to creation time. */
  timeBasis?: MemoTimeBasis;
  timezone?: string;
}

export const buildMemoFilter = ({
  creatorName,
  filters,
  includePinned,
  selectedMemoViewFilter,
  visibilities,
  excludeFactors,
  timeBasis = "create_time",
  timezone = "Asia/Shanghai",
}: BuildMemoFilterOptions): string | undefined => {
  const conditions: string[] = [];
  const effectiveFilters = excludeFactors?.length ? filters.filter((filter) => !excludeFactors.includes(filter.factor)) : filters;

  if (creatorName) {
    const creatorFilter = buildMemoCreatorFilter(creatorName);
    if (creatorFilter) {
      conditions.push(creatorFilter);
    }
  }

  if (selectedMemoViewFilter) {
    conditions.push(selectedMemoViewFilter);
  }

  for (const filter of effectiveFilters) {
    if (filter.factor === "contentSearch") {
      conditions.push(`content.contains(${escapeFilterValue(filter.value)})`);
    } else if (filter.factor === "celSearch") {
      conditions.push(filter.value);
    } else if (filter.factor === "pinned") {
      if (includePinned) {
        conditions.push(`pinned`);
      }
    } else if (filter.factor === "property.hasLink") {
      conditions.push(`has_link`);
    } else if (filter.factor === "property.hasTaskList") {
      conditions.push(`has_task_list`);
    } else if (filter.factor === "property.hasCode") {
      conditions.push(`has_code`);
    } else if (filter.factor === "property.hasLocation") {
      conditions.push(`has_location`);
    } else if (filter.factor === "dateRange") {
      const preset = dynamicRangePreset(filter.value);
      if (preset) conditions.push(preset.cel);
    } else if (filter.factor === "displayTime") {
      const range = journalDayRange(filter.value, timezone);
      if (range) {
        conditions.push(buildTimestampRangeFilter(getTimeBasisField(timeBasis), { startTimestamp: range.start, endTimestamp: range.end }));
      }
    }
  }

  conditions.push(...buildSearchFacetConditions(effectiveFilters, timezone));

  if (visibilities && visibilities.length > 0) {
    const visibilityValues = visibilities.map((visibility) => `"${getVisibilityName(visibility)}"`).join(", ");
    conditions.push(`visibility in [${visibilityValues}]`);
  }

  return combineCELFilters(...conditions);
};

/** Stored CEL filter of the saved View selected in the sidebar. */
export const useSelectedMemoViewFilter = (): string | undefined => {
  const currentUser = useCurrentUser();
  const { memoView } = useMemoFilterContext();
  const { data: memoViews = [] } = useMemoViews(currentUser?.name);
  return useMemo(() => {
    return memoViews.find((view) => getMemoViewId(view.name) === memoView)?.filter;
  }, [memoView, memoViews]);
};

export const useMemoFilters = (options: UseMemoFiltersOptions = {}): string | undefined => {
  const { creatorName, includeMemoViews = false, includePinned = false, visibilities, excludeFactors } = options;

  const { filters } = useMemoFilterContext();
  const selectedMemoViewFilter = useSelectedMemoViewFilter();
  // The sidebar calendar buckets days by this basis, so a picked day must select on it too.
  const { timeBasis } = useView();
  const { data: preferences } = useJournalPreferences();

  return useMemo(
    () =>
      buildMemoFilter({
        creatorName,
        filters,
        includePinned,
        selectedMemoViewFilter: includeMemoViews ? selectedMemoViewFilter : undefined,
        visibilities,
        excludeFactors,
        timeBasis,
        timezone: preferences?.timezone,
      }),
    [
      creatorName,
      filters,
      includePinned,
      includeMemoViews,
      selectedMemoViewFilter,
      visibilities,
      excludeFactors,
      timeBasis,
      preferences?.timezone,
    ],
  );
};
