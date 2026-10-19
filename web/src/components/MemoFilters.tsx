import dayjs from "dayjs";
import { isEqual } from "lodash-es";
import {
  BookmarkIcon,
  BookmarkPlusIcon,
  CalendarIcon,
  CheckCircleIcon,
  CodeIcon,
  EyeIcon,
  HashIcon,
  LinkIcon,
  type LucideIcon,
  MapPinIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import MemoViewIcon from "@/components/MemoViewIcon";
import { Button } from "@/components/ui/button";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { type FilterFactor, getMemoFilterKey, type MemoFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useMemoViews } from "@/hooks/useUserQueries";
import { getMemoViewId, isMemoCollectionRoute } from "@/lib/memo-views";
import { cn } from "@/lib/utils";
import { DYNAMIC_RANGE_LABEL_KEYS, emptyViewScope, mergeScopes, parseViewFilter, scopeFromFilters } from "@/lib/view-scope";
import { useTranslate } from "@/utils/i18n";

const DATE_FILTER_FORMAT = "MMM D, YYYY";

interface FilterConfig {
  icon: LucideIcon;
  getLabel: (value: string, t: ReturnType<typeof useTranslate>) => string;
  /** The chip shows a typed expression: monospace, wider, and clicking it reopens Quick Find to edit. */
  editableQuery?: boolean;
}

const FILTER_CONFIGS: Record<FilterFactor, FilterConfig> = {
  untagged: { icon: HashIcon, getLabel: () => "未添加标签" },
  tagExclude: { icon: HashIcon, getLabel: (value) => `排除：${value}` },
  tagMatch: { icon: HashIcon, getLabel: (value) => (value === "any" ? "任一标签" : "全部标签") },
  tagExact: { icon: HashIcon, getLabel: () => "仅标签本身" },
  dateStart: { icon: CalendarIcon, getLabel: (value) => `从 ${value}` },
  dateEnd: { icon: CalendarIcon, getLabel: (value) => `至 ${value}` },
  dateRange: { icon: CalendarIcon, getLabel: (value, t) => t(DYNAMIC_RANGE_LABEL_KEYS[value] ?? "view.range.custom") },
  partition: { icon: BookmarkIcon, getLabel: (value) => (value ? "指定分区" : "未分区") },
  includeArchived: { icon: BookmarkIcon, getLabel: () => "包含归档" },
  "property.hasImage": { icon: BookmarkIcon, getLabel: () => "有图片" },
  "property.hasAudio": { icon: BookmarkIcon, getLabel: () => "有音频" },
  "property.hasAttachment": { icon: BookmarkIcon, getLabel: () => "有附件" },
  tagSearch: {
    icon: HashIcon,
    getLabel: (value) => value,
  },
  visibility: {
    icon: EyeIcon,
    getLabel: (value) => value,
  },
  contentSearch: {
    icon: SearchIcon,
    getLabel: (value) => value,
  },
  celSearch: {
    icon: SearchIcon,
    getLabel: (value) => value,
    editableQuery: true,
  },
  displayTime: {
    icon: CalendarIcon,
    getLabel: (value) => {
      const date = dayjs(value);
      return date.isValid() ? date.format(DATE_FILTER_FORMAT) : value;
    },
  },
  pinned: {
    icon: BookmarkIcon,
    getLabel: () => "已置顶",
  },
  "property.hasLink": {
    icon: LinkIcon,
    getLabel: (_, t) => t("memo.filters.has-link"),
  },
  "property.hasTaskList": {
    icon: CheckCircleIcon,
    getLabel: (_, t) => t("memo.filters.has-task-list"),
  },
  "property.hasCode": {
    icon: CodeIcon,
    getLabel: (_, t) => t("memo.filters.has-code"),
  },
  "property.hasLocation": {
    icon: MapPinIcon,
    getLabel: (_, t) => t("memo.filters.has-location"),
  },
};

interface FilterChipProps {
  icon?: LucideIcon;
  customIcon?: ReactNode;
  label: string;
  onRemove: () => void;
  /** When set, the label is a button that edits the filter; the label is also shown in full as a tooltip. */
  onEdit?: { label: string; onClick: () => void };
}

/** One chip for anything narrowing the list, so a view, a tag and a day are announced the same way. */
const FilterChip = ({ icon: Icon, customIcon, label, onRemove, onEdit }: FilterChipProps) => {
  const body = (
    <>
      {customIcon ?? (Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />)}
      <span className={cn("text-foreground/80 truncate", onEdit ? "font-mono text-xs max-w-64" : "font-medium max-w-32")}>{label}</span>
    </>
  );
  return (
    <div
      className={cn(
        "group inline-flex min-w-0 max-w-full items-center gap-1.5 h-7 px-2.5",
        "bg-accent/50 hover:bg-accent border border-border/50 rounded-full text-sm transition-all duration-200 hover:shadow-sm",
      )}
    >
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit.onClick}
          title={label}
          aria-label={onEdit.label}
          className="flex min-w-0 items-center gap-1.5"
        >
          {body}
        </button>
      ) : (
        body
      )}
      <span className="ml-0.5 -mr-1">
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove filter">
          <XIcon className="w-3 h-3" />
        </Button>
      </span>
    </div>
  );
};

const MemoFilters = ({ className }: { className?: string }) => {
  const t = useTranslate();
  const location = useLocation();
  const currentUser = useCurrentUser();
  const { filters, memoView, removeFilter, setMemoView, setFilters } = useMemoFilterContext();
  const { setQuickFindOpen, setViewComposer } = useAppSidebar();
  const { data: preferences } = useJournalPreferences();
  const timezone = preferences?.timezone ?? "Asia/Shanghai";
  // A remembered view only narrows the collection routes; elsewhere it is dormant and must not be echoed.
  const viewApplies = memoView !== undefined && isMemoCollectionRoute(location.pathname);
  const { data: memoViews = [] } = useMemoViews(viewApplies ? currentUser?.name : undefined);
  const activeView = viewApplies ? memoViews.find((item) => getMemoViewId(item.name) === memoView) : undefined;

  // Saving captures the live conditions plus the selected view's own scope, so
  // "save as view" means "everything I am looking at right now".
  const handleSaveAsView = () => {
    setViewComposer({
      scope: mergeScopes(scopeFromFilters(filters), activeView ? parseViewFilter(activeView.filter, timezone) : emptyViewScope()),
    });
  };

  const handleRemoveFilter = (filter: MemoFilter) => {
    removeFilter((f: MemoFilter) => isEqual(f, filter));
  };

  const getFilterDisplayText = (filter: MemoFilter): string => {
    const config = FILTER_CONFIGS[filter.factor];
    if (!config) {
      return filter.value || filter.factor;
    }
    return config.getLabel(filter.value, t);
  };

  const viewChip = (() => {
    if (!viewApplies) return null;
    const view = memoViews.find((item) => getMemoViewId(item.name) === memoView);
    return view?.title
      ? {
          customIcon: <MemoViewIcon icon={view.icon} className="size-3.5 text-sm text-muted-foreground" />,
          label: view.title,
        }
      : null;
  })();

  if (filters.length === 0 && !viewChip) {
    return null;
  }

  return (
    <div className={cn("w-full flex flex-row justify-start items-center flex-wrap gap-2", className)}>
      {viewChip && <FilterChip customIcon={viewChip.customIcon} label={viewChip.label} onRemove={() => setMemoView(undefined)} />}
      {filters.map((filter) => (
        <FilterChip
          key={getMemoFilterKey(filter)}
          icon={FILTER_CONFIGS[filter.factor]?.icon}
          label={getFilterDisplayText(filter)}
          onRemove={() => handleRemoveFilter(filter)}
          onEdit={
            FILTER_CONFIGS[filter.factor]?.editableQuery
              ? { label: t("search.edit-query"), onClick: () => setQuickFindOpen(true) }
              : undefined
          }
        />
      ))}
      {currentUser && filters.length > 0 && (
        <Button variant="ghost" size="sm" onClick={handleSaveAsView}>
          <BookmarkPlusIcon className="size-3.5" />
          {t("view.save-as")}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setFilters([]);
          setMemoView(undefined);
        }}
      >
        清空全部条件
      </Button>
    </div>
  );
};

MemoFilters.displayName = "MemoFilters";

export default MemoFilters;
