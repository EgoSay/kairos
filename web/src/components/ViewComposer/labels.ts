/**
 * [INPUT]: MemoFilter、DYNAMIC_RANGE_LABEL_KEYS、Translations、lucide 图标
 * [OUTPUT]: describeViewFilter —— 单个条件的可读中文/本地化标签；viewFilterIcon —— 条件的图标
 * [POS]: components/ViewComposer 的展示助手，也被 MemoViews 管理页复用作行内摘要
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  ArchiveIcon,
  AudioLinesIcon,
  BookmarkIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckCircleIcon,
  CodeIcon,
  EyeIcon,
  FilterIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  type LucideIcon,
  MapPinIcon,
  PaperclipIcon,
  PinIcon,
  SearchIcon,
} from "lucide-react";
import type { MemoFilter } from "@/contexts/MemoFilterContext";
import { DYNAMIC_RANGE_LABEL_KEYS } from "@/lib/view-scope";
import type { Translations } from "@/utils/i18n";

type T = (key: Translations, params?: Record<string, unknown>) => string;

const PROPERTY_LABEL_KEYS: Partial<Record<MemoFilter["factor"], Translations>> = {
  "property.hasImage": "view.facet.has-image",
  "property.hasAudio": "view.facet.has-audio",
  "property.hasAttachment": "view.facet.has-attachment",
  "property.hasLink": "view.facet.has-link",
  "property.hasCode": "view.facet.has-code",
  "property.hasTaskList": "view.facet.has-task-list",
  "property.hasLocation": "view.facet.has-location",
};

// One glyph per factor so a chip is scannable without reading its label.
const FACTOR_ICONS: Partial<Record<MemoFilter["factor"], LucideIcon>> = {
  contentSearch: SearchIcon,
  celSearch: CodeIcon,
  displayTime: CalendarIcon,
  dateStart: CalendarIcon,
  dateEnd: CalendarIcon,
  dateRange: CalendarClockIcon,
  tagSearch: HashIcon,
  tagExclude: HashIcon,
  tagMatch: HashIcon,
  tagExact: HashIcon,
  untagged: HashIcon,
  visibility: EyeIcon,
  pinned: PinIcon,
  partition: BookmarkIcon,
  includeArchived: ArchiveIcon,
  "property.hasImage": ImageIcon,
  "property.hasAudio": AudioLinesIcon,
  "property.hasAttachment": PaperclipIcon,
  "property.hasLink": LinkIcon,
  "property.hasTaskList": CheckCircleIcon,
  "property.hasCode": CodeIcon,
  "property.hasLocation": MapPinIcon,
};

export const viewFilterIcon = (filter: MemoFilter): LucideIcon => FACTOR_ICONS[filter.factor] ?? FilterIcon;

/** One readable label per scope condition; residual text is rendered separately. */
export const describeViewFilter = (filter: MemoFilter, t: T, partitionName?: (id: string) => string | undefined): string => {
  switch (filter.factor) {
    case "contentSearch":
      return filter.value;
    case "tagSearch":
      return `#${filter.value}`;
    case "tagExclude":
      return t("view.facet.exclude-tag", { tag: filter.value });
    case "tagMatch":
      return t(filter.value === "any" ? "view.facet.tag-any" : "view.facet.tag-all");
    case "tagExact":
      return t("view.facet.tag-exact");
    case "untagged":
      return t("view.facet.untagged");
    case "pinned":
      return t("view.facet.pinned");
    case "dateStart":
      return t("view.facet.date-from", { date: filter.value });
    case "dateEnd":
      return t("view.facet.date-to", { date: filter.value });
    case "dateRange":
      return t(DYNAMIC_RANGE_LABEL_KEYS[filter.value] ?? "view.range.custom");
    case "partition":
      return filter.value ? (partitionName?.(filter.value) ?? filter.value) : t("view.facet.no-partition");
    default: {
      const key = PROPERTY_LABEL_KEYS[filter.factor];
      return key ? t(key) : filter.value || filter.factor;
    }
  }
};
