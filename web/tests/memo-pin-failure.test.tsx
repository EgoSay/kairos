import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemoPin } from "@/hooks/useMemoPin";
import { memoKeys, useMemo } from "@/hooks/useMemoQueries";
import { State } from "@/types/proto/api/v1/common_pb";
import { ListMemosResponseSchema, type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ updateMemo: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: api }));
vi.mock("react-hot-toast", () => ({ toast: notifications }));

describe("persisted pin failure feedback and cache recovery", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { pinned: false, detailCached: true },
    { pinned: false, detailCached: false },
    { pinned: true, detailCached: true },
    { pinned: true, detailCached: false },
  ])("rolls back and retries pinned=$pinned with detailCached=$detailCached", async ({ pinned, detailCached }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const original = create(MemoSchema, {
      name: "memos/old-record",
      content: "保留原文 #人生/阅读",
      pinned,
      createTime: timestampFromDate(new Date("2024-03-01T02:03:04Z")),
      updateTime: timestampFromDate(new Date("2025-02-01T04:05:06Z")),
      location: { latitude: 31.2, longitude: 121.4 },
    });
    const other = create(MemoSchema, { name: "memos/unrelated", content: "另一条原文", pinned: true });
    const listKey = memoKeys.list({ filter: '"人生" in tags' });
    const infiniteKey = memoKeys.list({ pageSize: 1, state: State.NORMAL });
    const mapKey = memoKeys.list({ filter: "has_location", pageSize: 500, state: State.NORMAL });
    const listData = (memo: Memo) => create(ListMemosResponseSchema, { memos: [other, memo], nextPageToken: "another-page" });
    const infiniteData = (memo: Memo) => ({
      pages: [
        create(ListMemosResponseSchema, { memos: [other], nextPageToken: "second" }),
        create(ListMemosResponseSchema, { memos: [memo] }),
      ],
      pageParams: ["", "second"],
    });
    const mapData = (memo: Memo) => ({ pages: [create(ListMemosResponseSchema, { memos: [memo] })], pageParams: [""] });
    if (detailCached) client.setQueryData(memoKeys.detail(original.name), original);
    client.setQueryData(listKey, listData(original));
    client.setQueryData(infiniteKey, infiniteData(original));
    client.setQueryData(mapKey, mapData(original));

    const expectEveryCache = (memo: Memo) => {
      // Full objects, page tokens and unrelated rows must survive, not just the pin flag.
      expect(client.getQueryData(memoKeys.detail(original.name))).toEqual(memo);
      expect(client.getQueryData(listKey)).toEqual(listData(memo));
      expect(client.getQueryData(infiniteKey)).toEqual(infiniteData(memo));
      expect(client.getQueryData(mapKey)).toEqual(mapData(memo));
    };
    let rejectRequest!: (error: Error) => void;
    const serverSaved = create(MemoSchema, { ...original, pinned: !pinned });
    api.updateMemo
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      )
      .mockResolvedValueOnce(serverSaved);

    // Mount the actual query observer, pin hook and mutation callbacks. Only transport/toast are mocked.
    const { result, unmount } = renderHook(
      () => {
        const detail = useMemo(original.name, { enabled: false });
        const memo = detail.data ?? original;
        return { memo, pin: useMemoPin(memo) };
      },
      { wrapper },
    );

    try {
      let firstAttempt!: Promise<void>;
      act(() => {
        firstAttempt = result.current.pin.toggle();
      });
      await waitFor(() => expect(api.updateMemo).toHaveBeenCalledOnce());
      await waitFor(() => expect(result.current.pin.pending).toBe(true));
      await waitFor(() => expect(result.current.memo.pinned).toBe(!pinned));
      expectEveryCache(serverSaved);
      expect(notifications.success).not.toHaveBeenCalled();
      expect(notifications.error).not.toHaveBeenCalled();

      await act(async () => result.current.pin.toggle());
      expect(api.updateMemo).toHaveBeenCalledOnce();
      const failure = new ConnectError("置顶服务暂不可用，请重试", Code.Unavailable);
      await act(async () => {
        rejectRequest(failure);
        await firstAttempt;
      });
      await waitFor(() => expect(result.current.pin.pending).toBe(false));
      await waitFor(() => expect(result.current.memo).toEqual(original));
      expectEveryCache(original);
      expect(notifications.error).toHaveBeenCalledExactlyOnceWith(failure.message);
      expect(notifications.success).not.toHaveBeenCalled();
      expect(api.updateMemo).toHaveBeenCalledOnce();

      await act(async () => result.current.pin.toggle());
      await waitFor(() => expect(result.current.pin.pending).toBe(false));
      await waitFor(() => expect(result.current.memo).toEqual(serverSaved));
      expectEveryCache(serverSaved);
      expect(notifications.success).toHaveBeenCalledExactlyOnceWith(pinned ? "已取消置顶" : "已置顶");
      expect(notifications.error).toHaveBeenCalledOnce();
      expect(api.updateMemo).toHaveBeenCalledTimes(2);
      for (const [request] of api.updateMemo.mock.calls) {
        expect(request.memo.name).toBe(original.name);
        expect(request.memo.pinned).toBe(!pinned);
        expect(request.updateMask.paths).toEqual(["pinned"]);
      }
    } finally {
      unmount();
      client.clear();
    }
  });
});
