import { journalRequest } from "@/hooks/useJournalQueries";
import type { MapPoint } from "./types";

/** Explicit lookup only: opening an editor must not send its saved coordinates
 * to an external provider or silently replace a private, user-written name. */
export const lookupLocationName = (point: MapPoint, signal?: AbortSignal) =>
  journalRequest<{ name: string }>("/locations/reverse", {
    method: "POST",
    signal,
    body: JSON.stringify({ latitude: point.lat, longitude: point.lng }),
  });
