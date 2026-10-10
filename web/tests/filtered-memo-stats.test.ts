import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE importing the hook under test.
vi.mock("@/hooks/useUserQueries", () => ({
  useAllUserStats: vi.fn(),
  useUserStats: vi.fn(),
}));
vi.mock("@/hooks/useJournalQueries", () => ({ useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai" } }) }));
vi.mock("@/hooks/useMemoQueries", () => ({
  useMemos: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  default: () => ({ name: "users/test", id: 1 }),
}));

const mockUseView = vi.fn();
vi.mock("@/contexts/ViewContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/ViewContext")>("@/contexts/ViewContext");
  return {
    ...actual,
    useView: () => mockUseView(),
  };
});

import { useFilteredMemoStats } from "@/hooks/useFilteredMemoStats";
import { useAllUserStats, useUserStats } from "@/hooks/useUserQueries";
import { State } from "@/types/proto/api/v1/common_pb";

const wrapper = ({ children }: { children: ReactNode }) => children as never;

const ts = (year: number, month: number, day: number) => ({
  seconds: BigInt(Math.floor(Date.UTC(year, month - 1, day) / 1000)),
  nanos: 0,
});

describe("useFilteredMemoStats", () => {
  beforeEach(() => {
    vi.mocked(useAllUserStats).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAllUserStats>);
    vi.mocked(useUserStats).mockReturnValue({
      data: {
        memoCreatedTimestamps: [ts(2026, 5, 1), ts(2026, 5, 1), ts(2026, 5, 2)],
        memoUpdatedTimestamps: [ts(2026, 5, 3), ts(2026, 5, 3), ts(2026, 5, 3)],
        tagCount: {},
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useUserStats>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(["home", "collection", "archived"] as const)("exposes only the active %s statistics error and explicit retry", (context) => {
    mockUseView.mockReturnValue({ timeBasis: "create_time" });
    const userError = new Error("user statistics failed");
    const allError = new Error("all statistics failed");
    const userRetry = vi.fn();
    const allRetry = vi.fn();
    vi.mocked(useUserStats).mockReturnValue({ error: userError, isFetching: false, refetch: userRetry } as unknown as ReturnType<
      typeof useUserStats
    >);
    vi.mocked(useAllUserStats).mockReturnValue({ error: allError, isFetching: true, refetch: allRetry } as unknown as ReturnType<
      typeof useAllUserStats
    >);
    const { result } = renderHook(() => useFilteredMemoStats({ userName: "users/test", context }), { wrapper });
    expect(result.current.error).toBe(context === "home" ? userError : allError);
    expect(result.current.retrying).toBe(context !== "home");
    expect(userRetry).not.toHaveBeenCalled();
    expect(allRetry).not.toHaveBeenCalled();
    result.current.retry();
    expect(context === "home" ? userRetry : allRetry).toHaveBeenCalledTimes(1);
    expect(context === "home" ? allRetry : userRetry).not.toHaveBeenCalled();
  });

  it("aggregates by created timestamps when timeBasis is create_time", () => {
    mockUseView.mockReturnValue({
      timeBasis: "create_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });

    const { result } = renderHook(() => useFilteredMemoStats({ userName: "users/test" }), { wrapper });

    expect(result.current.statistics.activityStats).toEqual({ "2026-05-01": 2, "2026-05-02": 1 });
    expect(result.current.statistics.timeBasis).toBe("create_time");
  });

  it("aggregates by updated timestamps when timeBasis is update_time", () => {
    mockUseView.mockReturnValue({
      timeBasis: "update_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });

    const { result } = renderHook(() => useFilteredMemoStats({ userName: "users/test" }), { wrapper });

    expect(result.current.statistics.activityStats).toEqual({ "2026-05-03": 3 });
    expect(result.current.statistics.timeBasis).toBe("update_time");
  });

  it("falls back to created timestamps when updated array is empty (old server)", () => {
    // Old servers that don't know about the new field deserialize it as [].
    // Length divergence (created non-empty, updated empty) is the signal.
    vi.mocked(useUserStats).mockReturnValue({
      data: {
        memoCreatedTimestamps: [ts(2026, 5, 1)],
        memoUpdatedTimestamps: [],
        tagCount: {},
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useUserStats>);
    mockUseView.mockReturnValue({
      timeBasis: "update_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useFilteredMemoStats({ userName: "users/test" }), { wrapper });

    expect(result.current.statistics.activityStats).toEqual({ "2026-05-01": 1 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("counts midnight records on the Kairos date rather than the device date", () => {
    mockUseView.mockReturnValue({ timeBasis: "create_time" });
    vi.mocked(useAllUserStats).mockReturnValue({
      data: [{ memoCreatedTimestamps: [{ seconds: BigInt(Date.parse("2026-09-30T16:30:00Z") / 1000), nanos: 0 }], tagCount: {} }],
      isLoading: false,
    } as unknown as ReturnType<typeof useAllUserStats>);
    const { result } = renderHook(() => useFilteredMemoStats({ context: "collection" }), { wrapper });
    expect(result.current.statistics.activityStats).toEqual({ "2026-10-01": 1 });
  });

  it("disables both statistics queries when deferred", () => {
    mockUseView.mockReturnValue({
      timeBasis: "create_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });

    renderHook(() => useFilteredMemoStats({ userName: "users/test", context: "collection", enabled: false }), { wrapper });

    expect(useUserStats).toHaveBeenCalledWith("users/test", { enabled: false, filter: undefined });
    expect(useAllUserStats).toHaveBeenCalledWith(expect.anything(), { enabled: false });
  });

  it("passes the selected Space filter to Home statistics", () => {
    mockUseView.mockReturnValue({
      timeBasis: "create_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });
    const filter = 'space == "spaces/product"';

    renderHook(() => useFilteredMemoStats({ userName: "users/test", context: "home", filter }), { wrapper });

    expect(useUserStats).toHaveBeenCalledWith("users/test", { enabled: true, filter });
  });

  it("scopes collection statistics to a Space without excluding readable private memos", () => {
    mockUseView.mockReturnValue({
      timeBasis: "create_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });
    const filter = 'space == "spaces/product"';

    renderHook(() => useFilteredMemoStats({ context: "collection", filter }), { wrapper });

    expect(useAllUserStats).toHaveBeenCalledWith(
      {
        state: State.NORMAL,
        includeArchived: false,
        filter,
      },
      { enabled: true },
    );
  });

  it("leaves the creator and visibility filters to access control in the All collection", () => {
    mockUseView.mockReturnValue({
      timeBasis: "create_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });

    renderHook(() => useFilteredMemoStats({ context: "collection" }), { wrapper });

    expect(useAllUserStats).toHaveBeenCalledWith(
      {
        state: State.NORMAL,
        includeArchived: false,
        filter: undefined,
      },
      { enabled: true },
    );
  });

  it("supports an explicit unassigned filter", () => {
    mockUseView.mockReturnValue({
      timeBasis: "create_time",
      orderByTimeAsc: false,
      setOrderByTimeAsc: vi.fn(),
      setTimeBasis: vi.fn(),
    });
    const filter = "space == null";

    renderHook(() => useFilteredMemoStats({ context: "archived", filter }), { wrapper });

    expect(useAllUserStats).toHaveBeenCalledWith({ state: State.ARCHIVED, filter }, { enabled: true });
  });
});

vi.mock("@/contexts/MemoFilterContext", () => ({ useMemoFilterContext: () => ({ filters: [] }) }));
