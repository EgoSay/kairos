import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: vi.fn() }));

import { rememberNeighborhood, resetWander, type WanderNeighborhood, wanderKeys } from "@/hooks/useWanderQueries";

const neighborhood = (name: string): WanderNeighborhood => ({
  root: { name, content: "原文", createdTs: 1, revision: 1, tags: [], truncated: false },
  directions: [],
  epoch: 1,
  profile: "test",
  state: "ready",
});
describe("prepared wander memory", () => {
  it("bounds cached neighborhoods without mixing owners", () => {
    const client = new QueryClient();
    rememberNeighborhood(client, "other", neighborhood("memos/secret"));
    for (let i = 0; i < 40; i++) rememberNeighborhood(client, "me", neighborhood(`memos/${i}`));
    expect(client.getQueryCache().findAll({ queryKey: wanderKeys.owner("me") })).toHaveLength(20);
    expect(client.getQueryData(wanderKeys.node("me", "memos/secret"))).toBeUndefined();
    expect(client.getQueryData(wanderKeys.node("other", "memos/secret"))).toBeDefined();
    client.clear();
  });
  it("clears derived content on source or permission invalidation", async () => {
    const client = new QueryClient();
    rememberNeighborhood(client, "me", neighborhood("memos/a"));
    resetWander(client);
    await vi.waitFor(() => expect(client.getQueryData(wanderKeys.node("me", "memos/a"))).toBeUndefined());
    client.clear();
  });
});
