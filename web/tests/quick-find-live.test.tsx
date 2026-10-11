import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickFindDialog from "@/components/AppSidebar/QuickFindDialog";
import { AppSidebarProvider, useAppSidebar } from "@/contexts/AppSidebarContext";
import { type MemoFilter, parseFilterQuery } from "@/contexts/MemoFilterContext";
import { State } from "@/types/proto/api/v1/common_pb";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const state = vi.hoisted(() => ({ list: vi.fn(), filters: [] as MemoFilter[], setFilters: vi.fn(), owner: "users/alice" }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos: state.list } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => (state.owner ? { name: state.owner } : undefined) }));
vi.mock("@/components/MemoContent", () => ({ default: () => null }));
vi.mock("@/contexts/ViewContext", () => ({ useView: () => ({ timeBasis: "create_time" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai" } }) }));
vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({ duplicateSpaceTitles: new Set(), isSpaceReady: true, memoFilter: 'creator == "users/alice"' }),
}));
vi.mock("@/hooks/useUserQueries", () => ({
  useMemoViews: () => ({ data: [] }),
  useAllUserStats: () => ({ data: [{ tagCount: { "人生/阅读": 3 } }] }),
}));
vi.mock("@/hooks/useJournalPartitionQueries", () => ({ useJournalPartitions: () => ({ data: { partitions: [] } }) }));
vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/MemoFilterContext")>()),
  useMemoFilterContext: () => ({ filters: state.filters, setFilters: state.setFilters, setMemoView: vi.fn() }),
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const memo = (id: string, content = id) =>
  create(MemoSchema, {
    name: `memos/${id}`,
    creator: "users/alice",
    content,
    snippet: content.slice(0, 20),
    state: State.NORMAL,
    createTime: timestampFromDate(new Date("2026-10-10T23:00:00Z")),
  });
const page = (id: string, content = id) => ({ memos: [memo(id, content)], nextPageToken: "" });
const input = () => screen.getByRole("combobox", { name: /^搜索 / });

function Harness() {
  const { setQuickFindOpen } = useAppSidebar();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => setQuickFindOpen(true)}>
        查找
      </button>
      <output data-testid="path">
        {location.pathname}
        {location.search}
      </output>
      <QuickFindDialog />
    </>
  );
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <QueryClientProvider client={client}>
            <AppSidebarProvider>
              <Harness />
            </AppSidebarProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  const view = render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("button", { name: "查找" }));
  return { router, ...view };
}

beforeEach(() => {
  state.list.mockReset();
  state.setFilters.mockClear();
  state.filters = [];
  state.owner = "users/alice";
});

describe("live Quick Find", () => {
  it("shows matches without Enter, hides previous candidates, and sends complete facets to the full list", async () => {
    state.list.mockImplementation((request) =>
      Promise.resolve(request.filter.includes("散步") ? page("walk", "晚饭后散步，路边有桂花。") : page("recent")),
    );
    setup();
    await screen.findByRole("button", { name: "打开 recent" });
    fireEvent.change(input(), { target: { value: "散步" } });
    expect(screen.queryByRole("button", { name: "打开 recent" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "打开 晚饭后散步，路边有桂花。" });
    expect(screen.getByText("散步", { selector: "mark" })).toBeInTheDocument();
    expect(state.list.mock.calls.at(-1)?.[0]).toMatchObject({
      pageSize: 8,
      orderBy: "create_time desc",
      state: State.NORMAL,
      includeArchived: false,
    });
    expect(state.list.mock.calls.every(([request]) => request.filter.includes('creator == "users/alice"'))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "未添加标签" }));
    fireEvent.click(screen.getByRole("button", { name: "有图片" }));
    await waitFor(() => expect(state.list.mock.calls.at(-1)?.[0].filter).toContain("has_image"));
    expect(state.list.mock.calls.at(-1)?.[0].filter).toContain("size(tags) == 0");
    expect(state.list.mock.calls.at(-1)?.[0].filter).toContain('content.contains("散步")');
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const search = screen.getByTestId("path").textContent!.split("?")[1];
    expect(parseFilterQuery(new URLSearchParams(search).get("filter"))).toEqual([
      { factor: "untagged", value: "true" },
      { factor: "property.hasImage", value: "true" },
      { factor: "contentSearch", value: "散步" },
    ]);
  });

  it("holds requests and selection during Chinese composition, then searches the committed text", async () => {
    state.list.mockResolvedValue(page("one", "中文记录"));
    setup();
    await screen.findByRole("button", { name: "打开 中文记录" });
    const count = state.list.mock.calls.length;
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "zhong" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(state.list).toHaveBeenCalledTimes(count);
    fireEvent(input(), createEvent.keyDown(input(), { key: "Enter", isComposing: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: "中文" } });
    fireEvent.compositionEnd(input());
    await waitFor(() => expect(state.list.mock.calls.at(-1)?.[0].filter).toContain('content.contains("中文")'));
    expect(state.list.mock.calls.some(([request]) => request.filter.includes("zhong"))).toBe(false);
  });

  it("opens a keyboard-selected candidate and retains the query after returning", async () => {
    state.list.mockResolvedValue(page("walk", "一次散步"));
    const { router } = setup();
    fireEvent.change(input(), { target: { value: "散步" } });
    await screen.findByRole("button", { name: "打开 一次散步" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/memos/walk"));
    expect(router.state.location.state).toEqual({ from: "/" });
    await act(async () => {
      await router.navigate(-1);
    });
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    expect(input()).toHaveValue("散步");
  });

  it("distinguishes errors from no matches and retries without losing the query", async () => {
    state.list
      .mockResolvedValueOnce(page("first"))
      .mockRejectedValueOnce(new ConnectError("denied", Code.PermissionDenied))
      .mockResolvedValueOnce({ memos: [], nextPageToken: "" });
    setup();
    await screen.findByRole("button", { name: "打开 first" });
    fireEvent.change(input(), { target: { value: "人生" } });
    await screen.findByRole("alert");
    expect(screen.queryByText(/没有匹配的记录/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 first" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("匹配标签")).not.toBeInTheDocument();
    expect(input()).toHaveValue("人生");
    fireEvent.click(screen.getByRole("button", { name: "重试搜索" }));
    await screen.findByText(/没有匹配的记录/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("applies complete custom dates only and combines a matching tag without interpreting it as text", async () => {
    state.list.mockResolvedValue({ memos: [], nextPageToken: "" });
    setup();
    await screen.findByText(/没有匹配的记录/);
    fireEvent.change(input(), { target: { value: "人生" } });
    fireEvent.click(screen.getByRole("button", { name: "#人生/阅读" }));
    expect(input()).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "更多筛选" }));
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("button", { name: "查看全部匹配记录" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("请补全");
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-10-07" } });
    await waitFor(() => expect(state.list.mock.calls.at(-1)?.[0].filter).toContain("created_ts >= timestamp(1790784000)"));
    expect(state.list.mock.calls.at(-1)?.[0].filter).toContain("created_ts < timestamp(1791388800)");
    expect(state.list.mock.calls.at(-1)?.[0].filter).toContain('"人生/阅读" in tags');
    expect(state.list.mock.calls.at(-1)?.[0].filter).not.toContain("content.contains");
  });
});
