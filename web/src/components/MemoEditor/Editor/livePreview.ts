import { syntaxTree } from "@codemirror/language";
import { Compartment, type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export const previewCompartment = new Compartment();

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.className = "cm-preview-task";
    checkbox.setAttribute("aria-label", "切换待办状态");
    checkbox.addEventListener("change", () => {
      if (view.compositionStarted) {
        checkbox.checked = this.checked;
        return;
      }
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: checkbox.checked ? "x" : " " }, userEvent: "input" });
    });
    return checkbox;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-preview-list-marker";
    bullet.textContent = "•";
    return bullet;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.source === this.source && other.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const root = document.createElement("span");
    root.className = "cm-preview-image";
    const image = document.createElement("img");
    image.src = this.source;
    image.alt = this.alt;
    image.loading = "lazy";
    image.addEventListener("load", () => view.requestMeasure());
    image.addEventListener(
      "error",
      () => {
        image.hidden = true;
        const fallback = document.createElement("span");
        fallback.textContent = `图片暂时无法预览：${this.alt || "可切换源码查看链接"}`;
        root.append(fallback);
        view.requestMeasure();
      },
      { once: true },
    );
    root.append(image);
    return root;
  }
  ignoreEvent() {
    return false;
  }
}

const markerNames = new Set(["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark", "QuoteMark", "LinkMark"]);
const safeImageSource = (source: string) => {
  try {
    const url = new URL(source, window.location.origin);
    return ["http:", "https:", "blob:"].includes(url.protocol);
  } catch {
    return false;
  }
};

export function buildLivePreview(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const quoteLines = new Set<number>();
  // Never rewrite the Markdown. Reveal markup on the active line for precise
  // cursor/IME editing; other lines read as the final structure.
  const touchesSelection = (from: number, to: number) =>
    state.selection.ranges.some((selection) => {
      const first = state.doc.lineAt(selection.from).from;
      const last = state.doc.lineAt(selection.to).to;
      return from <= last && to >= first;
    });
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Blockquote") {
        for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++) {
          if (quoteLines.has(n)) continue;
          quoteLines.add(n);
          decorations.push(Decoration.line({ class: "cm-preview-quote" }).range(state.doc.line(n).from));
        }
      }
      if (node.name === "InlineCode") decorations.push(Decoration.mark({ class: "cm-preview-inline-code" }).range(node.from, node.to));
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        const start = state.doc.lineAt(node.from).number;
        const end = state.doc.lineAt(node.to).number;
        for (let n = start; n <= end; n++)
          decorations.push(Decoration.line({ class: "cm-preview-code-block" }).range(state.doc.line(n).from));
        return false;
      }
      if (node.name === "Image") {
        const url = node.node.getChild("URL");
        if (!url) return false;
        const source = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
        if (!safeImageSource(source)) return false;
        const raw = state.sliceDoc(node.from, node.to);
        const widget = new ImageWidget(source, /^!\[([^\]]*)\]/.exec(raw)?.[1] || "图片");
        if (touchesSelection(node.from, node.to)) decorations.push(Decoration.widget({ widget, side: 1 }).range(node.to));
        else decorations.push(Decoration.replace({ widget }).range(node.from, node.to));
        return false;
      }
      if (node.name === "HorizontalRule" && !touchesSelection(node.from, node.to)) {
        decorations.push(Decoration.mark({ class: "cm-preview-rule" }).range(node.from, node.to));
        return false;
      }
      const editingToken = state.selection.ranges.some((selection) => selection.from <= node.to && selection.to >= node.from);
      if (node.name === "TaskMarker" && !editingToken) {
        decorations.push(
          Decoration.replace({ widget: new TaskWidget(state.sliceDoc(node.from, node.to).toLowerCase() === "[x]", node.from) }).range(
            node.from,
            node.to,
          ),
        );
        return false;
      }
      if (node.name === "ListMark" && !editingToken && /^\s*\[[ xX]\]/.test(state.sliceDoc(node.to, state.doc.lineAt(node.to).to))) {
        decorations.push(Decoration.replace({}).range(node.from, node.to));
        return false;
      }
      if (touchesSelection(node.from, node.to)) return;
      if (markerNames.has(node.name) || (["URL", "LinkTitle", "LinkLabel"].includes(node.name) && node.node.parent?.name === "Link")) {
        decorations.push(Decoration.replace({}).range(node.from, node.to));
        return false;
      } else if (node.name === "ListMark") {
        const task = /^\s*\[[ xX]\]/.test(state.sliceDoc(node.to, state.doc.lineAt(node.to).to));
        if (task) decorations.push(Decoration.replace({}).range(node.from, node.to));
        else if (/^[-*+]$/.test(state.sliceDoc(node.from, node.to)))
          decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
        else decorations.push(Decoration.mark({ class: "cm-preview-list-marker" }).range(node.from, node.to));
      }
    },
  });
  return Decoration.set(decorations, true);
}

export const livePreview = StateField.define<DecorationSet>({
  create: buildLivePreview,
  update: (value, transaction) =>
    transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildLivePreview(transaction.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});
