import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JournalCalendar from "@/components/JournalCalendar";
import { State } from "@/types/proto/api/v1/common_pb";

const mocks = vi.hoisted(() => ({ stats: vi.fn(), scopeFilter: 'creator == "users/other"' }));
vi.mock("@/contexts/MemoFilterContext", () => ({ useMemoFilterContext: () => ({ filters: [] }) }));
vi.mock("@/contexts/SpaceContext", () => ({ useSpaceContext: () => ({ memoFilter: mocks.scopeFilter }) }));
vi.mock("@/hooks/useMemoFilters", () => ({ useMemoFilters: () => undefined }));
vi.mock("@/hooks/useUserQueries", () => ({ useAllUserStats: (...args: unknown[]) => mocks.stats(...args) }));
vi.mock("@/hooks/useJournalQueries", () => ({
  useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai", calendarVisible: true } }),
  useUpdateJournalPreferences: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  mocks.stats.mockReturnValue({ data: [{ memoCreatedTimestamps: [timestampFromDate(new Date("2026-09-30T16:30:00Z"))] }] });
});

describe("activity calendar collection scope", () => {
  it("carries archived-only scope to both statistics and the linked day", () => {
    render(
      <MemoryRouter initialEntries={["/archived"]}>
        <JournalCalendar scope={{ state: State.ARCHIVED, filter: 'content.contains("历史")' }} />
      </MemoryRouter>,
    );
    expect(mocks.stats).toHaveBeenCalledWith(
      { state: State.ARCHIVED, filter: 'content.contains("历史")', includeArchived: false },
      expect.anything(),
    );
    const link = screen.getByRole("link", { name: "1 records on 2026-10-01" });
    const query = new URL(link.getAttribute("href")!, "https://kairos.test").searchParams;
    expect(query.get("state")).toBe("archived");
    expect(query.get("scope")).toBe('content.contains("历史")');
    expect(query.get("archived")).toBe("0");
  });

  it("keeps the selected other creator without changing the source date", () => {
    render(
      <MemoryRouter initialEntries={["/?creator=other"]}>
        <JournalCalendar />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "1 records on 2026-10-01" });
    const query = new URL(link.getAttribute("href")!, "https://kairos.test").searchParams;
    expect(query.get("scope")).toContain('creator == "users/other"');
    expect(query.get("from")).toBe("/?creator=other");
    expect(query.get("state")).toBe("normal");
  });
});
