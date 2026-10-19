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
import i18n from "@/i18n";
import { combineCELFilters } from "@/lib/cel-filter";
import { journalDate } from "@/lib/journal";
import { searchIncludesArchived } from "@/lib/memo-search";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";
import { useTranslate } from "@/utils/i18n";

const fills = ["", "bg-primary/12", "bg-primary/22", "bg-primary/34", "bg-primary/48"];

interface JournalCalendarProps {
  mobile?: boolean;
  onDateSelect?: () => void;
  /** Reuse the collection's exact query, including archived-only views. */
  scope?: { filter?: string; state: State; includeArchived?: boolean };
}

export default function JournalCalendar({ mobile = false, onDateSelect, scope }: JournalCalendarProps) {
  const t = useTranslate();
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
  const locale = i18n.language || "en";
  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(dayjs(`${month}-01`).toDate());
  // 2024-01-01 is a Monday — anchor weekday names to a Monday-start week.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 1 + i)),
  );
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
        {t("journal.calendar-retry")}
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
        {t("journal.calendar-show")}
      </Button>
    );

  return (
    <section aria-label={t("journal.activity-calendar")} className={cn("w-full", mobile && "mb-5 rounded-lg border border-border/60 px-3")}>
      {mobile && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex min-h-11 w-full items-center justify-between text-sm text-muted-foreground"
        >
          {t("journal.activity-calendar")}
          <span>{expanded ? t("journal.collapse") : t("journal.expand")}</span>
        </button>
      )}
      {expanded && (
        <>
          <div className="flex items-center justify-between gap-2 pb-2">
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={t("journal.prev-month")}
              onClick={() => setSelectedMonth(dayjs(month).subtract(1, "month").format("YYYY-MM"))}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm tabular-nums">{monthLabel}</span>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={t("journal.next-month")}
              onClick={() => setSelectedMonth(dayjs(month).add(1, "month").format("YYYY-MM"))}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
          {calendar.isError ? (
            <div className="py-3 text-sm text-muted-foreground">
              <p>{t("journal.calendar-error")}</p>
              <Button variant="ghost" onClick={() => calendar.refetch()}>
                {t("journal.retry")}
              </Button>
            </div>
          ) : (
            <>
              {calendar.isPending && (
                <p role="status" className="py-2 text-xs text-muted-foreground">
                  {t("journal.calendar-loading")}
                </p>
              )}
              <div className="grid grid-cols-7 gap-1" aria-label={t("journal.calendar-current-range", { month: monthLabel })}>
                {weekdays.map((label) => (
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
                      title={t("journal.calendar-day-count", { date: day.date, count: day.count })}
                      aria-label={t("journal.calendar-day-count", { date: day.date, count: day.count })}
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
            <span title={t("journal.calendar-scope-note", { timezone })}>
              {t("journal.current-scope")}
              {state === State.ARCHIVED ? t("journal.scope-archived") : includeArchived ? t("journal.scope-includes-archived") : ""}
            </span>
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ calendarVisible: false })}
              className="min-h-11 rounded-lg px-2 hover:text-foreground focus-visible:outline-2"
            >
              {t("journal.hide")}
            </button>
          </div>
          {update.isError && (
            <p role="alert" className="pb-3 text-sm text-destructive">
              {t("journal.preference-save-error")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
