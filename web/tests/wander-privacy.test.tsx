import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalSessionProvider } from "@/contexts/JournalSessionContext";
import type { WanderNeighborhood } from "@/hooks/useWanderQueries";
import { isMemoBlurred } from "@/lib/tag";
import JournalWander from "@/pages/JournalWander";

const auth = vi.hoisted(() => ({ isUserSettingsInitialized: false, userTagsSetting: undefined as unknown }));
const request = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: request }));
vi.mock("@/hooks/useLiveMemoRefresh", () => ({ useSSEConnectionStatus: () => "connected" }));
vi.mock("@/hooks/useMediaQuery", () => ({ default: () => true }));
vi.mock("@/hooks/useMemoQueries", () => ({
  memoDetailQueryOptions: (name: string) => ({
    queryKey: ["memo", name],
    queryFn: async () => ({
      name,
      content: name === "memos/a" ? "protected original" : "associated original",
      tags: name === "memos/a" ? ["private"] : [],
    }),
  }),
}));
vi.mock("@/components/JournalMemo", () => ({
  default: ({ memo }: { memo: { content: string; tags: string[] } }) =>
    isMemoBlurred(memo, auth.userTagsSetting as Parameters<typeof isMemoBlurred>[1]) ? (
      <button type="button">显示这篇记录</button>
    ) : (
      <p>{memo.content}</p>
    ),
}));
vi.mock("@/components/MemoContent", () => ({ default: ({ content }: { content: string }) => <p>{content}</p> }));

const node: WanderNeighborhood = {
  root: { name: "memos/a", content: "protected original", createdTs: 1, revision: 1, tags: ["private"], truncated: false },
  directions: [
    {
      original: { name: "memos/b", content: "associated original", createdTs: 1, revision: 1, tags: [], truncated: false },
      kind: "same-question",
      hint: "protected hint",
      context: "context",
      topic: "protected topic",
      topicId: "topic",
      sourceQuote: "protected original",
      targetQuote: "associated original",
      manual: false,
    },
  ],
  epoch: 1,
  profile: "test",
  state: "ready",
};
let client: QueryClient;
beforeEach(() => {
  auth.isUserSettingsInitialized = false;
  auth.userTagsSetting = undefined;
  request.mockImplementation(async (path: string) => {
    if (path === "/wander/status") return { state: "ready", counts: { total: 2, ready: 2, pending: 0, failed: 0 } };
    if (path === "/wander/neighborhoods") return { neighborhoods: [node] };
    return node;
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => client.clear());

function reader() {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/journal/wander"]}>
        <JournalSessionProvider>
          <JournalWander />
        </JournalSessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("wander display privacy", () => {
  it("waits for blur settings even when a prepared original arrives first", async () => {
    const view = render(reader());
    await screen.findByText("正在核对阅读设置…");
    expect(screen.queryByText("protected original")).not.toBeInTheDocument();
    expect(screen.queryByText("associated original")).not.toBeInTheDocument();
    auth.isUserSettingsInitialized = true;
    view.rerender(reader());
    await waitFor(() => expect(screen.getByText("protected original")).toBeInTheDocument());
  });

  it("does not reveal blurred originals through hints, topics or neighboring excerpts", async () => {
    auth.isUserSettingsInitialized = true;
    auth.userTagsSetting = { tags: { private: { blurContent: true } } };
    render(reader());
    expect(await screen.findByRole("button", { name: "显示这篇记录" })).toBeInTheDocument();
    for (const text of ["protected original", "associated original", "protected hint", "protected topic"]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });
});
