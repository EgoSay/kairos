import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalSessionProvider } from "@/contexts/JournalSessionContext";
import type { WanderDirection, WanderNeighborhood, WanderOriginal } from "@/hooks/useWanderQueries";
import JournalWander from "@/pages/JournalWander";

const { request, detail } = vi.hoisted(() => ({ request: vi.fn(), detail: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isUserSettingsInitialized: true, userTagsSetting: undefined }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: request }));
vi.mock("@/hooks/useLiveMemoRefresh", () => ({ useSSEConnectionStatus: () => "connected" }));
vi.mock("@/hooks/useMediaQuery", () => ({ default: () => true }));
vi.mock("@/hooks/useMemoQueries", () => ({
  memoDetailQueryOptions: (name: string) => ({ queryKey: ["memo", name], queryFn: () => detail(name) }),
}));
vi.mock("@/components/JournalMemo", () => ({
  default: ({ memo, continuous }: { memo: { content: string }; continuous: boolean }) => <p data-continuous={continuous}>{memo.content}</p>,
}));
vi.mock("@/components/MemoContent", () => ({ default: ({ content }: { content: string }) => <p>{content}</p> }));

const original = (id: string): WanderOriginal => ({
  name: `memos/${id}`,
  content: `完整原文 ${id}`,
  createdTs: 1700000000 + id.charCodeAt(0) * 86400,
  revision: 1,
  tags: [],
  truncated: false,
});
const edge = (source: string, target: string): WanderDirection => ({
  original: original(target),
  sourceQuote: `原文 ${source}`,
  targetQuote: `原文 ${target}`,
  hint: `连接 ${source} 与 ${target}`,
  kind: "test",
  topic: "并读",
  topicId: "t",
  context: "情境不同",
  manual: false,
});
const node = (id: string, targets: string[]): WanderNeighborhood => ({
  root: original(id),
  directions: targets.map((target) => edge(id, target)),
  epoch: 1,
  profile: "test",
  state: "ready",
});
const graph = { a: node("a", ["b", "d"]), b: node("b", ["a", "c"]), c: node("c", ["b"]), d: node("d", ["a", "b"]) };
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  detail.mockImplementation(async (name: string) => ({ name, content: original(name.slice(-1)).content }));
  request.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === "/wander/status") return { state: "ready", counts: { total: 4, ready: 4, pending: 0, failed: 0 } };
    if (path === "/wander/neighborhoods") {
      const { names } = JSON.parse(options.body as string);
      return { neighborhoods: names.map((name: string) => graph[name.slice(-1) as keyof typeof graph]) };
    }
    return graph.a;
  });
});
afterEach(() => client.clear());
function show() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/journal/wander"]}>
        <JournalSessionProvider>
          <JournalWander />
        </JournalSessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("A+C associative reading", () => {
  it("automatically presents a finite connected path as complete originals without a per-note continue gate", async () => {
    const { container } = show();
    await waitFor(() => expect(container.querySelectorAll('[data-continuous="true"]')).toHaveLength(3));
    expect(screen.getByText("完整原文 a")).toBeInTheDocument();
    expect(screen.getByText("完整原文 b")).toBeInTheDocument();
    expect(screen.getByText("完整原文 c")).toBeInTheDocument();
    expect(screen.queryByText("完整原文 d")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /沿.*走走/ })).not.toBeInTheDocument();
  });
  it("uses one map selection to read a branch and restores the previous path on return", async () => {
    const { container } = show();
    await waitFor(() => expect(container.querySelectorAll('[data-continuous="true"]')).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "附近地图" }));
    await screen.findByRole("dialog");
    const branch = document.querySelector('[data-map-node="memos/d"]');
    expect(branch).not.toBeNull();
    fireEvent.click(branch!);
    await waitFor(() => expect(document.querySelector('[data-wander-original="memos/d"]')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelector('[data-wander-original="memos/d"]')).toHaveFocus();
    expect(screen.getByText("连接 d 与 b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到刚才" }));
    await waitFor(() => expect(document.querySelector('[data-wander-original="memos/d"]')).toBeNull());
    expect(screen.getByText("连接 a 与 b")).toBeInTheDocument();
  });
});
