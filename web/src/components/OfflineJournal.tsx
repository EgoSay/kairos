import { useEffect, useRef, useState } from "react";
import { cacheService } from "@/components/MemoEditor/services/cacheService";
import { createInitialState, type EditorState } from "@/components/MemoEditor/state";
import { editInlineImageDraft, type TextEditSelection } from "@/components/MemoEditor/utils/inlineImageDraft";
import type { DeviceOwner } from "@/lib/journal-device";
import { type JournalDraft, journalDrafts, restoreJournalState } from "@/lib/journal-drafts";
import { useTranslate } from "@/utils/i18n";

/** A cold offline start reads device drafts, without pretending to have a verified session. */
export default function OfflineJournal({ owner }: { owner?: DeviceOwner }) {
  const t = useTranslate();
  const [state, setState] = useState<EditorState>(createInitialState);
  const [key, setKey] = useState(owner ? `offline:${owner.name}` : "");
  const [options, setOptions] = useState<JournalDraft["options"]>();
  const [entries, setEntries] = useState<JournalDraft[]>([]);
  const [status, setStatus] = useState(() => t("journal.offline-loading"));
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const urls = useRef(new Set<string>());
  const generation = useRef(0);
  const textSelection = useRef<TextEditSelection | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    void journalDrafts
      .list(owner.name)
      .then((drafts) => {
        if (!alive) return;
        setEntries(drafts);
        const draft = drafts.find((d) => d.key === `offline:${owner.name}` && d.kind === "draft");
        if (draft) {
          const restored = restoreJournalState(draft);
          for (const file of restored.localFiles) urls.current.add(file.previewUrl);
          setState(restored);
        }
        setReady(true);
        setStatus(t("journal.offline-stored"));
      })
      .catch(() => {
        if (alive) setStatus(t("journal.offline-read-error"));
      });
    return () => {
      alive = false;
    };
  }, [owner, t]);
  useEffect(() => {
    if (!owner || !ready || busy) return;
    const current = ++generation.current;
    setStatus(t("journal.offline-saving"));
    void journalDrafts
      .save(key, owner.name, state, options)
      .then(() => {
        if (generation.current === current) setStatus(t("journal.offline-saved"));
      })
      .catch(() => {
        if (generation.current === current) setStatus(t("journal.offline-save-error"));
      });
  }, [owner, ready, busy, state, key, options, t]);
  const refresh = async () => {
    if (owner) setEntries(await journalDrafts.list(owner.name));
  };
  const load = async (draft: JournalDraft) => {
    if (!owner || busy) return;
    setError("");
    setBusy(true);
    try {
      await journalDrafts.save(key, owner.name, stateRef.current, options);
      const restored = restoreJournalState(draft);
      for (const file of restored.localFiles) urls.current.add(file.previewUrl);
      setState(restored);
      setKey(draft.key);
      setOptions(draft.options);
    } catch {
      setError(t("journal.offline-switch-error"));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!owner || busy) return;
    setError("");
    setBusy(true);
    ++generation.current;
    try {
      const current = stateRef.current;
      await journalDrafts.save(`pending:${owner.name}:${current.clientId}`, owner.name, current, options, "pending");
      await journalDrafts.remove(key);
      cacheService.clear(key);
      setState(createInitialState());
      setKey(`offline:${owner.name}`);
      setOptions(undefined);
      await refresh();
      setStatus(t("journal.offline-kept"));
    } catch {
      setError(t("journal.offline-keep-error"));
    } finally {
      setBusy(false);
    }
  };
  const reconnect = async () => {
    setError("");
    if (owner && ready) {
      try {
        await journalDrafts.save(key, owner.name, stateRef.current, options);
      } catch {
        setError(t("journal.offline-unsaved-error"));
        return;
      }
    }
    location.reload();
  };
  return (
    <main className="max-w-2xl mx-auto px-5 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-medium">{t("journal.offline-title")}</h1>
        <p className="text-sm text-muted-foreground">{t("journal.offline-desc")}</p>
      </header>
      {!owner ? (
        <p>{t("journal.offline-login-note")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("journal.offline-owner", { name: owner.username })}</p>
          <textarea
            aria-label={t("journal.offline-content-label")}
            placeholder={t("journal.offline-placeholder")}
            value={state.content}
            disabled={!ready || busy}
            onKeyDown={(event) => {
              textSelection.current =
                event.key === "Backspace" || event.key === "Delete"
                  ? {
                      from: event.currentTarget.selectionStart,
                      to: event.currentTarget.selectionEnd,
                      inputType: event.key === "Backspace" ? "deleteContentBackward" : "deleteContentForward",
                    }
                  : undefined;
            }}
            onPaste={(event) => {
              textSelection.current = { from: event.currentTarget.selectionStart, to: event.currentTarget.selectionEnd };
            }}
            onBeforeInput={(event) => {
              textSelection.current = {
                from: event.currentTarget.selectionStart,
                to: event.currentTarget.selectionEnd,
                inputType: (event.nativeEvent as InputEvent).inputType || textSelection.current?.inputType,
              };
            }}
            onChange={(event) => {
              setError("");
              const content = event.target.value;
              const selection = textSelection.current;
              textSelection.current = undefined;
              setState((previous) => editInlineImageDraft(previous, content, selection));
            }}
            className="w-full min-h-48 bg-transparent border border-border rounded-sm p-4 outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="space-y-2">
            {state.localFiles.map((item) => (
              <div key={item.clientId ?? item.previewUrl} className="flex justify-between gap-3 text-sm">
                <a href={item.previewUrl} download={item.file.name} className="underline break-all">
                  {item.file.name}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setState((previous) => ({ ...previous, localFiles: previous.localFiles.filter((file) => file !== item) }))}
                >
                  {t("journal.offline-remove")}
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="text-sm cursor-pointer underline">
              {t("journal.offline-add-file")}
              <input
                type="file"
                className="sr-only"
                multiple
                disabled={!ready || busy}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).map((file) => {
                    const previewUrl = URL.createObjectURL(file);
                    urls.current.add(previewUrl);
                    return { file, previewUrl, clientId: crypto.randomUUID().replaceAll("-", ""), origin: "upload" as const };
                  });
                  setState((previous) => ({ ...previous, localFiles: [...previous.localFiles, ...files] }));
                  event.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="bg-primary text-primary-foreground rounded-sm px-4 py-2 disabled:opacity-50"
              disabled={!ready || busy || (!state.content.trim() && !state.localFiles.length && !state.metadata.attachments.length)}
              onClick={() => void save()}
            >
              {t("journal.offline-save-action")}
            </button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {entries.length > 0 && (
            <details>
              <summary className="cursor-pointer py-3 text-sm">{t("journal.offline-drafts-title")}</summary>
              <div className="space-y-3">
                {entries
                  .filter((entry) => entry.key !== key)
                  .map((entry) => (
                    <article key={entry.key} className="border-b border-border py-3 text-sm space-y-2">
                      <p className="whitespace-pre-wrap break-words">{entry.state.content || t("journal.offline-media-entry")}</p>
                      <p className="text-muted-foreground">
                        {(entry.kind === "pending" ? t("journal.offline-pending") : t("journal.offline-draft")) +
                          " " +
                          t("journal.offline-attachments", { count: entry.state.localFiles.length })}
                      </p>
                      {entry.kind === "draft" && (
                        <button type="button" className="underline" disabled={busy} onClick={() => void load(entry)}>
                          {t("journal.offline-continue")}
                        </button>
                      )}
                    </article>
                  ))}
              </div>
            </details>
          )}
        </>
      )}
      <button type="button" className="text-sm underline min-h-11" disabled={busy} onClick={() => void reconnect()}>
        {online ? t("journal.offline-reconnect") : t("journal.offline-retry-connect")}
      </button>
    </main>
  );
}
