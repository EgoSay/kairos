import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";

export interface NamedPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  nameOnly?: boolean;
}
export interface PlaceCandidate {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}
export interface JournalLocations {
  places: NamedPlace[];
  version: number;
  recent: NamedPlace[];
}
export function useJournalLocations(open: boolean) {
  const user = useCurrentUser();
  const client = useQueryClient();
  const key = ["journal", "locations", user?.name] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => journalRequest<JournalLocations>("/locations", { signal }),
    enabled: open && Boolean(user),
    // Other record save/restore paths change recent places. Reopening must
    // refresh them even when the previous dialog showed an empty result.
    staleTime: 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (value: Pick<JournalLocations, "places" | "version">) =>
      journalRequest<Pick<JournalLocations, "places" | "version">>("/locations", {
        method: "PUT",
        body: JSON.stringify(value),
      }),
    onSuccess: (value) => client.setQueryData<JournalLocations>(key, (previous) => ({ ...value, recent: previous?.recent ?? [] })),
    onError: () => {
      void client.invalidateQueries({ queryKey: key });
    },
  });
  return { ...query, save };
}
export const searchPublicPlaces = (query: string, signal: AbortSignal) =>
  journalRequest<{ places: PlaceCandidate[] }>("/locations/search", { method: "POST", signal, body: JSON.stringify({ query }) });
