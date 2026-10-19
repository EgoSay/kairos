import { useState } from "react";
import CloudBackupConfiguration from "@/components/Backup/CloudBackupConfiguration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRequestToken } from "@/connect";
import { useTranslate } from "@/utils/i18n";

type Report = { memos: number; attachments: number; originals: number; warnings: string[]; complete: boolean };
type Preview = {
  token: string;
  digest: string;
  createdTs: number;
  memos: number;
  attachments: number;
  originals: number;
  warnings: string[];
};
async function request(path: string, options: RequestInit = {}) {
  const token = await getRequestToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`/api/v1/journal/backups${path}`, { ...options, headers, credentials: "same-origin" });
}
function Warnings({ warnings }: { warnings: string[] }) {
  const t = useTranslate();
  if (!warnings.length) return null;
  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("journal.backup-warnings", { count: warnings.length })}</summary>
      <ul className="list-disc space-y-2 pl-5 text-xs leading-5 text-muted-foreground">
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}
export default function JournalBackup() {
  const t = useTranslate();
  const [history, setHistory] = useState(false);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const run = async (kind: string, work: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("journal.backup-op-error"));
    } finally {
      setBusy("");
    }
  };
  const download = () =>
    run("export", async () => {
      const response = await request(`/export?history=${history}`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `personal-journal-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setMessage(t("journal.backup-exported"));
    });
  const inspect = () =>
    run("preview", async () => {
      if (!file) return;
      setPreview(undefined);
      setReport(undefined);
      const response = await request("/preview", { method: "POST", body: file, headers: { "Content-Type": "application/zip" } });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message);
      setPreview(value);
    });
  const restore = () =>
    run("restore", async () => {
      if (!preview) return;
      const response = await request(`/${preview.token}/restore`, {
        method: "POST",
        body: JSON.stringify({ digest: preview.digest }),
        headers: { "Content-Type": "application/json" },
      });
      const value = await response.json();
      if (!response.ok) {
        if (value.report) setReport(value.report);
        throw new Error(value.message ?? t("journal.backup-restore-error"));
      }
      setReport(value);
    });
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 pb-12 pt-5 sm:pt-10">
      <header>
        <h1 className="font-content text-3xl font-medium">{t("journal.backup")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("journal.backup-tagline")}</p>
      </header>
      <CloudBackupConfiguration />
      <section className="space-y-4 rounded-xl border border-border/70 bg-card p-5">
        <h2 className="text-lg font-medium">{t("journal.backup-export-title")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("journal.backup-export-desc")}</p>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={history} disabled={Boolean(busy)} onChange={(event) => setHistory(event.target.checked)} />
          {t("journal.backup-export-history")}
        </label>
        <p className="text-xs leading-5 text-muted-foreground">{t("journal.backup-export-note")}</p>
        <Button className="min-h-11" disabled={Boolean(busy)} onClick={() => void download()}>
          {busy === "export" ? t("journal.backup-exporting") : t("journal.backup-export-action")}
        </Button>
      </section>
      <section className="space-y-4 rounded-xl border border-border/70 bg-card p-5">
        <h2 className="text-lg font-medium">{t("journal.backup-restore-title")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("journal.backup-restore-desc")}</p>
        <Input
          aria-label={t("journal.backup-file-label")}
          className="min-h-11 py-2"
          type="file"
          accept=".zip,application/zip"
          disabled={Boolean(busy)}
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            setPreview(undefined);
            setReport(undefined);
            setError("");
          }}
        />
        <p className="text-xs text-muted-foreground">{t("journal.backup-file-note")}</p>
        <Button variant="outline" className="min-h-11" disabled={!file || Boolean(busy)} onClick={() => void inspect()}>
          {busy === "preview" ? t("journal.backup-inspecting") : t("journal.backup-inspect")}
        </Button>
        {preview && !report?.complete && (
          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-sm">{t("journal.backup-archive-date", { date: new Date(preview.createdTs * 1000).toLocaleString() })}</p>
            <p className="text-sm">
              {t("journal.backup-archive-stats", { memos: preview.memos, attachments: preview.attachments, originals: preview.originals })}
            </p>
            <p className="break-all text-xs text-muted-foreground">SHA-256：{preview.digest}</p>
            <Warnings warnings={preview.warnings} />
            <p className="text-sm leading-6">{t("journal.backup-restore-note")}</p>
            <Button className="min-h-11 h-auto whitespace-normal py-3" disabled={Boolean(busy)} onClick={() => void restore()}>
              {busy === "restore" ? t("journal.backup-restoring") : t("journal.backup-restore-action")}
            </Button>
          </div>
        )}
        {report && (
          <div role="status" className="space-y-2 border-t border-border pt-4">
            <p className="font-medium">{report.complete ? t("journal.backup-report-complete") : t("journal.backup-report-partial")}</p>
            <p className="text-sm">
              {t("journal.backup-report-stats", { memos: report.memos, attachments: report.attachments, originals: report.originals })}
            </p>
            <Warnings warnings={report.warnings} />
          </div>
        )}
      </section>
      {message && (
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm leading-6 text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs leading-6 text-muted-foreground">{t("journal.backup-footer-note")}</p>
    </div>
  );
}
