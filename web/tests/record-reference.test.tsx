import { create } from "@bufbuild/protobuf";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Editor from "@/components/MemoEditor/Editor";
import type { EditorController } from "@/components/MemoEditor/types/editorController";
import { RecordReadingContext } from "@/components/RecordReference/RecordReadingContext";
import RecordReference from "@/components/RecordReference/RecordReference";
import { memoKeys } from "@/hooks/useMemoQueries";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const mocks = vi.hoisted(() => ({ getMemo: vi.fn(), near: true, open: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: { getMemo: mocks.getMemo } }));
vi.mock("@/hooks/useUserQueries", () => ({ useTagCounts: () => ({ data: {} }), userKeys: { stats: () => [] } }));
vi.mock("@/hooks/useNearViewport", () => ({ useNearViewport: () => ({ ref: { current: null }, isNearViewport: mocks.near }) }));

const memo = create(MemoSchema, { name: "memos/one", content: "原始正文", snippet: "原始正文" });
const reader = { enabled: true, origins: ["https://journal.example"], open: mocks.open };
const wrapper =
  (client: QueryClient, enabled = true) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RecordReadingContext.Provider value={{ ...reader, enabled }}>{children}</RecordReadingContext.Provider>
    </QueryClientProvider>
  );
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

beforeEach(() => {
  mocks.getMemo.mockReset().mockResolvedValue(memo);
  mocks.open.mockReset();
  mocks.near = true;
});

describe("live record reference", () => {
  it("renders only an accessible arrow without fetching or exposing cached text", () => {
    const queryClient = client();
    queryClient.setQueryData(memoKeys.detail(memo.name), memo);
    render(<RecordReference name={memo.name} href="/memos/one" />, { wrapper: wrapper(queryClient) });
    expect(screen.queryByText("原始正文")).not.toBeInTheDocument();
    expect(mocks.getMemo).not.toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "查看关联记录" });
    expect(link.textContent).toBe("");
    expect(link).toHaveAttribute("href", "/memos/one");
    fireEvent.click(link);
    expect(mocks.open).toHaveBeenCalledWith(memo.name, link, undefined, undefined);
  });

  it("keeps the authored label, ordinary activation and modified-link behavior", () => {
    render(<RecordReference name={memo.name} href="/memos/one" label="我的命名" sourceName="memos/source" />, {
      wrapper: wrapper(client()),
    });
    const link = screen.getByRole("link", { name: "我的命名" });
    fireEvent.click(link);
    expect(mocks.open).toHaveBeenCalledWith(memo.name, link, "memos/source", undefined);
    mocks.open.mockClear();
    fireEvent.click(link, { ctrlKey: true });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("href", "/memos/one");
  });

  it("does not resolve references when the share reader is disabled", () => {
    render(<RecordReference name={memo.name} href="/memos/one" />, { wrapper: wrapper(client(), false) });
    expect(mocks.getMemo).not.toHaveBeenCalled();
  });

  it("keeps widget Markdown, selection and undo across reading and source mode", async () => {
    const ref = createRef<EditorController>();
    const original = "开头\n\nhttps://journal.example/memos/one";
    const props = {
      ref,
      className: "",
      initialContent: original,
      placeholder: "",
      onContentChange: vi.fn(),
      onFiles: vi.fn(),
      onSubmit: vi.fn(),
    };
    const { container, rerender } = render(<Editor {...props} />, { wrapper: wrapper(client()) });
    await screen.findByRole("link", { name: "查看关联记录" });
    const view = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
    act(() => view.dispatch({ selection: { anchor: original.length } }));
    fireEvent.click(screen.getByRole("link"));
    expect(ref.current?.getMarkdown()).toBe(original);
    expect(view.state.selection.main.head).toBe(original.length);
    const restore = mocks.open.mock.calls[0][3];
    act(() => restore());
    expect(view.hasFocus).toBe(true);
    act(() => view.dispatch({ changes: { from: original.length, insert: "\n继续写" }, userEvent: "input" }));
    expect(ref.current?.getMarkdown()).toBe(`${original}\n继续写`);
    rerender(<Editor {...props} contentIsExternal={false} sourceMode />);
    expect(container.querySelector(".cm-record-reference")).toBeNull();
    expect(view.state.doc.toString()).toBe(`${original}\n继续写`);
    act(() => {
      undo(view);
    });
    expect(ref.current?.getMarkdown()).toBe(original);
    rerender(<Editor {...props} contentIsExternal={false} />);
    await screen.findByRole("link", { name: "查看关联记录" });
    expect(container.querySelectorAll(".cm-record-reference")).toHaveLength(1);
  });
});
