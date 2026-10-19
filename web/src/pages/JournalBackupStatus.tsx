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
          {t("journal.status-config-link")}
        </Link>
      </header>
      {user?.role !== User_Role.ADMIN ? (
        <p>{t("journal.status-admin-only")}</p>
      ) : (
        <>
          {query.isPending && <p role="status">{t("journal.status-loading")}</p>}
          {query.isError && (
            <p role="alert" className="rounded-xl border border-destructive p-4 text-sm text-destructive">
              {t("journal.status-error", { message: query.error.message })}
            </p>
          )}
          <section className="space-y-2 rounded-xl border p-5">
            <h2 className="font-medium">{t("journal.status-device-drafts")}</h2>
            <p className="text-sm">
              {draftCount === undefined ? t("journal.status-drafts-unknown") : t("journal.status-drafts-count", { count: draftCount })}
              {t("journal.status-drafts-suffix")}
            </p>
            <p className="text-xs text-muted-foreground">{t("journal.status-drafts-note")}</p>
          </section>
          {data && (
            <>
              <section className="space-y-3 rounded-xl border p-5">
                <h2 className="text-lg font-medium">{query.isError ? t("journal.status-unknown") : t(backupStateLabel(data.state))}</h2>
                <p className="text-sm">{t("journal.status-protection-point", { time: backupTime(data.lastSuccess?.sourceTs) })}</p>
                <p className="text-sm">{t("journal.status-last-success", { time: backupTime(data.lastSuccess?.completedTs) })}</p>
                <p className="text-sm">
                  {t("journal.status-next-run", {
                    value: data.enabled ? data.nextRun || t("journal.status-next-run-pending") : t("journal.status-paused"),
                  })}
                </p>
                {data.currentTask && (
                  <p role="status" className="text-sm">
                    {t("journal.status-current-phase", {
                      phase: data.currentTask.phase === "upload" ? t("journal.status-phase-upload") : t("journal.status-phase-snapshot"),
                      time: backupTime(data.currentTask.startedTs),
                    })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("journal.status-source", { source: data.source, time: backupTime(data.updatedTs) })}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={busy || query.isError} onClick={() => run("run")}>
                    {t("journal.status-run-now")}
                  </Button>
                  <Button variant="outline" disabled={busy || query.isError} onClick={() => run(data.enabled ? "pause" : "enable")}>
                    {data.enabled ? t("journal.status-pause") : t("journal.status-enable")}
                  </Button>
                  <Button variant="outline" disabled={busy || query.isError} onClick={() => run("check")}>
                    {t("journal.status-verify")}
                  </Button>
                </div>
              </section>
              <section className="grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <h2 className="font-medium">{t("journal.status-monitor")}</h2>
                  <p className="text-sm">
                    {data.monitor.configured
                      ? t("journal.status-monitor-delivery", {
                          state: data.monitor.stale
                            ? t("journal.status-monitor-stale")
                            : data.monitor.delivery?.status === "success"
                              ? t("journal.status-monitor-ok")
                              : t("journal.status-monitor-failed"),
                        })
                      : t("journal.status-monitor-unset")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("journal.status-monitor-note", {
                      time: backupTime(data.monitor.delivery?.completedTs ?? data.monitor.delivery?.attemptTs),
                    })}
                  </p>
                </div>
                <div className="space-y-2">
                  <h2 className="font-medium">{t("journal.status-replica")}</h2>
                  <p className="text-sm">
                    {data.independentReplica.status === "success"
                      ? data.independentReplica.stale
                        ? t("journal.status-replica-stale")
                        : t("journal.status-replica-fresh")
                      : t("journal.status-replica-unknown")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("journal.status-replica-note", { time: backupTime(data.independentReplica.sourceTs) })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("journal.status-replica-lag", {
                      value:
                        data.independentReplica.lagSeconds == null
                          ? t("journal.status-unknown-value")
                          : t("journal.status-lag-minutes", { count: Math.ceil(data.independentReplica.lagSeconds / 60) }),
                    })}
                  </p>
                </div>
              </section>
              {data.job && (
                <section aria-live="polite" className="space-y-2 rounded-xl border p-5">
                  <h2 className="font-medium">{t("journal.status-recent-job")}</h2>
                  <p className="text-sm">
                    {data.job.action} ·{" "}
                    {data.job.status === "running"
                      ? t("journal.status-job-running")
                      : data.job.status === "success"
                        ? t("journal.status-job-done")
                        : t("journal.status-job-incomplete")}
                  </p>
                  {data.job.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {data.job.error}
                    </p>
                  )}
                </section>
              )}
              <section className="space-y-4">
                <h2 className="text-lg font-medium">{t("journal.status-history-title")}</h2>
                <p className="text-xs leading-5 text-muted-foreground">{t("journal.status-history-note")}</p>
                {data.history.length === 0 && <p className="text-sm">{t("journal.status-history-empty")}</p>}
                {data.history.map((item, index) => {
                  const repositoryId = item.repositoryId ?? data.config.repositoryId;
                  const restore = data.restores.find(
                    (record) => record.snapshotId === item.snapshotId && record.repositoryId === repositoryId,
                  );
                  const verification = restore?.applicationVerification;
                  const verificationState =
                    verification?.status === "failed"
                      ? t("journal.status-verify-failed")
                      : verification?.status === "running"
                        ? t("journal.status-verify-running")
                        : restore?.applicationVerified
                          ? t("journal.status-verified")
                          : t("journal.status-verify-pending");
                  const checked =
                    item.snapshotId &&
                    (data.integrity?.repositoryId ?? data.config.repositoryId) === repositoryId &&
                    data.integrity?.snapshotIds?.some((identifier) => identifier.startsWith(item.snapshotId ?? ""));
                  const currentDestination = !item.repositoryId || item.repositoryId === data.config.repositoryId;
                  return (
                    <details key={`${item.snapshotId ?? item.attemptTs}-${index}`} className="rounded-xl border p-4">
                      <summary className="min-h-11 cursor-pointer text-sm leading-6">
                        {item.status === "success" ? t("journal.status-backup-ok") : t("journal.status-backup-failed")} ·{" "}
                        {backupTime(item.sourceTs ?? item.attemptTs)}{" "}
                        {item.counts
                          ? `· ${t("journal.status-backup-counts", { memos: item.counts.memo ?? 0, attachments: item.counts.attachment ?? 0 })}`
                          : ""}
                      </summary>
                      <div className="space-y-3 pt-3 text-sm">
                        <p className="break-all">
                          {t("journal.status-snapshot", { id: item.snapshotId ?? t("journal.status-no-snapshot") })}
                        </p>
                        <p className="break-all">
                          {t("journal.status-instance-version", { version: item.instanceVersion ?? t("journal.status-not-recorded") })}
                        </p>
                        <p>{t("journal.status-scope")}</p>
                        <p>
                          {t("journal.status-size-duration", {
                            size: item.bytes === undefined ? t("journal.status-not-recorded") : `${(item.bytes / 1048576).toFixed(2)} MiB`,
                            seconds: item.durationSeconds ?? t("journal.status-unknown-value"),
                          })}
                        </p>
                        <p>
                          {t("journal.status-integrity", {
                            time: checked ? backupTime(data.integrity?.checkedTs) : t("journal.status-no-integrity"),
                          })}
                        </p>
                        <p>
                          {t("journal.status-isolated-restore", {
                            state: restore?.manifestVerified
                              ? t("journal.status-manifest-ok", { time: backupTime(restore.restoredTs) })
                              : t("journal.status-not-verified"),
                            verification: verificationState,
                          })}
                        </p>
                        {verification && (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>
                              {t("journal.status-verify-last", { time: backupTime(verification.completedTs ?? verification.startedTs) })}
                            </p>
                            <p className="break-all">
                              {t("journal.status-verify-version", {
                                version: verification.testedVersion ?? t("journal.status-no-receipt"),
                                commit: verification.testedCommit ?? t("journal.status-unconfirmed"),
                              })}
                            </p>
                            {verification.sourceIndexMigration && (
                              <p>{t("journal.status-index-migration", { count: verification.sourceIndexMigration.migratedRows })}</p>
                            )}
                            {verification.message && <p className="text-destructive">{verification.message}</p>}
                            <p>{t("journal.status-verify-scope-note")}</p>
                          </div>
                        )}
                        {item.errorType && (
                          <p className="text-destructive">{item.message ?? t("journal.status-failure-type", { type: item.errorType })}</p>
                        )}
                        {!currentDestination && <p>{t("journal.status-old-destination")}</p>}
                        <Button
                          variant="outline"
                          disabled={busy || query.isError || item.status !== "success" || !item.snapshotId || !currentDestination}
                          onClick={() => run("restore", item.snapshotId)}
                        >
                          {t("journal.status-restore-verify")}
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
