import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type JournalPartition,
  type JournalTarget,
  useJournalDeliveries,
  useJournalPartitionAction,
  useJournalPartitionMemos,
  useJournalPartitions,
  useJournalPartitionTargets,
} from "@/hooks/useJournalPartitionQueries";
import { type Translations, useTranslate } from "@/utils/i18n";

const statusKeys: Record<string, Translations> = {
  pending: "journal.delivery-pending",
  delivering: "journal.delivery-delivering",
  delivered: "journal.delivery-delivered",
  published: "journal.delivery-published",
  failed: "journal.delivery-failed",
  cancelled: "journal.delivery-cancelled",
  local_changed: "journal.delivery-local-changed",
};
const targetBody = (target: JournalTarget) => ({
  partitionId: target.partitionId,
  name: target.name,
  url: target.url,
  enabled: target.enabled,
  autoUpdate: target.autoUpdate,
  retract: target.retract,
  fields: target.fields,
  version: target.version,
  signingSecret: "",
});

function TargetForm({ partitionId, existing, onClose }: { partitionId: string; existing?: JournalTarget; onClose: () => void }) {
  const t = useTranslate();
  const action = useJournalPartitionAction();
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [autoUpdate, setAutoUpdate] = useState(existing?.autoUpdate ?? false);
  const [retract, setRetract] = useState(existing?.retract ?? false);
  const [fields, setFields] = useState(existing?.fields ?? { content: true, date: true, media: false });
  const [createdSecret, setCreatedSecret] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);
  if (createdSecret)
    return (
      <section className="space-y-4 rounded-lg border border-border p-4">
        <p>{t("journal.target-saved-note")}</p>
        <Input aria-label={t("journal.target-secret-label")} readOnly value={createdSecret} onFocus={(event) => event.target.select()} />
        <Button className="min-h-11" onClick={onClose}>
          {t("journal.target-secret-saved")}
        </Button>
      </section>
    );
  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-background p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const value = await action.mutateAsync({
            path: existing ? `/targets/${existing.id}` : `/partitions/${partitionId}/targets`,
            method: existing ? "PUT" : "POST",
            body: { partitionId, name, url, signingSecret: secret, enabled, autoUpdate, retract, fields, version: existing?.version ?? 0 },
          });
          if (value?.signingSecret) setCreatedSecret(value.signingSecret);
          else onClose();
        } catch {
          /* The mutation error remains beside this form. */
        }
      }}
    >
      <label className="block space-y-2">
        <span className="text-sm">{t("journal.target-name")}</span>
        <Input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("journal.target-name-placeholder")}
          className="min-h-11"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm">{t("journal.target-url")}</span>
        <Input
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          className="min-h-11"
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm">{t("journal.target-secret")}</span>
        <Input
          type="password"
          autoComplete="new-password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={existing ? t("journal.target-secret-keep") : t("journal.target-secret-generate")}
          className="min-h-11"
        />
      </label>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm">{t("journal.target-fields")}</legend>
        {(
          [
            ["content", t("journal.target-field-content")],
            ["date", t("journal.target-field-date")],
            ["media", t("journal.target-field-media")],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.checked })} />
            {label}
          </label>
        ))}
        <p className="text-xs leading-5 text-muted-foreground">{t("journal.target-fields-note")}</p>
      </fieldset>
      <div className="border-t border-border pt-3">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          {t("journal.target-enabled")}
        </label>
        <p className="text-xs leading-5 text-muted-foreground">{t("journal.target-enabled-note")}</p>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={autoUpdate} onChange={(event) => setAutoUpdate(event.target.checked)} />
          {t("journal.target-auto-update")}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={retract} onChange={(event) => setRetract(event.target.checked)} />
          {t("journal.target-retract")}
        </label>
        <p className="text-xs leading-5 text-muted-foreground">{t("journal.target-retract-note")}</p>
      </div>
      {existing && (
        <div className="space-y-2 border-t border-border pt-2">
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setRemoveArmed(!removeArmed)}>
            {t("journal.target-remove")}
          </Button>
          {removeArmed && (
            <div>
              <p className="text-xs leading-5 text-muted-foreground">{t("journal.target-remove-note")}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11"
                disabled={action.isPending}
                onClick={async () => {
                  try {
                    await action.mutateAsync({ path: `/targets/${existing.id}?version=${existing.version}`, method: "DELETE" });
                    onClose();
                  } catch {
                    /* Error shown below. */
                  }
                }}
              >
                {t("journal.target-remove-confirm")}
              </Button>
            </div>
          )}
        </div>
      )}
      {action.isError && (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button className="min-h-11" type="submit" disabled={action.isPending}>
          {action.isPending ? t("journal.saving") : t("journal.target-save")}
        </Button>
        <Button className="min-h-11" type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function HistoricalSend({ partitionId }: { partitionId: string }) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const records = useJournalPartitionMemos(partitionId, open);
  const action = useJournalPartitionAction();
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground">{t("journal.historical-send")}</summary>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">{t("journal.historical-send-note")}</p>
      {records.isPending && open && (
        <p role="status" className="text-sm">
          {t("journal.loading")}
        </p>
      )}
      {records.isError && (
        <Button variant="outline" className="min-h-11" onClick={() => records.refetch()}>
          {t("journal.retry")}
        </Button>
      )}
      <div className="max-h-64 overflow-auto">
        {records.data?.memos.map((memo) => (
          <label key={memo.uid} className="flex min-h-11 items-start gap-3 border-b border-border/50 py-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={selected.includes(memo.uid)}
              disabled={!selected.includes(memo.uid) && selected.length >= 100}
              onChange={(event) => {
                setSent(false);
                setSelected(event.target.checked ? [...selected, memo.uid] : selected.filter((uid) => uid !== memo.uid));
              }}
            />
            <span>
              <span className="block text-xs text-muted-foreground">{new Date(memo.recordTime * 1000).toLocaleDateString()}</span>
              <span className="mt-1 block whitespace-pre-wrap">{memo.content || t("journal.historical-media-record")}</span>
            </span>
          </label>
        ))}
      </div>
      {records.data?.memos.length === 0 && <p className="py-3 text-sm text-muted-foreground">{t("journal.historical-empty")}</p>}
      {selected.length > 0 && (
        <Button
          className="mt-3 min-h-11"
          disabled={action.isPending}
          onClick={async () => {
            try {
              await action.mutateAsync({ path: `/partitions/${partitionId}/send`, body: { memoUids: selected } });
              setSelected([]);
              setSent(true);
            } catch {
              /* Error shown below. */
            }
          }}
        >
          {t("journal.historical-send-count", { count: selected.length })}
        </Button>
      )}
      {sent && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {t("journal.historical-sent")}
        </p>
      )}
      {action.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {action.error.message}
        </p>
      )}
    </details>
  );
}

function PartitionSection({ partition }: { partition: JournalPartition }) {
  const t = useTranslate();
  const targets = useJournalPartitionTargets(partition.id);
  const action = useJournalPartitionAction();
  const [editing, setEditing] = useState<JournalTarget | "new" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(partition.name);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (input: Parameters<typeof action.mutateAsync>[0], done?: () => void) => {
    setMessage("");
    try {
      await action.mutateAsync(input);
      done?.();
    } catch {
      /* Rendered below. */
    }
  };
  return (
    <section className="space-y-5 rounded-xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{partition.name}</h2>
        <div className="flex gap-1">
          <Button className="min-h-11" variant="ghost" onClick={() => setRenaming(!renaming)}>
            {t("journal.partition-rename")}
          </Button>
          <Button className="min-h-11" variant="ghost" onClick={() => setDeleteArmed(!deleteArmed)}>
            {t("journal.partition-delete")}
          </Button>
        </div>
      </div>
      {renaming && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run({ path: `/partitions/${partition.id}`, method: "PUT", body: { name, version: partition.version } }, () =>
              setRenaming(false),
            );
          }}
        >
          <Input
            aria-label={t("journal.partition-name-label")}
            className="min-h-11"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button className="min-h-11" type="submit" disabled={action.isPending}>
            {t("common.save")}
          </Button>
        </form>
      )}
      {deleteArmed && (
        <div className="space-y-2 rounded-sm bg-muted/50 p-3">
          <p className="text-sm leading-6">{t("journal.partition-delete-note")}</p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={action.isPending}
            onClick={() => void run({ path: `/partitions/${partition.id}?version=${partition.version}`, method: "DELETE" })}
          >
            {t("journal.partition-delete-confirm")}
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {targets.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("journal.targets-loading")}
          </p>
        )}
        {targets.isError && (
          <Button className="min-h-11" variant="outline" onClick={() => targets.refetch()}>
            {t("journal.targets-retry")}
          </Button>
        )}
        {targets.data?.targets.length === 0 && <p className="text-sm text-muted-foreground">{t("journal.targets-empty")}</p>}
        {targets.data?.targets.map((target) => (
          <div key={target.id} className="rounded-lg border border-border/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{target.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {target.enabled ? t("journal.target-enabled-on") : t("journal.target-enabled-off")}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button className="min-h-11" variant="ghost" onClick={() => setEditing(target)}>
                  {t("journal.target-settings")}
                </Button>
                {target.enabled && (
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() =>
                      void run({ path: `/targets/${target.id}`, method: "PUT", body: { ...targetBody(target), enabled: false } })
                    }
                  >
                    {t("journal.target-pause")}
                  </Button>
                )}
                <Button
                  className="min-h-11"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => void run({ path: `/targets/${target.id}/test` }, () => setMessage(t("journal.target-test-sent")))}
                >
                  {t("journal.target-test")}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {editing ? (
        <TargetForm
          key={editing === "new" ? "new" : editing.id}
          partitionId={partition.id}
          existing={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : (
        <Button className="min-h-11" variant="outline" onClick={() => setEditing("new")}>
          {t("journal.target-add")}
        </Button>
      )}
      {targets.data?.targets.some((target) => target.enabled) && <HistoricalSend partitionId={partition.id} />}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {action.isError && (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      )}
    </section>
  );
}

export default function JournalPartitions() {
  const t = useTranslate();
  const partitions = useJournalPartitions();
  const deliveries = useJournalDeliveries();
  const action = useJournalPartitionAction();
  const [name, setName] = useState("");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 pb-12 pt-5 sm:pt-10">
      <header>
        <h1 className="font-content text-3xl font-medium">{t("journal.partitions")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("journal.partitions-tagline")}</p>
      </header>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await action.mutateAsync({ path: "/partitions", body: { name } });
            setName("");
          } catch {
            /* Rendered below. */
          }
        }}
      >
        <Input
          aria-label={t("journal.partition-name-placeholder")}
          placeholder={t("journal.partition-name-placeholder")}
          className="min-h-11"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <Button className="min-h-11" type="submit" disabled={action.isPending}>
          {t("journal.partition-create")}
        </Button>
      </form>
      {action.isError && (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      )}
      {partitions.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("journal.partitions-loading")}
        </p>
      )}
      {partitions.isError && (
        <Button variant="outline" className="min-h-11" onClick={() => partitions.refetch()}>
          {t("journal.partitions-retry")}
        </Button>
      )}
      {partitions.data?.partitions.map((partition) => (
        <PartitionSection key={partition.id} partition={partition} />
      ))}
      <details className="border-t border-border pt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("journal.deliveries-title")}</summary>
        <p className="mb-4 text-xs leading-5 text-muted-foreground">{t("journal.deliveries-note")}</p>
        {deliveries.isError && (
          <Button className="min-h-11" variant="outline" onClick={() => deliveries.refetch()}>
            {t("journal.deliveries-retry")}
          </Button>
        )}
        {deliveries.data?.deliveries.length === 0 && <p className="text-sm text-muted-foreground">{t("journal.deliveries-empty")}</p>}
        <div className="divide-y divide-border">
          {deliveries.data?.deliveries.map((delivery) => (
            <div key={delivery.id} className="space-y-2 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  {delivery.targetName} · {delivery.event === "retract" ? t("journal.delivery-retract") : t("journal.delivery-sync")}
                </p>
                <time className="text-xs text-muted-foreground">{new Date(delivery.createdTs * 1000).toLocaleString()}</time>
              </div>
              <p>{statusKeys[delivery.status] ? t(statusKeys[delivery.status]) : delivery.status}</p>
              {delivery.lastError && <p className="text-xs leading-5 text-muted-foreground">{delivery.lastError}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Link className="inline-flex min-h-11 items-center underline underline-offset-4" to={`/memos/${delivery.memoUid}`}>
                  {t("journal.delivery-original")}
                </Link>
                {delivery.publishedUrl && (
                  <a
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                    href={delivery.publishedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("journal.delivery-open-receipt")}
                  </a>
                )}
                {["failed", "local_changed"].includes(delivery.status) && (
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ path: `/deliveries/${delivery.id}/retry` })}
                  >
                    {delivery.status === "local_changed" ? t("journal.delivery-send-update") : t("journal.retry")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
