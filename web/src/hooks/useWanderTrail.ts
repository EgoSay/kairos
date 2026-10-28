import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useJournalSession } from "@/contexts/JournalSessionContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useSSEConnectionStatus } from "@/hooks/useLiveMemoRefresh";
import { memoDetailQueryOptions } from "@/hooks/useMemoQueries";
import {
  rememberNeighborhood,
  resetWander,
  type WanderNeighborhood,
  wanderKeys,
  wanderNodeOptions,
  wanderStartOptions,
} from "@/hooks/useWanderQueries";
import { isMemoBlurred } from "@/lib/tag";
import { insertWanderBranch, readableWanderTrail, WANDER_AUTOMATIC_LENGTH, WANDER_ROUTE_LIMIT, type WanderPosition } from "@/lib/wander";

/** Bounded continuous reading, sharing the graph's live eligibility and withdrawal lifecycle. */
export function useWanderTrail() {
  const owner = useCurrentUser()?.name ?? "";
  const client = useQueryClient();
  const { graphWalk: session, setGraphWalk: setSession } = useJournalSession();
  const { userTagsSetting, isUserSettingsInitialized } = useAuth();
  const connection = useSSEConnectionStatus();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [empty, setEmpty] = useState(false);
  const operation = useRef(0);
  const starting = useRef(false);
  const names = session?.history ?? [];
  const queries = useQueries({ queries: names.map((name) => wanderNodeOptions(owner, name)) });
  const details = useQueries({ queries: names.map((name) => ({ ...memoDetailQueryOptions(name), staleTime: 0 })) });
  const nodes = new Map(names.map((name, index) => [name, queries[index]?.data]));
  const unavailable = new Set(
    names.filter((name, index) => {
      const memo = details[index]?.data;
      const original = nodes.get(name)?.root;
      const changed =
        memo && original && !(original.truncated ? memo.content.startsWith(original.content) : memo.content === original.content);
      return queries[index]?.isError || memo === null || changed;
    }),
  );
  const hidden = (original: { tags: string[] }) => isMemoBlurred(original, userTagsSetting);
  const entries = online && isUserSettingsInitialized ? readableWanderTrail(session, nodes, hidden, unavailable) : [];
  const epoch = queries[0]?.data?.epoch;

  const start = async () => {
    const seq = ++operation.current;
    setPending(true);
    setError("");
    try {
      const value = await client.fetchQuery(wanderStartOptions(owner, names));
      if (seq !== operation.current) return;
      rememberNeighborhood(client, owner, value);
      setEmpty(!value.root);
      setSession(value.root ? { history: [value.root.name], sources: {}, index: 0, returns: [], hints: [] } : undefined);
      client.removeQueries({ queryKey: ["wander", owner, "start"], exact: true });
      void client.prefetchQuery(wanderStartOptions(owner, [...names, ...(value.root ? [value.root.name] : [])]));
      return value.root?.name;
    } catch (e) {
      if (seq === operation.current) setError(e instanceof Error ? e.message : "暂时无法打开原文。");
    } finally {
      if (seq === operation.current) setPending(false);
    }
  };
  useEffect(() => {
    if (owner && !names.length && !starting.current) {
      starting.current = true;
      void start();
    }
  }, [owner, names.length]);

  // Prepare only direct neighbors of the at most twelve mounted path nodes.
  // A fetched neighbor never starts another recursive prefetch.
  const prepared = queries.map((query) => query.data);
  const preparedVersion = prepared
    .map((node) =>
      node?.root
        ? `${node.root.name}:${node.root.revision}:${node.epoch}:${node.profile}:${node.directions.map((direction) => direction.original.name).join()}`
        : "",
    )
    .join("|");
  useEffect(() => {
    if (!online || !isUserSettingsInitialized) return;
    for (const node of prepared) {
      if (!node?.root || hidden(node.root) || node.epoch !== epoch) continue;
      for (const direction of node.directions) {
        if (hidden(direction.original)) continue;
        const cached = client.getQueryData<WanderNeighborhood>(wanderKeys.node(owner, direction.original.name));
        void client
          .fetchQuery({ ...wanderNodeOptions(owner, direction.original.name), staleTime: cached?.epoch === epoch ? 60_000 : 0 })
          .then((value) => rememberNeighborhood(client, owner, value))
          .catch(() => undefined);
      }
    }
  }, [client, owner, online, isUserSettingsInitialized, userTagsSetting, epoch, preparedVersion]);

  const last = entries.at(-1);
  const lastQuery = queries[names.length - 1];
  const next = last?.neighborhood?.directions.find((direction) => !names.includes(direction.original.name) && !hidden(direction.original));
  useEffect(() => {
    if (!session || !last || entries.length !== names.length || names.length >= WANDER_AUTOMATIC_LENGTH || lastQuery?.isFetching || !next)
      return;
    setSession((current) => {
      if (!current || current.history.join() !== names.join()) return current;
      return {
        ...current,
        history: [...current.history, next.original.name],
        sources: { ...current.sources, [next.original.name]: last.original.name },
      };
    });
  }, [session, last, entries.length, names, lastQuery?.isFetching, next, setSession]);

  useEffect(() => {
    const invalidate = () => {
      if (document.visibilityState === "visible") {
        operation.current++;
        setPending(false);
        resetWander(client);
      }
    };
    const connectivity = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) invalidate();
    };
    document.addEventListener("visibilitychange", invalidate);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => {
      document.removeEventListener("visibilitychange", invalidate);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      operation.current++;
    };
  }, [client]);

  const choose = async (source: string, target: string, position: WanderPosition): Promise<boolean> => {
    if (!session || !online) return false;
    const seq = ++operation.current;
    setError("");
    const sourceNode = client.getQueryData<WanderNeighborhood>(wanderKeys.node(owner, source));
    const cached = client.getQueryData<WanderNeighborhood>(wanderKeys.node(owner, target));
    setPending(!(connection === "connected" && cached?.root && cached.epoch === sourceNode?.epoch));
    try {
      const value =
        connection === "connected" && cached?.root && cached.epoch === sourceNode?.epoch
          ? cached
          : await client.fetchQuery({ ...wanderNodeOptions(owner, target), staleTime: 0 });
      if (seq !== operation.current) return false;
      const latestSource = client.getQueryData<WanderNeighborhood>(wanderKeys.node(owner, source));
      const edge = latestSource?.directions.find((direction) => direction.original.name === target);
      const alreadyVisible = entries.some((entry) => entry.original.name === target);
      if (
        !value.root ||
        !latestSource?.root ||
        (!edge && !alreadyVisible) ||
        value.epoch !== latestSource.epoch ||
        hidden(value.root) ||
        hidden(latestSource.root)
      ) {
        setError("这条记录或关联已经变化，请看看其他方向。");
        return false;
      }
      if (!session.history.includes(target) && session.history.length >= WANDER_ROUTE_LIMIT) {
        setError("这段小径先到这里。可以回看，或换个起点。");
        return false;
      }
      rememberNeighborhood(client, owner, value);
      setSession((current) => {
        if (!current) return current;
        const route = insertWanderBranch(current, source, target, value);
        return {
          ...current,
          ...route,
          index: route.history.indexOf(target),
          returns: [
            ...current.returns,
            { route: { history: current.history, sources: current.sources, index: current.index }, position },
          ].slice(-16),
        };
      });
      return true;
    } catch (e) {
      if (seq === operation.current) setError(e instanceof Error ? e.message : "暂时无法打开这条记录。");
      return false;
    } finally {
      if (seq === operation.current) setPending(false);
    }
  };
  const savePosition = useCallback(
    (position: WanderPosition) => {
      setSession((current) => (current ? { ...current, position } : current));
    },
    [setSession],
  );
  const back = () => {
    const point = session?.returns.at(-1);
    if (!point) return undefined;
    operation.current++;
    setPending(false);
    setSession((current) =>
      current ? { ...current, ...point.route, position: point.position, returns: current.returns.slice(0, -1) } : current,
    );
    return point.position;
  };
  const toggleHint = (key: string, open: boolean) =>
    setSession((current) =>
      current && current.hints.includes(key) !== open
        ? {
            ...current,
            hints: open ? [...current.hints.filter((value) => value !== key), key] : current.hints.filter((value) => value !== key),
          }
        : current,
    );
  const memos = useMemo(() => new Map(names.map((name, index) => [name, details[index]?.data])), [names, details]);
  return {
    owner,
    client,
    session,
    entries,
    nodes,
    memos,
    online,
    pending,
    error,
    empty,
    start,
    choose,
    back,
    savePosition,
    toggleHint,
    hidden,
    ready: isUserSettingsInitialized,
    loading: queries.some((query) => query.isPending),
    failed: queries.some((query) => query.isError),
  };
}
