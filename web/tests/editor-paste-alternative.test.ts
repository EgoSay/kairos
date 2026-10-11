import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEditorExtensions } from "@/components/MemoEditor/Editor/extensions";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((view) => view.destroy()));

function editor(sourceMode = false) {
  const alternatives = vi.fn<(action: (() => void) | undefined) => void>();
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: "前文\n",
      selection: { anchor: 3 },
      extensions: buildEditorExtensions({
        sourceMode,
        placeholder: "",
        onChange: vi.fn(),
        onFiles: vi.fn(),
        onUpdate: vi.fn(),
        onSubmit: vi.fn(),
        getTags: () => [],
        onPasteAlternative: alternatives,
      }),
    }),
  });
  views.push(view);
  const paste = (html: string, plain: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/html" ? html : plain), items: [], files: [] },
    });
    view.contentDOM.dispatchEvent(event);
  };
  return { view, alternatives, paste };
}

describe("semantic paste recovery", () => {
  it.each([false, true])("isolates immediate post-paste edits from the paste itself (source=%s)", (sourceMode) => {
    const { view } = editor(sourceMode);
    const before = view.state.doc.toString();
    view.dispatch(view.state.replaceSelection("**重点**"), { userEvent: "input.paste" });
    const pasted = view.state.doc.toString();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(view.state.doc.toString()).not.toBe(pasted);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(pasted);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
  });
  it("allows a paste to keep plain text without replacing surrounding prose", () => {
    const { view, alternatives, paste } = editor();
    paste("<p><strong>重点</strong> 与文字</p>", "重点 与文字");
    expect(view.state.doc.toString()).toBe("前文\n**重点** 与文字");
    const applyPlain = alternatives.mock.calls.at(-1)?.[0];
    expect(applyPlain).toBeTypeOf("function");
    applyPlain?.();
    expect(view.state.doc.toString()).toBe("前文\n重点 与文字");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(alternatives).toHaveBeenLastCalledWith(undefined);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toContain("前文\n");
  });

  it("invalidates the alternative when subsequent typing changes the document", () => {
    const { view, alternatives, paste } = editor();
    paste("<b>重点</b>", "重点");
    const applyPlain = alternatives.mock.calls.at(-1)?.[0];
    view.dispatch({ changes: { from: view.state.doc.length, insert: "继续" }, userEvent: "input.type" });
    expect(alternatives).toHaveBeenLastCalledWith(undefined);
    const current = view.state.doc.toString();
    applyPlain?.();
    expect(view.state.doc.toString()).toBe(current);
  });

  it("keeps the clipboard text when its HTML fragment contains no supported content", () => {
    const { view, paste } = editor();
    paste("<style>body { color: red }</style>", "不要丢掉这段文字");
    expect(view.state.doc.toString()).toBe("前文\n不要丢掉这段文字");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("前文\n");
  });
});
