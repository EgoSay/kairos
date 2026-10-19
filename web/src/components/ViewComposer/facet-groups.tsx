/**
 * [INPUT]: MemoFilter、SearchFacetPanel 的 facetDateDraftError、view-scope 时间选择助手、i18n
 * [OUTPUT]: FacetGroup（手风琴行）、Pill（切换丸）、TimeEditor（时间组编辑器）、GROUP_FACTORS
 * [POS]: components/ViewComposer 的条件编辑器 —— 单开手风琴，五组控件按需展开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ChevronDownIcon, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { facetDateDraftError } from "@/components/AppSidebar/SearchFacetPanel";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import type { FilterFactor, MemoFilter } from "@/contexts/MemoFilterContext";
import { cn } from "@/lib/utils";
import { DYNAMIC_RANGE_LABEL_KEYS, DYNAMIC_RANGE_PRESETS, withTimeSelection } from "@/lib/view-scope";
import type { Translations } from "@/utils/i18n";

export type FacetGroupId = "content" | "time" | "tags" | "properties" | "partition";

/** Which factors each accordion group owns — drives the active-count badges. */
export const GROUP_FACTORS: Record<FacetGroupId, readonly FilterFactor[]> = {
  content: ["contentSearch"],
  time: ["dateStart", "dateEnd", "dateRange", "displayTime"],
  tags: ["tagSearch", "tagExclude", "tagMatch", "tagExact"],
  properties: [
    "untagged",
    "property.hasImage",
    "property.hasAudio",
    "property.hasAttachment",
    "property.hasLink",
    "property.hasCode",
    "property.hasTaskList",
    "property.hasLocation",
    "pinned",
    "includeArchived",
  ],
  partition: ["partition"],
};

interface FacetGroupProps {
  icon: LucideIcon;
  label: string;
  /** Active-condition count shown as a badge — the chips above remain the truth. */
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** One collapsible row of the condition domain — the editor stays a calm list until asked. */
export const FacetGroup = ({ icon: Icon, label, count, open, onToggle, children }: FacetGroupProps) => (
  <div>
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent/50",
        FOCUS_VISIBLE_OUTLINE_CLASSES,
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn("flex-1 text-start", open && "font-medium")}>{label}</span>
      {count > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">{count}</span>}
      <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
    </button>
    {open && <div className="px-3 pb-3">{children}</div>}
  </div>
);

interface PillProps extends React.ComponentProps<"button"> {
  active: boolean;
}

/** A single-choice pill — the active one fills like a selected chip. */
export const Pill = ({ active, className, type = "button", ...props }: PillProps) => (
  <button
    type={type}
    aria-pressed={active}
    className={cn(
      "h-7 rounded-full border px-2.5 text-sm transition-colors",
      active
        ? "border-border bg-accent font-medium text-foreground"
        : "border-border/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      FOCUS_VISIBLE_OUTLINE_CLASSES,
      className,
    )}
    {...props}
  />
);

type T = (key: Translations, params?: Record<string, unknown>) => string;

interface TimeEditorProps {
  filters: MemoFilter[];
  onChange: (filters: MemoFilter[]) => void;
  onDateValidationChange?: (error: string | undefined) => void;
  /** Bumped on "clear conditions" — drops a half-typed fixed range even when nothing committed. */
  resetKey?: number;
  t: T;
}

/**
 * Time selection as one pill row: no-limit / fixed dates / rolling presets.
 * Fixed reveals its date inputs; fixed and dynamic are mutually exclusive scopes.
 */
export const TimeEditor = ({ filters, onChange, onDateValidationChange, resetKey = 0, t }: TimeEditorProps) => {
  const rangeValue = filters.find((filter) => filter.factor === "dateRange")?.value;
  const start = filters.find((filter) => filter.factor === "dateStart")?.value ?? "";
  const end = filters.find((filter) => filter.factor === "dateEnd")?.value ?? "";
  const [draft, setDraft] = useState({ start, end });
  // "Fixed" intent lives locally until both dates are committed as a valid range.
  const [fixedIntent, setFixedIntent] = useState(Boolean(start || end));

  useEffect(() => {
    setDraft({ start, end });
    setFixedIntent(Boolean(start || end));
  }, [start, end, resetKey]);

  const draftError = facetDateDraftError(draft.start, draft.end);
  useEffect(() => {
    onDateValidationChange?.(fixedIntent ? draftError : undefined);
    return () => onDateValidationChange?.(undefined);
  }, [fixedIntent, draftError, onDateValidationChange]);

  const commitFixed = (next: { start: string; end: string }) => {
    setDraft(next);
    if (facetDateDraftError(next.start, next.end)) return;
    onChange(withTimeSelection(filters, { kind: "fixed", start: next.start, end: next.end }));
  };

  const pick = (choice: "none" | "fixed" | string) => {
    if (choice === "none") {
      setFixedIntent(false);
      setDraft({ start: "", end: "" });
      onChange(withTimeSelection(filters, { kind: "none" }));
      return;
    }
    if (choice === "fixed") {
      setFixedIntent(true);
      if (!facetDateDraftError(draft.start, draft.end)) {
        onChange(withTimeSelection(filters, { kind: "fixed", start: draft.start, end: draft.end }));
      }
      return;
    }
    setFixedIntent(false);
    onChange(withTimeSelection(filters, { kind: "dynamic", preset: choice }));
  };

  const fixedActive = fixedIntent || Boolean(start || end);
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        <Pill active={!rangeValue && !fixedActive} onClick={() => pick("none")}>
          {t("view.range-none")}
        </Pill>
        <Pill active={fixedActive} onClick={() => pick("fixed")}>
          {t("view.time-fixed")}
        </Pill>
        {DYNAMIC_RANGE_PRESETS.map((preset) => (
          <Pill key={preset.id} active={rangeValue === preset.id} onClick={() => pick(preset.id)}>
            {t(DYNAMIC_RANGE_LABEL_KEYS[preset.id])}
          </Pill>
        ))}
      </div>
      {fixedActive && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label={t("view.date-start")}
            value={draft.start}
            onChange={(event) => commitFixed({ ...draft, start: event.target.value })}
          />
          <Input
            type="date"
            aria-label={t("view.date-end")}
            value={draft.end}
            onChange={(event) => commitFixed({ ...draft, end: event.target.value })}
          />
        </div>
      )}
      {fixedActive && draftError && (
        <p role="alert" className="text-xs text-destructive">
          {draftError}
        </p>
      )}
      {rangeValue && <p className="text-xs text-muted-foreground">{t("view.range-dynamic-hint")}</p>}
    </div>
  );
};
