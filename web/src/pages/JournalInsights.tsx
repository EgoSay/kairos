import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import JournalSourcePicker from "@/components/JournalSourcePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";
import { useTranslate } from "@/utils/i18n";

interface Insight {
  id: string;
  text: string;
  citations: string[];
  sources: { name: string; fingerprint: string }[];
  createdTs: number;
  stale: boolean;
}
interface Config {
  providerId: string;
  model: string;
}
interface AISettings {
  providers: { id: string; title: string; endpoint: string }[];
  config: Config;
}

export default function JournalInsights() {
  const t = useTranslate();
  const user = useCurrentUser();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() => (params.get("memo") ? [params.get("memo") as string] : []));
  const [result, setResult] = useState<Insight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const controller = useRef<AbortController | null>(null);
  const configQuery = useQuery({ queryKey: ["journal", user?.name, "ai-config"], queryFn: () => journalRequest<AISettings>("/ai/config") });
  const history = useQuery({
    queryKey: ["journal", user?.name, "insights"],
    queryFn: () => journalRequest<Insight[]>("/insights"),
    enabled: showHistory,
  });
  const saveConfig = useMutation({
    mutationFn: (value: Config) => journalRequest<Config>("/ai/config", { method: "PUT", body: JSON.stringify(value) }),
    onSuccess: () => {
      setConfig(null);
      void configQuery.refetch();
    },
  });
  useEffect(() => () => controller.current?.abort(), []);
  const settings = config ?? configQuery.data?.config ?? { providerId: "", model: "" };
  const provider = configQuery.data?.providers.find((entry) => entry.id === configQuery.data?.config.providerId);
  const generate = async () => {
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setResult(null);
    setSaved(false);
    try {
      const next = await journalRequest<Insight>("/insights/generate", {
        method: "POST",
        body: JSON.stringify({ memoNames: selected }),
        signal: request.signal,
      });
      if (!request.signal.aborted) setResult(next);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : t("journal.insights-generate-error"));
    } finally {
      if (controller.current === request) setBusy(false);
    }
  };
  const save = async () => {
    if (!result) return;
    try {
      await journalRequest("/insights", { method: "POST", body: JSON.stringify(result) });
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["journal", user?.name, "insights"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("journal.insights-save-error"));
    }
  };
  return (
    <main className="mx-auto max-w-2xl space-y-7 pb-16 pt-4 sm:pt-8">
      <Link to="/journal" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("journal.explore")}
      </Link>
      <header>
        <h1 className="font-content text-3xl font-medium">{t("journal.ai-insights")}</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{t("journal.insights-tagline")}</p>
      </header>
      <details className="rounded-lg border border-border/60 p-4" open={!configQuery.data?.config.providerId || undefined}>
        <summary className="cursor-pointer text-sm">
          {provider ? t("journal.insights-current-provider", { title: provider.title }) : t("journal.insights-configure")}
        </summary>
        <div className="mt-4 space-y-3 text-sm">
          {configQuery.isError && <p role="alert">{t("journal.insights-config-error")}</p>}
          {!configQuery.data?.providers.length && (
            <p>
              {t("journal.insights-setup-prefix")}
              <Link className="underline" to="/setting#ai">
                {t("journal.insights-setup-link")}
              </Link>
              {t("journal.insights-setup-suffix")}
            </p>
          )}
          <label className="block space-y-2">
            <span>{t("journal.insights-provider")}</span>
            <select
              className="min-h-11 w-full rounded-sm border bg-background px-3"
              value={settings.providerId}
              onChange={(e) => setConfig({ ...settings, providerId: e.target.value })}
            >
              <option value="">{t("journal.insights-provider-select")}</option>
              {configQuery.data?.providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-2">
            <span>{t("journal.insights-model")}</span>
            <Input
              value={settings.model}
              onChange={(e) => setConfig({ ...settings, model: e.target.value })}
              placeholder={t("journal.insights-model-placeholder")}
            />
          </label>
          <p className="leading-6 text-muted-foreground">{t("journal.insights-send-notice")}</p>
          <Button
            variant="outline"
            disabled={!settings.providerId || !settings.model || saveConfig.isPending}
            onClick={() => saveConfig.mutate(settings)}
          >
            {t("journal.insights-save-settings")}
          </Button>
          {saveConfig.isError && (
            <p role="alert" className="text-destructive">
              {saveConfig.error.message}
            </p>
          )}
        </div>
      </details>
      <JournalSourcePicker
        selected={selected}
        onChange={(names) => {
          setSelected(names);
          setResult(null);
        }}
        disabled={busy}
      />
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {provider
            ? t("journal.insights-send-summary", { title: provider.title, count: selected.length })
            : t("journal.insights-provider-required")}
        </p>
        {busy ? (
          <div className="flex items-center gap-4">
            <span role="status" className="text-sm">
              {t("journal.insights-reading")}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button disabled={selected.length === 0 || selected.length > 30 || !provider} onClick={generate}>
            {t("journal.insights-start")}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      {result && (
        <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-6">
          <p className="text-xs tracking-wider text-muted-foreground">{t("journal.insights-result-label")}</p>
          <p className="whitespace-pre-wrap leading-8">{result.text}</p>
          <div className="flex flex-wrap gap-3">
            {result.citations.map((name, i) => (
              <Link key={name} className="text-sm underline underline-offset-4" to={`/${name}`}>
                {t("journal.insights-view-source", { n: i + 1 })}
              </Link>
            ))}
          </div>
          <Button variant="ghost" disabled={saved} onClick={save}>
            {saved ? t("journal.insights-saved") : t("journal.insights-save")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("journal.insights-unsaved-note")}</p>
        </section>
      )}
      <details onToggle={(e) => setShowHistory(e.currentTarget.open)}>
        <summary className="cursor-pointer py-3 text-sm text-muted-foreground">{t("journal.insights-history")}</summary>
        {history.isError && <p role="alert">{t("journal.load-error")}</p>}
        {history.data?.length === 0 && <p className="py-5 text-sm text-muted-foreground">{t("journal.insights-history-empty")}</p>}
        {history.data?.map((item) => (
          <article key={item.id} className="space-y-3 border-t py-5">
            <p className="text-xs text-muted-foreground">
              {t("journal.insights-label")}
              {item.stale ? t("journal.insights-stale") : ""}
            </p>
            <p className="whitespace-pre-wrap leading-7">{item.text}</p>
            <div className="flex gap-3">
              {item.citations.map((name, i) => (
                <Link className="text-sm underline" key={name} to={`/${name}`}>
                  {t("journal.insights-source", { n: i + 1 })}
                </Link>
              ))}
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await journalRequest(`/insights/${item.id}`, { method: "DELETE" });
                    void history.refetch();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                {t("common.delete")}
              </Button>
            </div>
          </article>
        ))}
      </details>
    </main>
  );
}
