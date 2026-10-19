import { type ReactNode, useEffect, useState } from "react";
import OfflineJournal from "@/components/OfflineJournal";
import { readJournalOwner } from "@/lib/journal-device";
import { useTranslate } from "@/utils/i18n";

/** Decide once per cold start; never unmount an in-progress editor on a network event. */
export default function JournalStartup({ children }: { children: ReactNode }) {
  const t = useTranslate();
  const [privatePage] = useState(
    () => !/^\/(s|shared|shares|memos\/shares)(\/|$)/.test(location.pathname) && !new URLSearchParams(location.search).has("share_token"),
  );
  const [owner] = useState(() => (privatePage ? readJournalOwner() : undefined));
  const [reachable, setReachable] = useState<boolean | undefined>(() => {
    if (!privatePage) return true;
    if (!navigator.onLine) return false;
    return owner ? undefined : true;
  });
  useEffect(() => {
    if (reachable !== undefined) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let active = true;
    // navigator.onLine can remain true when a local server or Wi-Fi connection
    // is unavailable. This public probe sends no identity or journal content.
    void fetch("/api/v1/instance/profile", { credentials: "omit", cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (active) setReachable(response.status < 500);
      })
      .catch(() => {
        if (active) setReachable(false);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [reachable]);
  if (reachable === undefined)
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 text-sm text-muted-foreground" role="status">
        {t("journal.startup-connecting")}
      </main>
    );
  if (!reachable) return <OfflineJournal owner={owner} />;
  return <>{children}</>;
}
