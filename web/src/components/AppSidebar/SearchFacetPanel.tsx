import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import type { FilterFactor, MemoFilter } from "@/contexts/MemoFilterContext";
import { useJournalPartitions } from "@/hooks/useJournalPartitionQueries";
import { useAllUserStats } from "@/hooks/useUserQueries";
import { searchIncludesArchived } from "@/lib/memo-search";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";

const SELECT_CLASSES = cn("h-8 rounded-sm border border-border bg-background px-2 text-sm", FOCUS_VISIBLE_OUTLINE_CLASSES);

// One pill per toggleable condition — pressed state reads like an active chip.
const TOGGLE_PILL_CLASSES = cn("h-7 rounded-full border px-2.5 text-sm transition-colors", FOCUS_VISIBLE_OUTLINE_CLASSES);

interface FacetProps {
  filters: MemoFilter[];
  onChange: (filters: MemoFilter[]) => void;
}

interface Props extends FacetProps {
  scopeFilter?: string;
  state?: State;
  onDateValidationChange?: (error: string | undefined) => void;
  /** Hosts merge into the root so the panel can drop its own chrome inside a framed container. */
  className?: string;
}

const value = (filters: MemoFilter[], factor: FilterFactor) => filters.find((filter) => filter.factor === factor)?.value ?? "";

const setFactor = (filters: MemoFilter[], factor: FilterFactor, next: string | undefined): MemoFilter[] => [
  ...filters.filter((filter) => filter.factor !== factor && !(factor === "untagged" && next && filter.factor === "tagSearch")),
  ...(next === undefined ? [] : [{ factor, value: next }]),
];

export const searchDateError = (filters: MemoFilter[]): string | undefined => {
  const start = value(filters, "dateStart");
  const end = value(filters, "dateEnd");
  return start && end && start > end ? "开始日期不能晚于结束日期。" : undefined;
};

/** Draft-aware range check: a half-typed range blocks saving until completed. */
export const facetDateDraftError = (start: string, end: string): string | undefined =>
  Boolean(start) !== Boolean(end)
    ? "请补全开始和结束日期，完整范围会立即生效。"
    : start && end && start > end
      ? "开始日期不能晚于结束日期。"
      : undefined;

interface DateFieldsProps extends FacetProps {
  onDateValidationChange?: (error: string | undefined) => void;
  /** Bumped by the host's "clear" action — an uncommitted draft must die even when filters never changed. */
  resetKey?: number;
}

const FacetDateFields = ({ filters, onChange, onDateValidationChange, resetKey = 0 }: DateFieldsProps) => {
  const start = value(filters, "dateStart");
  const end = value(filters, "dateEnd");
  const [dateDraft, setDateDraft] = useState({ start, end });
  const [dateDraftError, setDateDraftError] = useState<string>();
  useEffect(() => {
    setDateDraft({ start, end });
    setDateDraftError(undefined);
    onDateValidationChange?.(undefined);
  }, [start, end, resetKey, onDateValidationChange]);
  useEffect(() => () => onDateValidationChange?.(undefined), [onDateValidationChange]);
  const updateDate = (edge: "start" | "end", value: string) => {
    const draft = { ...dateDraft, [edge]: value };
    setDateDraft(draft);
    const error = facetDateDraftError(draft.start, draft.end);
    setDateDraftError(error);
    onDateValidationChange?.(error);
    if (error) return;
    onChange([
      ...filters.filter((filter) => !["dateStart", "dateEnd", "displayTime"].includes(filter.factor)),
      ...(draft.start
        ? [
            { factor: "dateStart" as const, value: draft.start },
            { factor: "dateEnd" as const, value: draft.end },
          ]
        : []),
    ]);
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          开始日期
          <Input type="date" aria-label="开始日期" value={dateDraft.start} onChange={(e) => updateDate("start", e.target.value)} />
        </label>
        <label className="space-y-1">
          结束日期
          <Input type="date" aria-label="结束日期" value={dateDraft.end} onChange={(e) => updateDate("end", e.target.value)} />
        </label>
      </div>
      {(dateDraftError || searchDateError(filters)) && (
        <p role="alert" className="text-destructive">
          {dateDraftError || searchDateError(filters)}
        </p>
      )}
    </>
  );
};

const TOGGLES: Array<[FilterFactor, string]> = [
  ["untagged", "未添加标签"],
  ["property.hasImage", "有图片"],
  ["property.hasAudio", "有音频"],
  ["property.hasAttachment", "有附件"],
  ["property.hasLocation", "有位置"],
  ["pinned", "已置顶"],
  ["includeArchived", "包含归档"],
];

/** Toggleable record traits — pills instead of checkboxes so the active set scans like chips. */
export const FacetPropertyToggles = ({ filters, onChange }: FacetProps) => (
  <div className="flex flex-wrap gap-1.5">
    {TOGGLES.map(([factor, label]) => {
      const active = Boolean(value(filters, factor));
      return (
        <button
          key={factor}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(setFactor(filters, factor, active ? undefined : "true"))}
          className={cn(
            TOGGLE_PILL_CLASSES,
            active
              ? "border-border bg-accent text-foreground"
              : "border-border/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          {label}
        </button>
      );
    })}
  </div>
);

interface TagFieldsProps extends FacetProps {
  scopeFilter?: string;
  state?: State;
}

/** Tag include/exclude input with suggestions, match mode and descendant toggle. */
export const FacetTagFields = ({ filters, onChange, scopeFilter, state = State.NORMAL }: TagFieldsProps) => {
  const stats = useAllUserStats({
    filter: scopeFilter,
    state,
    includeArchived: state !== State.ARCHIVED && searchIncludesArchived(filters),
  });
  const tags = [...new Set(stats.data?.flatMap((item) => Object.keys(item.tagCount)) ?? [])].sort();
  const tagListId = useId();
  const [tagInput, setTagInput] = useState("");
  const [tagAction, setTagAction] = useState<"tagSearch" | "tagExclude">("tagSearch");
  const addTag = () => {
    const tag = tagInput.trim().replace(/^#/, "");
    if (!tag) return;
    onChange([
      ...filters.filter(
        (filter) => !(tagAction === "tagSearch" && filter.factor === "untagged") && !(filter.factor === tagAction && filter.value === tag),
      ),
      { factor: tagAction, value: tag },
    ]);
    setTagInput("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="标签操作"
          className={SELECT_CLASSES}
          value={tagAction}
          onChange={(e) => setTagAction(e.target.value as typeof tagAction)}
        >
          <option value="tagSearch">包含标签</option>
          <option value="tagExclude">排除标签</option>
        </select>
        <Input
          className="min-w-0 flex-1"
          list={tagListId}
          aria-label="标签路径"
          placeholder="搜索或输入完整标签路径"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (!e.nativeEvent.isComposing && e.keyCode !== 229) addTag();
            }
          }}
        />
        <datalist id={tagListId}>
          {tags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <Button type="button" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
          添加
        </Button>
      </div>
      {stats.isError && (
        <div role="alert" className="text-xs text-muted-foreground">
          <p>标签列表读取失败，已选筛选条件仍保留。可以继续手动输入标签。{tags.length > 0 ? "建议列表是上次读取的结果。" : ""}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={stats.isFetching}
            onClick={() => {
              void stats.refetch();
            }}
          >
            重试读取标签
          </Button>
        </div>
      )}
      {stats.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取标签建议…
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="标签匹配方式"
          className={SELECT_CLASSES}
          value={value(filters, "tagMatch") || "all"}
          onChange={(e) => onChange(setFactor(filters, "tagMatch", e.target.value === "all" ? undefined : "any"))}
        >
          <option value="all">包含全部所选标签</option>
          <option value="any">包含任一所选标签</option>
        </select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={!value(filters, "tagExact")}
            onChange={(e) => onChange(setFactor(filters, "tagExact", e.target.checked ? undefined : "true"))}
          />
          包含子标签
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {filters
          .filter((filter) => filter.factor === "tagSearch" || filter.factor === "tagExclude")
          .map((filter) => (
            <Button
              key={`${filter.factor}:${filter.value}`}
              variant="outline"
              size="sm"
              type="button"
              aria-label={`移除${filter.factor === "tagExclude" ? "排除" : "包含"}标签 ${filter.value}`}
              onClick={() => onChange(filters.filter((item) => item !== filter))}
            >
              {filter.factor === "tagExclude" ? "排除 " : ""}#{filter.value} ×
            </Button>
          ))}
      </div>
    </div>
  );
};

/** Just the partition select — hosts add their own label or accordion heading. */
export const FacetPartitionSelect = ({ filters, onChange }: FacetProps) => {
  const partitions = useJournalPartitions();
  return (
    <>
      <select
        aria-label="分区筛选"
        className={cn(SELECT_CLASSES, "min-w-0 flex-1")}
        value={filters.some((filter) => filter.factor === "partition") ? value(filters, "partition") || "__none" : "__all"}
        onChange={(e) =>
          onChange(
            setFactor(filters, "partition", e.target.value === "__all" ? undefined : e.target.value === "__none" ? "" : e.target.value),
          )
        }
      >
        <option value="__all">全部分区</option>
        <option value="__none">未分区</option>
        {partitions.data?.partitions.map((partition) => (
          <option key={partition.id} value={partition.id}>
            {partition.name}
          </option>
        ))}
      </select>
      {partitions.isError && (
        <p role="alert">
          分区列表读取失败。
          <button type="button" className="underline" onClick={() => partitions.refetch()}>
            重试
          </button>
        </p>
      )}
    </>
  );
};

export default function SearchFacetPanel({
  filters,
  onChange,
  scopeFilter,
  state = State.NORMAL,
  onDateValidationChange,
  className,
}: Props) {
  const [resetKey, setResetKey] = useState(0);
  const clearFilters = () => {
    onDateValidationChange?.(undefined);
    setResetKey((key) => key + 1);
    onChange([]);
  };
  return (
    <div className={cn("space-y-4 border-t p-4 text-sm", className)} aria-label="筛选条件">
      <FacetDateFields filters={filters} onChange={onChange} onDateValidationChange={onDateValidationChange} resetKey={resetKey} />
      <FacetPropertyToggles filters={filters} onChange={onChange} />
      <FacetTagFields filters={filters} onChange={onChange} scopeFilter={scopeFilter} state={state} />
      <label className="flex items-center gap-2">
        分区
        <FacetPartitionSelect filters={filters} onChange={onChange} />
      </label>
      <p className="text-xs text-muted-foreground">日期按记录原始时间及 Kairos 时区筛选。回收站不包含在搜索中。</p>
      <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
        清空筛选条件
      </Button>
    </div>
  );
}
