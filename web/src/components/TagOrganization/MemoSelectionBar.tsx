import { CheckSquare2Icon, TagsIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMemoSelection } from "@/contexts/MemoSelectionContext";
import { useTranslate } from "@/utils/i18n";
import BatchTagDialog from "./BatchTagDialog";

// Fixed action bar shown while memos are selected: counts, select-all-loaded,
// the tag operation entry and cancel.
const MemoSelectionBar = () => {
  const t = useTranslate();
  const selection = useMemoSelection();
  const [dialogOpen, setDialogOpen] = useState(false);
  if (!selection?.selecting) return null;

  const count = selection.selected.size;
  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
          <span className="px-1 text-sm font-medium">{t("tagOps.selected-count", { count })}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={selection.loadedCount() === 0}
            onClick={() => selection.selectMany(selection.selected.size === selection.loadedCount() ? [] : selection.loadedNames())}
          >
            <CheckSquare2Icon className="me-1 size-4" />
            {t("tagOps.select-all-loaded")}
          </Button>
          <Button variant="default" size="sm" disabled={count === 0} onClick={() => setDialogOpen(true)}>
            <TagsIcon className="me-1 size-4" />
            {t("tagOps.batch-tags")}
          </Button>
          <Button variant="ghost" size="sm" onClick={selection.exit} aria-label={t("common.cancel")}>
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>
      {dialogOpen && <BatchTagDialog names={[...selection.selected]} onClose={() => setDialogOpen(false)} />}
    </>
  );
};

export default MemoSelectionBar;
