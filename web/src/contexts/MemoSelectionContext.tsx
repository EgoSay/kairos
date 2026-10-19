import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

// Selection lives at the list level: MemoView wrappers register each rendered
// memo so "select all loaded" and the shared/partial tag split need no extra fetch.
interface MemoSelectionContextValue {
  selecting: boolean;
  selected: ReadonlySet<string>;
  memoFor: (name: string) => Memo | undefined;
  loadedNames: () => string[];
  loadedCount: () => number;
  enter: () => void;
  exit: () => void;
  toggle: (name: string) => void;
  selectMany: (names: Iterable<string>) => void;
  registerMemo: (memo: Memo) => void;
  unregisterMemo: (name: string) => void;
}

const MemoSelectionContext = createContext<MemoSelectionContextValue | undefined>(undefined);

export const MemoSelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const loaded = useRef(new Map<string, Memo>());

  const registerMemo = useCallback((memo: Memo) => {
    loaded.current.set(memo.name, memo);
  }, []);
  const unregisterMemo = useCallback((name: string) => {
    loaded.current.delete(name);
  }, []);
  const memoFor = useCallback((name: string) => loaded.current.get(name), []);
  const loadedNames = useCallback(() => [...loaded.current.keys()], []);
  const loadedCount = useCallback(() => loaded.current.size, []);

  const enter = useCallback(() => setSelecting(true), []);
  const exit = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const toggle = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
    setSelecting(true);
  }, []);
  const selectMany = useCallback((names: Iterable<string>) => {
    setSelected(new Set(names));
    setSelecting(true);
  }, []);

  const value = useMemo(
    () => ({ selecting, selected, memoFor, loadedNames, loadedCount, enter, exit, toggle, selectMany, registerMemo, unregisterMemo }),
    [selecting, selected, memoFor, loadedNames, loadedCount, enter, exit, toggle, selectMany, registerMemo, unregisterMemo],
  );
  return <MemoSelectionContext.Provider value={value}>{children}</MemoSelectionContext.Provider>;
};

// Returns undefined outside a provider so components can stay selection-agnostic.
export const useMemoSelection = () => useContext(MemoSelectionContext);
