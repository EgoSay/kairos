import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import type { MemoReferenceRange } from "@/lib/memo-reference";

interface RecordLinkRendering {
  origins: readonly string[];
  mount: (element: HTMLElement, reference: MemoReferenceRange, view: EditorView) => () => void;
}

export const recordLinkRendering = Facet.define<RecordLinkRendering, RecordLinkRendering | undefined>({ combine: (values) => values[0] });
const widgetCleanup = new WeakMap<HTMLElement, () => void>();

/** React owns the preview inside a stable CodeMirror atom; source bytes stay intact. */
export class RecordReferenceWidget extends WidgetType {
  constructor(
    readonly reference: MemoReferenceRange,
    readonly render: RecordLinkRendering,
  ) {
    super();
  }
  eq(other: RecordReferenceWidget) {
    return (
      this.reference.href === other.reference.href &&
      this.reference.label === other.reference.label &&
      this.reference.block === other.reference.block &&
      this.render === other.render
    );
  }
  toDOM(view: EditorView) {
    const element = document.createElement("span");
    element.className = "cm-record-reference";
    widgetCleanup.set(element, this.render.mount(element, this.reference, view));
    return element;
  }
  destroy(element: HTMLElement) {
    widgetCleanup.get(element)?.();
    widgetCleanup.delete(element);
  }
  ignoreEvent() {
    return true;
  }
}
