import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JournalCalendar from "@/components/JournalCalendar";
import { readJournalDayContext } from "@/lib/journal";
import { State } from "@/types/proto/api/v1/common_pb";

const mocks = vi.hoisted(() => ({
  stats: vi.fn(),
  scopeFilter: 'creator == "users/other"',
  creatorUsername: undefined as string | undefined,
  selectedSpaceName: undefined as string | undefined,
}));
vi.mock("@/contexts/MemoFilterContext", () => ({ useMemoFilterContext: () => ({ filters: [] }) }));
vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({
    memoFilter: mocks.scopeFilter,
    creatorUsername: mocks.creatorUsername,
    selectedSpaceName: mocks.selectedSpaceName,
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me", username: "me" }) }));
vi.mock("@/hooks/useMemoFilters", () => ({ useMemoFilters: () => undefined }));
vi.mock("@/hooks/useUserQueries", () => ({ useAllUserStats: (...args: unknown[]) => mocks.stats(...args) }));
vi.mock("@/hooks/useJournalQueries", () => ({
  useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai", calendarVisible: true } }),
  useUpdateJournalPreferences: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  mocks.stats.mockReturnValue({ data: [{ memoCreatedTimestamps: [timestampFromDate(new Date("2026-09-30T16:30:00Z"))] }] });
  mocks.creatorUsername = undefined;
  mocks.selectedSpaceName = undefined;
});

describe("activity calendar collection scope", () => {
  it.each(["2026-13-01", "not-a-date"])("keeps the calendar usable when the day URL contains %s", (selectedDate) => {
    render(
      <MemoryRouter>
        <JournalCalendar selectedDate={selectedDate} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "1 records on 2026-10-01" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0 records on 2026-10-10" })).toHaveAttribute("aria-current", "date");
  });

  it("keeps the selected month, scope and original return link across successive day clicks", () => {
    const scope = 'creator == "users/other"';
    const from = "/?creator=other&filter=tagSearch%3Awork";
    const query = new URLSearchParams({ scoped: "1", scope, state: "normal", archived: "1", from });
    function DayCalendar() {
      const { date } = useParams();
      const [search] = useSearchParams();
      const context = readJournalDayContext(search, "users/me");
      return <JournalCalendar selectedDate={date} scope={context.scope} returnTo={context.from} />;
    }
    render(
      <MemoryRouter initialEntries={[`/journal/day/2026-09-17?${query}`]}>
        <Routes>
          <Route path="/journal/day/:date" element={<DayCalendar />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "0 records on 2026-09-17" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("link", { name: "0 records on 2026-09-18" }));
    expect(screen.getByRole("link", { name: "0 records on 2026-09-18" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("link", { name: "1 records on 2026-10-01" }));
    expect(screen.getByRole("link", { name: "1 records on 2026-10-01" })).toHaveAttribute("aria-current", "page");
    // Today keeps its own marker while another day is the page being read.
    expect(screen.getByRole("link", { name: "0 records on 2026-10-10" })).toHaveAttribute("aria-current", "date");
    const next = new URL(screen.getByRole("link", { name: "0 records on 2026-10-02" }).getAttribute("href")!, "https://kairos.test");
    expect(next.searchParams.get("from")).toBe(from);
    expect(next.searchParams.get("scope")).toBe(scope);
    expect(next.searchParams.get("archived")).toBe("1");
    expect(mocks.stats).toHaveBeenLastCalledWith({ filter: scope, state: State.NORMAL, includeArchived: true }, expect.anything());
  });

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
    // An archived scope is inherently its owner's, so the day URL carries the creator.
    expect(query.get("creator")).toBe("me");
  });

  it("keeps the selected other creator without changing the source date", () => {
    mocks.creatorUsername = "other";
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
    expect(query.get("creator")).toBe("other");
  });

  it("carries Space and creator identity into the day URL", () => {
    mocks.selectedSpaceName = "spaces/product";
    mocks.creatorUsername = "alice";
    render(
      <MemoryRouter initialEntries={["/spaces/product?creator=alice"]}>
        <JournalCalendar />
      </MemoryRouter>,
    );
    const link = new URL(screen.getByRole("link", { name: "1 records on 2026-10-01" }).getAttribute("href")!, "https://kairos.test");
    expect(link.pathname).toBe("/spaces/product/journal/day/2026-10-01");
    expect(link.searchParams.get("creator")).toBe("alice");
    expect(link.searchParams.get("from")).toBe("/spaces/product?creator=alice");
  });
});
