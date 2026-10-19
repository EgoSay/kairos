import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoViewIcon from "@/components/MemoViewIcon";
import MemoViews from "@/pages/MemoViews";
import { MemoView_IconSchema, MemoViewSchema } from "@/types/proto/api/v1/user_service_pb";

const mocks = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  setViewComposer: vi.fn(),
  views: [] as Array<{ name: string; title: string; filter: string }>,
}));
vi.mock("@/connect", () => ({ userServiceClient: { deleteMemoView: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/steven" }) }));
vi.mock("@/hooks/useUserQueries", () => ({
  useMemoViews: () => ({ data: mocks.views, isPending: mocks.isPending, isError: mocks.isError, refetch: mocks.refetch }),
  userKeys: { memoViews: () => ["views"] },
}));
vi.mock("@/hooks/useJournalQueries", () => ({
  useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai" }, isPending: false }),
}));
vi.mock("@/hooks/useJournalPartitionQueries", () => ({ useJournalPartitions: () => ({ data: { partitions: [] } }) }));
vi.mock("@/contexts/MemoFilterContext", () => ({ useMemoFilterContext: () => ({ setMemoView: vi.fn(), memoView: undefined }) }));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ setViewComposer: mocks.setViewComposer }) }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const emoji = create(MemoView_IconSchema, { value: { case: "emoji", value: "🌱" } });
const leaf = create(MemoView_IconSchema, { value: { case: "lucide", value: "leaf" } });
const existingView = create(MemoViewSchema, { name: "users/steven/views/garden", title: "Garden", filter: "pinned", icon: emoji });

function renderPage(state?: { openCreate?: boolean; memoView?: unknown }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[{ pathname: "/views", state }]}>
        <MemoViews />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPending = false;
  mocks.isError = false;
  mocks.views = [];
});

describe("memo view icons", () => {
  it("renders emoji and symbols with a view-specific fallback", () => {
    const view = render(<MemoViewIcon />);
    expect(view.container.querySelector(".lucide-parentheses")).not.toBeNull();
    view.rerender(<MemoViewIcon icon={emoji} />);
    expect(view.container).toHaveTextContent("🌱");
    view.rerender(<MemoViewIcon icon={leaf} />);
    expect(view.container.querySelector(".lucide-leaf")).not.toBeNull();
    view.rerender(<MemoViewIcon icon={create(MemoView_IconSchema, { value: { case: "lucide", value: "future-icon" } })} />);
    expect(view.container.querySelector(".lucide-parentheses")).not.toBeNull();
  });
});

describe("memo views page", () => {
  it("opens the composer when creating, editing, or arriving from a deep link", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "setting.memo-view.create" }));
    expect(mocks.setViewComposer).toHaveBeenCalledWith({});

    mocks.setViewComposer.mockClear();
    mocks.views = [existingView];
    renderPage({ memoView: existingView });
    expect(mocks.setViewComposer).toHaveBeenCalledWith({ editing: existingView });
  });

  it("does not report empty views while loading or after a failed request", () => {
    mocks.isPending = true;
    const page = renderPage();
    expect(screen.getByText("view.loading")).toBeInTheDocument();
    expect(screen.queryByText("view.empty-title")).not.toBeInTheDocument();
    page.unmount();
    mocks.isPending = false;
    mocks.isError = true;
    renderPage();
    expect(screen.getByText("view.load-failed")).toBeInTheDocument();
    expect(screen.queryByText("view.empty-title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "search.retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
