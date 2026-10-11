import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { backupStateLabel, useCloudBackup, useCloudBackupAction } from "@/hooks/useCloudBackup";
import useCurrentUser from "@/hooks/useCurrentUser";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";

export default function CloudBackupConfiguration() {
  const user = useCurrentUser();
  const status = useCloudBackup();
  const action = useCloudBackupAction();
  const [form, setForm] = useState({
    endpoint: "",
    region: "auto",
    bucket: "",
    prefix: "restic",
    accessKeyId: "",
    accessKeySecret: "",
    recoveryPassword: "",
    intervalSeconds: 300,
    retention: { daily: 30, monthly: 12, yearly: 100 },
    initialize: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [draftToken, setDraftToken] = useState("");
  const [trialPassed, setTrialPassed] = useState(false);
  const [watchedJob, setWatchedJob] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (status.data && !loaded) {
      const config = status.data.config;
      setForm((previous) => ({
        ...previous,
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        prefix: config.prefix,
        intervalSeconds: config.intervalSeconds,
        retention: config.retention,
      }));
      setLoaded(true);
    }
  }, [status.data, loaded]);
  useEffect(() => {
    const job = status.data?.job;
    if (!watchedJob || !job) return;
    if (job.id !== watchedJob) {
      setWatchedJob("");
      setMessage("服务器管理任务已更新，请到状态页核对；未自动启用这份草稿。");
      return;
    }
    if (job.status === "running") return;
    setWatchedJob("");
    if (job.status !== "success") {
      setMessage(job.error ?? "任务未完成，请重试。");
      return;
    }
    if (job.action === "test" && job.result?.draftToken) {
      setDraftToken(job.result.draftToken);
      setTrialPassed(false);
      setMessage("读写检测和仓库访问通过，活动配置未改变。下一步进行完整试备份。");
      setForm((previous) => ({ ...previous, accessKeyId: "", accessKeySecret: "", recoveryPassword: "", initialize: false }));
    } else if (job.action === "trial") {
      setTrialPassed(true);
      setMessage("数据库与受管附件试备份完成，可以保存并启用此配置。");
    } else if (job.action === "activate") {
      setDraftToken("");
      setTrialPassed(false);
      setMessage("已启用并沿用现有服务器定时任务。请到状态页核验下一次自动执行。");
    }
  }, [status.data?.job, watchedJob]);
  if (user?.role !== User_Role.ADMIN)
    return <p className="text-sm text-muted-foreground">整实例定时备份由管理员配置；你可以继续使用个人档案导出。</p>;
  const busy = action.isPending || status.data?.job?.status === "running" || Boolean(watchedJob);
  const unavailable = busy || status.isError;
  const edit = (patch: Partial<typeof form>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setDraftToken("");
    setTrialPassed(false);
    setMessage("");
  };
  const run = async (kind: string) => {
    setMessage("");
    try {
      const job = await action.mutateAsync({ action: kind, payload: kind === "test" ? form : { draftToken } });
      setWatchedJob(job.id);
    } catch {
      /* The mutation error is shown below; input stays available. */
    }
  };
  return (
    <section className="space-y-4 rounded-xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">整实例定时备份到 S3</h2>
        <Link className="min-h-11 py-3 text-sm underline" to="/journal/backup/status">
          查看备份与同步状态 →
        </Link>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        数据库保存记录，附件存储提供媒体，独立加密备份用于灾难恢复。这里配置独立备份，不切换应用数据库或附件存储。
      </p>
      {status.isError && (
        <p role="alert" className="text-sm text-destructive">
          {status.error.message}
        </p>
      )}
      {status.data && (
        <p className="text-sm">
          活动配置：{status.isError ? "状态未知" : (backupStateLabel[status.data.state] ?? "状态未知")} · 每{" "}
          {status.data.config.intervalSeconds / 60} 分钟。下方是配置草稿，检测失败不会替换活动配置。
        </p>
      )}
      <fieldset disabled={unavailable || !loaded} className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["endpoint", "S3 endpoint（HTTPS）"],
            ["region", "Region"],
            ["bucket", "Bucket"],
            ["prefix", "独立备份前缀"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            {label}
            <Input value={form[key]} onChange={(event) => edit({ [key]: event.target.value })} autoComplete="off" />
          </label>
        ))}
        <label className="space-y-1 text-sm">
          Access key ID（留空保留同 endpoint 凭据）
          <Input autoComplete="off" value={form.accessKeyId} onChange={(event) => edit({ accessKeyId: event.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          Secret access key
          <Input
            type="password"
            autoComplete="new-password"
            value={form.accessKeySecret}
            onChange={(event) => edit({ accessKeySecret: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          Restic 恢复密码（留空沿用现有密码，输入新密码至少 20 字符）
          <Input
            type="password"
            autoComplete="new-password"
            value={form.recoveryPassword}
            onChange={(event) => edit({ recoveryPassword: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm">
          自动备份间隔（分钟）
          <Input
            type="number"
            min={5}
            max={1440}
            value={form.intervalSeconds / 60}
            onChange={(event) => edit({ intervalSeconds: Number(event.target.value) * 60 })}
          />
        </label>
        {(
          [
            ["daily", "每日恢复点保留数"],
            ["monthly", "每月恢复点保留数"],
            ["yearly", "每年恢复点保留数"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            {label}
            <Input
              type="number"
              min={1}
              max={3650}
              value={form.retention[key]}
              onChange={(event) => edit({ retention: { ...form.retention, [key]: Number(event.target.value) } })}
            />
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.initialize} onChange={(event) => edit({ initialize: event.target.checked })} />
          这是全新的独立备份前缀，检测时明确初始化加密仓库
        </label>
      </fieldset>
      <p className="text-xs leading-5 text-muted-foreground">
        恢复密码不会回显，请独立保存。不要对 restic 文件启用对象生命周期删除。初始化只适用于新仓库；仓库访问失败不会自动创建替代仓库。
      </p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={unavailable || !loaded} variant="outline" onClick={() => void run("test")}>
          1. 检测实际读写
        </Button>
        <Button disabled={unavailable || !draftToken} variant="outline" onClick={() => void run("trial")}>
          2. 完整试备份
        </Button>
        <Button disabled={unavailable || !draftToken || !trialPassed} onClick={() => void run("activate")}>
          3. 保存并启用
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-sm">
          服务器正在处理，可在状态页查看。关闭页面不会中止服务器任务。
        </p>
      )}
      {message && (
        <p role="status" className="text-sm leading-6">
          {message}
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      )}
    </section>
  );
}
