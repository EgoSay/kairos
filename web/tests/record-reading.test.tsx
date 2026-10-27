import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelatedRecordCard } from "@/components/RecordReference/RecordReadingCard";
import { useRecordReading } from "@/components/RecordReference/RecordReadingContext";
import RecordReadingProvider from "@/components/RecordReference/RecordReadingProvider";
import RecordReference from "@/components/RecordReference/RecordReference";
import { memoKeys } from "@/hooks/useMemoQueries";
import { MemoRelation_Type, MemoRelationSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const mocks = vi.hoisted(() => ({ getMemo: vi.fn(), near: true }));
vi.mock("@/connect", () => ({ memoServiceClient: { getMemo: mocks.getMemo } }));
vi.mock("@/hooks/useUserQueries", () => ({ userKeys: { stats: () => [] } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/owner" }) }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ profile: {} }) }));
vi.mock("@/hooks/useNearViewport", () => ({ useNearViewport: () => ({ ref: { current: null }, isNearViewport: mocks.near }) }));
vi.mock("@/components/MemoContent", () => ({
  default: ({ content, memoName }: { content: string; memoName: string }) => (
    <div>
      <p>{content}</p>
      {memoName === "memos/b" && <RecordReference name="memos/c" href="/memos/c" sourceName={memoName} />}
    </div>
  ),
}));
vi.mock("@/components/PreviewImageDialog", () => ({ default: () => null }));

const relation = (from: string, to: string, type = MemoRelation_Type.CONTENT_REFERENCE) =>
  create(MemoRelationSchema, { memo: { name: from }, relatedMemo: { name: to }, type });
const a = create(MemoSchema, { name: "memos/a", content: "来源完整正文，不只是摘要。", relations: [relation("memos/a", "memos/b")] });
const b = create(MemoSchema, {
  name: "memos/b",
  content: "目标完整正文，继续读到最后一句。",
  relations: [relation(a.name, "memos/b"), relation(a.name, "memos/b", MemoRelation_Type.REFERENCE), relation("memos/b", "memos/c")],
});
const c = create(MemoSchema, {
  name: "memos/c",
  content: "第三条完整正文。",
  relations: [relation(b.name, "memos/c"), relation("memos/c", "memos/d")],
});
const d = create(MemoSchema, { name: "memos/d", content: "第四条正文不自动展开。" });
const memos = new Map([a, b, c, d].map((memo) => [memo.name, memo]));
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const wrapper =
  (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecordReadingProvider>{children}</RecordReadingProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
function OpenReader() {
  const reader = useRecordReading();
  return (
    <button type="button" onClick={(event) => reader.open(b.name, event.currentTarget, a.name)}>
      查看引用
    </button>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.near = true;
  mocks.getMemo.mockReset().mockImplementation(({ name }) => Promise.resolve(memos.get(name)));
});

describe("two-column record reading", () => {
  it("shows both full records without a second click, deduplicates, and only reads one hop", async () => {
    render(<OpenReader />, { wrapper: wrapper(client()) });
    fireEvent.click(screen.getByRole("button", { name: "查看引用" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(a.content);
    expect(within(screen.getByRole("region", { name: "当前记录" })).getByText(b.content)).toBeInTheDocument();
    const related = screen.getByRole("complementary", { name: "关联记录正文" });
    expect(within(related).getAllByText(a.content)).toHaveLength(1);
    await within(related).findByText(c.content);
    expect(screen.queryByText(d.content)).not.toBeInTheDocument();
    expect(mocks.getMemo.mock.calls.map(([request]) => request.name)).not.toContain(d.name);
    expect(dialog.querySelector("details")).toBeNull();
  });

  it("changes the source with each hop and restores the previous pair on back", async () => {
    render(<OpenReader />, { wrapper: wrapper(client()) });
    fireEvent.click(screen.getByRole("button", { name: "查看引用" }));
    await screen.findByText(b.content);
    fireEvent.click(within(screen.getByRole("region", { name: "当前记录" })).getByRole("link", { name: "查看关联记录" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "当前记录" })).getByText(c.content)).toBeInTheDocument());
    await within(screen.getByRole("complementary", { name: "关联记录正文" })).findByText(b.content);
    expect(screen.queryByText(a.content)).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "返回上一条记录" }));
    await within(await screen.findByRole("region", { name: "当前记录" })).findByText(b.content);
    await within(screen.getByRole("complementary", { name: "关联记录正文" })).findByText(a.content);
  });

  it("does not expose a cached related record before its permission check or after denial", async () => {
    const queryClient = client();
    queryClient.setQueryData(memoKeys.detail(a.name), a);
    mocks.near = false;
    mocks.getMemo.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));
    const { rerender } = render(<RelatedRecordCard name={a.name} sourceName={b.name} />, { wrapper: wrapper(queryClient) });
    expect(screen.queryByText(a.content)).not.toBeInTheDocument();
    expect(mocks.getMemo).not.toHaveBeenCalled();
    mocks.near = true;
    rerender(<RelatedRecordCard name={a.name} sourceName={b.name} />);
    expect(screen.queryByText(a.content)).not.toBeInTheDocument();
    await screen.findByText("记录不可用，可能已删除或没有访问权限。");
    expect(screen.queryByText(a.content)).not.toBeInTheDocument();
    expect(queryClient.getQueryData(memoKeys.detail(a.name))).toBeNull();
  });

  it("retries failed related content in place without showing stale cached text", async () => {
    const queryClient = client();
    queryClient.setQueryData(memoKeys.detail(a.name), a);
    mocks.getMemo.mockRejectedValueOnce(new ConnectError("failed", Code.InvalidArgument));
    render(<RelatedRecordCard name={a.name} sourceName={b.name} eager />, { wrapper: wrapper(queryClient) });
    await screen.findByRole("alert");
    expect(screen.queryByText(a.content)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText(a.content);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
