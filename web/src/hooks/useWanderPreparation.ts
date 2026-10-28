import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";

export type PreparationFilter = "attention" | "preparing" | "quota" | "ready";
export interface PreparationJob {
  name: string;
  preview: string;
  tags: string[];
  createdTs: number;
  revision: number;
  statusVersion: number;
  state: string;
  stage: string;
  errorCode?: string;
  attempts: number;
  lastAttemptTs: number;
  nextAttemptTs: number;
  canRetry: boolean;
}
export interface PreparationAttempt {
  id: string;
  stage: string;
  revision: number;
  outcome: string;
  errorCode?: string;
  requestId?: string;
  httpStatus?: number;
  providerCode?: number;
  startedTs: number;
  finishedTs: number;
  usageKind: string;
  chargedUnits: number;
  inputTokens: number;
  outputTokens: number;
}
export interface PreparationRetry {
  requestId: string;
  name?: string;
  revision?: number;
  statusVersion?: number;
}

export function usePreparationJobs(filter: PreparationFilter, polling: boolean) {
  const owner = useCurrentUser()?.name ?? "";
  return useInfiniteQuery({
    queryKey: ["wander", owner, "preparation", "jobs", filter],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      journalRequest<{ jobs: PreparationJob[]; nextAfter: number }>(`/wander/jobs?state=${filter}&after=${pageParam}`, { signal }),
    getNextPageParam: (page) => page.nextAfter || undefined,
    refetchInterval: polling ? 15_000 : false,
    refetchOnWindowFocus: false,
    enabled: Boolean(owner),
    retry: 1,
  });
}

export function usePreparationAttempts(name: string, open: boolean) {
  const owner = useCurrentUser()?.name ?? "";
  return useInfiniteQuery({
    queryKey: ["wander", owner, "preparation", "attempts", name],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      journalRequest<{ attempts: PreparationAttempt[]; nextCursor: string }>(
        `/wander/jobs/${encodeURIComponent(name.replace("memos/", ""))}/attempts?cursor=${encodeURIComponent(pageParam)}`,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: Boolean(owner && open),
    refetchInterval: open ? 15_000 : false,
    retry: 1,
  });
}

/** Refresh preparation metadata only. A retry must not reset the current reading trail. */
export function useRetryPreparation() {
  const owner = useCurrentUser()?.name ?? "";
  const client = useQueryClient();
  return async (input: PreparationRetry) => {
    const result = await journalRequest<{ accepted: number; skipped: number; more: boolean }>("/wander/retry", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await Promise.all([
      client.invalidateQueries({ queryKey: ["wander", owner, "preparation"] }),
      client.invalidateQueries({ queryKey: ["wander", owner, "status"] }),
    ]);
    return result;
  };
}
