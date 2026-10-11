/** Tests the same MCP tool path an external client uses, without storing the credential. */
export async function testAgentConnection(
  endpoint: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ timezone: string; today: string }> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token.trim()}`,
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "journal_get_context", arguments: {} } }),
    signal,
  }).catch(() => {
    throw new Error("无法连接 MCP 服务，请检查服务地址、网络或服务是否可用。");
  });
  if (response.status === 401) throw new Error("认证失败：凭据无效、已过期或已撤销。");
  if (response.status === 403) throw new Error("权限不足：当前凭据不允许访问该服务。");
  if (!response.ok) throw new Error(`MCP 服务不可用（HTTP ${response.status}）。`);
  const body = await response.json().catch(() => {
    throw new Error("MCP 服务返回无法识别的数据，请检查服务版本。");
  });
  if (body.error) throw new Error("MCP 协议请求失败，请检查服务版本。");
  const result = body.result;
  if (result?.isError) {
    const text = result.content?.map((part: { text?: string }) => part.text ?? "").join(" ") ?? "";
    if (/401|unauthenticated|请先登录/i.test(text)) throw new Error("认证失败：凭据无效、已过期或已撤销。");
    if (/403|permission|forbidden|read.only/i.test(text)) throw new Error("权限不足：当前凭据不允许读取记录。");
    throw new Error("服务已连接，但读取失败。请检查服务日志。");
  }
  const context = result?.structuredContent;
  if (!context?.readOnlyCredential) throw new Error("该凭据不是专用只读凭据，请在此页面创建 Agent 凭据。");
  if (typeof context.timezone !== "string" || typeof context.today !== "string") {
    throw new Error("MCP 服务未返回完整的读取上下文，请检查服务版本。");
  }
  return { timezone: context.timezone, today: context.today };
}

export function agentClientConfig(endpoint: string): string {
  return `[mcp_servers.kairos]\nurl = ${JSON.stringify(endpoint)}\nbearer_token_env_var = "KAIROS_MCP_TOKEN"`;
}
