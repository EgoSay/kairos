import type { MemoFilter } from "@/contexts/MemoFilterContext";
import { parseLocalDate } from "@/lib/calendar-utils";
import { journalDate, journalDayRange } from "@/lib/journal";

/**
 * Derive a default `createTime` for a new memo from the active memo filters.
 * If a `displayTime:YYYY-MM-DD` filter is present, returns that local date
 * combined with the current time (in the supplied zone when present). Returns undefined otherwise or
 * when the filter value is malformed.
 */
export function deriveDefaultCreateTimeFromFilters(filters: MemoFilter[], now: Date = new Date(), timezone?: string): Date | undefined {
  const dateFilter = filters.find((f) => f.factor === "displayTime");
  if (!dateFilter) return undefined;
  return deriveDefaultCreateTimeFromDate(dateFilter.value, now, timezone);
}

/**
 * The local date `YYYY-MM-DD` combined with `now`'s wall-clock hh:mm:ss, so a memo composed
 * for a past day still orders naturally within it. An explicit zone keeps the same progress
 * through that zone's day instead. Undefined for a malformed date.
 */
export function deriveDefaultCreateTimeFromDate(value: string, now: Date = new Date(), timezone?: string): Date | undefined {
  if (timezone) {
    const range = journalDayRange(value, timezone);
    const today = journalDayRange(journalDate(now, timezone), timezone);
    if (!range || !today) return undefined;
    // Keep today's progress through the day, clamped for shorter DST days. Never
    // let the device zone move a record composed on a calendar day to another day.
    const elapsed = Math.floor(now.getTime() / 1000) - today.start;
    return new Date((range.start + Math.min(elapsed, range.end - range.start - 1)) * 1000);
  }
  const date = parseLocalDate(value);
  if (!date) return undefined;
  date.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  return date;
}
