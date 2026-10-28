import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useJournalSession } from "@/contexts/JournalSessionContext";
import useMediaQuery from "@/hooks/useMediaQuery";
import {
  type PreparationFilter,
  type PreparationJob,
  type PreparationRetry,
  usePreparationAttempts,
  usePreparationJobs,
  useRetryPreparation,
} from "@/hooks/useWanderPreparation";
import { useWanderStatus, type WanderStatus } from "@/hooks/useWanderQueries";
import { isMemoBlurred } from "@/lib/tag";
import { cn } from "@/lib/utils";

const stages: Record<string, string> = {
  embedding: "理解原文",
  facets: "整理关注点",
  "concern-embedding": "准备检索线索",
  relations: "寻找有关记录",
  publish: "保存关联",
  complete: "已完成本轮准备",
};
const reasons: Record<string, string> = {
  "legacy-unknown": "历史版本没有保存详细原因，再次处理后可查看结果。",
  connection: "关联服务暂时未响应，会自动再试。",
  "daily-budget": "剩余应用预算不足下一次处理，额度恢复后自动继续。",
  "cloudflare-daily-quota": "Cloudflare 当日免费额度已达限制，额度恢复后自动继续。",
  configuration: "服务连接需要检查，更新连接后会自动继续。",
  "generation-incomplete": "这次模型回复没有完整结束。",
  "result-schema": "这次模型回复的格式未通过检查。",
  "response-json": "这次模型回复无法读取。",
  "quote-mismatch": "这次关联的引文未能与原文逐字对应，结果未采用。",
  "embedding-count": "这次语义结果不完整。",
  "embedding-dimensions": "这次语义结果的格式不符合要求。",
  "embedding-zero": "这次语义结果未通过有效性检查。",
  "embedding-nonfinite": "这次语义结果未通过有效性检查。",
  "response-too-large": "这次模型回复超出了处理范围。",
  "source-changed": "原文或阅读设置已更新，将使用最新内容继续。",
  cancelled: "上次处理被中断，会从已保存的进度继续。",
  internal: "后台处理中断，详细原因尚待确认。",
};
const labels: Record<PreparationFilter, string> = { attention: "暂未完成", preparing: "准备中", quota: "等额度", ready: "已准备" };
const number = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const at = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function preparationMessage(status: WanderStatus): string {
  switch (status.state) {
    case "unconfigured":
      return "连接 Cloudflare 后，会在后台逐步准备关联。";
    case "paused":
      return "后台准备已暂停，已准备的线索仍可阅读。";
    case "configuration-error":
      return "关联服务暂不可用，需要检查连接。";
    case "connection-wait":
      return `关联服务暂时未响应，${at(status.blockers?.find((b) => b.code === "connection")?.until ?? status.resetAt)} 起自动再试。`;
    case "quota-paused":
      return `今天的关联准备先歇一歇，${at(status.resetAt)} 起自动继续。`;
    case "delayed":
      return `有 ${status.progress?.attention ?? status.counts.failed} 篇暂未完成关联准备，已有的线索仍可阅读。`;
    case "preparing":
      return `已准备 ${status.progress?.ready ?? status.counts.ready} 篇，更多关联正在后台整理。`;
    default:
      return "本轮关联准备已完成；没有可靠关联的记录也会保留原样。";
  }
}

function AttemptDetails({ job, open }: { job: PreparationJob; open: boolean }) {
  const history = usePreparationAttempts(job.name, open);
  if (!open) return null;
  return (
    <div className="space-y-3 py-2 text-xs leading-6 text-muted-foreground">
      {history.isPending && <p>正在读取处理详情…</p>}
      {history.isError && (
        <p>
          暂时读不到处理详情。
          <Button variant="quiet" size="touch" onClick={() => void history.refetch()}>
            重新读取
          </Button>
        </p>
      )}
      {history.data?.pages.every((page) => page.attempts.length === 0) && <p>暂无详细尝试记录。旧版本的历史原因未记录。</p>}
      {history.data?.pages
        .flatMap((page) => page.attempts)
        .map((attempt) => (
          <div key={attempt.id} className="border-l border-border pl-3">
            <p>
              {at(attempt.startedTs / 1000)} · {stages[attempt.stage] ?? "后台处理"} ·{" "}
              {attempt.outcome === "succeeded" ? "通过检查" : attempt.outcome === "pending" ? "等待结算" : "未完成"}
            </p>
            {attempt.errorCode && <p>{reasons[attempt.errorCode] ?? "本次处理未完成。"}</p>}
            <p>
              {attempt.usageKind === "known"
                ? "按返回用量结算"
                : attempt.usageKind === "estimated"
                  ? "按输入保守估算"
                  : "用量待确认，保留预留"}
              ：{number(attempt.chargedUnits / 1_000_000)} Neurons
            </p>
            {attempt.usageKind === "known" && (
              <p>
                输入 {attempt.inputTokens} / 输出 {attempt.outputTokens} tokens
              </p>
            )}
            <p className="break-all">
              {attempt.httpStatus ? `HTTP ${attempt.httpStatus} · ` : ""}
              {attempt.providerCode ? `服务代码 ${attempt.providerCode} · ` : ""}错误类型：{attempt.errorCode ?? "无"}
            </p>
            {attempt.requestId && <p className="break-all">请求标识：{attempt.requestId}</p>}
          </div>
        ))}
      {history.hasNextPage && (
        <Button variant="quiet" size="touch" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          更早的尝试
        </Button>
      )}
    </div>
  );
}

function PreparationContent({ online }: { online: boolean }) {
  const status = useWanderStatus(15_000);
  const { preparation, setPreparation } = useJournalSession();
  const [chosen, setChosen] = useState<PreparationFilter | undefined>(preparation?.filter);
  const filter =
    chosen ??
    ((status.data?.progress.attention ?? 0) > 0
      ? "attention"
      : (status.data?.progress.preparing ?? 0) > 0
        ? "preparing"
        : (status.data?.progress.quota ?? 0) > 0
          ? "quota"
          : "ready");
  const [expanded, setExpanded] = useState(preparation?.expanded ?? "");
  const scroll = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const lastView = useRef(preparation);
  const jobs = usePreparationJobs(filter, online && !expanded);
  lastView.current = { filter, expanded, scroll: scroll.current?.scrollTop ?? preparation?.scroll ?? 0 };
  useLayoutEffect(() => {
    if (!restored.current && jobs.data && scroll.current) {
      scroll.current.scrollTop = preparation?.scroll ?? 0;
      restored.current = true;
    }
  }, [jobs.data, preparation?.scroll]);
  useEffect(() => () => setPreparation(lastView.current), [setPreparation]);
  const retry = useRetryPreparation();
  const retryInput = useRef<PreparationRetry | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [retryError, setRetryError] = useState("");
  const { userTagsSetting, isUserSettingsInitialized } = useAuth();
  const refresh = () => {
    void status.refetch();
    void jobs.refetch();
  };
  const submit = async (job?: PreparationJob) => {
    const name = job?.name;
    if (retryInput.current?.name !== name || !retryInput.current)
      retryInput.current = {
        requestId: crypto.randomUUID(),
        name,
        revision: job?.revision,
        statusVersion: job?.statusVersion,
      };
    setPending(true);
    setMessage("");
    setRetryError("");
    try {
      const receipt = await retry(retryInput.current);
      setMessage(
        `已重新安排 ${receipt.accepted} 篇${receipt.skipped ? `，跳过 ${receipt.skipped} 篇已变化的记录` : ""}。后台会在服务和额度可用时继续。${receipt.more ? "还有未完成项，可继续安排下一批。" : ""}`,
      );
      retryInput.current = undefined;
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "这次安排没有确认，请稍后重试。");
      if (error instanceof Error && "status" in error && error.status === 409) {
        retryInput.current = undefined;
        refresh();
      }
      // Keep the request identity until a receipt is received, including a lost response.
    } finally {
      setPending(false);
    }
  };
  const stale = !online || status.isError || jobs.isError || status.isFetching || jobs.isFetching;
  const data = status.data;
  return (
    <>
      <div
        ref={scroll}
        onScroll={(event) => {
          lastView.current = { filter, expanded, scroll: event.currentTarget.scrollTop };
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6"
        data-preparation-scroll
      >
        {status.isPending && <p className="py-6 text-sm text-muted-foreground">正在读取关联准备情况…</p>}
        {(!online || status.isError || jobs.isError) && (
          <div className="mb-4 text-sm text-muted-foreground" role="status">
            <p>{!online ? "当前离线，显示上次读取的进度。恢复连接后会先核对状态。" : "暂时读不到最新进度，已有内容可能已变化。"}</p>
            <Button variant="quiet" size="touch" disabled={!online} onClick={refresh}>
              刷新进度
            </Button>
          </div>
        )}
        {data && (
          <>
            <p className="mb-4 text-xs text-muted-foreground">更新于 {at(data.updatedTs)}</p>
            <dl className="mb-3 grid grid-cols-4 gap-2" aria-label="关联准备数量">
              {(["ready", "preparing", "quota", "attention"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">
                    {key === "preparing" && ["paused", "configuration-error", "connection-wait"].includes(data.state)
                      ? "待继续"
                      : labels[key]}
                  </dt>
                  <dd className="mt-1 text-2xl tabular-nums">{data.progress[key]}</dd>
                </div>
              ))}
            </dl>
            {data.progress.excluded > 0 && (
              <p className="mb-5 text-xs text-muted-foreground">另有 {data.progress.excluded} 篇不参与关联准备</p>
            )}
            <div className="mb-5 space-y-3 rounded-lg bg-muted/40 p-4 text-sm leading-6">
              <p>{preparationMessage(data)}</p>
              {data.state === "configuration-error" && (
                <Link to="/setting#ai" className="inline-flex min-h-11 items-center underline underline-offset-4">
                  检查 AI 服务连接
                </Link>
              )}
              <details>
                <summary className={cn("flex min-h-11 cursor-pointer items-center", FOCUS_VISIBLE_OUTLINE_CLASSES)}>
                  本应用预算占用 {number(data.reservedNeurons)} / {number(data.dailyNeurons)} · 预算说明
                </summary>
                <div className="space-y-2 pt-2 text-xs text-muted-foreground">
                  {data.baseline && <p>本轮对比从 {at(data.baseline.resetAt)} 清账后开始，Cloudflare 当日实际用量不会归零。</p>}
                  <p>Cloudflare 免费额度为 {number(data.cloudflareFreeNeurons)} Neurons / 天。本应用预算是你设定的处理上限。</p>
                  <p>
                    已确认 {number(data.usage.knownNeurons)} · 保守估算 {number(data.usage.estimatedNeurons)} · 请求中预留{" "}
                    {number(data.usage.inFlightNeurons)} · 用量待确认 {number(data.usage.unknownNeurons)}
                  </p>
                  <p>
                    统计日 {data.usage.day}（UTC），{at(data.resetAt)} 起使用下一天预算。占用包含保守预留，不是 Cloudflare
                    账单；同账户其他应用也会消耗免费额度。
                  </p>
                  <a
                    href="https://dash.cloudflare.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    在 Cloudflare 查看实际用量
                  </a>
                </div>
              </details>
            </div>
            {data.progress.total === 0 && <p className="py-6 text-sm text-muted-foreground">还没有参与关联准备的原文。</p>}
          </>
        )}
        <div className="mb-4 grid grid-cols-4 gap-1 border-b border-border pb-2" role="group" aria-label="筛选关联准备记录">
          {(["attention", "preparing", "quota", "ready"] as const).map((key) => (
            <Button
              key={key}
              variant="quiet"
              size="touch"
              aria-pressed={filter === key}
              onClick={() => {
                setChosen(key);
                setExpanded("");
              }}
            >
              {labels[key]}
            </Button>
          ))}
        </div>
        {filter === "attention" && (data?.progress.attention ?? 0) > 0 && data?.state !== "configuration-error" && (
          <Button variant="quiet" size="touch" disabled={pending || stale} onClick={() => void submit()}>
            {pending ? "正在安排…" : "重新安排暂未完成的记录"}
          </Button>
        )}
        {message && (
          <p role="status" className="my-3 text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {retryError && (
          <p role="alert" className="my-3 text-sm text-destructive">
            {retryError}
          </p>
        )}
        {jobs.isPending && <p className="py-6 text-sm text-muted-foreground">正在读取记录…</p>}
        {jobs.data?.pages.every((page) => page.jobs.length === 0) && (
          <p className="py-6 text-sm text-muted-foreground">当前没有{labels[filter]}的记录。</p>
        )}
        {jobs.data?.pages
          .flatMap((page) => page.jobs)
          .map((job) => {
            const blurred = !isUserSettingsInitialized || isMemoBlurred({ tags: job.tags ?? [] }, userTagsSetting);
            return (
              <article key={job.name} className="border-b border-border/60 py-5" data-preparation-job={job.name}>
                <p className="mb-2 text-xs text-muted-foreground">{new Date(job.createdTs * 1000).toLocaleDateString("zh-CN")}</p>
                <p className="font-content text-base leading-7">
                  {blurred ? "这篇记录已按阅读设置隐去内容" : job.preview || "一篇没有文字的记录"}
                </p>
                <div className="mt-3 space-y-1 text-xs leading-6 text-muted-foreground">
                  <p>
                    {stages[job.stage] ?? "等待后台准备"}
                    {job.state === "processing" ? " · 正在处理" : ""}
                  </p>
                  {job.errorCode && <p>{reasons[job.errorCode] ?? "这次处理暂未完成。"}</p>}
                  <p>最后尝试：{job.lastAttemptTs ? at(job.lastAttemptTs) : "未记录"}</p>
                  {job.nextAttemptTs > 0 && (
                    <p>
                      {job.state === "quota" ? "额度恢复后继续" : "下次最早尝试"}：{at(job.nextAttemptTs)}
                    </p>
                  )}
                  {job.state === "attention" && <p>自动尝试暂告一段落。可重新安排，也可以稍后再看。</p>}
                  {job.state === "ready" && <p>已完成本轮检查；只有找到可靠依据时才会建立关联。</p>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link
                    to={`/${job.name}`}
                    className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    查看原文
                  </Link>
                  {job.canRetry && data?.state !== "configuration-error" && (
                    <Button variant="quiet" size="touch" disabled={pending || stale} onClick={() => void submit(job)}>
                      重新尝试
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    size="touch"
                    aria-expanded={expanded === job.name}
                    onClick={() => setExpanded(expanded === job.name ? "" : job.name)}
                  >
                    处理详情{expanded === job.name ? " · 收起" : ""}
                  </Button>
                </div>
                <AttemptDetails job={job} open={expanded === job.name} />
              </article>
            );
          })}
        {jobs.hasNextPage && (
          <div className="pt-4">
            <Button variant="quiet" size="touch" disabled={jobs.isFetchingNextPage} onClick={() => void jobs.fetchNextPage()}>
              更多记录
            </Button>
          </div>
        )}
      </div>
      <SheetFooter>
        <SheetClose render={<Button variant="quiet" size="touch" />}>回到原文</SheetClose>
      </SheetFooter>
    </>
  );
}

export default function WanderPreparation({
  open,
  online,
  onClose,
  onClosed,
}: {
  open: boolean;
  online: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  const desktop = useMediaQuery("md");
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      onOpenChangeComplete={(value) => {
        if (!value) onClosed();
      }}
    >
      <SheetContent side={desktop ? "right" : "bottom"} size="reading" closeLabel="收起关联准备" finalFocus={false}>
        <SheetHeader>
          <div className="pr-12">
            <SheetTitle>关联准备</SheetTitle>
          </div>
          <SheetDescription>原文照常阅读，关联在后台慢慢整理。</SheetDescription>
        </SheetHeader>
        {open && <PreparationContent online={online} />}
      </SheetContent>
    </Sheet>
  );
}
