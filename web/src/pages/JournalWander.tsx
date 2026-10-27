import { ArrowLeftIcon, MapIcon, RotateCcwIcon, Settings2Icon, ShuffleIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import JournalMemo from "@/components/JournalMemo";
import MemoContent from "@/components/MemoContent";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import WanderConnection from "@/components/WanderConnection";
import WanderMap, { type WanderMapEdge, type WanderMapNode } from "@/components/WanderMap";
import WanderSettings from "@/components/WanderSettings";
import { journalRequest } from "@/hooks/useJournalQueries";
import useMediaQuery from "@/hooks/useMediaQuery";
import { resetWander, useWanderStatus, type WanderNeighborhood, type WanderOriginal, wanderKeys } from "@/hooks/useWanderQueries";
import { useWanderTrail } from "@/hooks/useWanderTrail";
import type { WanderPosition } from "@/lib/wander";
import { ROUTES } from "@/router/routes";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

function Original({ value, memo, blurred }: { value: WanderOriginal; memo: Memo | null | undefined; blurred: boolean }) {
  if (memo && (value.truncated ? memo.content.startsWith(value.content) : memo.content === value.content))
    return <JournalMemo memo={memo} continuous />;
  if (blurred)
    return (
      <p role="status" className="py-6 text-sm text-muted-foreground">
        正在核对这篇记录的阅读设置…
      </p>
    );
  return (
    <article className="rounded-xl border border-border/60 bg-card px-5 py-5 sm:px-7 sm:py-6">
      <Link
        to={`/${value.name}`}
        className="mb-4 inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <time dateTime={new Date(value.createdTs * 1000).toISOString()}>
          {new Date(value.createdTs * 1000).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
        </time>
      </Link>
      <MemoContent memoName={value.name} parentPage={ROUTES.JOURNAL_WANDER} content={value.content} attachments={[]} readonly />
      {value.truncated && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          正在接上后面的原文…
        </p>
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
  const trail = useWanderTrail();
  const status = useWanderStatus();
  const desktop = useMediaQuery("md");
  const [settings, setSettings] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapName, setMapName] = useState("");
  const [restore, setRestore] = useState<WanderPosition>();
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState<{ source: string; target: string }>();
  const elements = useRef(new Map<string, HTMLDivElement>());
  const opener = useRef<HTMLElement | null>(null);
  const mapPosition = useRef<WanderPosition | undefined>(undefined);
  const mapDestination = useRef<string | undefined>(undefined);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const captureLatest = useRef<() => WanderPosition | undefined>(() => undefined);
  const initialized = useRef(false);
  const active = trail.entries.find((entry) => entry.original.name === mapName) ?? trail.entries[0];

  const capture = (): WanderPosition | undefined => {
    const sightline = Math.min(window.innerHeight * 0.4, 320);
    const candidates = [...elements.current.entries()].map(([name, element]) => ({ name, rect: element.getBoundingClientRect() }));
    const nearest = candidates.sort(
      (a, b) =>
        Math.max(a.rect.top - sightline, sightline - a.rect.bottom, 0) - Math.max(b.rect.top - sightline, sightline - b.rect.bottom, 0),
    )[0];
    return nearest ? { name: nearest.name, offset: nearest.rect.top, scrollY: window.scrollY } : undefined;
  };
  captureLatest.current = capture;
  useLayoutEffect(
    () => () => {
      const position = captureLatest.current();
      if (position) trail.savePosition(position);
    },
    [trail.savePosition],
  );
  useLayoutEffect(() => {
    if (!initialized.current && trail.entries.length) {
      initialized.current = true;
      if (trail.session?.position) setRestore(trail.session.position);
    }
    if (!restore || mapOpen) return;
    const element = elements.current.get(restore.name);
    if (!element) return;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - restore.offset, behavior: "instant" });
    (restoreFocus.current?.isConnected ? restoreFocus.current : element).focus({ preventScroll: true });
    restoreFocus.current = null;
    setRestore(undefined);
  }, [restore, mapOpen, trail.entries, trail.session?.position]);
  useEffect(() => {
    if (mapOpen && !trail.entries.some((entry) => entry.original.name === mapName)) setMapOpen(false);
  }, [mapOpen, mapName, trail.entries]);

  const openMap = (trigger: HTMLElement, from?: string) => {
    const position = capture();
    if (!position) return;
    mapPosition.current = position;
    opener.current = trigger;
    mapDestination.current = undefined;
    setMapName(from ?? position.name);
    setMapOpen(true);
  };
  const finishMap = (open: boolean) => {
    if (open) return;
    const target = mapDestination.current;
    const toolbarHeight = document.querySelector('[aria-label="漫步阅读工具"]')?.getBoundingClientRect().height ?? 56;
    const position = target ? { name: target, offset: desktop ? 80 : 64 + toolbarHeight, scrollY: 0 } : mapPosition.current;
    if (position) setRestore(position);
    restoreFocus.current = target ? null : opener.current;
    mapDestination.current = undefined;
  };
  const choose = async (source: string, target: string) => {
    if (!mapPosition.current) return;
    if (target === mapName) {
      setMapOpen(false);
      return;
    }
    if (await trail.choose(source, target, mapPosition.current)) {
      mapDestination.current = target;
      setMapOpen(false);
      setMessage("原文已经在这里，可以接着读。");
    }
  };
  const feedback = async (source: string, target: string, dismiss: boolean) => {
    try {
      await journalRequest("/wander/feedback", { method: "POST", body: JSON.stringify({ source, target, dismiss }) });
      setDismissed(dismiss ? { source, target } : undefined);
      resetWander(trail.client);
    } catch {
      setMessage("这次反馈没有保存，请稍后重试。");
    }
  };
  const restart = async () => {
    const name = await trail.start();
    setDismissed(undefined);
    if (name) setRestore({ name, offset: desktop ? 80 : 124, scrollY: 0 });
  };

  const mapNodes: WanderMapNode[] = [];
  const mapEdges: WanderMapEdge[] = [];
  if (active && !trail.hidden(active.original)) {
    const current = active.original.name;
    const visiblePath = [active, ...trail.entries.filter((entry) => entry.original.name !== current).slice(-3)];
    for (const entry of visiblePath) {
      if (!trail.hidden(entry.original)) mapNodes.push({ original: entry.original, source: current, label: "来路与小径" });
      if (entry.source) mapEdges.push({ source: entry.source, target: entry.original.name, inPath: true });
    }
    for (const direction of active.neighborhood?.directions ?? []) {
      const cached = trail.client.getQueryData<WanderNeighborhood>(wanderKeys.node(trail.owner, direction.original.name));
      if (
        trail.hidden(direction.original) ||
        trail.memos.get(direction.original.name) === null ||
        (cached && (!cached.root || trail.hidden(cached.root) || cached.epoch !== active.neighborhood?.epoch))
      )
        continue;
      if (!mapNodes.some((node) => node.original.name === direction.original.name))
        mapNodes.push({ original: cached?.root ?? direction.original, source: current, label: "一条岔路" });
      if (
        !mapEdges.some(
          (edge) =>
            (edge.source === current && edge.target === direction.original.name) ||
            (edge.target === current && edge.source === direction.original.name),
        )
      )
        mapEdges.push({ source: current, target: direction.original.name, inPath: false });
    }
  }
  const visibleNames = new Set(mapNodes.map((node) => node.original.name));
  const available = trail.entries.length > 0;
  const last = trail.entries.at(-1);

  return (
    <div className="mx-auto max-w-3xl pb-16 pt-2 sm:pt-7">
      <Link to={ROUTES.JOURNAL} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" />
        探索
      </Link>
      <header className="mb-5">
        <p className="mb-2 text-xs tracking-widest text-muted-foreground">在散落的记录之间</p>
        <h1 className="font-content text-3xl font-medium">随机漫步</h1>
        <p className="mt-3 text-sm text-muted-foreground">顺着这些原话，慢慢读。</p>
      </header>
      <div
        className="sticky top-12 z-20 mb-5 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background py-2 md:top-0"
        aria-label="漫步阅读工具"
      >
        <div className="flex items-center gap-1">
          {!!trail.session?.returns.length && (
            <Button
              variant="quiet"
              disabled={!trail.online}
              onClick={() => {
                const position = trail.back();
                if (position) setRestore(position);
              }}
            >
              <ArrowLeftIcon />
              回到刚才
            </Button>
          )}
          <Button
            variant="quiet"
            disabled={trail.pending || !trail.online}
            onClick={() => {
              void restart();
            }}
          >
            <ShuffleIcon />
            换个起点
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="quiet"
            aria-haspopup="dialog"
            aria-expanded={mapOpen}
            disabled={!available || !trail.online || Boolean(active && trail.hidden(active.original))}
            onClick={(event) => openMap(event.currentTarget)}
          >
            <MapIcon />
            附近地图
          </Button>
          <Button variant="quiet" size="icon" aria-label="关联准备设置" aria-expanded={settings} onClick={() => setSettings(!settings)}>
            <Settings2Icon />
          </Button>
        </div>
      </div>
      {settings && <WanderSettings onClose={() => setSettings(false)} />}
      {status.data && stateText[status.data.state] && (
        <p role="status" className="mb-5 text-sm leading-6 text-muted-foreground">
          {stateText[status.data.state]}
        </p>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
      {!trail.ready ? (
        <p role="status" className="py-12 text-muted-foreground">
          正在核对阅读设置…
        </p>
      ) : !trail.online ? (
        <p role="status" className="py-12 text-muted-foreground">
          网络恢复后会核对记录的最新状态，再继续漫步。
        </p>
      ) : (
        <>
          {(trail.error || trail.failed) && (
            <div role="alert" className="mb-5 flex items-center gap-3 text-sm">
              <p>{trail.error || "这段原文暂时无法核对，已读的内容仍留在这里。"}</p>
              <Button
                variant="quiet"
                onClick={() => {
                  if (trail.session) resetWander(trail.client);
                  else void restart();
                }}
              >
                <RotateCcwIcon />
                重试
              </Button>
            </div>
          )}
          {dismissed && (
            <div role="status" className="mb-5 flex items-center gap-3 text-sm text-muted-foreground">
              已隐藏这条关联。
              <Button variant="quiet" onClick={() => void feedback(dismissed.source, dismissed.target, false)}>
                撤销
              </Button>
            </div>
          )}
          <div aria-label="连续原文" className="space-y-3">
            {trail.entries.map((entry, index) => {
              const name = entry.original.name;
              const key = `${entry.source}:${name}`;
              const resuming = index > 0 && entry.source !== trail.entries[index - 1].original.name;
              const forks =
                entry.neighborhood?.directions.filter(
                  (direction) => !trail.session?.history.includes(direction.original.name) && !trail.hidden(direction.original),
                ) ?? [];
              return (
                <div
                  key={name}
                  ref={(element) => {
                    if (element) elements.current.set(name, element);
                    else elements.current.delete(name);
                  }}
                  tabIndex={-1}
                  data-wander-original={name}
                  className="outline-none"
                >
                  {resuming && (
                    <p className="mb-3 pt-2 text-xs text-muted-foreground">
                      {entry.direction ? "再顺着前面的记录，看看另一处。" : "刚才读过的原文"}
                    </p>
                  )}
                  {entry.direction && (
                    <WanderConnection
                      direction={entry.direction}
                      open={trail.session?.hints.includes(key) ?? false}
                      onToggle={(open) => trail.toggleHint(key, open)}
                      onDismiss={() => entry.source && void feedback(entry.source, name, true)}
                    />
                  )}
                  <Original value={entry.original} memo={trail.memos.get(name)} blurred={trail.hidden(entry.original)} />
                  {forks.length > 0 && !trail.hidden(entry.original) && (
                    <div className="ml-3 py-2">
                      <Button variant="quiet" size="sm" onClick={(event) => openMap(event.currentTarget, name)}>
                        ↳ 附近还有别的记录
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!available && (trail.empty || (!trail.loading && !trail.pending && trail.session)) ? (
            <p className="py-12 text-muted-foreground">暂时没有可读的原文，可以换个起点。</p>
          ) : (
            !available &&
            !trail.error && (
              <div role="status" className="min-h-64 rounded-xl bg-muted/40 p-6 text-sm text-muted-foreground">
                正在打开原文…
              </div>
            )
          )}
          {available && trail.loading && (
            <p role="status" className="py-5 text-sm text-muted-foreground">
              正在接上附近的原文…
            </p>
          )}
          {available && !trail.loading && !trail.hidden(last!.original) && (
            <div className="mt-9 border-t border-border/60 px-5 py-9 text-center">
              <p className="font-content text-xl">这条小径，先到这里。</p>
              <p className="mt-3 text-sm text-muted-foreground">刚才读到的，可以再留一会儿。</p>
              <div className="mt-5">
                <Button variant="quiet" disabled={trail.pending} onClick={() => void restart()}>
                  去别处看看 <ShuffleIcon />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <Sheet open={mapOpen} onOpenChange={setMapOpen} onOpenChangeComplete={finishMap}>
        <SheetContent side={desktop ? "right" : "bottom"} size="reading" closeLabel="收起附近地图" finalFocus={false}>
          <SheetHeader>
            <div className="pr-12">
              <SheetTitle>这一带的小径</SheetTitle>
            </div>
            <SheetDescription>原话是路标。点一篇，回到完整原文接着读。</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
            {mapNodes.length ? (
              <WanderMap
                current={mapName}
                nodes={mapNodes}
                edges={mapEdges.filter((edge) => visibleNames.has(edge.source) && visibleNames.has(edge.target))}
                disabled={trail.pending}
                onChoose={(source, target) => void choose(source, target)}
              />
            ) : (
              <p className="py-8 text-sm text-muted-foreground">正在核对附近的原文；可以先回去继续读。</p>
            )}
            {trail.error && (
              <p role="alert" className="py-3 text-sm text-muted-foreground">
                {trail.error}
              </p>
            )}
          </div>
          <SheetFooter>
            <p className="text-xs text-muted-foreground">实线是这次的小径，虚线是另一条联系。</p>
            <SheetClose render={<Button variant="quiet" />}>回到原文</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
