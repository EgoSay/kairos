import { redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlClipboardMarkdown } from "@/components/MemoEditor/Editor/clipboard";
import { buildEditorExtensions } from "@/components/MemoEditor/Editor/extensions";
import { livePreview, previewCompartment } from "@/components/MemoEditor/Editor/livePreview";

const views: EditorView[] = [];
const mount = (doc: string, onFiles = vi.fn(), consumePlainPaste?: () => boolean) => {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      extensions: buildEditorExtensions({
        placeholder: "",
        onChange: vi.fn(),
        onFiles,
        onUpdate: vi.fn(),
        onSubmit: vi.fn(),
        getTags: () => [],
        consumePlainPaste,
      }),
    }),
  });
  views.push(view);
  return view;
};
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});
const paste = (view: EditorView, html: string, plain = "", files: File[] = []) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => (format === "text/html" ? html : plain),
      items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
      files,
    },
  });
  view.contentDOM.dispatchEvent(event);
  return event;
};

describe("Markdown visual editing", () => {
  it("keeps the reading shape while editing formatted text on the active line", () => {
    const source = "## 标题\n\n**重要** 与 [来源](https://example.test)\n\n#生活/散步";
    const view = mount(source);
    for (const word of ["标题", "重要", "来源"]) {
      view.dispatch({ selection: { anchor: source.indexOf(word) + 1 } });
      expect(view.contentDOM.textContent).not.toContain("## 标题");
      expect(view.contentDOM.textContent).not.toContain("**重要**");
      expect(view.contentDOM.textContent).not.toContain("https://example.test");
      expect(view.contentDOM.textContent).toContain("#生活/散步");
    }
    view.dispatch({ changes: { from: source.indexOf("重要") + 1, insert: "新" }, userEvent: "input" });
    expect(view.contentDOM.textContent).toContain("重新要");
    expect(view.contentDOM.textContent).not.toContain("**");
    expect(view.state.doc.toString()).toContain("**重新要**");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("renders editable table rows and code without exposing their structural delimiters", () => {
    const source = "| 今天 | 明天 |\n| --- | --- |\n| **散步** | 阅读 |\n\n```md\n**literal**\n```";
    const view = mount(source);
    view.dispatch({ selection: { anchor: source.indexOf("散步") + 1 } });
    expect(view.dom.querySelectorAll(".cm-preview-table-cell")).toHaveLength(4);
    expect(view.contentDOM.textContent).not.toContain("|");
    expect(view.contentDOM.textContent).not.toContain("---");
    expect(view.contentDOM.textContent).not.toContain("```");
    expect(view.contentDOM.textContent).toContain("**literal**");
    view.dispatch({ changes: { from: source.indexOf("阅读"), to: source.indexOf("阅读") + 2, insert: "跑步" }, userEvent: "input" });
    expect(view.state.doc.toString()).toBe(source.replace("阅读", "跑步"));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("keeps literal delimiters visible when the caret sits inside code", () => {
    const source = "```md\n****\n```\n\n`~~~~`";
    const view = mount(source);
    for (const at of [source.indexOf("****") + 2, source.indexOf("~~~~") + 2]) {
      view.dispatch({ selection: { anchor: at } });
      expect(view.contentDOM.textContent).toContain("****");
      expect(view.contentDOM.textContent).toContain("~~~~");
    }
    expect(view.state.doc.toString()).toBe(source);
  });

  it("unwraps an inline format at its hidden edge instead of leaving a broken delimiter", () => {
    for (const [source, head, key, plain] of [
      ["**重点**", 2, "Backspace", "重点"],
      ["**重点**", 4, "Delete", "重点"],
      ["[来源](https://example.test)", 1, "Backspace", "来源"],
    ] as const) {
      const view = mount(source);
      view.dispatch({ selection: { anchor: head } });
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(view.state.doc.toString()).toBe(plain);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    }
  });

  it("keeps paired syntax balanced when deleting from outside the rendered format", () => {
    for (const [source, plain] of [
      ["**重点**", "重点"],
      ["*轻声*", "轻声"],
      ["~~旧~~", "旧"],
      ["`code`", "code"],
      ["[来源](https://example.test)", "来源"],
      ["```md\n**literal**\n```", "**literal**"],
    ]) {
      for (const [head, key] of [
        [source.length, "Backspace"],
        [0, "Delete"],
      ] as const) {
        const view = mount(source);
        // Pasting places the caret after the closing delimiter. This is a
        // different (but visually identical) position from its inner edge.
        view.dispatch({ selection: { anchor: head } });
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        expect(view.state.doc.toString()).toBe(plain);
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(source);
        expect(redo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(plain);
      }
    }
  });

  it("preserves visible text when a keyboard selection deletes only a hidden edge", () => {
    const source = "[来源](https://example.test)";
    const view = mount(source);
    view.dispatch({ selection: { anchor: source.length } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }));
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(view.state.doc.toString()).toBe("来源");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("keeps cross-boundary deletion, cut and replacement in a single undoable edit", () => {
    for (const [from, to, insert, event, expected] of [
      [4, 7, "", "delete.selection", "前重后"],
      [0, 4, "", "delete.cut", "点后"],
      [4, 7, "新", "input.paste", "前重新后"],
    ] as const) {
      const source = "前**重点**后";
      const view = mount(source);
      view.dispatch({ selection: { anchor: from, head: to } });
      view.dispatch(view.state.replaceSelection(insert), { userEvent: event });
      expect(view.state.doc.toString()).toBe(expected);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    }
  });

  it("does not normalize composition input or deliberate source edits", () => {
    const view = mount("**重点**");
    view.dispatch({ changes: { from: 2, to: 4, insert: "内容" }, userEvent: "input.type.compose" });
    expect(view.state.doc.toString()).toBe("**内容**");
    expect(undo(view)).toBe(true);
    view.dispatch({ effects: previewCompartment.reconfigure([]) });
    view.dispatch({ selection: { anchor: 6 } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(view.state.doc.toString()).toBe("**重点*");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("**重点**");
  });

  it("splits formatted paragraphs without exposing syntax or losing nested marks and link targets", () => {
    for (const [source, position, expected] of [
      ["**重点**", 3, "**重**\n\n**点**"],
      ["***重点***", 4, "***重***\n\n***点***"],
      ["**alpha beta**", 8, "**alpha** \n\n**beta**"],
      ["[来源](https://example.test)", 2, "[来](https://example.test)\n\n[源](https://example.test)"],
    ] as const) {
      const view = mount(source);
      view.dispatch({ selection: { anchor: position } });
      for (let count = 0; count < 2; count++) view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(view.state.doc.toString()).toBe(expected);
      expect(view.contentDOM.textContent).not.toContain("*");
      expect(view.contentDOM.textContent).not.toContain("https://example.test");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(`${source.slice(0, position)}\n${source.slice(position)}`);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(expected);
    }
  });

  it("leaves full replacement and ordinary text next to nested formatting verbatim", () => {
    const source = "前**[来源](https://example.test)**后";
    const view = mount(source);
    view.dispatch({ selection: { anchor: source.length } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(view.state.doc.toString()).toBe(source.slice(0, -1));
    expect(undo(view)).toBe(true);
    const replacement = "新内容\n\n**保留**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n#旧标签";
    view.dispatch({ selection: { anchor: 0, head: source.length } });
    view.dispatch(view.state.replaceSelection(replacement), { userEvent: "input.paste" });
    expect(view.state.doc.toString()).toBe(replacement);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(replacement);
  });

  it("assigns table content to explicit columns and preserves an editable empty middle cell", () => {
    const source = "| A | B | C |\n| --- | --- | --- |\n|one||three|";
    const view = mount(source);
    const row = view.dom.querySelectorAll(".cm-preview-table-row")[1];
    const cells = Array.from(row.querySelectorAll<HTMLElement>(":scope > .cm-preview-table-cell"));
    expect(cells.map((cell) => cell.textContent)).toEqual(["one", "", "three"]);
    expect(cells.map((cell) => cell.dataset.tableColumn)).toEqual(["1", "2", "3"]);
    cells[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.selection.main.head).toBe(source.indexOf("||") + 1);
    view.dispatch(view.state.replaceSelection("two"), { userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(source.replace("||", "|two|"));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(view.dom.querySelectorAll(".cm-preview-table-row")[1].querySelectorAll(":scope > .cm-preview-table-cell")).toHaveLength(3);
  });

  it("keeps Enter and multiline paste inside a table cell without breaking its row", () => {
    const source = "| A | B |\n| --- | --- |\n| one | two |";
    const view = mount(source);
    const position = source.indexOf("one") + 1;
    view.dispatch({ selection: { anchor: position } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.doc.toString()).toBe(source.replace("one", "o<br>ne"));
    expect(view.contentDOM.querySelector(".cm-preview-table-cell br")).not.toBeNull();
    expect(view.contentDOM.textContent).not.toContain("<br>");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    view.dispatch({ selection: { anchor: position } });
    view.dispatch(view.state.replaceSelection("甲\n乙\n\n丙"), { userEvent: "input.paste" });
    expect(view.state.doc.toString()).toBe(source.replace("one", "o甲<br>乙<br><br>丙ne"));
    expect(view.contentDOM.querySelectorAll(".cm-preview-table-cell br")).toHaveLength(3);
    expect(view.dom.querySelectorAll(".cm-preview-table-row")).toHaveLength(2);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("places the caret inside the last table cell after paste so appended text cannot create an invisible extra column", () => {
    const source = "| A | B | C |\n| --- | --- | --- |\n|one||three|";
    const view = mount("");
    paste(view, "", source);
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.head).toBe(source.length - 1);
    view.dispatch(view.state.replaceSelection("末尾"), { userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(source.slice(0, -1) + "末尾|");
    expect(view.dom.querySelectorAll(".cm-preview-table-row")[1].querySelectorAll(":scope > .cm-preview-table-cell")).toHaveLength(3);
  });

  it("leaves the last table cell through Down and creates one undoable following paragraph", () => {
    const source = "| A | B |\n| --- | --- |\n| one | two |";
    const view = mount(source);
    view.dispatch({ selection: { anchor: source.length - 1 } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(view.state.doc.toString()).toBe(`${source}\n\n`);
    expect(view.state.selection.main.head).toBe(source.length + 2);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);
    view.dispatch(view.state.replaceSelection("继续记录"), { userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(`${source}\n\n继续记录`);
    expect(view.dom.querySelectorAll(".cm-preview-table-row")).toHaveLength(2);
  });

  it("moves Down to existing prose after a table without changing bytes or ordinary arrow navigation", () => {
    const table = "| A | B |\n| --- | --- |\n| one | two |";
    const source = `${table}\n\n后文`;
    const view = mount(source);
    view.dispatch({ selection: { anchor: table.length - 1 } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.head).toBe(source.indexOf("后文"));
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(view.state.doc.toString()).toBe(source);
    const normal = mount("普通文字\n最后一行");
    normal.dispatch({ selection: { anchor: normal.state.doc.length } });
    normal.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(normal.state.doc.toString()).toBe("普通文字\n最后一行");
  });

  it("renders structure without changing legacy Markdown, tags, links or complex source", () => {
    const markdown =
      "current\n\n## 标题\n\n**重要** and *轻声* ~~旧~~\n\n- [ ] 回顾\n\n> 引用\n\n[来源](https://example.test)\n\n![照片](https://example.test/photo.png)\n\n#人生修行/阅读\n\n| A | B |\n| - | - |\n| 1 | 2 |";
    const view = mount(markdown);
    expect(view.contentDOM.textContent).toContain("标题");
    expect(view.contentDOM.textContent).not.toContain("**重要**");
    expect(view.dom.querySelector(".cm-md-h2")).toBeTruthy();
    expect(view.dom.querySelector(".cm-preview-quote")).toBeTruthy();
    expect(view.dom.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(view.dom.querySelector(".cm-preview-image img")).toHaveAttribute("src", "https://example.test/photo.png");
    expect(view.state.doc.toString()).toBe(markdown);
    const selected = { anchor: markdown.indexOf("重要"), head: markdown.indexOf("重要") + 2 };
    view.dispatch({ selection: selected });
    view.dispatch({ effects: previewCompartment.reconfigure([]) });
    expect(view.state.selection.main.anchor).toBe(selected.anchor);
    expect(view.state.selection.main.head).toBe(selected.head);
    expect(view.state.doc.toString()).toBe(markdown);
    expect(view.dom.querySelector(".cm-preview-image")).toBeNull();
    view.dispatch({ effects: previewCompartment.reconfigure(livePreview) });
    expect(view.state.doc.toString()).toBe(markdown);
    expect(view.state.selection.main.head).toBe(selected.head);
  });

  it("leaves fenced code literal and never styles its contents as headings, tags or tasks", () => {
    const source = "write here\n\n```md\n## literal\n- [ ] literal\n**literal**\n```";
    const view = mount(source);
    expect(view.dom.querySelector(".cm-md-h2")).toBeNull();
    expect(view.dom.querySelector('input[type="checkbox"]')).toBeNull();
    expect(view.contentDOM.textContent).toContain("**literal**");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("makes task checkboxes editable and undoable without losing history on mode changes", () => {
    const view = mount("current\n\n- [ ] 今天");
    const checkbox = view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(view.state.doc.toString()).toContain("- [x] 今天");
    view.dispatch({ effects: previewCompartment.reconfigure([]) });
    undo(view);
    expect(view.state.doc.toString()).toContain("- [ ] 今天");
    view.dispatch({ effects: previewCompartment.reconfigure(livePreview) });
    redo(view);
    expect(view.state.doc.toString()).toContain("- [x] 今天");
  });

  it("converts basic HTML semantics without source styles or fetching remote images", () => {
    const converted = htmlClipboardMarkdown(
      '<h2 style="color:red">今天</h2><p><strong>重点</strong> <em>想法</em> <a href="https://example.test/a">来源</a></p><ul><li>一</li><li>二</li></ul><img src="https://example.test/image.png" alt="图片"><script>alert(1)</script>',
    );
    expect(converted).toBe(
      "## 今天\n\n**重点** *想法* [来源](https://example.test/a)\n\n- 一\n- 二\n\n[图片](https://example.test/image.png)",
    );
    expect(converted).not.toContain("style");
    expect(converted).not.toContain("![");
    expect(htmlClipboardMarkdown('<a href="javascript:alert(1)">内容</a>')).toBe("内容");
    expect(htmlClipboardMarkdown("<pre>**literal**\n```\n&lt;tag&gt;</pre>")).toBe("````\n**literal**\n```\n<tag>\n````");
  });

  it("preserves text and the order of multiple actual images in a mixed HTML paste", () => {
    const files = [new File(["a"], "first.png", { type: "image/png" }), new File(["b"], "second.png", { type: "image/png" })];
    const onFiles = vi.fn();
    const view = mount("记录", onFiles);
    view.dispatch({ selection: { anchor: 2 } });
    paste(view, '<p>前</p><img src="blob:first"><p>中</p><img src="blob:second"><p>后</p>', "前中后", files);
    const content = view.state.doc.toString();
    expect(content).toContain("前");
    expect(content).toContain("中");
    expect(content).toContain("后");
    expect(content).not.toContain("kairos-image");
    expect(content).not.toContain("blob:");
    expect(onFiles).toHaveBeenCalledTimes(2);
    const first = onFiles.mock.calls[0][1].position;
    const second = onFiles.mock.calls[1][1].position;
    expect(content.indexOf("前")).toBeLessThan(first);
    expect(first).toBeLessThan(content.indexOf("中"));
    expect(content.indexOf("中")).toBeLessThan(second);
    expect(second).toBeLessThan(content.indexOf("后"));
    expect(onFiles.mock.calls.map(([fileList]) => fileList[0].name)).toEqual(["first.png", "second.png"]);
  });

  it("does not consume a local image for an earlier remote image in mixed HTML", () => {
    const file = new File(["local bytes"], "local.png", { type: "image/png" });
    const onFiles = vi.fn();
    const view = mount("", onFiles);
    paste(
      view,
      '<p>开始</p><img src="https://example.test/remote.png" alt="远程"><p>中间</p><img src="blob:local"><p>结束</p>',
      "开始中间结束",
      [file],
    );
    const content = view.state.doc.toString();
    expect(content).toContain("[远程](https://example.test/remote.png)");
    expect(onFiles).toHaveBeenCalledTimes(1);
    const position = onFiles.mock.calls[0][1].position;
    expect(position).toBeGreaterThan(content.indexOf("中间"));
    expect(position).toBeLessThan(content.indexOf("结束"));
  });

  it("preserves repeated blank lines in pasted preformatted code", () => {
    expect(htmlClipboardMarkdown("<pre>first\n\n\nlast</pre>")).toBe("```\nfirst\n\n\nlast\n```");
  });

  it("keeps literal code inside its quote while retaining all empty lines", () => {
    expect(htmlClipboardMarkdown("<blockquote><pre>first\n\n\nlast</pre></blockquote>")).toBe("> ```\n> first\n> \n> \n> last\n> ```");
  });

  it("keeps ambiguous and remote HTML image sources while attaching actual file bytes once", () => {
    const file = new File(["image"], "actual.png", { type: "image/png" });
    const onFiles = vi.fn();
    const view = mount("", onFiles);
    paste(
      view,
      '<img src="https://example.test/photo.png" alt="来源"><img src="blob:one" alt="一"><img src="blob:two" alt="二">',
      "来源一二",
      [file],
    );
    expect(view.state.doc.toString()).toContain("[来源](https://example.test/photo.png)");
    expect(view.state.doc.toString()).toContain("一二");
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([file], { source: "paste", position: view.state.doc.length });
  });

  it("supports semantic and plain-text paste as separate user intents", () => {
    const view = mount("");
    paste(view, "<b>重点</b>", "重点");
    expect(view.state.doc.toString()).toBe("**重点**");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, shiftKey: true, bubbles: true }));
    paste(view, "<b>纯文本</b>", "纯文本");
    expect(view.state.doc.toString()).toBe("**重点**纯文本");
  });

  it("consumes an explicit plain paste once, replaces the selection and remains undoable", () => {
    const onFiles = vi.fn();
    const consume = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const view = mount("保留 待替换 尾部", onFiles, consume);
    view.dispatch({ selection: { anchor: 3, head: 6 } });
    paste(view, '<strong>纯文字</strong><img src="blob:image">', "纯文字", [new File(["image"], "one.png", { type: "image/png" })]);
    expect(view.state.doc.toString()).toBe("保留 纯文字 尾部");
    expect(onFiles).not.toHaveBeenCalled();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("保留 待替换 尾部");
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("保留 纯文字 尾部");
    paste(view, "<strong>下一次</strong>", "下一次");
    expect(view.state.doc.toString()).toContain("**下一次**");
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("never deletes selected text when plain paste receives only an image", () => {
    const onFiles = vi.fn();
    const view = mount("要保留的文字", onFiles, () => true);
    view.dispatch({ selection: { anchor: 1, head: 5 } });
    paste(view, '<img src="blob:image">', "", [new File(["image"], "one.png", { type: "image/png" })]);
    expect(view.state.doc.toString()).toBe("要保留的文字");
    expect(view.state.selection.main.from).toBe(1);
    expect(view.state.selection.main.to).toBe(5);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("preserves native plain-paste support for URI-only clipboard text", () => {
    const view = mount("替换这里", vi.fn(), () => true);
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/uri-list" ? "https://example.test/source" : ""), items: [], files: [] },
    });
    view.contentDOM.dispatchEvent(event);
    expect(view.state.doc.toString()).toBe("https://example.test/source");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("替换这里");
  });
  it("shows a task checkbox while continuing to type on its active line", () => {
    const view = mount("- [ ] 今天");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(view.dom.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(view.state.doc.toString()).toBe("- [ ] 今天");
  });
});
