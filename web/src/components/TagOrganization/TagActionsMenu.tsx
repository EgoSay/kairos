import { MergeIcon, MoreHorizontalIcon, PencilIcon, TagsIcon, Trash2Icon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/** The four user-level tag operations; each opens a focused TagActionDialog. */
export type TagAction = "rename" | "merge" | "delete" | "batch";

interface Props {
  tag: string;
  onAction: (tag: string, action: TagAction) => void;
  /** Trigger styling — sidebar rows hide it until hover; management lists keep it visible. */
  className?: string;
  "aria-label": string;
}

// Direct manipulation: the actions live on the tag itself, so "which tag am I
// operating on" is answered by where the user clicked rather than a form field.
const TagActionsMenu = ({ tag, onAction, className, "aria-label": ariaLabel }: Props) => {
  const t = useTranslate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger nativeButton={false} render={<span role="button" tabIndex={0} aria-label={ariaLabel} className={className} />}>
        <MoreHorizontalIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={2} size="sm" className="w-44">
        <DropdownMenuItem onClick={() => onAction(tag, "rename")}>
          <PencilIcon className="text-muted-foreground" strokeWidth={1.8} />
          {t("tagOps.action-rename")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction(tag, "merge")}>
          <MergeIcon className="text-muted-foreground" strokeWidth={1.8} />
          {t("tagOps.action-merge")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction(tag, "batch")}>
          <TagsIcon className="text-muted-foreground" strokeWidth={1.8} />
          {t("tagOps.action-batch")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onAction(tag, "delete")}>
          <Trash2Icon strokeWidth={1.8} />
          {t("tagOps.action-delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const TAG_MENU_TRIGGER_BASE = cn("text-muted-foreground transition-opacity");

export default TagActionsMenu;
