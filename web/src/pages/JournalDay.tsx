import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import JournalMemo from "@/components/JournalMemo";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useInfiniteMemos } from "@/hooks/useMemoQueries";
import { buildTimestampRangeFilter } from "@/lib/calendar-utils";
import { combineCELFilters } from "@/lib/cel-filter";
import { journalDayRange } from "@/lib/journal";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";
import { useTranslate } from "@/utils/i18n";

function DayRecords({ date, timezone }: { date: string; timezone: string }) {
  const user = useCurrentUser();
  const [search] = useSearchParams();
  const scoped = search.get("scoped") === "1";
  const state = scoped && search.get("state") === "archived" ? State.ARCHIVED : State.NORMAL;
  const includeArchived = state !== State.ARCHIVED && (!scoped || search.get("archived") === "1");
  const range = journalDayRange(date, timezone);
  const filter = combineCELFilters(
    scoped ? undefined : buildMemoCreatorFilter(user?.name ?? ""),
    scoped ? (search.get("scope") ?? undefined) : undefined,
    range ? buildTimestampRangeFilter("created_ts", { startTimestamp: range.start, endTimestamp: range.end }) : "false",
  );
  const records = useInfiniteMemos(
    { state, includeArchived, filter, pageSize: 100, orderBy: "create_time desc" },
    { enabled: Boolean(range) },
  );
  const memos = [...new Map(records.data?.pages.flatMap((page) => page.memos).map((memo) => [memo.name, memo]) ?? []).values()]
    .filter((memo) => !memo.parent && (scoped || memo.creator === user?.name))
    .sort(
      (a, b) => (b.createTime ? timestampDate(b.createTime).getTime() : 0) - (a.createTime ? timestampDate(a.createTime).getTime() : 0),
    );
  const pending = records.isPending;
  const failed = records.isError;
  if (!range) return <p className="text-sm text-muted-foreground">这个日期无效。</p>;
  return (
    <>
      {pending && (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          正在翻开记录…
        </p>
      )}
      {failed && (
        <div role="alert" className="py-5">
          <p>暂时没能读取完整记录。</p>
          <Button
            variant="outline"
            onClick={() => {
              void records.refetch();
            }}
          >
            重试
          </Button>
        </div>
      )}
      {!pending && !failed && memos.length === 0 && <p className="py-8 text-sm text-muted-foreground">这一天没有记录。</p>}
      <div className="space-y-5">
        {memos.map((memo) => (
          <JournalMemo key={memo.name} memo={memo} />
        ))}
      </div>
      {records.hasNextPage && (
        <Button
          className="mt-6"
          variant="outline"
          disabled={records.isFetchingNextPage}
          onClick={() => {
            void records.fetchNextPage();
          }}
        >
          继续查看
        </Button>
      )}
    </>
  );
}

export default function JournalDay() {
  const t = useTranslate();
  const { date = "" } = useParams();
  const [search] = useSearchParams();
  const requestedFrom = search.get("from") ?? "";
  const from =
    requestedFrom.startsWith("/") && !requestedFrom.startsWith("//") && !requestedFrom.includes("\\") ? requestedFrom : ROUTES.HOME;
  const preferences = useJournalPreferences();
  return (
    <div className="mx-auto max-w-2xl pb-12 pt-2 sm:pt-7">
      <Link
        to={from}
        className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        {t("journal.records")}
      </Link>
      <h1 className="mb-2 font-content text-3xl font-medium">{date}</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {search.get("scoped") === "1" ? t("journal.day-scoped-note") : t("journal.day-scope-note")}
      </p>
      {preferences.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取设置…
        </p>
      )}
      {preferences.isError && (
        <Button variant="outline" onClick={() => preferences.refetch()}>
          重试
        </Button>
      )}
      {preferences.data && <DayRecords date={date} timezone={preferences.data.timezone} />}
    </div>
  );
}
