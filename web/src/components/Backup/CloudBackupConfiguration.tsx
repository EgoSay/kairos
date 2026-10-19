import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { backupStateLabel, useCloudBackup, useCloudBackupAction } from "@/hooks/useCloudBackup";
import useCurrentUser from "@/hooks/useCurrentUser";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";
import { type Translations, useTranslate } from "@/utils/i18n";

export default function CloudBackupConfiguration() {
  const t = useTranslate();
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
      setMessage(t("journal.cloud-job-updated"));
      return;
    }
    if (job.status === "running") return;
    setWatchedJob("");
    if (job.status !== "success") {
      setMessage(job.error ?? t("journal.cloud-job-failed"));
      return;
    }
    if (job.action === "test" && job.result?.draftToken) {
      setDraftToken(job.result.draftToken);
      setTrialPassed(false);
      setMessage(t("journal.cloud-test-passed"));
      setForm((previous) => ({ ...previous, accessKeyId: "", accessKeySecret: "", recoveryPassword: "", initialize: false }));
    } else if (job.action === "trial") {
      setTrialPassed(true);
      setMessage(t("journal.cloud-trial-passed"));
    } else if (job.action === "activate") {
      setDraftToken("");
      setTrialPassed(false);
      setMessage(t("journal.cloud-activated"));
    }
  }, [status.data?.job, watchedJob, t]);
  if (user?.role !== User_Role.ADMIN) return <p className="text-sm text-muted-foreground">{t("journal.cloud-admin-only")}</p>;
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
        <h2 className="text-lg font-medium">{t("journal.cloud-title")}</h2>
        <Link className="min-h-11 py-3 text-sm underline" to="/journal/backup/status">
          {t("journal.cloud-status-link")}
        </Link>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{t("journal.cloud-desc")}</p>
      {status.isError && (
        <p role="alert" className="text-sm text-destructive">
          {status.error.message}
        </p>
      )}
      {status.data && (
        <p className="text-sm">
          {t("journal.cloud-active", {
            state: status.isError ? t("journal.status-unknown") : t(backupStateLabel(status.data.state)),
            minutes: status.data.config.intervalSeconds / 60,
          })}
        </p>
      )}
      <fieldset disabled={unavailable || !loaded} className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["endpoint", "journal.cloud-endpoint"],
            ["region", "journal.cloud-region"],
            ["bucket", "journal.cloud-bucket"],
            ["prefix", "journal.cloud-prefix"],
          ] satisfies ReadonlyArray<readonly [keyof typeof form & string, Translations]>
        ).map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            {t(label)}
            <Input value={form[key]} onChange={(event) => edit({ [key]: event.target.value })} autoComplete="off" />
          </label>
        ))}
        <label className="space-y-1 text-sm">
          {t("journal.cloud-access-key")}
          <Input autoComplete="off" value={form.accessKeyId} onChange={(event) => edit({ accessKeyId: event.target.value })} />
        </label>
        <label className="space-y-1 text-sm">
          {t("journal.cloud-secret-key")}
          <Input
            type="password"
            autoComplete="new-password"
            value={form.accessKeySecret}
            onChange={(event) => edit({ accessKeySecret: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          {t("journal.cloud-recovery-password")}
          <Input
            type="password"
            autoComplete="new-password"
            value={form.recoveryPassword}
            onChange={(event) => edit({ recoveryPassword: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm">
          {t("journal.cloud-interval")}
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
            ["daily", "journal.cloud-retention-daily"],
            ["monthly", "journal.cloud-retention-monthly"],
            ["yearly", "journal.cloud-retention-yearly"],
          ] satisfies ReadonlyArray<readonly ["daily" | "monthly" | "yearly", Translations]>
        ).map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            {t(label)}
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
          {t("journal.cloud-initialize")}
        </label>
      </fieldset>
      <p className="text-xs leading-5 text-muted-foreground">{t("journal.cloud-note")}</p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={unavailable || !loaded} variant="outline" onClick={() => void run("test")}>
          {t("journal.cloud-test")}
        </Button>
        <Button disabled={unavailable || !draftToken} variant="outline" onClick={() => void run("trial")}>
          {t("journal.cloud-trial")}
        </Button>
        <Button disabled={unavailable || !draftToken || !trialPassed} onClick={() => void run("activate")}>
          {t("journal.cloud-activate")}
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-sm">
          {t("journal.cloud-busy")}
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
