import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, GitBranchIcon, RotateCcwIcon, Settings2Icon, ShuffleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import JournalMemo from "@/components/JournalMemo";
import MemoContent from "@/components/MemoContent";
import { Button } from "@/components/ui/button";
import WanderMap from "@/components/WanderMap";
import WanderSettings from "@/components/WanderSettings";
import { useAuth } from "@/contexts/AuthContext";
import { useJournalSession } from "@/contexts/JournalSessionContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";
import { useSSEConnectionStatus } from "@/hooks/useLiveMemoRefresh";
import { memoDetailQueryOptions } from "@/hooks/useMemoQueries";
import {
  rememberNeighborhood,
  resetWander,
  useWanderStatus,
  type WanderDirection,
  type WanderNeighborhood,
  type WanderOriginal,
  wanderKeys,
  wanderNodeOptions,
  wanderStartOptions,
} from "@/hooks/useWanderQueries";
import { isMemoBlurred } from "@/lib/tag";
import { ROUTES } from "@/router/routes";

function Original({ value, compact = false }: { value: WanderOriginal; compact?: boolean }) {
  const { userTagsSetting } = useAuth();
  const { expanded, setExpanded } = useJournalSession();
  const [revealed, setRevealed] = useState(false);
  const hidden = isMemoBlurred({ tags: value.tags ?? [] }, userTagsSetting) && !revealed;
  const detail = useQuery({ ...memoDetailQueryOptions(value.name), staleTime: 60_000 });
  const long = value.content.length > 700;
  const open = expanded.has(value.name);
  if (detail.data && (value.truncated ? detail.data.content.startsWith(value.content) : detail.data.content === value.content)) {
    return (
      <div data-original={value.name}>
        <JournalMemo memo={detail.data} />
      </div>
    );
  }
  return (
    <article className="rounded-xl border border-border/60 bg-card px-5 py-5 sm:px-7 sm:py-6" data-original={value.name}>
      <Link
        to={`/${value.name}`}
        className="mb-4 inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        <time dateTime={new Date(value.createdTs * 1000).toISOString()}>
          {new Date(value.createdTs * 1000).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
        </time>
      </Link>
      {hidden ? (
        <Button variant="outline" onClick={() => setRevealed(true)}>
          显示这篇记录
        </Button>
      ) : (
        <>
          <div className={long && !open ? "relative max-h-64 overflow-hidden" : ""}>
            <MemoContent
              memoName={value.name}
              parentPage={ROUTES.JOURNAL_WANDER}
              content={value.content}
              attachments={[]}
              readonly
              compact={compact}
              contentClassName="leading-8"
            />
            {long && !open && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent" />
            )}
          </div>
          {long && (
            <Button variant="ghost" className="mt-2" aria-expanded={open} onClick={() => setExpanded(value.name, !open)}>
              {open ? "收起原文" : "展开原文"}
            </Button>
          )}
          {value.truncated && (
            <Link className="mt-3 block text-sm underline" to={`/${value.name}`}>
              继续阅读完整记录
            </Link>
          )}
        </>
      )}
    </article>
  );
}
const stateText: Record<string, string> = {
  unconfigured: "原文已经在这里。连接 Cloudflare 后，会在后台逐步准备关联。",
  paused: "关联准备已暂停，已准备的内容仍可阅读。",
  preparing: "正在后台寻找线索，你可以先读原文。",
  "quota-paused": "今天的后台预算已用完，已有的线索仍可继续阅读。",
  delayed: "部分记录暂未处理成功，已有的线索仍可阅读。",
  "configuration-error": "Cloudflare 服务暂不可用，请检查关联设置。",
};

export default function JournalWander() {
  const owner = useCurrentUser()?.name ?? "";
  const client = useQueryClient();
  const { graphWalk, setGraphWalk } = useJournalSession();
  const name = graphWalk?.history[graphWalk.index] ?? "";
  const connection = useSSEConnectionStatus();
  const current = useQuery(wanderNodeOptions(owner, name));
  const status = useWanderStatus();
  const [settings, setSettings] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [empty, setEmpty] = useState(false);
  const [expandedHint, setExpandedHint] = useState<string>();
  const [dismissed, setDismissed] = useState<{ source: string; target: string }>();
  const [online, setOnline] = useState(navigator.onLine);
  const operation = useRef(0);
  const starting = useRef(false);
  const data = current.data;

  const adopt = (value: WanderNeighborhood, restart: boolean) => {
    rememberNeighborhood(client, owner, value);
    setEmpty(!value.root);
    if (value.root)
      setGraphWalk(
        restart || !graphWalk
          ? { history: [value.root.name], index: 0 }
          : {
              history: [...graphWalk.history.slice(0, graphWalk.index + 1), value.root.name].slice(-64),
              index: Math.min(graphWalk.index + 1, 63),
            },
      );
    setExpandedHint(undefined);
  };
  const start = async () => {
    const seq = ++operation.current;
    setPending(true);
    setError("");
    try {
      const value = await client.fetchQuery(wanderStartOptions(owner, graphWalk?.history ?? []));
      if (seq !== operation.current) return;
      adopt(value, true);
      client.removeQueries({ queryKey: ["wander", owner, "start"], exact: true });
      void client.prefetchQuery(wanderStartOptions(owner, [...(graphWalk?.history ?? []), ...(value.root ? [value.root.name] : [])]));
    } catch (e) {
      if (seq === operation.current) setError(e instanceof Error ? e.message : "暂时无法打开");
    } finally {
      if (seq === operation.current) setPending(false);
    }
  };
  useEffect(() => {
    if (owner && !name && !starting.current) {
      starting.current = true;
      void start();
    }
  }, [owner, name]);
  useEffect(() => {
    if (!data?.root) return;
    for (const direction of data.directions)
      void client
        .fetchQuery(wanderNodeOptions(owner, direction.original.name))
        .then((value) => rememberNeighborhood(client, owner, value))
        .catch(() => undefined);
  }, [client, owner, data]);
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
      invalidate();
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
  const follow = async (target: string) => {
    const seq = ++operation.current;
    setError("");
    const cached = client.getQueryData<WanderNeighborhood>(wanderKeys.node(owner, target));
    if (connection === "connected" && cached?.root && cached.epoch === data?.epoch) {
      setPending(false);
      adopt(cached, false);
      return;
    }
    setPending(true);
    try {
      const next = await client.fetchQuery({ ...wanderNodeOptions(owner, target), staleTime: 0 });
      if (seq === operation.current) adopt(next, false);
    } catch (e) {
      if (seq === operation.current) setError(e instanceof Error ? e.message : "暂时无法打开");
    } finally {
      if (seq === operation.current) setPending(false);
    }
  };
  const feedback = async (source: string, target: string, dismiss: boolean) => {
    try {
      await journalRequest("/wander/feedback", { method: "POST", body: JSON.stringify({ source, target, dismiss }) });
      setDismissed(dismiss ? { source, target } : undefined);
      resetWander(client);
    } catch {
      setError("这次反馈没有保存，请稍后重试。");
    }
  };
  const { userTagsSetting, isUserSettingsInitialized } = useAuth();
  const safeDirections =
    data?.directions.filter(
      (d) =>
        !isMemoBlurred({ tags: d.original.tags ?? [] }, userTagsSetting) &&
        !isMemoBlurred({ tags: data.root?.tags ?? [] }, userTagsSetting),
    ) ?? [];
  const direction = (d: WanderDirection, index: number) => (
    <section key={d.original.name} className="rounded-xl border border-border/70 bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted">{index + 1}</span>
        <span>{d.manual ? "你建立的关联" : d.topic}</span>
      </div>
      <p className="mb-3 line-clamp-3 whitespace-pre-wrap font-content text-base leading-7">{d.original.content}</p>
      <button
        type="button"
        className="min-h-11 w-full text-left text-sm leading-6 text-muted-foreground hover:text-foreground"
        aria-expanded={expandedHint === d.original.name}
        onClick={() => setExpandedHint(expandedHint === d.original.name ? undefined : d.original.name)}
      >
        {d.hint} <span aria-hidden="true">{expandedHint === d.original.name ? "−" : "+"}</span>
      </button>
      {expandedHint === d.original.name && (
        <div className="my-3 space-y-3 border-l-2 border-primary/30 pl-3 text-sm leading-6">
          <p className="text-xs text-muted-foreground">这条提示来自两段原文</p>
          <blockquote>“{d.sourceQuote}”</blockquote>
          <blockquote>“{d.targetQuote}”</blockquote>
          {d.context && <p className="text-muted-foreground">{d.context}</p>}
          {!d.manual && (
            <Button variant="ghost" size="sm" onClick={() => data?.root && void feedback(data.root.name, d.original.name, true)}>
              这条关联不贴切
            </Button>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        className="mt-1 min-h-11 w-full justify-between"
        disabled={!online}
        onClick={() => void follow(d.original.name)}
      >
        沿这条线索走走
        <ArrowRightIcon className="size-4" />
      </Button>
    </section>
  );
  return (
    <div className="mx-auto max-w-5xl pb-16 pt-2 sm:pt-7">
      <Link to={ROUTES.JOURNAL} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" />
        探索
      </Link>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs tracking-widest text-muted-foreground">在散落的记录之间</p>
          <h1 className="font-content text-3xl font-medium">随机漫步</h1>
          <p className="mt-3 text-sm text-muted-foreground">从一段原文出发，看看它还通向哪里。</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="关联准备设置" onClick={() => setSettings(!settings)}>
          <Settings2Icon className="size-4" />
        </Button>
      </header>
      {settings && <WanderSettings onClose={() => setSettings(false)} />}
      {status.data && stateText[status.data.state] && (
        <p role="status" className="mb-5 text-sm leading-6 text-muted-foreground">
          {stateText[status.data.state]}
          {status.data.counts.pending > 0 && ` 已准备 ${status.data.counts.ready} 篇。`}
        </p>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!graphWalk || graphWalk.index === 0 || !online}
          onClick={() => {
            operation.current++;
            setPending(false);
            if (graphWalk) setGraphWalk({ ...graphWalk, index: graphWalk.index - 1 });
          }}
        >
          <ArrowLeftIcon className="size-4" />
          回到上一步
        </Button>
        <Button variant="outline" disabled={pending || !online} onClick={() => void start()}>
          <ShuffleIcon className="size-4" />
          换个起点
        </Button>
        {pending && (
          <span role="status" className="text-xs text-muted-foreground">
            正在打开…
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{graphWalk ? `走到第 ${graphWalk.index + 1} 站` : ""}</span>
      </div>
      {!isUserSettingsInitialized ? (
        <p role="status" className="py-12 text-muted-foreground">
          正在核对阅读设置…
        </p>
      ) : !online ? (
        <p role="status" className="py-12 text-muted-foreground">
          网络恢复后会核对记录的最新状态，再继续漫步。
        </p>
      ) : (
        <>
          {(error || current.isError) && (
            <div role="alert" className="mb-5 flex items-center gap-3 text-sm">
              <span>{error || "记录可能已更新，请重新打开。"}</span>
              <Button variant="ghost" onClick={() => (name ? void current.refetch() : void start())}>
                <RotateCcwIcon className="size-4" />
                重试
              </Button>
            </div>
          )}
          {dismissed && (
            <div role="status" className="mb-5 flex items-center gap-3 text-sm text-muted-foreground">
              已隐藏这条关联。
              <Button variant="ghost" onClick={() => void feedback(dismissed.source, dismissed.target, false)}>
                撤销
              </Button>
            </div>
          )}
          {data?.root ? (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <Original key={data.root.name} value={data.root} />
                <p className="mt-3 text-xs leading-5 text-muted-foreground">原文保留自己的语境，关联提示只是一次并读的邀请。</p>
              </div>
              <aside aria-label="与这篇记录相连的线索" className="min-w-0 space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <GitBranchIcon className="size-4" />
                  <span>{safeDirections.length ? "从这里延伸" : "在这里停留也很好"}</span>
                </div>
                {safeDirections.length > 0 && <WanderMap directions={safeDirections} onFollow={(target) => void follow(target)} />}
                {safeDirections.map(direction)}
                {safeDirections.length === 0 && (
                  <p className="rounded-xl border border-dashed p-5 text-sm leading-7 text-muted-foreground">
                    暂时没有找到值得并读的记录。可以换个起点，让这段原文先留在心里。
                  </p>
                )}
              </aside>
            </div>
          ) : empty || data?.state === "unavailable" ? (
            <p className="py-12 text-muted-foreground">
              {empty ? "暂时没有可漫步的记录。写下第一段想法后，再回来看看。" : "这篇记录已变更或不再参与漫步，请换个起点。"}
            </p>
          ) : (
            !error && (
              <div
                role="status"
                className="min-h-64 animate-pulse rounded-xl bg-muted/40 p-6 text-sm text-muted-foreground motion-reduce:animate-none"
              >
                正在打开原文…
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
