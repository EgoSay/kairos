import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tag } from "@/components/MemoContent/Tag";

const navigateTo = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useNavigateTo", () => ({
  default: () => navigateTo,
}));

vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/MemoFilterContext")>();
  return {
    ...actual,
    useMemoFilterContext: () => ({
      getFiltersByFactor: () => [],
      removeFilter: vi.fn(),
      addFilter: vi.fn(),
    }),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ userTagsSetting: undefined }),
}));

describe("Memo tag navigation", () => {
  beforeEach(() => {
    navigateTo.mockClear();
  });

  it("navigates directly to the global collection from a global detail", () => {
    render(
      <MemoryRouter initialEntries={["/memos/parent"]}>
        <Tag data-tag="work">#work</Tag>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("#work"));
    expect(navigateTo).toHaveBeenCalledWith("/?filter=tagSearch%3Awork");
  });

  it("returns a creator-scoped tag to that creator's memo list", () => {
    render(
      <MemoryRouter initialEntries={["/memos/parent"]}>
        <Tag data-tag="work" parentPage="/?creator=alice">
          #work
        </Tag>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("#work"));
    expect(navigateTo).toHaveBeenCalledWith("/?creator=alice&filter=tagSearch%3Awork");
  });

  it("opens a real filtered collection from a journal reader without a memo-card provider", () => {
    render(
      <MemoryRouter initialEntries={["/journal/day/2025-10-03"]}>
        <Tag data-tag="日常" parentPage="/journal/day/2025-10-03">
          #日常
        </Tag>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("#日常"));
    // A creatorless day reader belongs to the all-creator collection: Explore.
    expect(navigateTo).toHaveBeenCalledWith(`/explore?filter=${encodeURIComponent("tagSearch:" + encodeURIComponent("日常"))}`);
  });

  it("keeps the day reader's collection when opening a tag from the records", () => {
    render(
      <MemoryRouter initialEntries={["/spaces/a/journal/day/2025-10-03?creator=alice"]}>
        <Tag data-tag="work" parentPage="/spaces/a/journal/day/2025-10-03?creator=alice">
          #work
        </Tag>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("#work"));
    expect(navigateTo).toHaveBeenCalledWith("/spaces/a?creator=alice&filter=tagSearch%3Awork");
  });
});
