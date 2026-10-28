import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";
import { resetWander, type WanderConfig } from "@/hooks/useWanderQueries";

export default function WanderSettings({ onClose, onProgress }: { onClose: () => void; onProgress: (trigger: HTMLElement) => void }) {
  const owner = useCurrentUser()?.name ?? "";
  const client = useQueryClient();
  const config = useQuery({
    queryKey: ["wander", owner, "config"],
    queryFn: () => journalRequest<{ config: WanderConfig; providers: { id: string; title: string }[] }>("/wander/config"),
  });
  const [draft, setDraft] = useState<WanderConfig>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const value = draft ?? config.data?.config;
  const save = async () => {
    if (!value) return;
    setPending(true);
    setError("");
    try {
      await journalRequest("/wander/config", { method: "PUT", body: JSON.stringify(value) });
      resetWander(client);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂时无法保存");
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-label="关联准备设置" className="mb-6 space-y-5 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">在后台准备关联</h2>
        <Button variant="ghost" onClick={onClose}>
          收起
        </Button>
      </div>
      <div>
        <Button variant="quiet" size="touch" onClick={(event) => onProgress(event.currentTarget)}>
          查看关联准备进度
        </Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        开启后，你未排除的本人记录会自动发送给 Cloudflare Workers
        AI，以理解语义并准备有原文依据的关联。删除或排除记录后，关联会随之失效。首次整理可能需要几天，阅读已有结果不等待模型。
      </p>
      {config.isPending && <p role="status">正在读取设置…</p>}
      {config.isError && <p role="alert">设置读取失败，请稍后重试。</p>}
      {value && (
        <>
          <label className="block space-y-2 text-sm">
            <span>Cloudflare 服务</span>
            <select
              className="block min-h-11 w-full rounded-md border bg-background px-3"
              value={value.providerId}
              onChange={(e) => setDraft({ ...value, providerId: e.target.value })}
            >
              <option value="">选择已配置的服务</option>
              {config.data?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            可在{" "}
            <Link to="/setting#ai" className="underline">
              设置的 AI 服务
            </Link>{" "}
            中添加 Cloudflare 的 OpenAI 兼容端点及 Token。密钥仅保存在服务端。
          </p>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.freePlanConfirmed}
              onChange={(e) => setDraft({ ...value, freePlanConfirmed: e.target.checked })}
            />
            <span>
              我确认这个 Cloudflare 账户使用 Workers Free 计划；免费额度用尽后暂停，不升级付费。应用预算无法覆盖同账户其他应用的用量。
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={value.enabled} onChange={(e) => setDraft({ ...value, enabled: e.target.checked })} />
            允许自动处理我的记录并准备关联
          </label>
          <p className="text-sm text-muted-foreground">
            本应用每日预算 {value.dailyNeurons} Neurons，与账户其他用量共享 Cloudflare 的免费额度。每天 UTC 0 点恢复。
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button disabled={pending} onClick={() => void save()}>
            {pending ? "正在保存…" : "保存设置"}
          </Button>
        </>
      )}
    </section>
  );
}
