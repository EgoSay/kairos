import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { journalRequest } from "@/hooks/useJournalQueries";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

export default function JournalRecordHistoryDialog({
  name,
  open,
  onOpenChange,
  finalFocus,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslate();
  const uid = encodeURIComponent(name.replace(/^memos\//, ""));
  const client = useQueryClient();
  const versions = useQuery({
    queryKey: ["journal", "revisions", name],
    enabled: open,
    queryFn: () =>
      journalRequest<{
        revisions: { id: string; createdTs: number; memo: JsonValue }[];
        provenance?: { source?: string; modifiedTs?: number; enteredTs?: number; importedTs?: number; imported?: boolean };
      }>(`/memos/${uid}/revisions`),
  });
  const restore = useMutation({
    mutationFn: (id: string) => journalRequest(`/memos/${uid}/revisions/${encodeURIComponent(id)}/restore`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["memos"] }),
        client.invalidateQueries({ queryKey: ["journal"] }),
        client.invalidateQueries({ queryKey: ["journal-partitions"] }),
      ]);
      onOpenChange(false);
    },
  });
  const provenance = versions.data?.provenance;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" initialFocus finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t("journal.recent-versions")}</DialogTitle>
          <DialogDescription>{t("journal.recent-versions-description")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto space-y-3">
          {versions.data && (
            <p className="text-sm text-muted-foreground">
              {t("journal.version-source", {
                source: t(
                  provenance?.imported
                    ? "journal.source-import"
                    : provenance?.source === "manual"
                      ? "journal.source-manual"
                      : "journal.source-legacy",
                ),
              })}
              {provenance?.enteredTs
                ? t("journal.entered-at", { time: new Date(provenance.enteredTs * 1000).toLocaleString() })
                : provenance?.importedTs
                  ? t("journal.imported-at", { time: new Date(provenance.importedTs * 1000).toLocaleString() })
                  : ""}
              {provenance?.modifiedTs ? t("journal.modified-at", { time: new Date(provenance.modifiedTs * 1000).toLocaleString() }) : ""}
            </p>
          )}
          {versions.isPending && <p role="status">{t("journal.loading")}</p>}
          {versions.isError && (
            <div className="space-y-2">
              <p role="alert">{t("journal.versions-error")}</p>
              <Button variant="outline" disabled={versions.isFetching} onClick={() => void versions.refetch()}>
                {versions.isFetching ? t("journal.retrying") : t("journal.retry")}
              </Button>
            </div>
          )}
          {versions.isSuccess && versions.data.revisions.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("journal.no-versions")}</p>
          )}
          {versions.data?.revisions.map((version) => {
            const memo = fromJson(MemoSchema, version.memo);
            return (
              <details key={version.id} className="rounded-lg border p-3">
                <summary className="cursor-pointer py-2">
                  {new Date(version.createdTs * 1000).toLocaleString()} ·{" "}
                  {t("journal.attachments-count", { count: memo.attachments.length })}
                </summary>
                <p className="whitespace-pre-wrap break-words py-3 leading-7">{memo.content || t("journal.media-record")}</p>
                <Button variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(version.id)}>
                  {t("journal.restore-version")}
                </Button>
              </details>
            );
          })}
          {restore.isError && (
            <p role="alert" className="text-sm text-destructive">
              {restore.error.message}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
