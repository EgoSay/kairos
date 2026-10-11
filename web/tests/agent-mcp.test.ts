import { afterEach, describe, expect, it, vi } from "vitest";
import { agentClientConfig, testAgentConnection } from "@/lib/agent-mcp";

afterEach(() => vi.unstubAllGlobals());

describe("Agent MCP connection", () => {
  it("uses bearer authentication without browser cookies and confirms restricted scope", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ result: { structuredContent: { readOnlyCredential: true, timezone: "Asia/Shanghai", today: "2026-10-11" } } }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await testAgentConnection("https://example.test/mcp/journal", " test-token ")).toEqual({
      timezone: "Asia/Shanghai",
      today: "2026-10-11",
    });
    const [endpoint, request] = fetch.mock.calls[0];
    expect(endpoint).toBe("https://example.test/mcp/journal");
    expect(request.credentials).toBe("omit");
    expect(request.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(request.body).params.name).toBe("journal_get_context");
  });
  it.each([
    [401, {}, "认证失败"],
    [403, {}, "权限不足"],
    [503, {}, "服务不可用"],
    [200, { result: { isError: true, content: [{ text: "HTTP 401 请先登录" }] } }, "认证失败"],
    [200, { result: { isError: true, content: [{ text: "HTTP 403 forbidden" }] } }, "权限不足"],
    [200, { result: { structuredContent: { readOnlyCredential: false } } }, "不是专用只读凭据"],
  ])("distinguishes failure %s instead of claiming connected", async (status, body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
    await expect(testAgentConnection("/mcp/journal", "secret")).rejects.toThrow(expected);
  });
  it("reports inaccessible network and never embeds a token in copied configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(testAgentConnection("/mcp/journal", "secret")).rejects.toThrow("无法连接");
    expect(agentClientConfig("https://example.test/mcp/journal")).toContain('bearer_token_env_var = "KAIROS_MCP_TOKEN"');
    expect(agentClientConfig("https://example.test/mcp/journal")).not.toContain("secret");
  });
});
