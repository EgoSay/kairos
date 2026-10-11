import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { createController } from "@/components/MemoEditor/Editor/controller";
import { type UploadAnchorDescriptor, uploadAnchorField } from "@/components/MemoEditor/Editor/uploadAnchors";

const descriptor = (id: string): UploadAnchorDescriptor => ({
  id,
  status: "uploading",
  completed: 0,
  total: 1,
  message: "Uploading images 0/1",
  retryLabel: "Retry",
  keepLabel: "Keep as attachments",
  onRetry: vi.fn(),
  onKeepAttachments: vi.fn(),
});

const view = (doc = "") => new EditorView({ state: EditorState.create({ doc, extensions: [uploadAnchorField] }) });

describe("editor upload anchors", () => {
  it("maps the anchor through edits before resolving Markdown", () => {
    const editorView = view("alpha");
    const controller = createController(editorView, {} as never);
    controller.setCursor(5);
    controller.createUploadAnchor(descriptor("upload-one"));

    editorView.dispatch({ changes: { from: 0, insert: "X" } });
    controller.resolveUploadAnchor("upload-one", "![photo](/file/attachments/photo)");

    expect(controller.getMarkdown()).toBe("Xalpha\n\n![photo](/file/attachments/photo)");
    expect(editorView.dom.querySelector(".cm-upload-anchor")).toBeNull();
  });

  it("cancels an anchor without changing serialized Markdown", () => {
    const editorView = view("alpha");
    const controller = createController(editorView, {} as never);
    controller.createUploadAnchor(descriptor("upload-two"), 2);
    expect(editorView.dom.querySelector(".cm-upload-anchor")).not.toBeNull();

    controller.cancelUploadAnchor("upload-two");

    expect(controller.getMarkdown()).toBe("alpha");
    expect(editorView.dom.querySelector(".cm-upload-anchor")).toBeNull();
  });

  // The buttons that reach insertMarkdown live outside the editor, and CodeMirror
  // keeps its selection across blur, so an insert must not consume the range.
  it("inserts at the caret without replacing the selection", () => {
    const editorView = view("keep this paragraph of text");
    const controller = createController(editorView, {} as never);
    editorView.dispatch({ selection: { anchor: 5, head: 19 } });

    controller.insertMarkdown("![photo](/file/attachments/photo)");

    expect(controller.getMarkdown()).toBe("keep this paragraph\n\n![photo](/file/attachments/photo)\n\n of text");
  });

  it("re-renders the anchor when only its labels or callbacks change", () => {
    const editorView = view("alpha");
    const controller = createController(editorView, {} as never);
    const stale = vi.fn();
    controller.createUploadAnchor({ ...descriptor("upload-three"), status: "failed", onRetry: stale });

    const fresh = vi.fn();
    controller.updateUploadAnchor({ ...descriptor("upload-three"), status: "failed", message: "Retrying soon", onRetry: fresh });

    expect(editorView.dom.querySelector(".cm-upload-anchor-badge")?.textContent).toBe("Retrying soon");
    editorView.dom.querySelector<HTMLButtonElement>(".cm-upload-anchor-action")?.click();
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
  it("keeps images before text typed at the paste point and resolves consecutive pastes in order", () => {
    const editorView = view("before");
    const controller = createController(editorView, {} as never);
    controller.setCursor(6);
    controller.createUploadAnchor(descriptor("first"));
    controller.createUploadAnchor(descriptor("second"));
    editorView.dispatch({ changes: { from: 6, insert: "after" }, selection: { anchor: 11 } });
    expect(controller.getUploadAnchorPosition?.("first")).toBe(6);
    controller.resolveUploadAnchor("first", "![first](/file/attachments/first)");
    expect(editorView.state.doc.sliceString(controller.getCursor() - 5, controller.getCursor())).toBe("after");
    controller.resolveUploadAnchor("second", "![second](/file/attachments/second)");
    const source = controller.getMarkdown();
    expect(source.indexOf("![first]")).toBeLessThan(source.indexOf("![second]"));
    expect(source.indexOf("![second]")).toBeLessThan(source.indexOf("after"));
    expect(source.endsWith("after")).toBe(true);
    expect(controller.getCursor()).toBe(source.length);
    editorView.destroy();
  });
  it("keeps a pending image at the deletion boundary when surrounding text is removed", () => {
    const editorView = view("before pending after");
    const controller = createController(editorView, {} as never);
    controller.createUploadAnchor(descriptor("retained"), 10);
    editorView.dispatch({ changes: { from: 7, to: 15, insert: "" } });
    expect(controller.getUploadAnchorPosition?.("retained")).toBe(7);
    controller.resolveUploadAnchor("retained", "![retained](/file/attachments/retained)");
    expect(controller.getMarkdown()).toBe("before \n\n![retained](/file/attachments/retained)\n\nafter");
    editorView.destroy();
  });
});
