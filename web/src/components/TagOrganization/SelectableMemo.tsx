import { CheckSquare2Icon, SquareIcon } from "lucide-react";
import { type ReactElement, useEffect } from "react";
import { useMemoSelection } from "@/contexts/MemoSelectionContext";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

// Wraps a rendered memo with the selection affordance. Outside a provider it
// renders children untouched; inside one, a hover-revealed checkbox enters
// selection mode and click-anywhere toggles afterwards.
const SelectableMemo = ({ memo, children }: { memo: Memo; children: ReactElement }) => {
  const t = useTranslate();
  const selection = useMemoSelection();
  const selected = selection?.selected.has(memo.name) ?? false;
  const selecting = selection?.selecting ?? false;

  useEffect(() => {
    if (!selection) return;
    selection.registerMemo(memo);
    return () => selection.unregisterMemo(memo.name);
  }, [selection, memo]);

  if (!selection) return children;

  return (
    <div className="group relative" data-memo-selection>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t("tagOps.select-memo")}
        className={cn(
          "absolute -start-3 -top-3 z-10 rounded-md border bg-background/95 p-1 shadow-md transition-opacity",
          selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          selected ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/60",
        )}
        onClick={(event) => {
          event.stopPropagation();
          selection.toggle(memo.name);
        }}
      >
        {selected ? <CheckSquare2Icon className="size-5" /> : <SquareIcon className="size-5" />}
      </button>
      <div
        className={cn(selected && "rounded-xl ring-2 ring-primary/60 ring-offset-1 ring-offset-background")}
        onClick={(event) => {
          if (!selecting) return;
          // In selection mode a click anywhere on the card toggles; real edits
          // stay reachable after exiting selection mode.
          const target = event.target as HTMLElement;
          if (target.closest("a,button,input,textarea,select,[role='checkbox']")) return;
          event.preventDefault();
          selection.toggle(memo.name);
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SelectableMemo;
