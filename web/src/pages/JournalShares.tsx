import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CopyIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import JournalSharedContent from "@/components/JournalSharedContent";
import JournalSourcePicker from "@/components/JournalSourcePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest, useJournalPreferences } from "@/hooks/useJournalQueries";
import { type JournalShare, type JournalSharedItem, type JournalShareFilter, shareChanges } from "@/lib/journal-share";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

interface ShareRequest {
  title: string;
  mode: "fixed" | "dynamic";
  filter: JournalShareFilter;
  excludedMemoNames: string[];
  passcode: string;
  clearPasscode: boolean;
  expiresTs: number;
  version?: number;
  paused: boolean;
}

const toInputTime = (seconds: number) => {
  if (!seconds) return "";
  const value = new Date(seconds * 1000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function ShareEditor({
  existing,
  timezone,
  onClose,
  onSaved,
  initialSelection = [],
}: {
  existing?: JournalShare;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
  initialSelection?: string[];
}) {
  const t = useTranslate();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [mode, setMode] = useState<"fixed" | "dynamic">(existing?.mode ?? "fixed");
  const [scope, setScope] = useState<"manual" | "filter">(existing && existing.filter.memoNames.length === 0 ? "filter" : "manual");
  const [selected, setSelected] = useState(existing?.filter.memoNames ?? initialSelection);
  const [from, setFrom] = useState(existing?.filter.from ?? "");
  const [to, setTo] = useState(existing?.filter.to ?? "");
  const [tags, setTags] = useState(existing?.filter.tags.join(", ") ?? "");
  const [tagMode, setTagMode] = useState<"any" | "all">(existing?.filter.tagMode ?? "any");
  const [includeSubtags, setIncludeSubtags] = useState(existing?.filter.includeSubtags ?? false);
  const [excluded, setExcluded] = useState(existing?.excludedMemoNames ?? []);
  const [passcode, setPasscode] = useState("");
  const [clearPasscode, setClearPasscode] = useState(false);
  const [expires, setExpires] = useState(toInputTime(existing?.expiresTs ?? 0));
  const [preview, setPreview] = useState<{ key: string; items: JournalSharedItem[]; digest: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const before = useQuery({
    queryKey: ["journal", "share-snapshot", existing?.id, existing?.version],
    queryFn: ({ signal }) => journalRequest<{ share: JournalShare; items: JournalSharedItem[] }>(`/shares/${existing?.id}`, { signal }),
    enabled: Boolean(existing),
    staleTime: 0,
  });
  const request: ShareRequest = {
    title: title.trim() || t("journal.share-default-title"),
    mode,
    filter: {
      from: scope === "filter" ? from : "",
      to: scope === "filter" ? to : "",
      timezone: existing?.filter.timezone ?? timezone,
      tags:
        scope === "filter"
          ? [
              ...new Set(
                tags
                  .split(/[,，]/)
                  .map((tag) => tag.trim().replace(/^#/, ""))
                  .filter(Boolean),
              ),
            ]
          : [],
      tagMode,
      includeSubtags,
      memoNames: scope === "manual" ? selected : [],
    },
    excludedMemoNames: excluded,
    passcode,
    clearPasscode,
    expiresTs: expires ? Math.floor(new Date(expires).getTime() / 1000) : 0,
    version: existing?.version,
    paused: existing?.paused ?? false,
  };
  const key = JSON.stringify(request);
  const previewCurrent = preview?.key === key;
  const diff = useMemo(
    () => (before.data && previewCurrent && preview ? shareChanges(before.data.items, preview.items) : undefined),
    [before.data, preview, previewCurrent],
  );
  const validate = () => {
    if (scope === "manual" && selected.length === 0) return t("journal.share-error-empty-selection");
    if (scope === "filter" && !from && !to && request.filter.tags.length === 0) return t("journal.share-error-empty-filter");
    if (scope === "filter" && from && to && from > to) return t("journal.share-error-date-order");
    if (expires && (!Number.isFinite(request.expiresTs) || request.expiresTs * 1000 <= Date.now())) return t("journal.share-error-expiry");
    return "";
  };
  const previewShare = async () => {
    setError("");
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const value = await journalRequest<{ items: JournalSharedItem[]; previewDigest: string }>("/shares/preview", {
        method: "POST",
        body: key,
      });
      setPreview({ key, items: value.items, digest: value.previewDigest });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("journal.share-preview-error"));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!previewCurrent || busy || (existing && !before.isSuccess)) return;
    setBusy(true);
    setError("");
    try {
      await journalRequest(existing ? `/shares/${existing.id}` : "/shares", {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify({ ...request, previewDigest: preview?.digest }),
      });
      setPasscode("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("journal.share-save-error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-7 rounded-xl border border-border/60 bg-card p-5 sm:p-7"
      aria-label={existing ? t("journal.share-edit") : t("journal.share-create")}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{existing ? t("journal.share-edit") : t("journal.share-create")}</h2>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
      <fieldset disabled={busy} className="space-y-6">
        <label className="block space-y-2 text-sm">
          <span>{t("journal.share-name")}</span>
          <Input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("journal.share-default-title")}
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm">{t("journal.share-scope")}</legend>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="share-scope" checked={scope === "manual"} onChange={() => setScope("manual")} />
              {t("journal.share-scope-manual")}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="share-scope" checked={scope === "filter"} onChange={() => setScope("filter")} />
              {t("journal.share-scope-filter")}
            </label>
          </div>
          {scope === "manual" ? (
            <JournalSourcePicker selected={selected} onChange={setSelected} disabled={busy} allowArchived={false} />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm">
                  <span>{t("journal.share-from")}</span>
                  <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </label>
                <label className="block space-y-2 text-sm">
                  <span>{t("journal.share-to")}</span>
                  <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">{t("journal.share-timezone", { timezone: request.filter.timezone })}</p>
              <label className="block space-y-2 text-sm">
                <span>{t("journal.share-tags")}</span>
                <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("journal.share-tags-placeholder")} />
              </label>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex min-h-11 items-center gap-2">
                  <input type="radio" name="share-tag-mode" checked={tagMode === "any"} onChange={() => setTagMode("any")} />
                  {t("journal.share-tag-any")}
                </label>
                <label className="flex min-h-11 items-center gap-2">
                  <input type="radio" name="share-tag-mode" checked={tagMode === "all"} onChange={() => setTagMode("all")} />
                  {t("journal.share-tag-all")}
                </label>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={includeSubtags} onChange={(event) => setIncludeSubtags(event.target.checked)} />
                {t("journal.share-include-subtags")}
              </label>
              <p className="text-sm leading-6 text-muted-foreground">{t("journal.share-filter-note")}</p>
            </div>
          )}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm">{t("journal.share-mode-legend")}</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="share-mode" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
            {t("journal.share-mode-fixed")}
          </label>
          <p className="pl-5 text-sm leading-6 text-muted-foreground">{t("journal.share-mode-fixed-desc")}</p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="share-mode" checked={mode === "dynamic"} onChange={() => setMode("dynamic")} />
            {t("journal.share-mode-dynamic")}
          </label>
          <p className="pl-5 text-sm leading-6 text-muted-foreground">
            {scope === "filter" ? t("journal.share-mode-dynamic-filter") : t("journal.share-mode-dynamic-manual")}
          </p>
        </fieldset>
        <details className="rounded-lg border border-border/60 px-4">
          <summary className="cursor-pointer py-4 text-sm">{t("journal.share-access")}</summary>
          <div className="space-y-4 pb-4">
            <label className="block space-y-2 text-sm">
              <span>{existing?.hasPasscode ? t("journal.share-passcode-new") : t("journal.share-passcode")}</span>
              <Input
                type="password"
                autoComplete="new-password"
                value={passcode}
                onChange={(event) => {
                  setPasscode(event.target.value);
                  setClearPasscode(false);
                }}
              />
            </label>
            {existing?.hasPasscode && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearPasscode}
                  onChange={(event) => {
                    setClearPasscode(event.target.checked);
                    setPasscode("");
                  }}
                />
                {t("journal.share-passcode-remove")}
              </label>
            )}
            <label className="block space-y-2 text-sm">
              <span>{t("journal.share-expiry")}</span>
              <Input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} />
            </label>
          </div>
        </details>
      </fieldset>
      {excluded.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {t("journal.share-excluded", { count: excluded.length })}
          <Button variant="ghost" disabled={busy} onClick={() => setExcluded([])}>
            {t("journal.share-excluded-clear")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {existing && before.isError && (
        <div role="alert" className="text-sm text-destructive">
          {t("journal.share-load-error")}
          <Button variant="ghost" onClick={() => before.refetch()}>
            {t("journal.retry")}
          </Button>
        </div>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void previewShare()}>
        {busy ? t("journal.share-busy") : t("journal.share-preview")}
      </Button>
      {preview && (
        <section className="space-y-5 border-t border-border pt-6" aria-label={t("journal.share-preview-label")}>
          <h3 className="font-medium">
            {previewCurrent ? t("journal.share-preview-count", { count: preview.items.length }) : t("journal.share-preview-stale")}
          </h3>
          {diff && (
            <p className="text-sm text-muted-foreground">
              {t("journal.share-diff", { added: diff.added, removed: diff.removed, changed: diff.changed })}
            </p>
          )}
          {existing?.mode === "fixed" && <p className="text-sm leading-6 text-muted-foreground">{t("journal.share-update-note")}</p>}
          {previewCurrent && (
            <>
              <div className="max-h-[36rem] space-y-4 overflow-y-auto">
                {preview.items.map((item, index) => (
                  <div key={item.memoName ?? index} className="space-y-2">
                    <JournalSharedContent items={[item]} timezone={request.filter.timezone} />
                    {item.memoName && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setExcluded((previous) => [...new Set([...previous, item.memoName as string])])}
                      >
                        {t("journal.share-exclude-item")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {preview.items.length === 0 && <p className="text-sm text-muted-foreground">{t("journal.share-preview-empty")}</p>}
              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("journal.share-access-note", {
                    credential: passcode || (existing?.hasPasscode && !clearPasscode) ? t("journal.share-access-passcode") : "",
                  })}
                </p>
                <Button
                  disabled={busy || preview.items.length === 0 || Boolean(existing && !before.isSuccess)}
                  onClick={() => void publish()}
                >
                  {existing ? t("journal.share-update") : t("journal.share-publish")}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}

export default function JournalShares() {
  const t = useTranslate();
  const user = useCurrentUser();
  const client = useQueryClient();
  const preferences = useJournalPreferences();
  const [searchParams] = useSearchParams();
  const source = searchParams.get("memo");
  const selectedSource = source && /^memos\/[^/]+$/.test(source) ? source : undefined;
  const [editing, setEditing] = useState<JournalShare | "new" | undefined>(() => (selectedSource ? "new" : undefined));
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const key = ["journal", user?.name, "shares"];
  const shares = useQuery({ queryKey: key, queryFn: ({ signal }) => journalRequest<JournalShare[]>("/shares", { signal }) });
  const change = useMutation({
    mutationFn: ({ share, remove, rotate }: { share: JournalShare; remove?: boolean; rotate?: boolean }) =>
      journalRequest(
        `/shares/${share.id}${rotate ? "/rotate" : ""}`,
        rotate
          ? { method: "POST", body: JSON.stringify({ version: share.version }) }
          : remove
            ? { method: "DELETE" }
            : { method: "PATCH", body: JSON.stringify({ version: share.version, paused: !share.paused }) },
      ),
    onSuccess: () => {
      setCopied("");
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const copy = async (share: JournalShare) => {
    try {
      await navigator.clipboard.writeText(new URL(share.url, window.location.origin).href);
      setCopied(share.id);
      setCopyError("");
    } catch {
      setCopyError(t("journal.share-copy-error"));
    }
  };
  return (
    <div className="mx-auto min-w-0 max-w-2xl pb-12 pt-2 sm:pt-7 [&_button]:min-h-11">
      <Link to={ROUTES.HOME} className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" />
        {t("journal.records")}
      </Link>
      <header className="mb-8 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-content text-3xl font-medium">{t("journal.my-shares")}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{t("journal.shares-tagline")}</p>
        </div>
        {!editing && (
          <Button variant="outline" onClick={() => setEditing("new")}>
            <PlusIcon className="size-4" />
            {t("common.create")}
          </Button>
        )}
      </header>
      {editing && (
        <div className="mb-8">
          <ShareEditor
            key={editing === "new" ? "new" : `${editing.id}:${editing.version}`}
            existing={editing === "new" ? undefined : editing}
            initialSelection={selectedSource ? [selectedSource] : []}
            timezone={preferences.data?.timezone || "Asia/Shanghai"}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              void shares.refetch();
            }}
          />
        </div>
      )}
      {shares.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("journal.shares-loading")}
        </p>
      )}
      {shares.isError && (
        <div role="alert">
          <p>{t("journal.shares-error")}</p>
          <Button variant="outline" onClick={() => shares.refetch()}>
            {t("journal.retry")}
          </Button>
        </div>
      )}
      {change.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {change.error.message}
        </p>
      )}
      {copyError && (
        <p role="alert" className="mb-4 text-sm text-muted-foreground">
          {copyError}
        </p>
      )}
      {shares.data?.length === 0 && !editing && <p className="py-10 text-sm text-muted-foreground">{t("journal.shares-empty")}</p>}
      <div className="space-y-4">
        {shares.data?.map((share) => (
          <article key={share.id} className="rounded-xl border border-border/60 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="min-w-0 break-words font-medium">{share.title}</h2>
              <span className="text-xs text-muted-foreground">
                {share.paused
                  ? t("journal.share-paused")
                  : share.expiresTs && share.expiresTs * 1000 <= Date.now()
                    ? t("journal.share-expired")
                    : share.mode === "fixed"
                      ? t("journal.share-mode-fixed")
                      : t("journal.share-mode-dynamic")}
              </span>
            </div>
            <a
              href={share.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block break-all text-sm text-muted-foreground underline underline-offset-4"
            >
              {new URL(share.url, window.location.origin).href}
            </a>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void copy(share)}>
                <CopyIcon className="size-4" />
                {copied === share.id ? t("journal.share-copied") : t("journal.share-copy")}
              </Button>
              <Button variant="ghost" disabled={change.isPending} onClick={() => setEditing(share)}>
                {t("journal.share-edit-action")}
              </Button>
              <Button variant="ghost" disabled={change.isPending} onClick={() => change.mutate({ share })}>
                {share.paused ? t("journal.share-resume") : t("journal.share-pause")}
              </Button>
              <Button
                variant="ghost"
                disabled={change.isPending}
                onClick={() => {
                  if (window.confirm(t("journal.share-rotate-confirm"))) change.mutate({ share, rotate: true });
                }}
              >
                {t("journal.share-rotate")}
              </Button>
              <Button
                variant="ghost"
                disabled={change.isPending}
                onClick={() => {
                  if (window.confirm(t("journal.share-revoke-confirm"))) change.mutate({ share, remove: true });
                }}
              >
                {t("journal.share-revoke")}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
