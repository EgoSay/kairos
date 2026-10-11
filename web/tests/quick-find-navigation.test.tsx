import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickFindDialog from "@/components/AppSidebar/QuickFindDialog";
import MemoFilters from "@/components/MemoFilters";
import { AppSidebarProvider, useAppSidebar } from "@/contexts/AppSidebarContext";
import { SpaceProvider, useSpaceContext } from "@/contexts/SpaceContext";

const state = vi.hoisted(() => ({
  currentUser: { name: "users/alice" } as { name: string } | undefined,
  spaces: [{ name: "spaces/product", title: "Product", description: "" }],
  filters: [] as Array<{ factor: "contentSearch" | "celSearch" | "tagSearch"; value: string }>,
  setFilters: vi.fn(),
  setMemoView: vi.fn(),
  removeFilter: vi.fn(),
}));

vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/MemoFilterContext")>();
  return {
    ...actual,
    useMemoFilterContext: () => ({
      filters: state.filters,
      memoView: undefined,
      setFilters: state.setFilters,
      setMemoView: state.setMemoView,
      removeFilter: state.removeFilter,
    }),
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  default: () => state.currentUser,
}));

vi.mock("@/hooks/useSpaceQueries", () => ({
  useSpaces: () => ({ data: state.spaces, isSuccess: true, isPending: false, isError: false }),
  useSpace: (_user: string, name: string) => ({
    data: state.spaces.find((space) => space.name === name),
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useUserQueries", () => ({
  useMemoViews: () => ({ data: [] }),
  useAllUserStats: () => ({ data: [{ tagCount: { "人生/阅读": 2 } }] }),
}));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) => key,
}));

const Harness = () => {
  const location = useLocation();
  const { setQuickFindOpen } = useAppSidebar();
  const { collectionScope } = useSpaceContext();

  return (
    <>
      <output data-testid="path">{`${location.pathname}${location.search}`}</output>
      <output data-testid="scope">{collectionScope.kind === "space" ? collectionScope.name : collectionScope.kind}</output>
      <button type="button" onClick={() => setQuickFindOpen(true)}>
        Open Quick Find
      </button>
      <QuickFindDialog />
      <MemoFilters />
    </>
  );
};

describe("Quick Find navigation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.currentUser = { name: "users/alice" };
    state.spaces = [{ name: "spaces/product", title: "Product", description: "" }];
    state.filters = [];
    state.setFilters.mockClear();
    state.setMemoView.mockClear();
  });

  const renderSearch = (initialEntry = "/explore") => {
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <SpaceProvider>
              <AppSidebarProvider>
                <Harness />
              </AppSidebarProvider>
            </SpaceProvider>
          ),
        },
      ],
      { initialEntries: [initialEntry] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };
  const openQuickFind = () => fireEvent.click(screen.getByRole("button", { name: "Open Quick Find" }));

  it("preserves the draft when changing modes and submits CEL with Enter", async () => {
    renderSearch();
    openQuickFind();
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "pinned || has_link" } });
    fireEvent.click(screen.getByRole("tab", { name: "高级搜索" }));
    const expression = screen.getByRole("textbox");
    expect(expression.tagName).toBe("TEXTAREA");
    expect(expression).toHaveValue("pinned || has_link");
    expect(expression).toHaveFocus();
    fireEvent.keyDown(expression, { key: "Enter", shiftKey: true });
    expect(state.setFilters).not.toHaveBeenCalled();
    fireEvent.keyDown(expression, { key: "Enter" });
    expect(state.setFilters).toHaveBeenCalledWith([{ factor: "celSearch", value: "pinned || has_link" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("restores the expression from its chip and discards cancelled changes", async () => {
    state.filters = [
      { factor: "celSearch", value: "pinned\n || has_code" },
      { factor: "tagSearch", value: "work" },
    ];
    renderSearch();
    openQuickFind();
    const expression = await screen.findByRole("textbox");
    expect(expression).toHaveValue("pinned\n || has_code");
    expect(screen.getByRole("tab", { name: "高级搜索" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(expression, { target: { value: "has_link" } });
    fireEvent.keyDown(expression, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.setFilters).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "search.edit-query" }));
    expect(await screen.findByRole("textbox")).toHaveValue("pinned\n || has_code");
    fireEvent.click(screen.getByRole("tab", { name: "search.text" }));
    expect(screen.getByRole("textbox")).toHaveValue("pinned || has_code");
    fireEvent.click(screen.getByRole("tab", { name: "高级搜索" }));
    expect(screen.getByRole("textbox")).toHaveValue("pinned\n || has_code");
  });

  it.each(["text", "cel"])("ignores Enter during IME composition in %s mode", async (mode) => {
    renderSearch();
    openQuickFind();
    if (mode === "cel") fireEvent.click(screen.getByRole("tab", { name: "高级搜索" }));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "pinned" } });
    const composingEnter = createEvent.keyDown(input, { key: "Enter", isComposing: true });
    const legacyComposingEnter = createEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent(input, composingEnter);
    fireEvent(input, legacyComposingEnter);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(legacyComposingEnter.defaultPrevented).toBe(false);
    expect(state.setFilters).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("removes only CEL using the chip remove button", async () => {
    state.filters = [
      { factor: "celSearch", value: "pinned" },
      { factor: "tagSearch", value: "work" },
    ];
    renderSearch();
    openQuickFind();
    fireEvent.keyDown(await screen.findByRole("textbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [removeCel] = screen.getAllByRole("button", { name: "Remove filter" });
    fireEvent.click(removeCel);
    const predicate = state.removeFilter.mock.calls[0][0];
    expect(state.filters.filter((filter) => !predicate(filter))).toEqual([{ factor: "tagSearch", value: "work" }]);
  });

  it("searches from Inbox into global Explore in one history step", async () => {
    const router = renderSearch("/inbox");

    expect(screen.getByTestId("scope")).toHaveTextContent("all");
    openQuickFind();
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "roadmap" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/explore?filter=contentSearch%3Aroadmap"));
    expect(state.setFilters).not.toHaveBeenCalled();
    expect(screen.getByTestId("scope")).toHaveTextContent("all");

    await act(async () => {
      await router.navigate(-1);
    });

    expect(screen.getByTestId("path")).toHaveTextContent("/inbox");
  });

  it("combines visual facets and switches a Space search to all own records", async () => {
    renderSearch("/spaces/product");
    openQuickFind();
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "去年" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "未添加标签" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "有图片" }));
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2025-12-31" } });
    fireEvent.change(screen.getByRole("combobox", { name: "搜索范围" }), { target: { value: "own" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(screen.getByTestId("path").textContent).toMatch(/^\/\?filter=/));
    const params = new URLSearchParams(screen.getByTestId("path").textContent!.split("?")[1]);
    expect(params.get("filter")).toContain("untagged:true");
    expect(params.get("filter")).toContain("property.hasImage:true");
    expect(params.get("creator")).toBeNull();
    expect(state.setMemoView).toHaveBeenCalledWith(undefined);
  });

  it("blocks an inverted date range and clears conflicting included tags", async () => {
    state.filters = [{ factor: "tagSearch", value: "人生/阅读" }];
    renderSearch("/");
    openQuickFind();
    fireEvent.click(screen.getByRole("button", { name: "筛选 (1)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "未添加标签" }));
    expect(screen.queryByRole("button", { name: "移除包含标签 人生/阅读" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("开始日期不能晚于结束日期");
    expect(screen.getByRole("button", { name: "应用筛选" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(state.setFilters).not.toHaveBeenCalled();
  });

  it("keeps a unique selected Space title compact in route-collection search", async () => {
    renderSearch("/spaces/product");

    openQuickFind();
    const input = await screen.findByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "common.search Product · common.memos");
    expect(input).toHaveAttribute("aria-label", "common.search Product · common.memos");
  });

  it("shows a UID for matching titles and compacts its UUID only in the placeholder", async () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    state.spaces = [
      { name: `spaces/${uuid}`, title: "Product", description: "" },
      { name: "spaces/product-roadmap", title: "Product", description: "" },
    ];
    renderSearch(`/spaces/${uuid}`);

    openQuickFind();
    const input = await screen.findByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "common.search Product (123e4567…) · common.memos");
    expect(input).toHaveAttribute("aria-label", `common.search Product (${uuid}) · common.memos`);
  });

  it("preserves an anonymous global page in history", async () => {
    state.currentUser = undefined;

    const router = renderSearch("/about");

    openQuickFind();
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "roadmap" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/explore?filter=contentSearch%3Aroadmap"));

    await act(async () => {
      await router.navigate(-1);
    });

    expect(screen.getByTestId("path")).toHaveTextContent("/about");
  });
});

vi.mock("@/hooks/useJournalPartitionQueries", () => ({
  useJournalPartitions: () => ({ data: { partitions: [{ id: "life", name: "生活" }] } }),
}));
