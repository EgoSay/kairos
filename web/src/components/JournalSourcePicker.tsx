import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { memoServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { memoKeys } from "@/hooks/useMemoQueries";
import i18n from "@/i18n";
import { buildTimestampRangeFilter } from "@/lib/calendar-utils";
import { combineCELFilters } from "@/lib/cel-filter";
import { journalDayRange } from "@/lib/journal";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { State } from "@/types/proto/api/v1/common_pb";
import { useTranslate } from "@/utils/i18n";

/** Explicit source selection; changing a query never expands the selected set. */
export default function JournalSourcePicker({
  selected,
  onChange,
  disabled = false,
  allowArchived = true,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  allowArchived?: boolean;
}) {
  const t = useTranslate();
  const user = useCurrentUser();
  const preferences = useJournalPreferences();
  const timezone = preferences.data?.timezone || "Asia/Shanghai";
  const [draftQuery, setDraftQuery] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [query, setQuery] = useState({ text: "", from: "", to: "" });
  const [dateError, setDateError] = useState("");
  const [archived, setArchived] = useState(false);
  const from = query.from ? journalDayRange(query.from, timezone)?.start : undefined;
  const to = query.to ? journalDayRange(query.to, timezone)?.end : undefined;
  const dateFilter =
    from !== undefined && to !== undefined
      ? buildTimestampRangeFilter("created_ts", { startTimestamp: from, endTimestamp: to })
      : from !== undefined
        ? `created_ts >= timestamp(${from})`
        : to !== undefined
          ? `created_ts < timestamp(${to})`
          : undefined;
  const records = useInfiniteQuery({
    queryKey: [...memoKeys.lists(), "journal-source-picker", user?.name, query, archived, timezone],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      memoServiceClient.listMemos(
        {
          pageToken: pageParam,
          pageSize: 30,
          state: archived ? State.ARCHIVED : State.NORMAL,
          filter: combineCELFilters(
            buildMemoCreatorFilter(user?.name ?? ""),
            query.text ? `content.contains(${JSON.stringify(query.text)})` : undefined,
            dateFilter,
          ),
          orderBy: "create_time desc",
        },
        { signal },
      ),
    getNextPageParam: (page) => page.nextPageToken || undefined,
    enabled: Boolean(user),
  });
  return (
    <section className="space-y-4 [&_button]:min-h-11" aria-label={t("journal.source-label")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (draftFrom && draftTo && draftFrom > draftTo) {
            setDateError(t("journal.source-date-error"));
            return;
          }
          setDateError("");
          setQuery({ text: draftQuery.trim(), from: draftFrom, to: draftTo });
        }}
      >
        <div className="flex gap-2">
          <Input
            aria-label={t("journal.source-search-label")}
            placeholder={t("journal.source-search-placeholder")}
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            disabled={disabled}
          />
          <Button type="submit" variant="outline" disabled={disabled}>
            {t("journal.source-search")}
          </Button>
        </div>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer py-2">{t("journal.source-date-range")}</summary>
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            <label className="space-y-2">
              <span>{t("journal.source-from")}</span>
              <Input type="date" value={draftFrom} disabled={disabled} onChange={(event) => setDraftFrom(event.target.value)} />
            </label>
            <label className="space-y-2">
              <span>{t("journal.source-to")}</span>
              <Input type="date" value={draftTo} disabled={disabled} onChange={(event) => setDraftTo(event.target.value)} />
            </label>
          </div>
          <p className="text-xs">{t("journal.source-date-note", { timezone })}</p>
        </details>
        {dateError && (
          <p role="alert" className="text-sm text-destructive">
            {dateError}
          </p>
        )}
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t("journal.source-selected", { count: selected.length })}</span>
        {allowArchived && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" checked={archived} disabled={disabled} onChange={(e) => setArchived(e.target.checked)} />
            {t("journal.source-archived")}
          </label>
        )}
        {selected.length > 0 && (
          <Button variant="ghost" disabled={disabled} onClick={() => onChange([])}>
            {t("journal.source-clear")}
          </Button>
        )}
      </div>
      {records.isPending && <p role="status">{t("journal.source-loading")}</p>}
      {records.isError && (
        <div role="alert">
          <p>{t("journal.source-error")}</p>
          <Button variant="outline" onClick={() => records.refetch()}>
            {t("journal.retry")}
          </Button>
        </div>
      )}
      <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border/60 p-2">
        {records.data?.pages
          .flatMap((page) => page.memos)
          .filter((memo) => memo.creator === user?.name && !memo.parent)
          .map((memo) => (
            <label key={memo.name} className="flex cursor-pointer items-start gap-3 rounded-sm p-3 hover:bg-muted/40">
              <input
                className="mt-1 size-4"
                type="checkbox"
                checked={selected.includes(memo.name)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(e.target.checked ? [...new Set([...selected, memo.name])] : selected.filter((name) => name !== memo.name))
                }
              />
              <span className="min-w-0">
                <time className="mb-1 block text-xs text-muted-foreground">
                  {memo.createTime
                    ? timestampDate(memo.createTime).toLocaleDateString(i18n.language || "en", { timeZone: timezone })
                    : t("journal.source-date-unknown")}
                </time>
                <span className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed">
                  {memo.content || t("journal.source-media")}
                </span>
              </span>
            </label>
          ))}
        {records.data?.pages[0]?.memos.length === 0 && <p className="p-5 text-sm text-muted-foreground">{t("journal.source-empty")}</p>}
      </div>
      {records.hasNextPage && (
        <Button variant="ghost" disabled={records.isFetchingNextPage} onClick={() => records.fetchNextPage()}>
          {t("journal.source-more")}
        </Button>
      )}
    </section>
  );
}
