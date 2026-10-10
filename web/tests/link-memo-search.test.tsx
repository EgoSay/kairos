import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkMemo } from "@/components/MemoEditor/hooks/useLinkMemo";
import { MemoRelation_Type, MemoRelationSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos: api.list } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/qa" }) }));
const memo = (id: string) => create(MemoSchema, { name: `memos/${id}`, content: id, snippet: id });
const page = (...ids: string[]) => ({ memos: ids.map(memo), nextPageToken: "" });

function setup(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const onAddRelation = vi.fn();
  const existingRelations = [create(MemoRelationSchema, { type: MemoRelation_Type.REFERENCE, relatedMemo: { name: "memos/linked" } })];
  const hook = renderHook(({ isOpen }) => useLinkMemo({ isOpen, currentMemoName: "memos/self", existingRelations, onAddRelation }), {
    wrapper,
    initialProps: { isOpen: open },
  });
  return { ...hook, client, onAddRelation };
}

describe("linked record search", () => {
  beforeEach(() => api.list.mockReset());

  it("uses owner-scoped archived-inclusive pagination and excludes self/duplicates", async () => {
    api.list.mockResolvedValueOnce({ ...page("self", "linked", "one"), nextPageToken: "next" }).mockResolvedValueOnce(page("one", "two"));
    const { result, onAddRelation } = setup();
    await waitFor(() => expect(result.current.filteredMemos).toHaveLength(2));
    expect(api.list.mock.calls[0][0]).toMatchObject({ includeArchived: true, filter: '(creator == "users/qa")', pageToken: "" });
    act(() => {
      result.current.addMemoRelation(memo("self"));
      result.current.addMemoRelation(memo("linked"));
    });
    expect(onAddRelation).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(api.list.mock.calls[1][0].pageToken).toBe("next");
    await waitFor(() => expect(result.current.filteredMemos.map((item) => item.name)).toEqual(["memos/linked", "memos/one", "memos/two"]));
    act(() => result.current.addMemoRelation(memo("two")));
    expect(onAddRelation).toHaveBeenCalledWith(
      expect.objectContaining({ type: MemoRelation_Type.REFERENCE, relatedMemo: expect.objectContaining({ name: "memos/two" }) }),
    );
  });

  it("hides previous candidates immediately and ignores late results from an old keyword", async () => {
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    api.list
      .mockResolvedValueOnce(page("initial"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(page("new"));
    const { result, onAddRelation } = setup();
    await waitFor(() => expect(result.current.filteredMemos).toHaveLength(1));
    act(() => result.current.setSearchText('中文 "旧"'));
    expect(result.current.filteredMemos).toEqual([]);
    act(() => result.current.addMemoRelation(memo("initial")));
    expect(onAddRelation).not.toHaveBeenCalled();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    act(() => result.current.setSearchText("新"));
    await waitFor(() => expect(result.current.filteredMemos[0]?.name).toBe("memos/new"));
    await act(async () => resolveOld(page("old")));
    expect(result.current.filteredMemos.map((item) => item.name)).toEqual(["memos/new"]);
    expect(api.list.mock.calls[1][0].filter).toContain('content.contains("中文")');
    expect(api.list.mock.calls[1][0].filter).toContain('content.contains("\\"旧\\"")');
  });

  it("distinguishes failed pages from empty results and retries the missing page", async () => {
    api.list
      .mockResolvedValueOnce({ ...page("first"), nextPageToken: "next" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page("second"));
    const { result } = setup();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.filteredMemos).toEqual([]);
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.error).toBeUndefined());
    expect(result.current.filteredMemos.map((item) => item.name)).toEqual(["memos/first", "memos/second"]);
    expect(api.list.mock.calls.map(([request]) => request.pageToken)).toEqual(["", "next", "next"]);
  });

  it("makes no request until the dialog opens", async () => {
    api.list.mockResolvedValue(page("one"));
    const { result, rerender } = setup(false);
    expect(api.list).not.toHaveBeenCalled();
    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.filteredMemos).toHaveLength(1));
  });
});
