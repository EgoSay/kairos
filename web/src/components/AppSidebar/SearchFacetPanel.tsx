import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FilterFactor, MemoFilter } from "@/contexts/MemoFilterContext";
import { useJournalPartitions } from "@/hooks/useJournalPartitionQueries";
import { useAllUserStats } from "@/hooks/useUserQueries";
import { searchIncludesArchived } from "@/lib/memo-search";
import { State } from "@/types/proto/api/v1/common_pb";

interface Props {
  filters: MemoFilter[];
  onChange: (filters: MemoFilter[]) => void;
  scopeFilter?: string;
}

export const searchDateError = (filters: MemoFilter[]): string | undefined => {
  const start = filters.find((filter) => filter.factor === "dateStart")?.value;
  const end = filters.find((filter) => filter.factor === "dateEnd")?.value;
  return start && end && start > end ? "开始日期不能晚于结束日期。" : undefined;
};

export default function SearchFacetPanel({ filters, onChange, scopeFilter }: Props) {
  const partitions = useJournalPartitions();
  const stats = useAllUserStats({ filter: scopeFilter, state: State.NORMAL, includeArchived: searchIncludesArchived(filters) });
  const tags = [...new Set(stats.data?.flatMap((item) => Object.keys(item.tagCount)) ?? [])].sort();
  const tagListId = useId();
  const [tagInput, setTagInput] = useState("");
  const [tagAction, setTagAction] = useState<"tagSearch" | "tagExclude">("tagSearch");
  const value = (factor: FilterFactor) => filters.find((filter) => filter.factor === factor)?.value ?? "";
  const setValue = (factor: FilterFactor, next: string | undefined) =>
    onChange([
      ...filters.filter((filter) => filter.factor !== factor && !(factor === "untagged" && next && filter.factor === "tagSearch")),
      ...(next === undefined ? [] : [{ factor, value: next }]),
    ]);
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
  const toggles: Array<[FilterFactor, string]> = [
    ["untagged", "未添加标签"],
    ["property.hasImage", "有图片"],
    ["property.hasAudio", "有音频"],
    ["property.hasAttachment", "有附件"],
    ["property.hasLocation", "有位置"],
    ["pinned", "已置顶"],
    ["includeArchived", "包含归档"],
  ];
  return (
    <div className="space-y-4 border-t p-4 text-sm" aria-label="筛选条件">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          开始日期
          <Input
            type="date"
            aria-label="开始日期"
            value={value("dateStart")}
            onChange={(e) => setValue("dateStart", e.target.value || undefined)}
          />
        </label>
        <label className="space-y-1">
          结束日期
          <Input
            type="date"
            aria-label="结束日期"
            value={value("dateEnd")}
            onChange={(e) => setValue("dateEnd", e.target.value || undefined)}
          />
        </label>
      </div>
      {searchDateError(filters) && (
        <p role="alert" className="text-destructive">
          {searchDateError(filters)}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        {toggles.map(([factor, label]) => (
          <label key={factor} className="flex min-h-8 items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(value(factor))}
              onChange={(e) => setValue(factor, e.target.checked ? "true" : undefined)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="标签操作"
            className="h-9 rounded-md border bg-background px-2"
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
            className="h-9 rounded-md border bg-background px-2"
            value={value("tagMatch") || "all"}
            onChange={(e) => setValue("tagMatch", e.target.value === "all" ? undefined : "any")}
          >
            <option value="all">包含全部所选标签</option>
            <option value="any">包含任一所选标签</option>
          </select>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!value("tagExact")}
              onChange={(e) => setValue("tagExact", e.target.checked ? undefined : "true")}
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
      <label className="flex items-center gap-2">
        分区
        <select
          aria-label="分区筛选"
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2"
          value={filters.some((filter) => filter.factor === "partition") ? value("partition") || "__none" : "__all"}
          onChange={(e) =>
            setValue("partition", e.target.value === "__all" ? undefined : e.target.value === "__none" ? "" : e.target.value)
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
      </label>
      {partitions.isError && (
        <p role="alert">
          分区列表读取失败。
          <button type="button" className="underline" onClick={() => partitions.refetch()}>
            重试
          </button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">日期按记录原始时间及 Kairos 时区筛选。回收站不包含在搜索中。</p>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
        清空筛选条件
      </Button>
    </div>
  );
}
