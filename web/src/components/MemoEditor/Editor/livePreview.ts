import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { ChangeSet, Compartment, EditorSelection, EditorState, type Range, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";

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

class RuleWidget extends WidgetType {
  toDOM() {
    return document.createElement("hr");
  }
}

class TableBreakWidget extends WidgetType {
  toDOM() {
    return document.createElement("br");
  }
}

class CodeLabelWidget extends WidgetType {
  constructor(readonly language: string) {
    super();
  }
  eq(other: CodeLabelWidget) {
    return other.language === this.language;
  }
  toDOM() {
    const label = document.createElement("span");
    label.className = "cm-preview-code-label";
    label.textContent = this.language || "代码";
    return label;
  }
}

class EmptyTableCellWidget extends WidgetType {
  constructor(
    readonly column: number,
    readonly position: number,
  ) {
    super();
  }
  eq(other: EmptyTableCellWidget) {
    return other.column === this.column && other.position === this.position;
  }
  toDOM(view: EditorView) {
    const cell = document.createElement("span");
    cell.className = "cm-preview-table-cell";
    cell.dataset.tableColumn = String(this.column);
    cell.setAttribute("aria-label", "空白单元格");
    cell.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.position } });
      view.focus();
    });
    return cell;
  }
  ignoreEvent() {
    return true;
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
type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];

function tableCells(row: MarkdownNode) {
  const separators = row.getChildren("TableDelimiter");
  const boundaries = [row.from, ...separators.flatMap((separator) => [separator.from, separator.to]), row.to];
  const cells: { from: number; to: number }[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 2) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    // Leading/trailing pipes are optional borders; a zero-width slot
    // between two pipes is a real empty column and must keep its place.
    if (from === to && (i === 0 || i === boundaries.length - 2)) continue;
    cells.push({ from, to });
  }
  return cells;
}

function tableRowAt(state: EditorState, position: number): MarkdownNode | undefined {
  for (const side of [-1, 1] as const) {
    for (let node = syntaxTree(state).resolveInner(position, side); node; node = node.parent!) {
      if (node.name === "TableHeader" || node.name === "TableRow") return node;
    }
  }
}

function insideTable(node: MarkdownNode) {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === "Table") return true;
  return false;
}
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
  const hide = (from: number, to: number) => {
    if (from < to) decorations.push(Decoration.replace({ atomic: true }).range(from, to));
  };
  // The document stays verbatim. Decorations do not depend on the active line:
  // moving the caret into prose must never expose markup or change its layout.
  // Empty toolbar-inserted mark pairs keep a caret slot until their first input.
  const head = state.selection.main.empty ? state.selection.main.head : -1;
  const emptyPair = ["**", "~~", "*", "`"].find((token) => {
    if (head < token.length || state.sliceDoc(head - token.length, head + token.length) !== token + token) return false;
    for (let node = syntaxTree(state).resolveInner(head, -1); node; node = node.parent!) {
      if (node.name === "Escape") return false;
      if (
        ["FencedCode", "CodeBlock", "InlineCode"].includes(node.name) &&
        (node.from < head - token.length || node.to > head + token.length)
      )
        return false;
    }
    return true;
  });
  const pendingFrom = emptyPair ? head - emptyPair.length : -1;
  const pendingTo = emptyPair ? head + emptyPair.length : -1;
  if (emptyPair) {
    hide(pendingFrom, head);
    hide(head, pendingTo);
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from === pendingFrom && node.to === pendingTo) return false;
      if (node.name === "Table") {
        const rows = [...node.node.getChildren("TableHeader"), ...node.node.getChildren("TableRow")];
        const cellsByRow = rows.map(tableCells);
        const columns = Math.max(1, ...cellsByRow.map((cells) => cells.length));
        rows.forEach((row, index) => {
          decorations.push(
            Decoration.line({
              class: `cm-preview-table-row${row.name === "TableHeader" ? " cm-preview-table-heading" : ""}`,
              attributes: { style: `--table-columns:${columns}` },
            }).range(state.doc.lineAt(row.from).from),
          );
          cellsByRow[index].forEach((cell, column) => {
            if (cell.from === cell.to) {
              decorations.push(Decoration.widget({ widget: new EmptyTableCellWidget(column + 1, cell.from), side: 1 }).range(cell.from));
            } else {
              decorations.push(
                Decoration.mark({
                  class: "cm-preview-table-cell",
                  attributes: { "data-table-column": String(column + 1) },
                }).range(cell.from, cell.to),
              );
            }
          });
        });
      }
      if (node.name === "TableDelimiter") {
        if (node.node.parent?.name === "Table")
          decorations.push(Decoration.replace({ block: true, atomic: true }).range(node.from, node.to));
        else hide(node.from, node.to);
        return false;
      }
      if (node.name === "HTMLTag" && /^<br\s*\/?>$/i.test(state.sliceDoc(node.from, node.to)) && insideTable(node.node)) {
        decorations.push(Decoration.replace({ widget: new TableBreakWidget(), atomic: true }).range(node.from, node.to));
        return false;
      }
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
        if (node.name === "FencedCode") {
          const marks = node.node.getChildren("CodeMark");
          marks.forEach((mark, index) => {
            const line = state.doc.lineAt(mark.from);
            decorations.push(Decoration.line({ class: "cm-preview-code-edge" }).range(line.from));
            decorations.push(
              Decoration.replace({
                atomic: true,
                ...(index === 0 ? { widget: new CodeLabelWidget(state.sliceDoc(mark.to, line.to).trim()) } : {}),
              }).range(mark.from, line.to),
            );
          });
        }
        return false;
      }
      if (node.name === "Link") {
        const marks = node.node.getChildren("LinkMark");
        if (marks.length >= 2) {
          hide(node.from, marks[0].to);
          hide(marks[1].from, node.to);
        }
      }
      if (node.node.parent?.name === "Link" && ["LinkMark", "URL", "LinkTitle", "LinkLabel"].includes(node.name)) return false;
      if (node.name === "Image") {
        const url = node.node.getChild("URL");
        if (!url) return false;
        const source = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
        if (!safeImageSource(source)) return false;
        const raw = state.sliceDoc(node.from, node.to);
        const widget = new ImageWidget(source, /^!\[([^\]]*)\]/.exec(raw)?.[1] || "图片");
        decorations.push(Decoration.replace({ widget, atomic: true }).range(node.from, node.to));
        return false;
      }
      if (node.name === "HorizontalRule") {
        decorations.push(Decoration.replace({ widget: new RuleWidget(), atomic: true }).range(node.from, node.to));
        return false;
      }
      if (node.name === "TaskMarker") {
        decorations.push(
          Decoration.replace({
            widget: new TaskWidget(state.sliceDoc(node.from, node.to).toLowerCase() === "[x]", node.from),
            atomic: true,
          }).range(node.from, node.to),
        );
        return false;
      }
      if (node.name === "ListMark" && /^\s*\[[ xX]\]/.test(state.sliceDoc(node.to, state.doc.lineAt(node.to).to))) {
        hide(node.from, node.to);
        return false;
      }
      if (markerNames.has(node.name) || (["URL", "LinkTitle", "LinkLabel"].includes(node.name) && node.node.parent?.name === "Link")) {
        const space = ["HeaderMark", "QuoteMark"].includes(node.name) && state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
        hide(node.from, node.to + space);
        return false;
      } else if (node.name === "ListMark") {
        const task = /^\s*\[[ xX]\]/.test(state.sliceDoc(node.to, state.doc.lineAt(node.to).to));
        if (task) hide(node.from, node.to);
        else if (/^[-*+]$/.test(state.sliceDoc(node.from, node.to)))
          decorations.push(Decoration.replace({ widget: new BulletWidget(), atomic: true }).range(node.from, node.to));
        else decorations.push(Decoration.mark({ class: "cm-preview-list-marker" }).range(node.from, node.to));
      }
    },
  });
  return Decoration.set(decorations, true);
}

/** Keep paired hidden syntax balanced when an edit removes either edge. */
function tableCursorSelection(transaction: Transaction) {
  const selection = transaction.newSelection;
  if (!selection.main.empty) return selection;
  const head = selection.main.head;
  const line = transaction.newDoc.lineAt(head);
  if ((head !== line.from && head !== line.to) || !line.text.includes("|")) return selection;
  const row = tableRowAt(transaction.state, head);
  if (!row) return selection;
  const cells = tableCells(row);
  if (!cells.length) return selection;
  const position = Math.max(cells[0].from, Math.min(head, cells[cells.length - 1].to));
  return position === head ? selection : selection.replaceRange(EditorSelection.cursor(position));
}

function preserveHiddenFormats(transaction: Transaction) {
  // Native composition owns its DOM/text range until it commits. Source mode
  // removes this extension altogether; undo/redo must replay the exact bytes.
  if (transaction.isUserEvent("input.type.compose")) return transaction;
  const selection = tableCursorSelection(transaction);
  const unchanged = selection === transaction.newSelection ? transaction : [transaction, { selection, sequential: true }];
  if (!transaction.docChanged || (!transaction.isUserEvent("input") && !transaction.isUserEvent("delete"))) return unchanged;
  const removed: { from: number; to: number }[] = [];
  const touched: { from: number; to: number }[] = [];
  const replacements: { from: number; to: number; insert: string }[] = [];
  let insertedLineBreak = false;
  transaction.changes.iterChanges((from, to, newFrom, _newTo, inserted) => {
    touched.push({ from, to });
    if (from < to) removed.push({ from, to });
    const text = inserted.toString();
    if (!text.includes("\n")) return;
    insertedLineBreak = true;
    const row = tableRowAt(transaction.startState, from);
    // Pasted paragraphs within a cell become visible breaks while the stored
    // Markdown remains a single table row. A full-document replacement is
    // deliberately left verbatim.
    if (row && tableCells(row).some((cell) => from >= cell.from && to <= cell.to)) {
      for (const match of text.matchAll(/\n/g))
        replacements.push({ from: newFrom + match.index, to: newFrom + match.index + 1, insert: "<br>" });
    }
  });
  if (!removed.length && !insertedLineBreak) return unchanged;
  const edges: { from: number; to: number }[] = [];
  const paragraphEdges = new Map<number, string>();
  syntaxTree(transaction.startState).iterate({
    from: touched[0].from,
    to: touched[touched.length - 1].to,
    enter: ({ node }) => {
      const delimiter =
        node.name === "StrongEmphasis" || node.name === "Emphasis"
          ? "EmphasisMark"
          : node.name === "Strikethrough"
            ? "StrikethroughMark"
            : node.name === "InlineCode"
              ? "CodeMark"
              : node.name === "Link"
                ? "LinkMark"
                : node.name === "FencedCode"
                  ? "CodeMark"
                  : undefined;
      if (!delimiter) return;
      const marks = node.getChildren(delimiter);
      if (marks.length < 2) return;
      const first = marks[0];
      const closeFrom = node.name === "Link" ? marks[1].from : marks[marks.length - 1].from;
      let pair = [
        { from: node.from, to: first.to },
        { from: closeFrom, to: node.to },
      ];
      if (node.name === "FencedCode") {
        const open = transaction.startState.doc.lineAt(first.from);
        const close = transaction.startState.doc.lineAt(closeFrom);
        const openEnd = Math.min(open.to + 1, transaction.startState.doc.length);
        pair = [
          { from: first.from, to: openEnd },
          { from: Math.max(close.from - 1, openEnd), to: close.to },
        ];
      }
      if (pair.some((edge) => removed.some((range) => range.from < edge.to && range.to > edge.from))) {
        edges.push(...pair);
      } else if (insertedLineBreak && node.name !== "FencedCode" && !insideTable(node)) {
        // A Markdown inline mark cannot cross a blank paragraph. Split the
        // representation, retaining the same visible formatting and URL on
        // both paragraphs instead of exposing broken delimiters to the user.
        const from = transaction.changes.mapPos(first.to, -1);
        const to = transaction.changes.mapPos(closeFrom, 1);
        const body = transaction.newDoc.sliceString(from, to);
        for (const gap of body.matchAll(/\n[ \t]*\n/g)) {
          let end = from + gap.index;
          let start = end + gap[0].length;
          while (end > from && /[ \t]/.test(transaction.newDoc.sliceString(end - 1, end))) end--;
          while (start < to && /[ \t]/.test(transaction.newDoc.sliceString(start, start + 1))) start++;
          const opening = transaction.startState.sliceDoc(node.from, first.to);
          const closing = transaction.startState.sliceDoc(closeFrom, node.to);
          paragraphEdges.set(end, closing + (paragraphEdges.get(end) ?? ""));
          paragraphEdges.set(start, (paragraphEdges.get(start) ?? "") + opening);
        }
      }
    },
  });
  if (!edges.length && !paragraphEdges.size && !replacements.length) return unchanged;
  const cleanup: { from: number; to: number }[] = [];
  // Only delete surviving original delimiter bytes, never text the user just
  // inserted while replacing a selection that crosses a format boundary.
  transaction.changes.iterGaps((oldFrom, newFrom, length) => {
    for (const edge of edges) {
      const from = Math.max(oldFrom, edge.from);
      const to = Math.min(oldFrom + length, edge.to);
      if (from < to) cleanup.push({ from: newFrom + from - oldFrom, to: newFrom + to - oldFrom });
    }
  });
  cleanup.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: typeof cleanup = [];
  for (const range of cleanup) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  const changes = ChangeSet.of(
    [...merged, ...replacements, ...Array.from(paragraphEdges, ([from, insert]) => ({ from, insert }))],
    transaction.newDoc.length,
  );
  if (changes.empty) return unchanged;
  return [transaction, { changes, selection: selection.map(changes, 1), sequential: true }];
}

function insertTableBreak(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  const selection = view.state.selection.main;
  const row = tableRowAt(view.state, selection.head);
  if (!row) return false;
  const cells = tableCells(row);
  if (!cells.length) return false;
  const cell = cells.find((candidate) => selection.from >= candidate.from && selection.to <= candidate.to);
  // A caret immediately outside an optional border still belongs to the
  // visible first/last cell; do not insert a new Markdown row through it.
  const edge = selection.empty
    ? selection.head <= cells[0].from
      ? cells[0].from
      : selection.head >= cells.at(-1)!.to
        ? cells.at(-1)!.to
        : undefined
    : undefined;
  if (!cell && edge === undefined) return false;
  const from = cell ? selection.from : edge!;
  const to = cell ? selection.to : edge!;
  view.dispatch({ changes: { from, to, insert: "<br>" }, selection: { anchor: from + 4 }, userEvent: "input.type" });
  return true;
}

function leaveLastTableRow(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (view.compositionStarted || !selection.empty) return false;
  const row = tableRowAt(state, selection.head);
  const table = row?.parent;
  if (!row || table?.name !== "Table") return false;
  const lastRow = table.getChildren("TableRow").at(-1) ?? table.getChild("TableHeader");
  if (row.from !== lastRow?.from) return false;
  const cell = tableCells(row).at(-1);
  if (!cell || selection.head < cell.from || selection.head > cell.to) return false;
  if (selection.head < cell.to) {
    const caret = view.coordsAtPos(selection.head);
    const end = view.coordsAtPos(cell.to);
    // Normal Down navigation still owns wrapped lines within the same cell.
    if (!caret || !end || caret.bottom <= end.top) return false;
  }
  const finalLine = state.doc.lineAt(table.to);
  for (let number = finalLine.number + 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (line.text.trim()) {
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true, userEvent: "select" });
      return true;
    }
  }
  const missingLines = Math.max(0, 2 - (state.doc.lines - finalLine.number));
  if (!missingLines) {
    view.dispatch({ selection: { anchor: state.doc.line(state.doc.lines).from }, scrollIntoView: true, userEvent: "select" });
  } else {
    // The explicit Down gesture creates a separate paragraph only when no
    // following prose exists. Merely loading, pasting or saving never does.
    view.dispatch({
      changes: { from: state.doc.length, insert: "\n".repeat(missingLines) },
      selection: { anchor: state.doc.length + missingLines },
      scrollIntoView: true,
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    });
    // The insertion happens after the old caret. Record the explicit cursor
    // jump as the event's following selection so redo returns to the new
    // paragraph rather than inferring a position inside the old table cell.
    view.dispatch({ selection: view.state.selection, userEvent: "select" });
  }
  return true;
}

export const livePreview = StateField.define<DecorationSet>({
  create: buildLivePreview,
  update: (value, transaction) =>
    transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildLivePreview(transaction.state)
      : value,
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) =>
      view.state.field(field).update({ filter: (_from, _to, decoration) => decoration.spec.atomic === true }),
    ),
    EditorState.transactionFilter.of(preserveHiddenFormats),
    keymap.of([
      { key: "Enter", run: insertTableBreak },
      { key: "Shift-Enter", run: insertTableBreak },
      { key: "ArrowDown", run: leaveLastTableRow },
    ]),
  ],
});
