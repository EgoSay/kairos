import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/utils/i18n";
import { EDITOR_COMMANDS, isCommandActive } from "../formatting/commands";
import { useEditorActiveState } from "../hooks";
import type { EditorController } from "../types";

const commands = EDITOR_COMMANDS.filter((command) => command.group === "mark");

/** A selection supplies context; the ordinary Format action remains keyboard accessible. */
export function SelectionFormattingToolbar({ controllerRef }: { controllerRef: RefObject<EditorController | null> }) {
  const t = useTranslate();
  const root = useRef<HTMLDivElement>(null);
  const active = useEditorActiveState(controllerRef);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  useEffect(() => {
    const update = () => {
      const editor = controllerRef.current;
      const bounds = editor?.formatting?.getSelectionBounds?.();
      if (!bounds || (!editor?.hasFocus() && !root.current?.contains(document.activeElement))) {
        setPosition(undefined);
        return;
      }
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const top = viewport?.offsetTop ?? 0;
      const next = { top: Math.max(top + 8, bounds.top - 48), left: Math.max(8, Math.min(bounds.left, width - 192)) };
      setPosition((previous) => (previous?.top === next.top && previous.left === next.left ? previous : next));
    };
    const unsubscribe = controllerRef.current?.formatting?.subscribe(update);
    document.addEventListener("focusin", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    update();
    return () => {
      unsubscribe?.();
      document.removeEventListener("focusin", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [controllerRef]);
  if (!position) return null;
  return createPortal(
    <div
      ref={root}
      role="toolbar"
      aria-label="所选文字格式"
      className="fixed z-[70] flex rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
      style={position}
    >
      {commands.map((command) => (
        <Button
          key={command.id}
          type="button"
          variant="quiet"
          size="icon"
          className="size-11"
          aria-label={t(command.labelKey)}
          aria-pressed={isCommandActive(active, command.id)}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            controllerRef.current?.formatting?.run(command.id);
            controllerRef.current?.focus();
          }}
        >
          {command.icon && <command.icon className="size-4" />}
        </Button>
      ))}
    </div>,
    document.body,
  );
}
