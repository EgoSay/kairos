import { type PropsWithChildren, useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useInstance } from "@/contexts/InstanceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { RecordReadingContext } from "./RecordReadingContext";
import RecordReadingDialog from "./RecordReadingDialog";

export interface ReadingEntry {
  name: string;
  scrollTop: number;
  sourceName?: string;
}

/** One reading stack per route/account. Share routes never use ambient owner credentials. */
export default function RecordReadingProvider({ children }: PropsWithChildren) {
  const { profile } = useInstance();
  const location = useLocation();
  const user = useCurrentUser();
  const owner = `${user?.name ?? "guest"}:${location.key}`;
  const enabled = !location.pathname.startsWith("/memos/shares/");
  const [session, setSession] = useState<{ owner: string; entries: ReadingEntry[] }>();
  const trigger = useRef<HTMLElement | null>(null);
  const restore = useRef<(() => void) | undefined>(undefined);
  const scroll = useRef<HTMLDivElement | null>(null);
  const origins = useMemo(() => [window.location.origin, ...(profile.instanceUrl ? [profile.instanceUrl] : [])], [profile.instanceUrl]);
  const open = useCallback(
    (name: string, element?: HTMLElement, sourceName?: string, restoreFocus?: () => void) => {
      if (!enabled) return;
      setSession((previous) => {
        if (previous?.owner === owner && previous.entries.length) {
          if (previous.entries.at(-1)?.name === name) return previous;
          const entries = previous.entries.map((entry, index) =>
            index === previous.entries.length - 1 ? { ...entry, scrollTop: scroll.current?.scrollTop ?? 0 } : entry,
          );
          return { ...previous, entries: [...entries, { name, sourceName: sourceName ?? previous.entries.at(-1)?.name, scrollTop: 0 }] };
        }
        trigger.current = element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        restore.current = restoreFocus;
        return { owner, entries: [{ name, sourceName, scrollTop: 0 }] };
      });
    },
    [enabled, owner],
  );
  const value = useMemo(() => ({ enabled, origins, open }), [enabled, origins, open]);
  const active = enabled && session?.owner === owner ? session : undefined;
  return (
    <RecordReadingContext.Provider value={value}>
      {children}
      {active && (
        <RecordReadingDialog
          entries={active.entries}
          scrollRef={scroll}
          onClose={() => setSession(undefined)}
          onBack={() => setSession((previous) => (previous ? { ...previous, entries: previous.entries.slice(0, -1) } : previous))}
          returnFocus={() => {
            if (restore.current) {
              restore.current();
              return false;
            }
            return trigger.current ?? false;
          }}
        />
      )}
    </RecordReadingContext.Provider>
  );
}
