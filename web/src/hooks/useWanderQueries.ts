import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";

export interface WanderOriginal {
  name: string;
  content: string;
  createdTs: number;
  revision: number;
  truncated: boolean;
  tags: string[];
}
export interface WanderDirection {
  original: WanderOriginal;
  kind: string;
  hint: string;
  context: string;
  topic: string;
  topicId: string;
  sourceQuote: string;
  targetQuote: string;
  manual: boolean;
}
export interface WanderNeighborhood {
  root: WanderOriginal | null;
  directions: WanderDirection[];
  epoch: number;
  profile: string;
  state: string;
}
export interface WanderConfig {
  providerId: string;
  enabled: boolean;
  freePlanConfirmed: boolean;
  dailyNeurons: number;
  version: number;
}
export interface WanderStatus {
  state: string;
  counts: { total: number; ready: number; pending: number; failed: number };
  reservedNeurons: number;
  dailyNeurons: number;
  resetAt: number;
  error?: string;
}
export const wanderKeys = {
  all: ["wander"] as const,
  owner: (owner: string) => ["wander", owner] as const,
  node: (owner: string, name: string) => ["wander", owner, "node", name] as const,
};

export function wanderNodeOptions(owner: string, name: string) {
  return queryOptions({
    queryKey: wanderKeys.node(owner, name),
    queryFn: async ({ signal }) => {
      const result = await journalRequest<{ neighborhoods: WanderNeighborhood[] }>("/wander/neighborhoods", {
        method: "POST",
        body: JSON.stringify({ names: [name] }),
        signal,
      });
      return result.neighborhoods[0];
    },
    staleTime: 60_000,
    gcTime: 120_000,
    retry: 1,
    refetchOnWindowFocus: false,
    enabled: Boolean(owner && name),
  });
}
export function wanderStartOptions(owner: string, seen: string[] = []) {
  return queryOptions({
    queryKey: ["wander", owner, "start"],
    queryFn: ({ signal }) =>
      journalRequest<WanderNeighborhood>("/wander/start", { method: "POST", body: JSON.stringify({ seen: seen.slice(-32) }), signal }),
    staleTime: 60_000,
    gcTime: 120_000,
    retry: 1,
  });
}
export function rememberNeighborhood(client: QueryClient, owner: string, value: WanderNeighborhood) {
  if (value.root) client.setQueryData(wanderKeys.node(owner, value.root.name), value);
  const entries = client
    .getQueryCache()
    .findAll({ queryKey: wanderKeys.owner(owner) })
    .filter((q) => q.queryKey[2] === "node")
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  let bytes = 0;
  for (const [index, query] of entries.entries()) {
    bytes += JSON.stringify(query.state.data ?? "").length * 2;
    if ((index >= 20 || bytes > 5 * 1024 * 1024) && !query.isActive()) client.removeQueries({ queryKey: query.queryKey, exact: true });
  }
}
export function useWanderWarmup() {
  const owner = useCurrentUser()?.name ?? "";
  const client = useQueryClient();
  useEffect(() => {
    if (!owner) return;
    const timer = window.setTimeout(
      () => {
        void import("@/pages/JournalWander");
        void client.prefetchQuery(wanderStartOptions(owner));
      },
      window.location.pathname === "/journal/wander" ? 0 : 1200,
    );
    return () => window.clearTimeout(timer);
  }, [client, owner]);
}
export function useWanderStatus() {
  const owner = useCurrentUser()?.name ?? "";
  return useQuery({
    queryKey: ["wander", owner, "status"],
    queryFn: ({ signal }) => journalRequest<WanderStatus>("/wander/status", { signal }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled: Boolean(owner),
  });
}

/** Purge sensitive derived content before refreshing after changes, reconnection or visibility changes. */
export function resetWander(client: QueryClient) {
  void client.cancelQueries({ queryKey: wanderKeys.all }).then(() => client.resetQueries({ queryKey: wanderKeys.all }));
}
