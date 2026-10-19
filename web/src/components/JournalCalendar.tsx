import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { buildMonthDays } from "@/components/ActivityCalendar/monthDays";
import { calculateMaxCount, getActivityLevel } from "@/components/ActivityCalendar/utils";
import { Button } from "@/components/ui/button";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useSpaceContext } from "@/contexts/SpaceContext";
import { useJournalPreferences, useUpdateJournalPreferences } from "@/hooks/useJournalQueries";
import { useMemoFilters } from "@/hooks/useMemoFilters";
import { useAllUserStats } from "@/hooks/useUserQueries";
import { combineCELFilters } from "@/lib/cel-filter";
import { journalDate } from "@/lib/journal";
import { searchIncludesArchived } from "@/lib/memo-search";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";

const fills = ["", "bg-primary/12", "bg-primary/22", "bg-primary/34", "bg-primary/48"];

interface JournalCalendarProps {
  mobile?: boolean;
  onDateSelect?: () => void;
  /** Reuse the collection's exact query, including archived-only views. */
  scope?: { filter?: string; state: State; includeArchived?: boolean };
}

export default function JournalCalendar({ mobile = false, onDateSelect, scope }: JournalCalendarProps) {
  const preferences = useJournalPreferences();
  const update = useUpdateJournalPreferences();
  const timezone = preferences.data?.timezone || "Asia/Shanghai";
  const today = journalDate(new Date(), timezone);
  const [selectedMonth, setSelectedMonth] = useState<string>();
  const month = selectedMonth ?? today.slice(0, 7);
  const [expanded, setExpanded] = useState(!mobile);
  const visible = preferences.data?.calendarVisible ?? false;
  const location = useLocation();
  const { filters } = useMemoFilterContext();
  const { memoFilter } = useSpaceContext();
  const activeFilter = useMemoFilters({ includeMemoViews: true, includePinned: true });
  const filter = scope ? scope.filter : combineCELFilters(memoFilter, activeFilter);
  const state = scope?.state ?? State.NORMAL;
  const includeArchived = state !== State.ARCHIVED && (scope?.includeArchived ?? searchIncludesArchived(filters));
  const calendar = useAllUserStats({ filter, state, includeArchived }, { enabled: visible && expanded });
  const counts: Record<string, number> = {};
  for (const stats of calendar.data ?? []) {
    for (const timestamp of stats.memoCreatedTimestamps) {
      const date = journalDate(timestampDate(timestamp), timezone);
      counts[date] = (counts[date] ?? 0) + 1;
    }
  }
  const dayQuery = new URLSearchParams({
    scoped: "1",
    scope: filter ?? "",
    archived: includeArchived ? "1" : "0",
    state: state === State.ARCHIVED ? "archived" : "normal",
    from: location.pathname + location.search,
  });
  const maxCount = calculateMaxCount(counts);
  const days = buildMonthDays({ month, data: counts, today, weekStartDayOffset: 1 });

  if (preferences.isPending) return null;
  if (preferences.isError)
    return (
      <Button variant="ghost" onClick={() => preferences.refetch()}>
        重试读取日历
      </Button>
    );
  if (!visible)
    return (
      <Button
        variant="ghost"
        disabled={update.isPending}
        className="min-h-11 text-sm text-muted-foreground"
        onClick={() => update.mutate({ calendarVisible: true })}
      >
        显示活动日历
      </Button>
    );

  return (
    <section aria-label="活动日历" className={cn("w-full", mobile && "mb-5 rounded-lg border border-border/60 px-3")}>
      {mobile && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex min-h-11 w-full items-center justify-between text-sm text-muted-foreground"
        >
          活动日历<span>{expanded ? "收起" : "展开"}</span>
        </button>
      )}
      {expanded && (
        <>
          <div className="flex items-center justify-between gap-2 pb-2">
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label="上个月"
              onClick={() => setSelectedMonth(dayjs(month).subtract(1, "month").format("YYYY-MM"))}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm tabular-nums">{month.replace("-", " 年 ")} 月</span>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label="下个月"
              onClick={() => setSelectedMonth(dayjs(month).add(1, "month").format("YYYY-MM"))}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
          {calendar.isError ? (
            <div className="py-3 text-sm text-muted-foreground">
              <p>日历暂时无法读取。</p>
              <Button variant="ghost" onClick={() => calendar.refetch()}>
                重试
              </Button>
            </div>
          ) : (
            <>
              {calendar.isPending && (
                <p role="status" className="py-2 text-xs text-muted-foreground">
                  正在读取日历…
                </p>
              )}
              <div className="grid grid-cols-7 gap-1" aria-label={`${month} 当前范围记录`}>
                {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
                  <span key={label} aria-hidden="true" className="pb-2 text-center text-xs text-muted-foreground">
                    {label}
                  </span>
                ))}
                {days.map((day) =>
                  day.isCurrentMonth ? (
                    <Link
                      key={day.date}
                      to={`${ROUTES.JOURNAL}/day/${day.date}?${dayQuery}`}
                      onClick={onDateSelect}
                      title={`${day.date}，${day.count} 条记录`}
                      aria-label={`${day.date}，${day.count} 条记录`}
                      aria-current={day.isToday ? "date" : undefined}
                      className={cn(
                        "flex aspect-square min-h-8 items-center justify-center rounded-sm text-xs tabular-nums hover:ring-1 hover:ring-ring focus-visible:outline-2 focus-visible:outline-offset-1",
                        preferences.data?.calendarColor && fills[getActivityLevel(day.count, maxCount)],
                        day.isToday && "font-bold underline underline-offset-4",
                      )}
                    >
                      {day.label}
                    </Link>
                  ) : (
                    <span key={day.date} />
                  ),
                )}
              </div>
            </>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 pb-2 text-xs text-muted-foreground">
            <span title={`按记录原始日期统计 · ${timezone}`}>
              当前范围{state === State.ARCHIVED ? " · 已归档" : includeArchived ? " · 含归档" : ""}
            </span>
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ calendarVisible: false })}
              className="min-h-11 rounded-lg px-2 hover:text-foreground focus-visible:outline-2"
            >
              隐藏
            </button>
          </div>
          {update.isError && (
            <p role="alert" className="pb-3 text-sm text-destructive">
              设置未保存，请重试。
            </p>
          )}
        </>
      )}
    </section>
  );
}
