import { ArrowUpRightIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { isOrdinaryActivation, useRecordReading } from "./RecordReadingContext";

interface Props {
  name: string;
  href: string;
  label?: ReactNode;
  sourceName?: string;
  restoreFocus?: () => void;
  onResize?: () => void;
}

/** A live reading affordance; the authored Markdown is never replaced. */
export default function RecordReference({ name, href, label, sourceName, restoreFocus, onResize }: Props) {
  const reader = useRecordReading();
  useEffect(() => onResize?.(), [onResize]);

  return (
    <span className="inline" data-record-reference={name}>
      <a
        href={href}
        title="查看关联记录"
        aria-label={label ? undefined : "查看关联记录"}
        className="inline-flex min-h-7 min-w-7 items-center justify-center gap-1 rounded-sm align-middle text-primary no-underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
        onMouseDown={(event) => {
          if (restoreFocus && isOrdinaryActivation(event)) event.preventDefault();
        }}
        onClick={(event) => {
          if (!reader.enabled || !isOrdinaryActivation(event)) return;
          event.preventDefault();
          event.stopPropagation();
          reader.open(name, event.currentTarget, sourceName, restoreFocus);
        }}
      >
        {label && <span>{label}</span>}
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <ArrowUpRightIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
        </span>
      </a>
    </span>
  );
}
