import { HashIcon, ListTreeIcon, MoreHorizontalIcon, Settings2Icon } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useLocalStorage, useOverflowTitle } from "@/hooks";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import TagActionDialog from "../TagOrganization/TagActionDialog";
import TagActionsMenu, { TAG_MENU_TRIGGER_BASE, type TagAction } from "../TagOrganization/TagActionsMenu";
import TagManagerDialog from "../TagOrganization/TagManagerDialog";
import TagTree, { tagRowAriaLabel } from "../TagTree";
import {
  SIDEBAR_ROW_BOX_CLASSES,
  SIDEBAR_ROW_CLASSES,
  SIDEBAR_ROW_COUNT_RAIL_CLASSES,
  SIDEBAR_ROW_LABEL_CLASSES,
  SIDEBAR_ROW_SLOT_BUTTON_CLASSES,
  SidebarRowIconSlot,
  sidebarRowStateAttributes,
  sidebarRowStateClasses,
} from "./SidebarRow";
import SidebarSection, { SIDEBAR_SECTION_ACTION_ICON_CLASSES } from "./SidebarSection";

interface Props {
  tagCount: Record<string, number>;
  onSelect?: () => void;
  /** Whose tags these are; keeps tree expansion state from bleeding between users and views. */
  scope: string;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  retrying?: boolean;
}

const TagPath = forwardRef<HTMLSpanElement, { tag: string }>(({ tag }, ref) => {
  const segments = tag.split("/");

  return (
    <span ref={ref} className="min-w-0 flex-1 truncate text-start">
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          {index > 0 && <span className="px-0.5 text-muted-foreground/40">/</span>}
          <span className={index === segments.length - 1 ? "text-current" : "text-muted-foreground/75"}>{segment}</span>
        </span>
      ))}
    </span>
  );
});
TagPath.displayName = "TagPath";

/** Same hidden-until-engaged trailing control as the tree and view rows. */
const TAG_MENU_TRIGGER_CLASSES = cn(
  SIDEBAR_ROW_SLOT_BUTTON_CLASSES,
  TAG_MENU_TRIGGER_BASE,
  "md:opacity-0 md:group-hover/tag:opacity-100 md:focus-visible:opacity-100 data-popup-open:opacity-100",
);

interface FlatTagRowProps {
  tag: string;
  amount: number;
  active: boolean;
  /** Computed by the parent, which already holds the translator — rows stay subscription-free. */
  ariaLabel: string;
  menuLabel: string;
  onClick: () => void;
  onAction: (action: TagAction) => void;
}

const FlatTagRow = ({ tag, amount, active, ariaLabel, menuLabel, onClick, onAction }: FlatTagRowProps) => {
  const { ref, title } = useOverflowTitle<HTMLSpanElement>(`#${tag}`);
  const state = active ? "checked" : "idle";

  return (
    <div {...sidebarRowStateAttributes(state)} className={cn(SIDEBAR_ROW_BOX_CLASSES, "group/tag", sidebarRowStateClasses(state))}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={active || undefined}
        title={title}
        className={SIDEBAR_ROW_LABEL_CLASSES}
        onClick={onClick}
      >
        {/* Same leading slot as the tree, so the # marks hold their line when switching modes. */}
        <SidebarRowIconSlot icon={HashIcon} />
        <TagPath ref={ref} tag={tag} />
        <span className={cn(SIDEBAR_ROW_COUNT_RAIL_CLASSES, "md:group-hover/tag:opacity-0")}>{amount}</span>
      </button>
      <TagActionsMenu tag={tag} onAction={(_, action) => onAction(action)} aria-label={menuLabel} className={TAG_MENU_TRIGGER_CLASSES} />
    </div>
  );
};

const TagsSection = ({ tagCount, onSelect, scope, loading, error, onRetry, retrying }: Props) => {
  const t = useTranslate();
  const { getFiltersByFactor, addFilter, removeFilter } = useMemoFilterContext();
  const [treePreference, setTreeMode] = useLocalStorage<boolean | null>("tag-view-as-tree-v2", null);
  const treeMode = treePreference ?? Object.keys(tagCount).some((tag) => tag.includes("/"));
  const activeTags = new Set(getFiltersByFactor("tagSearch").map((filter) => filter.value));
  const activeTag = activeTags.values().next().value as string | undefined;
  const tags = useMemo(() => Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [tagCount]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [tagAction, setTagAction] = useState<{ tag: string; action: TagAction }>();

  const untagged = getFiltersByFactor("untagged").length > 0;

  const handleTagClick = (tag: string) => {
    const active = activeTags.has(tag);
    if (active) {
      removeFilter((filter) => filter.factor === "tagSearch" && filter.value === tag);
    } else {
      removeFilter((filter) => filter.factor === "tagSearch" || filter.factor === "untagged");
      addFilter({ factor: "tagSearch", value: tag });
    }
    onSelect?.();
  };

  return (
    <SidebarSection
      label={t("common.tags")}
      action={
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <DropdownMenuTrigger
                aria-label={`${t("common.tags")}: ${t("common.more")}`}
                render={<Button variant="quiet" size="icon-sm" />}
              >
                <MoreHorizontalIcon className={SIDEBAR_SECTION_ACTION_ICON_CLASSES} strokeWidth={1.8} />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t("common.more")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" sideOffset={4} size="sm" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground">{t("common.tags")}</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={treeMode}
                onCheckedChange={setTreeMode}
                closeOnClick
                className="ps-2 pe-7 [&>span]:start-auto [&>span]:end-2"
              >
                <ListTreeIcon className="text-muted-foreground" strokeWidth={1.8} />
                {t("common.tree-mode")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem className="ps-2" onClick={() => setManagerOpen(true)}>
                <Settings2Icon className="text-muted-foreground" strokeWidth={1.8} />
                {t("tagOps.manage-entry")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <button
        type="button"
        aria-pressed={untagged}
        className={cn(SIDEBAR_ROW_CLASSES, sidebarRowStateClasses(untagged ? "checked" : "idle"))}
        onClick={() => {
          removeFilter((filter) => filter.factor === "untagged" || (!untagged && filter.factor === "tagSearch"));
          if (!untagged) addFilter({ factor: "untagged", value: "true" });
          onSelect?.();
        }}
      >
        <SidebarRowIconSlot icon={HashIcon} />
        <span>未添加标签</span>
      </button>
      {error && (
        <div role="alert" className="px-2 py-2 text-xs text-muted-foreground">
          <p>标签统计读取失败，已选筛选条件仍保留。{tags.length > 0 ? "以下是上次读取的结果。" : ""}</p>
          {onRetry && (
            <Button type="button" size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
              重试读取标签
            </Button>
          )}
        </div>
      )}
      {loading && !error && (
        <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
          正在读取标签…
        </p>
      )}
      {managerOpen && <TagManagerDialog onClose={() => setManagerOpen(false)} />}
      {tagAction && <TagActionDialog tag={tagAction.tag} action={tagAction.action} onClose={() => setTagAction(undefined)} />}
      {treeMode ? (
        <TagTree
          key={scope}
          tagAmounts={tags}
          activeTag={activeTag}
          scope={scope}
          onTagClick={handleTagClick}
          onTagAction={(tag, action) => setTagAction({ tag, action })}
        />
      ) : (
        <>
          {tags.map(([tag, amount]) => (
            <FlatTagRow
              key={tag}
              tag={tag}
              amount={amount}
              active={activeTags.has(tag)}
              ariaLabel={tagRowAriaLabel(t, tag, amount)}
              menuLabel={`${t("tagOps.manage-entry")} #${tag}`}
              onClick={() => handleTagClick(tag)}
              onAction={(action) => setTagAction({ tag, action })}
            />
          ))}
        </>
      )}
    </SidebarSection>
  );
};

export default TagsSection;
