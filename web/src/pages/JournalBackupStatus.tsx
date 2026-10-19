import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { backupStateLabel, backupTime, useCloudBackup, useCloudBackupAction } from "@/hooks/useCloudBackup";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalDrafts } from "@/lib/journal-drafts";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";

export default function JournalBackupStatus() {
  const t = useTranslate();
  const user = useCurrentUser();
  const query = useCloudBackup();
  const action = useCloudBackupAction();
  const [draftCount, setDraftCount] = useState<number>();
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (user)
        void journalDrafts
          .list(user.name)
          .then((entries) => {
            if (!cancelled) setDraftCount(entries.length);
          })
          .catch(() => {
            if (!cancelled) setDraftCount(undefined);
          });
    };
    refresh();
    window.addEventListener("journal-drafts-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("journal-drafts-changed", refresh);
    };
  }, [user]);
  const data = query.data;
  const busy = action.isPending || data?.job?.status === "running" || data?.state === "running";
  const run = (operation: string, snapshotId?: string) => action.mutate({ action: operation, payload: snapshotId ? { snapshotId } : {} });
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12 pt-5 sm:pt-10">
      <header className="space-y-3">
        <h1 className="font-content text-3xl">{t("journal.backup-status")}</h1>
        <Link className="inline-block min-h-11 py-3 text-sm underline" to="/journal/backup">
          配置备份与个人档案
        </Link>
      </header>
      {user?.role !== User_Role.ADMIN ? (
        <p>只有管理员可以查看整实例备份状态。</p>
      ) : (
        <>
          {query.isPending && <p role="status">正在读取服务器备份回执…</p>}
          {query.isError && (
            <p role="alert" className="rounded-xl border border-destructive p-4 text-sm text-destructive">
              状态读取失败：{query.error.message}。之前的成功回执不能证明当前正常。
            </p>
          )}
          <section className="space-y-2 rounded-xl border p-5">
            <h2 className="font-medium">当前设备待同步内容</h2>
            <p className="text-sm">
              {draftCount === undefined ? "本机草稿状态未知" : `本机保留 ${draftCount} 份草稿或待同步记录`}。这些内容不计入服务器备份。
            </p>
            <p className="text-xs text-muted-foreground">其他设备的本地草稿需在对应设备检查。</p>
          </section>
          {data && (
            <>
              <section className="space-y-3 rounded-xl border p-5">
                <h2 className="text-lg font-medium">{query.isError ? "状态未知" : (backupStateLabel[data.state] ?? "状态未知")}</h2>
                <p className="text-sm">数据保护时间点：{backupTime(data.lastSuccess?.sourceTs)}</p>
                <p className="text-sm">最近成功完成：{backupTime(data.lastSuccess?.completedTs)}</p>
                <p className="text-sm">下次自动执行：{data.enabled ? data.nextRun || "等待服务器调度回执" : "已暂停"}</p>
                {data.currentTask && (
                  <p role="status" className="text-sm">
                    当前阶段：{data.currentTask.phase === "upload" ? "加密上传" : "一致性快照与媒体核对"} · 开始于{" "}
                    {backupTime(data.currentTask.startedTs)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  来源：{data.source} · 更新于 {backupTime(data.updatedTs)}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={busy || query.isError} onClick={() => run("run")}>
                    立即备份
                  </Button>
                  <Button variant="outline" disabled={busy || query.isError} onClick={() => run(data.enabled ? "pause" : "enable")}>
                    {data.enabled ? "暂停自动备份" : "启用自动备份"}
                  </Button>
                  <Button variant="outline" disabled={busy || query.isError} onClick={() => run("check")}>
                    完整读取校验
                  </Button>
                </div>
              </section>
              <section className="grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <h2 className="font-medium">独立监控</h2>
                  <p className="text-sm">
                    {data.monitor.configured
                      ? `回执投递：${data.monitor.stale ? "回执已过期" : data.monitor.delivery?.status === "success" ? "最近投递成功" : "失败或尚无回执"}`
                      : "未配置独立监控回执"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    最近投递：{backupTime(data.monitor.delivery?.completedTs ?? data.monitor.delivery?.attemptTs)}
                    。投递成功与备份成功分别记录；应用离线时由独立监控判断心跳缺失。
                  </p>
                </div>
                <div className="space-y-2">
                  <h2 className="font-medium">独立副本</h2>
                  <p className="text-sm">
                    {data.independentReplica.status === "success"
                      ? data.independentReplica.stale
                        ? "副本保护时间已过期"
                        : "已有新鲜副本回执"
                      : "状态未知，不能认为已复制"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    保护时间：{backupTime(data.independentReplica.sourceTs)}。主备份成功不会自动证明另一台设备的副本已更新。
                  </p>
                  <p className="text-xs text-muted-foreground">
                    与主备份保护时间相差：
                    {data.independentReplica.lagSeconds == null ? "未知" : `${Math.ceil(data.independentReplica.lagSeconds / 60)} 分钟`}。
                  </p>
                </div>
              </section>
              {data.job && (
                <section aria-live="polite" className="space-y-2 rounded-xl border p-5">
                  <h2 className="font-medium">最近管理任务</h2>
                  <p className="text-sm">
                    {data.job.action} ·{" "}
                    {data.job.status === "running" ? "执行中" : data.job.status === "success" ? "任务完成，请查看对应阶段结果" : "未完成"}
                  </p>
                  {data.job.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {data.job.error}
                    </p>
                  )}
                </section>
              )}
              <section className="space-y-4">
                <h2 className="text-lg font-medium">备份历史与恢复</h2>
                <p className="text-xs leading-5 text-muted-foreground">
                  展示最近 100
                  条服务器回执。隔离恢复只写入全新目录，撤销旧令牌与分享并暂停外发，不替换线上数据。文件完整性与实际应用可用性分别验收。
                </p>
                {data.history.length === 0 && <p className="text-sm">暂无备份历史。</p>}
                {data.history.map((item, index) => {
                  const repositoryId = item.repositoryId ?? data.config.repositoryId;
                  const restore = data.restores.find(
                    (record) => record.snapshotId === item.snapshotId && record.repositoryId === repositoryId,
                  );
                  const verification = restore?.applicationVerification;
                  const verificationState =
                    verification?.status === "failed"
                      ? "最近检查未通过"
                      : verification?.status === "running"
                        ? "正在实际实例验证"
                        : restore?.applicationVerified
                          ? "已验证"
                          : "待实际实例验证";
                  const checked =
                    item.snapshotId &&
                    (data.integrity?.repositoryId ?? data.config.repositoryId) === repositoryId &&
                    data.integrity?.snapshotIds?.some((identifier) => identifier.startsWith(item.snapshotId ?? ""));
                  const currentDestination = !item.repositoryId || item.repositoryId === data.config.repositoryId;
                  return (
                    <details key={`${item.snapshotId ?? item.attemptTs}-${index}`} className="rounded-xl border p-4">
                      <summary className="min-h-11 cursor-pointer text-sm leading-6">
                        {item.status === "success" ? "备份成功" : "备份失败"} · {backupTime(item.sourceTs ?? item.attemptTs)}{" "}
                        {item.counts ? `· ${item.counts.memo ?? 0} 条记录 / ${item.counts.attachment ?? 0} 个附件` : ""}
                      </summary>
                      <div className="space-y-3 pt-3 text-sm">
                        <p className="break-all">快照：{item.snapshotId ?? "未产生完整快照"}</p>
                        <p className="break-all">备份时应用标识：{item.instanceVersion ?? "历史回执未记录"}</p>
                        <p>范围：数据库、受管附件、保留的历史原件；不含浏览器草稿和任意外链。</p>
                        <p>
                          大小：{item.bytes === undefined ? "历史回执未记录" : `${(item.bytes / 1048576).toFixed(2)} MiB`} · 耗时：
                          {item.durationSeconds ?? "未知"} 秒
                        </p>
                        <p>完整读取校验：{checked ? backupTime(data.integrity?.checkedTs) : "此快照尚无完整读取校验证据"}</p>
                        <p>
                          隔离恢复：{restore?.manifestVerified ? `文件与数据库通过（${backupTime(restore.restoredTs)}）` : "尚未验证"} ·
                          应用可用性：{verificationState}
                        </p>
                        {verification && (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>最近应用检查：{backupTime(verification.completedTs ?? verification.startedTs)}</p>
                            <p className="break-all">
                              实际测试版本：{verification.testedVersion ?? "尚无完整回执"} · 提交：{verification.testedCommit ?? "尚未确认"}
                            </p>
                            {verification.sourceIndexMigration && (
                              <p>
                                已核对标签索引迁移：{verification.sourceIndexMigration.migratedRows}{" "}
                                条；仅派生索引变化，原始记录字段和附件核对通过。
                              </p>
                            )}
                            {verification.message && <p className="text-destructive">{verification.message}</p>}
                            <p>仅针对这次隔离恢复及所列测试版本，不代表所有历史备份或当前线上版本已通过。</p>
                          </div>
                        )}
                        {item.errorType && (
                          <p className="text-destructive">
                            {item.message ?? `失败类型：${item.errorType}。请检查凭据、存储空间、网络和原件覆盖。`}
                          </p>
                        )}
                        {!currentDestination && <p>这是旧目的地的回执，请使用对应仓库和独立保管的恢复密钥。</p>}
                        <Button
                          variant="outline"
                          disabled={busy || query.isError || item.status !== "success" || !item.snapshotId || !currentDestination}
                          onClick={() => run("restore", item.snapshotId)}
                        >
                          从此快照隔离恢复并核验
                        </Button>
                      </div>
                    </details>
                  );
                })}
              </section>
            </>
          )}
          {action.error && (
            <p role="alert" className="text-sm text-destructive">
              {action.error.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
