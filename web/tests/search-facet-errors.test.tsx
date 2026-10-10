import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SearchFacetPanel from "@/components/AppSidebar/SearchFacetPanel";
import type { MemoFilter } from "@/contexts/MemoFilterContext";

const state = vi.hoisted(() => ({
  stats: { isError: true, isFetching: false, refetch: vi.fn(), data: undefined as undefined | Array<{ tagCount: Record<string, number> }> },
}));
vi.mock("@/hooks/useUserQueries", () => ({ useAllUserStats: () => state.stats }));
vi.mock("@/hooks/useJournalPartitionQueries", () => ({ useJournalPartitions: () => ({ data: { partitions: [] } }) }));

beforeEach(() => {
  state.stats.isError = true;
  state.stats.isFetching = false;
  state.stats.data = undefined;
  state.stats.refetch.mockClear();
});

it("reports a tag lookup failure, retries only on request, and preserves selected filters", () => {
  const filters: MemoFilter[] = [
    { factor: "tagSearch", value: "人生/阅读" },
    { factor: "dateStart", value: "2026-10-01" },
  ];
  const onChange = vi.fn();
  const view = render(<SearchFacetPanel filters={filters} onChange={onChange} />);
  expect(screen.getByRole("alert")).toHaveTextContent("标签列表读取失败");
  expect(screen.getByRole("button", { name: "移除包含标签 人生/阅读" })).toBeVisible();
  expect(screen.getByLabelText("开始日期")).toHaveValue("2026-10-01");
  expect(state.stats.refetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重试读取标签" }));
  expect(state.stats.refetch).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
  state.stats.isError = false;
  state.stats.data = [{ tagCount: { "人生/阅读": 2 } }];
  view.rerender(<SearchFacetPanel filters={filters} onChange={onChange} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "移除包含标签 人生/阅读" })).toBeVisible();
  expect(state.stats.refetch).toHaveBeenCalledOnce();
});

it("keeps manual tag entry usable while suggestions are unavailable", () => {
  const onChange = vi.fn();
  render(<SearchFacetPanel filters={[{ factor: "tagSearch", value: "人生" }]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("标签路径"), { target: { value: "工作/学习" } });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  expect(onChange).toHaveBeenCalledWith([
    { factor: "tagSearch", value: "人生" },
    { factor: "tagSearch", value: "工作/学习" },
  ]);
});
