import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMonthMemos } from "@/components/CalendarView/useMonthMemos";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const listMemos = vi.hoisted(() => vi.fn());
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos } }));
vi.mock("@/contexts/MemoFilterContext", () => ({
  useMemoFilterContext: () => ({ filters: [{ factor: "includeArchived", value: "true" }] }),
}));
vi.mock("@/contexts/ViewContext", () => ({ useView: () => ({ timeBasis: "create_time" }) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const memo = (uid: string, instant: string) =>
  create(MemoSchema, { name: `memos/${uid}`, content: uid, createTime: timestampFromDate(new Date(instant)) });

describe("complete calendar month in Kairos timezone", () => {
  it.each([
    ["Asia/Shanghai", "2026-10", "2026-09-30T16:00:00Z", "2026-10-31T16:00:00Z", "2026-09-30T16:30:00Z", "2026-10-01"],
    ["America/New_York", "2026-03", "2026-03-01T05:00:00Z", "2026-04-01T04:00:00Z", "2026-03-01T05:30:00Z", "2026-03-01"],
    ["America/New_York", "2026-10", "2026-10-01T04:00:00Z", "2026-11-01T04:00:00Z", "2026-10-02T03:30:00Z", "2026-10-01"],
  ])("queries and groups every page in %s", async (timezone, month, start, end, instant, date) => {
    listMemos
      .mockResolvedValueOnce({ memos: [memo("first", instant)], nextPageToken: "page-two" })
      .mockResolvedValueOnce({ memos: [memo("second", instant)], nextPageToken: "" });
    const { result } = renderHook(() => useMonthMemos({ month, timezone, filter: 'creator == "users/other"' }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeUndefined();
    expect(listMemos).toHaveBeenCalledTimes(2);
    for (const [request] of listMemos.mock.calls) {
      expect(request.includeArchived).toBe(true);
      expect(request.filter).toContain(
        `created_ts >= timestamp(${Date.parse(start) / 1000}) && created_ts < timestamp(${Date.parse(end) / 1000})`,
      );
      expect(request.filter).toContain('creator == "users/other"');
    }
    expect(Object.keys(result.current.model)).toEqual([date]);
    expect(result.current.model[date].memos.map((record) => record.name)).toEqual(["memos/first", "memos/second"]);
  });
});
