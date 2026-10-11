import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEditorExtensions } from "@/components/MemoEditor/Editor/extensions";
import { createMemoLinkIntent, pastedMemoName } from "@/components/MemoEditor/Editor/memoLinkIntent";

const views: EditorView[] = [];
const origin = "https://journal.example";
function setup(doc = "", position = doc.length) {
  const onLinkRequest = vi.fn();
  const onPastedMemo = vi.fn();
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      selection: { anchor: position },
      extensions: [markdown(), history(), createMemoLinkIntent({ origin, onLinkRequest, onPastedMemo })],
    }),
  });
  views.push(view);
  return { view, onLinkRequest, onPastedMemo };
}
function type(view: EditorView, text: string, event = "input.type") {
  view.dispatch(view.state.replaceSelection(text), { userEvent: event });
}
function richPaste(html: string, plain: string) {
  const onLinkRequest = vi.fn();
  const onPastedMemo = vi.fn();
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      extensions: buildEditorExtensions({
        placeholder: "",
        onChange: vi.fn(),
        onFiles: vi.fn(),
        onUpdate: vi.fn(),
        onSubmit: vi.fn(),
        getTags: () => [],
        onLinkRequest,
        onPastedMemo,
      }),
    }),
  });
  views.push(view);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], items: [], getData: (kind: string) => (kind === "text/plain" ? plain : kind === "text/html" ? html : "") },
  });
  view.contentDOM.dispatchEvent(event);
  return { view, onLinkRequest, onPastedMemo };
}
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe("memo association intents", () => {
  it("opens for typed [[, keeps cancelled text, and removes the trigger only after a successful choice", () => {
    const { view, onLinkRequest } = setup("想起 ");
    type(view, "[");
    expect(onLinkRequest).not.toHaveBeenCalled();
    type(view, "[");
    expect(onLinkRequest).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe("想起 [[");
    onLinkRequest.mock.calls[0][0].onLinked();
    expect(view.state.doc.toString()).toBe("想起 ");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("想起 [[");
    expect(onLinkRequest).toHaveBeenCalledOnce();
  });

  it("never removes a moved source range after another edit or after unmount", () => {
    const { view, onLinkRequest } = setup();
    type(view, "[[");
    type(view, "保留");
    onLinkRequest.mock.calls[0][0].onLinked();
    expect(view.state.doc.toString()).toBe("[[保留");
    view.destroy();
    expect(() => onLinkRequest.mock.calls[0][0].onLinked()).not.toThrow();
  });

  it.each([
    ["```\n[\n```", 5],
    ["`[ ]`", 2],
    ["\\[", 2],
    ["    [", 5],
  ])("does not open inside code or escapes: %s", (doc, position) => {
    const { view, onLinkRequest } = setup(doc as string, position as number);
    type(view, "[");
    expect(onLinkRequest).not.toHaveBeenCalled();
  });

  it("does not open for paste, composition, redo, or arbitrary document updates", () => {
    for (const event of ["input.paste", "input.type.compose", "redo", "input"]) {
      const { view, onLinkRequest } = setup();
      type(view, "[[", event);
      expect(onLinkRequest).not.toHaveBeenCalled();
    }
  });

  it("recognizes only standalone same-origin canonical record URLs", () => {
    expect(pastedMemoName(`${origin}/memos/my-record#comments`, origin)).toBe("memos/my-record");
    expect(pastedMemoName(` ${origin}/memos/123/?view=full `, origin)).toBe("memos/123");
    for (const input of [
      "https://external.example/memos/123",
      "https://journal.example.evil/memos/123",
      "javascript:alert(1)",
      `${origin}/share/123`,
      `${origin}/memos/a%2fb`,
      `${origin}/memos/one more`,
      `${origin}/memos/123\n正文`,
      "https://user:secret@journal.example/memos/123",
      "/memos/123",
    ])
      expect(pastedMemoName(input, origin)).toBeUndefined();
  });

  it("offers the plain pasted URL once and clears the hint when the document changes", () => {
    const { view, onPastedMemo } = setup();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [], getData: (kind: string) => (kind === "text/plain" ? `${origin}/memos/one` : "") },
    });
    view.contentDOM.dispatchEvent(event);
    expect(view.state.doc.toString()).toBe(`${origin}/memos/one`);
    expect(onPastedMemo).toHaveBeenLastCalledWith("memos/one");
    type(view, " 后续");
    expect(onPastedMemo).toHaveBeenLastCalledWith(undefined);
  });

  it.each([
    "",
    '<meta charset="utf-8">\n<!--StartFragment-->',
  ])("offers a single same-origin rich clipboard link without associating it automatically (prefix=%s)", (prefix) => {
    const url = `${window.location.origin}/memos/target`;
    const { view, onPastedMemo, onLinkRequest } = richPaste(`${prefix}<a href="${url}">${url}</a><!--EndFragment-->`, url);
    expect(view.state.doc.toString()).toBe(`[${url}](${url})`);
    expect(onPastedMemo).toHaveBeenLastCalledWith("memos/target");
    expect(onLinkRequest).not.toHaveBeenCalled();
    type(view, " 后续");
    expect(onPastedMemo).toHaveBeenLastCalledWith(undefined);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`[${url}](${url})`);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    expect(onPastedMemo).toHaveBeenLastCalledWith(undefined);
  });

  it.each([
    ["mixed text", (url: string) => `<p>额外正文</p><a href="${url}">${url}</a>`, false],
    ["multiple links", (url: string) => `<a href="${url}">${url}</a><a href="${url}">${url}</a>`, false],
    ["another record", (url: string) => `<a href="${window.location.origin}/memos/other">${url}</a>`, false],
    ["external target", (url: string) => `<a href="https://external.example/memos/target">${url}</a>`, false],
    ["non-URL label", (url: string) => `<a href="${url}">另一条记录</a>`, false],
    ["embedded image", (url: string) => `<a href="${url}">${url}<img src="/image.png"></a>`, false],
    ["external URL", (url: string) => `<a href="${url}">${url}</a>`, true],
  ])("does not offer an ambiguous or external rich clipboard link: %s", (_label, html, external) => {
    const url = `${external ? "https://external.example" : window.location.origin}/memos/target`;
    const { view, onPastedMemo, onLinkRequest } = richPaste(html(url), url);
    expect(view.state.doc.length).toBeGreaterThan(0);
    expect(onPastedMemo).not.toHaveBeenCalledWith(expect.any(String));
    expect(onLinkRequest).not.toHaveBeenCalled();
  });
});
