import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JournalDay from "@/pages/JournalDay";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

const { listMemos, preferences } = vi.hoisted(() => ({ listMemos: vi.fn(), preferences: { timezone: "Asia/Shanghai" } }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ useJournalPreferences: () => ({ data: preferences }) }));
vi.mock("@/components/JournalMemo", () => ({ default: ({ memo }: { memo: Memo }) => <p>{memo.content}</p> }));

beforeEach(() => {
  listMemos.mockResolvedValue({ memos: [], nextPageToken: "" });
});

function renderDay(date: string, search = "") {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/journal/day/${date}${search}`]}>
        <Routes>
          <Route path="/journal/day/:date" element={<JournalDay />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("journal day ListMemos request contract", () => {
  // The corresponding Go API test executes this CEL shape against SQLite at
  // each boundary; this layer checks the actual routed page emits that shape.
  it.each([
    ["2025-10-03", "Asia/Shanghai", "2025-10-02T16:00:00Z", "2025-10-03T16:00:00Z"],
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["2026-11-01", "America/New_York", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
  ])("uses original record timestamps and real day boundaries for %s in %s", async (date, timezone, start, end) => {
    preferences.timezone = timezone;
    renderDay(date);
    await waitFor(() => expect(listMemos).toHaveBeenCalledTimes(1));
    const requests = listMemos.mock.calls.map(([request]) => request);
    expect(requests.map((request) => request.state).sort()).toEqual([State.NORMAL]);
    for (const request of requests) {
      expect(request.filter).toBe(
        `(creator == "users/me") && (created_ts >= timestamp(${Date.parse(start) / 1000}) && created_ts < timestamp(${Date.parse(end) / 1000}))`,
      );
      expect(request.includeArchived).toBe(true);
      expect(request.orderBy).toBe("create_time desc");
    }
    expect(await screen.findByText("这一天没有记录。")).toBeInTheDocument();
  });

  it.each([
    ['creator == "users/other"', State.NORMAL, "normal"],
    ["", State.NORMAL, "normal"],
    ['content.contains("历史")', State.ARCHIVED, "archived"],
  ])("preserves linked collection %s and state %s", async (scope, state, stateParam) => {
    preferences.timezone = "Asia/Shanghai";
    listMemos.mockResolvedValue({
      memos: [
        { name: "memos/visible-other", creator: state === State.ARCHIVED ? "users/me" : "users/other", content: "服务端授权可见的记录" },
      ],
      nextPageToken: "",
    });
    const search = new URLSearchParams({ scoped: "1", scope, state: stateParam, archived: "0" });
    renderDay("2026-10-01", `?${search}`);
    await waitFor(() => expect(listMemos).toHaveBeenCalledTimes(1));
    const request = listMemos.mock.calls[0][0];
    expect(request.state).toBe(state);
    expect(request.includeArchived).toBe(false);
    expect(request.filter).not.toContain('creator == "users/me"');
    if (scope) expect(request.filter).toContain(scope);
    expect(await screen.findByText("服务端授权可见的记录")).toBeInTheDocument();
  });

  it("rejects an invalid date without asking the API to execute a made-up range", () => {
    renderDay("2025-02-30");
    expect(screen.getByText("这个日期无效。")).toBeInTheDocument();
    expect(listMemos).not.toHaveBeenCalled();
  });
});
