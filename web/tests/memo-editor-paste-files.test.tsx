import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoEditor from "@/components/MemoEditor";
import { uploadService } from "@/components/MemoEditor/services";
import { type JournalDraft, journalDrafts, snapshotJournalState } from "@/lib/journal-drafts";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("@/hooks/useUserQueries", () => ({ useTagCounts: () => ({ data: {} }) }));
vi.mock("@/hooks/useMemoQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMemoQueries")>()),
  useInfiniteMemos: () => ({ data: { pages: [{ memos: [] }] }, isPending: false, isRefetching: false, isError: false }),
}));
const identity = vi.hoisted(() => ({ name: "users/1" }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: identity.name }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userGeneralSetting: {} }) }));
vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({ aiSetting: { providers: [], transcription: undefined }, fetchSetting: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/contexts/NewMemoContext", () => ({ useNewMemo: () => ({ markNewMemo: vi.fn() }) }));
vi.mock("@/connect", () => ({ attachmentServiceClient: {}, memoServiceClient: {}, userServiceClient: {} }));
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// jsdom has no object URLs; local files are keyed by this value, so keep it unique per file.
URL.createObjectURL = (blob) => `blob:${(blob as File).name}`;
URL.revokeObjectURL = () => {};

const paste = (target: Element, files: File[]) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items: files.map((file) => ({ kind: "file", getAsFile: () => file })) },
  });
  target.dispatchEvent(event);
  return event;
};

const mount = () => {
  const client = new QueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <MemoEditor cacheKey="paste-test" />
    </QueryClientProvider>,
  );
  const content = result.container.querySelector<HTMLElement>(".cm-content");
  expect(content).not.toBeNull();
  const refresh = () =>
    result.rerender(
      <QueryClientProvider client={client}>
        <MemoEditor cacheKey="paste-test" />
      </QueryClientProvider>,
    );
  return { ...result, content: content!, refresh };
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  identity.name = "users/1";
});

describe("MemoEditor paste", () => {
  it("inlines pasted images while keeping non-image files in the attachment list", async () => {
    const upload = vi.spyOn(uploadService, "uploadFile").mockRejectedValue(new Error("network unavailable"));
    const { content, container } = mount();
    const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    const image = new File(["png"], "image.png", { type: "image/png" });

    const event = paste(content, [pdf, image]);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(container.querySelector(".cm-upload-preview")).toHaveAttribute("src", "blob:image.png"));
    expect(container.textContent).toContain(pdf.name);
    expect(container.querySelector(".cm-upload-anchor")).toHaveAttribute("data-status", "failed");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].file).toBe(image);
    expect(container.textContent).not.toContain("服务器保存成功");
  });
  it("isolates pending files and late persistence when the mounted editor changes accounts", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let finishOldWrite!: () => void;
    const oldWrite = new Promise<void>((resolve) => {
      finishOldWrite = resolve;
    });
    const persisted: { key: string; owner: string; names: string[] }[] = [];
    const persist = vi.spyOn(journalDrafts, "save").mockImplementation(async (key, owner, state, options, kind = "draft") => {
      if (owner === "users/1") await oldWrite;
      persisted.push({ key, owner, names: state.localFiles.map((entry) => entry.file.name) });
      return { key, owner, state: { ...state, localFiles: [] }, options, kind, updatedAt: 1 };
    });
    vi.spyOn(journalDrafts, "remove").mockResolvedValue();
    vi.spyOn(journalDrafts, "list").mockResolvedValue([]);
    vi.spyOn(journalDrafts, "pending").mockResolvedValue([]);
    const mounted = mount();
    act(() => paste(mounted.content, [new File(["private A bytes"], "alice.png", { type: "image/png" })]));
    await waitFor(() => expect(persist).toHaveBeenCalled());
    expect(mounted.container.querySelector(".cm-upload-preview")).toHaveAttribute("src", "blob:alice.png");
    identity.name = "users/2";
    mounted.refresh();
    expect(mounted.container.querySelector(".cm-content")).not.toBe(mounted.content);
    expect(mounted.container.querySelector(".cm-upload-preview")).toBeNull();
    const currentEditor = mounted.container.querySelector(".cm-content")!;
    act(() => paste(currentEditor, [new File(["private B bytes"], "bob.png", { type: "image/png" })]));
    await waitFor(() => expect(persist.mock.calls.some(([, owner]) => owner === "users/2")).toBe(true));
    await act(async () => finishOldWrite());
    expect(persisted.some((entry) => entry.owner === "users/1")).toBe(true);
    expect(persisted.some((entry) => entry.owner === "users/2")).toBe(true);
    for (const { key, owner, names } of persisted) {
      expect(key).toContain(owner);
      expect(names).toEqual([owner === "users/1" ? "alice.png" : "bob.png"]);
    }
    expect(mounted.container.querySelector(".cm-upload-preview")).toHaveAttribute("src", "blob:bob.png");
  });

  it("restores each account's own pending image when switching back", async () => {
    const stored = new Map<string, JournalDraft>();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(journalDrafts, "get").mockImplementation(async (key) => stored.get(key));
    vi.spyOn(journalDrafts, "remove").mockResolvedValue();
    vi.spyOn(journalDrafts, "list").mockResolvedValue([]);
    vi.spyOn(journalDrafts, "pending").mockResolvedValue([]);
    vi.spyOn(journalDrafts, "save").mockImplementation(async (key, owner, state, options, kind = "draft") => {
      const draft = { key, owner, state: await snapshotJournalState(state), options, kind, updatedAt: 1 };
      stored.set(key, draft);
      return draft;
    });
    // Exercise real initialization/restoration while the storage transport is
    // controlled; actual IndexedDB reload is a separate browser acceptance.
    vi.stubGlobal("indexedDB", {});
    const client = new QueryClient();
    const node = () => (
      <QueryClientProvider client={client}>
        <MemoEditor cacheKey="account-recovery" />
      </QueryClientProvider>
    );
    const mounted = render(node());
    try {
      for (const [owner, filename] of [
        ["users/1", "alice.png"],
        ["users/2", "bob.png"],
      ]) {
        identity.name = owner;
        mounted.rerender(node());
        await waitFor(() => expect(mounted.container.querySelector(".cm-content")).not.toBeNull());
        expect(mounted.container.querySelector(".cm-upload-preview")).toBeNull();
        act(() => paste(mounted.container.querySelector(".cm-content")!, [new File([owner], filename, { type: "image/png" })]));
        await waitFor(() => expect(stored.get(`${owner}-account-recovery`)?.state.localFiles[0].file.name).toBe(filename));
      }
      identity.name = "users/1";
      mounted.rerender(node());
      await waitFor(() => expect(mounted.container.querySelector(".cm-upload-preview")).toHaveAttribute("src", "blob:alice.png"));
      expect(mounted.container.querySelector('[src="blob:bob.png"]')).toBeNull();
      expect(journalDrafts.get).toHaveBeenLastCalledWith("users/1-account-recovery");
    } finally {
      mounted.unmount();
      vi.stubGlobal("indexedDB", undefined);
    }
  });

  it("keeps the same editor and pending image across source/focus changes and gives dialogs priority on Escape", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const upload = vi.spyOn(uploadService, "uploadFile").mockRejectedValue(new Error("must not upload offline"));
    const { content, container } = mount();
    act(() => paste(content, [new File(["png"], "focus.png", { type: "image/png" })]));
    fireEvent.click(screen.getByRole("button", { name: "Markdown 源码" }));
    expect(container.querySelector(".cm-content")).toBe(content);
    const scroller = container.querySelector<HTMLElement>(".cm-scroller")!;
    scroller.scrollTop = 120;
    fireEvent.click(screen.getByRole("button", { name: "聚焦" }));
    scroller.scrollTop = 35;
    expect(container.querySelector("[data-focus-mode]")).toBeTruthy();
    expect(container.querySelector(".cm-content")).toBe(content);
    expect(container.querySelector(".cm-upload-preview")).toHaveAttribute("src", "blob:focus.png");
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    fireEvent.keyDown(content, { key: "Escape" });
    expect(container.querySelector("[data-focus-mode]")).toBeTruthy();
    dialog.remove();
    fireEvent.keyDown(content, { key: "Escape" });
    expect(container.querySelector("[data-focus-mode]")).toBeNull();
    expect(scroller.scrollTop).toBe(120);
    expect(container.querySelector(".cm-content")).toBe(content);
    expect(container.querySelector(".cm-upload-preview")).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it("retains a long document, nonempty selection and scroll when returning from the real relation dialog", async () => {
    const { content, container } = mount();
    const view = EditorView.findFromDOM(content)!;
    const markdown = Array.from({ length: 100 }, (_, index) => `${index + 1} 长文滚动验收`).join("\n");
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } }));
    const selected = view.state.doc.line(17);
    act(() => view.dispatch({ selection: { anchor: selected.from, head: selected.to } }));
    const scroller = view.scrollDOM;
    scroller.scrollTop = 408;
    fireEvent.click(screen.getByRole("button", { name: "聚焦" }));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(scroller.scrollTop).toBe(408);
    scroller.scrollTop = 812;
    fireEvent.click(screen.getByRole("button", { name: "关联记录" }));
    const dialog = await screen.findByRole("dialog", { name: "关联记录" });
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(content).toHaveFocus());
    expect(container.querySelector("[data-focus-mode]")).toBeTruthy();
    expect(scroller.scrollTop).toBe(812);
    expect(view.state.selection.main).toMatchObject({ anchor: selected.from, head: selected.to });
    expect(view.state.doc.toString()).toBe(markdown);
    fireEvent.click(screen.getByRole("button", { name: "editor.exit-focus-mode" }));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(scroller.scrollTop).toBe(408);
    expect(view.state.selection.main).toMatchObject({ anchor: selected.from, head: selected.to });
    expect(view.state.doc.toString()).toBe(markdown);
    expect(container.querySelector(".cm-content")).toBe(content);
  });
});

import { EditorView } from "@codemirror/view";
