import { cn } from "@/lib/utils";
import type { CalendarDayCell } from "./types";
import { type ActivityLevel, getActivityLevel } from "./utils";

/**
 * The square chip inside a cell carries every visual. `max-w-[30px]` caps it so a wider
 * container spends its surplus on hit area rather than row height; the 224px rail's ~25px
 * columns sit below the cap and are unaffected.
 */
const CHIP_BASE =
  "relative flex aspect-square w-full max-w-[30px] items-center justify-center rounded-sm text-center text-xs font-normal leading-none tracking-[-0.01em] tabular-nums transition-[background-color,color,filter,box-shadow] duration-150 ease-out";

/** Hover reads off the cell (`group/day`), not the chip, so the whole column responds to the pointer. */
const INTERACTIVE_CHIP =
  "group-hover/day:brightness-[0.97] group-focus-visible/day:ring-2 group-focus-visible/day:ring-ring/40 group-focus-visible/day:ring-inset";

const OUTSIDE_MONTH_CHIP = "bg-transparent text-muted-foreground/25";
const EMPTY_CHIP = "bg-transparent text-foreground group-hover/day:bg-muted/40";
/** A picked day is a checked filter like a view or tag row: it takes the accent, not a ring. */
export const SELECTED_DAY_CHIP = "z-10 bg-primary font-medium text-primary-foreground";

/** Shared by both small calendars. Opaque text and a 42% cap keep dates readable on dark surfaces. */
export const ACTIVITY_LEVEL_STYLES: Record<ActivityLevel, string> = {
  0: "text-foreground",
  1: "bg-primary/12 text-foreground",
  2: "bg-primary/22 text-foreground",
  3: "bg-primary/34 text-foreground",
  4: "bg-primary/42 text-foreground",
};

/**
 * The same ladder for a full calendar day cell, with its hover step: lighter than the chip
 * because excerpts and photos sit on top. Kept beside the chip's so the two cannot drift.
 */
export const DAY_CELL_FILLS: Record<ActivityLevel, string> = {
  0: "bg-card hover:bg-muted/40",
  1: "bg-primary/8 hover:bg-primary/12",
  2: "bg-primary/16 hover:bg-primary/20",
  3: "bg-primary/26 hover:bg-primary/30",
  4: "bg-primary/38 hover:bg-primary/42",
};

const getFillClass = (day: CalendarDayCell, maxCount: number): string => {
  if (!day.isCurrentMonth) return OUTSIDE_MONTH_CHIP;
  // Selected owns the fill outright: layering the empty-cell hover tint on top would swap
  // the accent out on hover and leave primary-foreground text on a muted chip.
  if (day.isSelected) return SELECTED_DAY_CHIP;
  const level = getActivityLevel(day.count, maxCount);
  return level === 0 ? EMPTY_CHIP : ACTIVITY_LEVEL_STYLES[level];
};

export const getChipClassName = (day: CalendarDayCell, maxCount: number, isInteractive: boolean): string =>
  cn(CHIP_BASE, getFillClass(day, maxCount), isInteractive && day.isCurrentMonth && INTERACTIVE_CHIP);
