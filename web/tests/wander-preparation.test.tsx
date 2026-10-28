import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WanderPreparation from "@/components/WanderPreparation";
import { JournalSessionProvider } from "@/contexts/JournalSessionContext";
import type { PreparationJob } from "@/hooks/useWanderPreparation";
import type { WanderStatus } from "@/hooks/useWanderQueries";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: request }));
vi.mock("@/hooks/useMediaQuery", () => ({ default: () => true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isUserSettingsInitialized: true, userTagsSetting: undefined }) }));

const status: WanderStatus = {
  state: "delayed",
  counts: { total: 3, ready: 1, pending: 2, failed: 1 },
  progress: { total: 3, ready: 1, preparing: 0, quota: 1, attention: 1, excluded: 2 },
  reservedNeurons: 10.75,
  dailyNeurons: 8000,
  cloudflareFreeNeurons: 10000,
  resetAt: 1793232000,
  updatedTs: 1793181600,
  usage: {
    knownNeurons: 10.75,
    estimatedNeurons: 0,
    inFlightNeurons: 0,
    unknownNeurons: 0,
    day: "2026-10-28",
    scope: "application-account",
  },
  blockers: [{ code: "daily-budget", until: 1793232000 }],
};
const job: PreparationJob = {
  name: "memos/a",
  preview: "虚构的未完成原文",
  tags: [],
  createdTs: 1793000000,
  revision: 4,
  statusVersion: 9,
  state: "attention",
  stage: "relations",
  errorCode: "quote-mismatch",
  attempts: 3,
  lastAttemptTs: 1793180000,
  nextAttemptTs: 0,
  canRetry: true,
};
let client: QueryClient;
beforeEach(() => {
  request.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  request.mockImplementation(async (path: string) => {
    if (path === "/wander/status") return status;
    if (path.startsWith("/wander/jobs?")) return { jobs: path.includes("state=attention") ? [job] : [], nextAfter: 0 };
    if (path.includes("/attempts"))
      return {
        attempts: [
          {
            id: "call-1",
            stage: "relations",
            revision: 4,
            outcome: "failed",
            errorCode: "quote-mismatch",
            startedTs: 1793180000000,
            finishedTs: 1793180005000,
            usageKind: "known",
            chargedUnits: 767250,
            inputTokens: 100,
            outputTokens: 10,
          },
        ],
        nextCursor: "",
      };
    return { accepted: 1, skipped: 0, more: false };
  });
});
afterEach(() => client.clear());
function show(online = true) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/journal/wander?panel=preparation"]}>
        <JournalSessionProvider>
          <WanderPreparation open online={online} onClose={() => undefined} onClosed={() => undefined} />
        </JournalSessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("association preparation", () => {
  it("shows disjoint progress, separates app budget from Cloudflare and lazily reads attempt metadata", async () => {
    show();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(job.preview);
    expect(within(dialog).getByText("另有 2 篇不参与关联准备")).toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => String(path).includes("/attempts"))).toBe(false);
    fireEvent.click(within(dialog).getByText(/预算说明/));
    expect(within(dialog).getByText(/Cloudflare 免费额度为 10,000/)).toBeInTheDocument();
    expect(within(dialog).getByText(/占用包含保守预留，不是 Cloudflare/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "处理详情" }));
    await within(dialog).findByText(/按返回用量结算：0.767 Neurons/);
  });
  it("reuses the same retry identity after a lost reply and preserves reading caches", async () => {
    client.setQueryData(["wander", "users/me", "node", "memos/reader"], { private: "existing original" });
    const implementation = request.getMockImplementation()!;
    let retries = 0;
    request.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "/wander/retry" && retries++ === 0) throw new TypeError("reply lost");
      return implementation(...args);
    });
    show();
    const button = await screen.findByRole("button", { name: "重新尝试" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText("reply lost");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText(/已重新安排 1 篇/);
    const bodies = request.mock.calls.filter(([path]) => path === "/wander/retry").map(([, options]) => JSON.parse(options.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(client.getQueryData(["wander", "users/me", "node", "memos/reader"])).toEqual({ private: "existing original" });
  });
  it("keeps cached progress readable offline and disables retry writes", async () => {
    client.setQueryData(["wander", "users/me", "status"], status);
    show(false);
    await screen.findByText(job.preview);
    expect(screen.getByText(/当前离线/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新尝试" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新安排暂未完成的记录" })).toBeDisabled();
  });
});
