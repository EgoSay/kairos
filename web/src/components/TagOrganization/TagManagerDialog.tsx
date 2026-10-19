import { HashIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTagCounts } from "@/hooks/useUserQueries";
import { useTranslate } from "@/utils/i18n";
import TagActionDialog from "./TagActionDialog";
import TagActionsMenu, { TAG_MENU_TRIGGER_BASE, type TagAction } from "./TagActionsMenu";

interface Props {
  onClose: () => void;
}

// The unified management surface: every tag with its usage count, searchable,
// each row carrying the same actions the sidebar tree offers. Acting on a row
// opens the focused dialog on top; closing it returns here.
const TagManagerDialog = ({ onClose }: Props) => {
  const t = useTranslate();
  const { data: tagCount = {} } = useTagCounts(true);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<{ tag: string; action: TagAction }>();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.entries(tagCount)
      .filter(([tag]) => !needle || tag.toLowerCase().includes(needle))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tagCount, query]);

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("tagOps.manager-title")}</DialogTitle>
            <DialogDescription>{t("tagOps.manager-description")}</DialogDescription>
          </DialogHeader>

          <div className="relative">
            <SearchIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("tagOps.manager-search")}
              className="ps-8"
              autoFocus
            />
          </div>

          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {rows.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("tagOps.manager-empty")}</p>}
            {rows.map(([tag, amount]) => (
              <div key={tag} className="group/tag flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                <HashIcon className="size-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{tag}</span>
                <span className="text-2xs tabular-nums text-muted-foreground/60">{amount}</span>
                <TagActionsMenu
                  tag={tag}
                  onAction={(value, next) => setAction({ tag: value, action: next })}
                  aria-label={t("tagOps.row-actions", { tag: `#${tag}` })}
                  className={`${TAG_MENU_TRIGGER_BASE} rounded p-1 hover:bg-accent`}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {action && <TagActionDialog tag={action.tag} action={action.action} onClose={() => setAction(undefined)} />}
    </>
  );
};

export default TagManagerDialog;
