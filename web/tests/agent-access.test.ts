import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentCredential } from "@/hooks/useAgentAccess";

const clients = vi.hoisted(() => ({ createPersonalAccessToken: vi.fn(), deletePersonalAccessToken: vi.fn() }));
vi.mock("@/connect", () => ({ userServiceClient: clients }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice" }) }));

beforeEach(() => {
  vi.resetAllMocks();
  clients.deletePersonalAccessToken.mockResolvedValue({});
});
describe("independent Agent credentials", () => {
  it("requests finite readonly scope and returns only confirmed restricted credentials", async () => {
    const response = {
      token: "kairos_agent_synthetic",
      personalAccessToken: { readOnly: true, name: "users/alice/personalAccessTokens/id" },
    };
    clients.createPersonalAccessToken.mockResolvedValue(response);
    expect(await createAgentCredential("users/alice", " Codex ", 30)).toEqual(response);
    expect(clients.createPersonalAccessToken).toHaveBeenCalledWith({
      parent: "users/alice",
      description: "Codex",
      expiresInDays: 30,
      readOnly: true,
    });
    expect(clients.deletePersonalAccessToken).not.toHaveBeenCalled();
  });
  it("revokes a legacy full token returned by an older server instead of exposing it", async () => {
    clients.createPersonalAccessToken.mockResolvedValue({
      token: "memos_pat_full",
      personalAccessToken: { name: "users/alice/personalAccessTokens/legacy" },
    });
    await expect(createAgentCredential("users/alice", "Codex", 30)).rejects.toThrow("服务版本不支持只读授权");
    expect(clients.deletePersonalAccessToken).toHaveBeenCalledWith({ name: "users/alice/personalAccessTokens/legacy" });
  });
  it("reports failed revocation without claiming the full token was removed", async () => {
    clients.createPersonalAccessToken.mockResolvedValue({
      token: "memos_pat_full",
      personalAccessToken: { name: "users/alice/personalAccessTokens/legacy" },
    });
    clients.deletePersonalAccessToken.mockRejectedValue(new Error("offline"));
    await expect(createAgentCredential("users/alice", "Codex", 30)).rejects.toThrow("自动撤销失败");
  });
});
