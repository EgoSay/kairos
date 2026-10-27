import { createContext, useContext } from "react";

export interface RecordReading {
  enabled: boolean;
  origins: readonly string[];
  open: (name: string, trigger?: HTMLElement, sourceName?: string, restoreFocus?: () => void) => void;
}

export const RecordReadingContext = createContext<RecordReading>({ enabled: false, origins: [], open: () => {} });
export const useRecordReading = () => useContext(RecordReadingContext);

export function isOrdinaryActivation(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
