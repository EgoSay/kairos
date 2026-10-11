import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickFindDialog from "@/components/AppSidebar/QuickFindDialog";
import { AppSidebarProvider, useAppSidebar } from "@/contexts/AppSidebarContext";
import { MemoFilterProvider, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useMemoFilters } from "@/hooks/useMemoFilters";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos: api.list } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice" }) }));
vi.mock("@/components/MemoContent", () => ({ default: () => null }));
vi.mock("@/contexts/ViewContext", () => ({ useView: () => ({ timeBasis: "create_time" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai" } }) }));
vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({ duplicateSpaceTitles: new Set(), isSpaceReady: true, memoFilter: 'creator == "users/alice"' }),
}));
vi.mock("@/hooks/useUserQueries", () => ({
  useMemoViews: () => ({ data: [{ name: "users/alice/memoViews/focus", title: "工作笔记", filter: '"work" in tags' }], isPending: false }),
  useAllUserStats: () => ({ data: [] }),
}));
vi.mock("@/hooks/useJournalPartitionQueries", () => ({ useJournalPartitions: () => ({ data: { partitions: [] } }) }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

function Harness() {
  const { setQuickFindOpen } = useAppSidebar();
  const location = useLocation();
  const { memoView, setMemoView } = useMemoFilterContext();
  const fullFilter = useMemoFilters({ creatorName: "users/alice", includeMemoViews: true, includePinned: true });
  return (
    <>
      <button type="button" onClick={() => setQuickFindOpen(true)}>
        查找
      </button>
      <button type="button" onClick={() => setMemoView("focus")}>
        选择工作视图
      </button>
      <output data-testid="path">
        {location.pathname}
        {location.search}
      </output>
      <output data-testid="view">{memoView}</output>
      <output data-testid="full-filter">{fullFilter}</output>
      <QuickFindDialog />
    </>
  );
}
function setup(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <QueryClientProvider client={client}>
            <MemoFilterProvider>
              <AppSidebarProvider>
                <Harness />
              </AppSidebarProvider>
            </MemoFilterProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}
beforeEach(() => {
  api.list.mockReset();
  api.list.mockResolvedValue({ memos: [create(MemoSchema, { name: "memos/one", snippet: "一条工作记录" })], nextPageToken: "" });
});

describe("Quick Find scope and filter recovery", () => {
  it.each([
    "/calendar/2026/10?creator=alice",
    "/map?creator=alice",
  ])("keeps the saved view when %s opens all matching records", async (path) => {
    setup(path);
    fireEvent.click(screen.getByRole("button", { name: "选择工作视图" }));
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    await screen.findByRole("button", { name: "打开 一条工作记录" });
    expect(api.list.mock.calls.at(-1)?.[0].filter).toContain('"work" in tags');
    fireEvent.change(screen.getByRole("combobox", { name: /^搜索 / }), { target: { value: "散步" } });
    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[0].filter).toContain('content.contains("散步")'));
    fireEvent.click(screen.getByRole("button", { name: "查看全部匹配记录" }));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/?filter=contentSearch%3A"));
    expect(new URLSearchParams(screen.getByTestId("path").textContent!.split("?")[1]).get("creator")).toBe("alice");
    expect(screen.getByTestId("view")).toHaveTextContent("focus");
    expect(screen.getByTestId("full-filter")).toHaveTextContent('"work" in tags');
    expect(screen.getByTestId("full-filter")).toHaveTextContent('content.contains("散步")');
  });

  it("removes the saved view only when switching to all own records", async () => {
    setup("/calendar/2026/10?creator=alice");
    fireEvent.click(screen.getByRole("button", { name: "选择工作视图" }));
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    await screen.findByRole("button", { name: "打开 一条工作记录" });
    fireEvent.click(screen.getByRole("button", { name: "改为全部本人记录" }));
    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[0].filter).not.toContain('"work" in tags'));
    fireEvent.click(screen.getByRole("button", { name: "查看全部匹配记录" }));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent(/^\/$/));
    expect(screen.getByTestId("view")).toHaveTextContent(/^$/);
    expect(screen.getByTestId("full-filter")).not.toHaveTextContent('"work" in tags');
  });

  it("clears an incomplete local date draft and re-enables the preserved keyword search", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    const search = screen.getByRole("combobox", { name: /^搜索 / });
    fireEvent.change(search, { target: { value: "散步" } });
    fireEvent.click(screen.getByRole("button", { name: "更多筛选" }));
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("button", { name: "查看全部匹配记录" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("请补全");
    fireEvent.click(screen.getByRole("button", { name: "清空筛选条件" }));
    expect(screen.getByLabelText("开始日期")).toHaveValue("");
    expect(screen.getByLabelText("结束日期")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(search).toHaveValue("散步");
    expect(screen.getByRole("button", { name: "查看全部匹配记录" })).toBeEnabled();
    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[0].filter).toBe('(creator == "users/alice") && ((content.contains("散步")))'));
    await screen.findByRole("button", { name: "打开 一条工作记录" });
    fireEvent.click(screen.getByRole("button", { name: "查看全部匹配记录" }));
    await waitFor(() => expect(screen.getByTestId("full-filter")).toHaveTextContent('content.contains("散步")'));
  });
});
