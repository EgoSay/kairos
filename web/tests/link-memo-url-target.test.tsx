import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkMemo } from "@/components/MemoEditor/hooks/useLinkMemo";
import { memoKeys } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos: api.list, getMemo: api.get } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me" }) }));
const target = (changes: Partial<Memo> = {}) =>
  Object.assign(
    create(MemoSchema, {
      name: "memos/target",
      creator: "users/me",
      state: State.NORMAL,
      content: "这是链接指向的原记录",
      snippet: "原记录",
    }),
    changes,
  );

function setup(name = "memos/target", cached?: Memo) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(memoKeys.detail(name), cached);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const onAddRelation = vi.fn();
  const hook = renderHook(
    ({ requestId }) =>
      useLinkMemo({
        isOpen: true,
        currentMemoName: "memos/self",
        existingRelations: [],
        onAddRelation,
        requestedMemoName: name,
        requestId,
      }),
    { wrapper, initialProps: { requestId: 1 } },
  );
  return { ...hook, client, onAddRelation };
}

beforeEach(() => {
  api.list.mockReset();
  api.get.mockReset();
});

describe("pasted record URL association", () => {
  it("reads exactly the named record instead of searching for its URL in content", async () => {
    const record = target({ state: State.ARCHIVED });
    api.get.mockResolvedValue(record);
    const { result, onAddRelation } = setup();
    await waitFor(() => expect(result.current.filteredMemos).toEqual([record]));
    expect(api.get).toHaveBeenCalledWith({ name: "memos/target" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(api.list).not.toHaveBeenCalled();
    expect(result.current.hasNextPage).toBe(false);
    act(() => result.current.addMemoRelation(record));
    expect(onAddRelation).toHaveBeenCalledWith(expect.objectContaining({ relatedMemo: expect.objectContaining({ name: "memos/target" }) }));
  });

  it.each([
    { creator: "users/other" },
    { state: State.STATE_UNSPECIFIED },
    { parent: "memos/parent" },
    { name: "memos/self" },
    { name: "memos/unrelated" },
  ])("does not offer ineligible target content: %j", async (changes) => {
    const record = target(changes);
    api.get.mockResolvedValue(record);
    const { result, onAddRelation } = setup();
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.filteredMemos).toEqual([]);
    act(() => result.current.addMemoRelation(record));
    expect(onAddRelation).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });

  it.each([Code.PermissionDenied, Code.NotFound])("hides cached content after a fresh unavailable response: %s", async (code) => {
    let reject!: (error: Error) => void;
    api.get.mockImplementation(
      () =>
        new Promise((_resolve, deny) => {
          reject = deny;
        }),
    );
    const { result, onAddRelation } = setup("memos/target", target());
    expect(result.current.filteredMemos).toEqual([]);
    expect(result.current.isFetching).toBe(true);
    act(() => result.current.addMemoRelation(target()));
    expect(onAddRelation).not.toHaveBeenCalled();
    await act(async () => reject(new ConnectError("unavailable", code)));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.filteredMemos).toEqual([]);
  });

  it("allows a new keyword to switch back to the normal scoped candidate search", async () => {
    api.get.mockResolvedValue(target());
    api.list.mockResolvedValue({ memos: [target({ name: "memos/another" })], nextPageToken: "" });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.filteredMemos).toHaveLength(1));
    act(() => result.current.setSearchText("另一条"));
    expect(result.current.isTargeted).toBe(false);
    await waitFor(() => expect(result.current.filteredMemos[0]?.name).toBe("memos/another"));
    expect(api.list.mock.calls[0][0].filter).toBe('(creator == "users/me") && (content.contains("另一条"))');
    rerender({ requestId: 2 });
    await waitFor(() => expect(result.current.filteredMemos[0]?.name).toBe("memos/target"));
    expect(result.current.isTargeted).toBe(true);
  });

  it("rejects malformed internal names without making a request or waiting forever", () => {
    const { result } = setup("https://external.example/memos/target");
    expect(result.current.error).toBeDefined();
    expect(result.current.isFetching).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
    act(() => {
      void result.current.retry();
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });
});
