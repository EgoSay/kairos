import { create } from "@bufbuild/protobuf";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("never renders cached private text before a fresh check, or after access is denied", async () => {
    const queryClient = client();
    queryClient.setQueryData(memoKeys.detail(memo.name), memo);
    mocks.near = false;
    mocks.getMemo.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));
    const { rerender } = render(<RecordReference name={memo.name} href="/memos/one" />, { wrapper: wrapper(queryClient) });
    expect(screen.queryByText("原始正文")).not.toBeInTheDocument();
    expect(mocks.getMemo).not.toHaveBeenCalled();
    mocks.near = true;
    rerender(<RecordReference name={memo.name} href="/memos/one" />);
    expect(screen.queryByText("原始正文")).not.toBeInTheDocument();
    await screen.findByText("记录不可用");
    expect(queryClient.getQueryData(memoKeys.detail(memo.name))).toBeNull();
  });

  it("keeps the authored label, ordinary activation and modified-link behavior", async () => {
    render(<RecordReference name={memo.name} href="/memos/one" label="我的命名" sourceName="memos/source" />, {
      wrapper: wrapper(client()),
    });
    await waitFor(() => expect(mocks.getMemo).toHaveBeenCalled());
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

  it("retains a readable link on failure and resolves the original excerpt after retry", async () => {
    mocks.getMemo.mockRejectedValueOnce(new ConnectError("failed", Code.InvalidArgument));
    render(<RecordReference name={memo.name} href="/memos/one" />, { wrapper: wrapper(client()) });
    await screen.findByText("暂时无法读取");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/memos/one");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("原始正文");
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
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
    await screen.findByText("原始正文");
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
    await screen.findByText("原始正文");
    expect(container.querySelectorAll(".cm-record-reference")).toHaveLength(1);
  });
});
