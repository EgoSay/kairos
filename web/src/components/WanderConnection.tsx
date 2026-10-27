import { Button } from "@/components/ui/button";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import type { WanderDirection } from "@/hooks/useWanderQueries";
import { cn } from "@/lib/utils";

/** A reading angle with exact two-sided evidence, independently expandable from navigation. */
export default function WanderConnection({
  direction,
  open,
  onToggle,
  onDismiss,
}: {
  direction: WanderDirection;
  open: boolean;
  onToggle: (open: boolean) => void;
  onDismiss: () => void;
}) {
  return (
    <details
      open={open}
      className="my-4 border-l border-primary/30 py-4 pl-5 sm:ml-6"
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary
        className={cn(
          "cursor-pointer list-none rounded-sm text-sm leading-7 text-muted-foreground [&::-webkit-details-marker]:hidden",
          FOCUS_VISIBLE_OUTLINE_CLASSES,
        )}
      >
        {direction.hint}{" "}
        <span aria-hidden="true" className="ml-2 text-primary">
          {open ? "−" : "+"}
        </span>
      </summary>
      {open && (
        <div className="mt-4 space-y-3 rounded-lg bg-muted/50 p-4 text-sm leading-7">
          <p className="text-xs text-muted-foreground">这个角度来自两段原话{direction.manual ? "，连接由你建立" : ""}</p>
          <blockquote className="border-l border-primary/30 pl-3 font-content text-base">“{direction.sourceQuote}”</blockquote>
          <blockquote className="border-l border-primary/30 pl-3 font-content text-base">“{direction.targetQuote}”</blockquote>
          {direction.context && <p className="text-muted-foreground">{direction.context}</p>}
          {!direction.manual && (
            <Button variant="quiet" size="sm" onClick={onDismiss}>
              这条关联不贴切
            </Button>
          )}
        </div>
      )}
    </details>
  );
}
