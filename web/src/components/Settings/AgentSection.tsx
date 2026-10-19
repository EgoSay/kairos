import { timestampDate } from "@bufbuild/protobuf/wkt";
import copy from "copy-to-clipboard";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentAccess } from "@/hooks/useAgentAccess";
import { agentClientConfig, testAgentConnection } from "@/lib/agent-mcp";
import SettingSection from "./SettingSection";

const AgentSection = () => {
  const { tokens, create, revoke } = useAgentAccess();
  const [description, setDescription] = useState("");
  const [days, setDays] = useState(30);
  const [credential, setCredential] = useState("");
  const [createdName, setCreatedName] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState("");
  const endpoint = `${window.location.origin}/mcp/journal`;
  const config = agentClientConfig(endpoint);
  const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : "操作失败，请重试");
  const copyText = async (text: string) => {
    if (await copy(text)) toast.success("已复制");
    else toast.error("复制失败，请手动选择复制");
  };

  const handleCreate = async () => {
    try {
      const response = await create.mutateAsync({ description, expiresInDays: days });
      setCredential(response.token);
      setCreatedName(response.personalAccessToken?.name ?? "");
      setResult("");
      setDescription("");
    } catch (error) {
      reportError(error);
    }
  };
  const handleTest = async () => {
    setTesting(true);
    setResult("");
    try {
      const context = await testAgentConnection(endpoint, credential, AbortSignal.timeout(15_000));
      setResult(`连接成功，只读权限有效。Kairos 时区：${context.timezone}；今天：${context.today}。`);
      void tokens.refetch();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "连接失败");
    } finally {
      setTesting(false);
    }
  };
  return (
    <SettingSection
      title="Agent / MCP"
      description="让 Codex 等 Agent 读取你的记录、回顾变化。专用凭据只能读取你自己的正常与归档记录，回收站默认排除。"
    >
      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="font-medium">连接地址与客户端配置</h4>
        <p className="break-all text-sm">{endpoint}</p>
        <Button variant="outline" size="sm" onClick={() => copyText(endpoint)}>
          复制地址
        </Button>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          <code>{config}</code>
        </pre>
        <Button variant="outline" size="sm" onClick={() => copyText(config)}>
          复制 Codex 配置
        </Button>
        <p className="text-sm text-muted-foreground">
          将配置加入 Codex 的 MCP 设置，并在启动 Codex 的环境中设置 KAIROS_MCP_TOKEN。配置中不包含密钥；请勿将密钥放入仓库或对话。
        </p>
      </div>
      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="font-medium">创建独立只读凭据</h4>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1 text-sm">
            用途名称
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：我的 Codex"
              maxLength={100}
            />
          </label>
          <label className="space-y-1 text-sm">
            有效期
            <select
              aria-label="有效期"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="block h-9 rounded-sm border bg-background px-3"
            >
              {[7, 30, 90, 365].map((value) => (
                <option key={value} value={value}>
                  {value} 天
                </option>
              ))}
            </select>
          </label>
          <Button onClick={handleCreate} disabled={!description.trim() || create.isPending}>
            创建只读凭据
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">每个客户端使用独立凭据；密钥只在创建时返回，离开页面后不再显示。</p>
        <label className="block space-y-1 text-sm">
          待检测的凭据
          <Input
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(event) => {
              setCredential(event.target.value);
              setCreatedName("");
              setResult("");
            }}
            placeholder="创建新凭据或粘贴已有只读凭据"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {createdName && (
            <Button variant="outline" onClick={() => copyText(credential)}>
              复制新凭据
            </Button>
          )}
          <Button variant="outline" disabled={!credential.trim() || testing} onClick={handleTest}>
            {testing ? "检测中…" : "检测 MCP 连接"}
          </Button>
          <Button
            variant="ghost"
            disabled={!credential}
            onClick={() => {
              setCredential("");
              setCreatedName("");
              setResult("");
            }}
          >
            清除页面中的凭据
          </Button>
        </div>
        {result && (
          <p role="status" className="text-sm">
            {result}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <h4 className="font-medium">已授权的 Agent</h4>
        {tokens.isError && (
          <p role="alert">
            凭据列表读取失败。
            <Button variant="link" onClick={() => tokens.refetch()}>
              重试
            </Button>
          </p>
        )}
        {tokens.isLoading && <p>正在读取…</p>}
        {tokens.data?.length === 0 && <p className="text-sm text-muted-foreground">尚未创建 Agent 凭据。</p>}
        {tokens.data?.map((token) => (
          <div key={token.name} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">{token.description} · 只读</p>
              <p className="text-xs text-muted-foreground">
                到期：{token.expiresAt ? timestampDate(token.expiresAt).toLocaleString() : "未设置"}；最后使用：
                {token.lastUsedAt ? timestampDate(token.lastUsedAt).toLocaleString() : "尚未使用"}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={revoke.isPending}
              onClick={async () => {
                try {
                  await revoke.mutateAsync(token.name);
                  if (createdName === token.name) {
                    setCredential("");
                    setCreatedName("");
                    setResult("");
                  }
                  toast.success("凭据已撤销");
                } catch (error) {
                  reportError(error);
                }
              }}
            >
              撤销
            </Button>
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
        <h4 className="font-medium">可以这样开始回顾</h4>
        <p>“看看我今天写了什么，逐条引用原文和来源链接。”</p>
        <p>“对比上个月和这个月的记录，先读取全部分页，再区分事实与推测，说明变化与证据。”</p>
        <p className="text-muted-foreground">
          Agent 会收到原始日期、Kairos 时区、完整正文与分页覆盖状态。这里的检测验证服务及只读权限；实际客户端连接仍需在 Codex 中完成。
        </p>
      </div>
    </SettingSection>
  );
};
export default AgentSection;
