import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

export default function JournalTrash() {
  const t = useTranslate();
  const owner = useCurrentUser();
  const client = useQueryClient();
  const [purge, setPurge] = useState<string>();
  const records = useQuery({
    queryKey: ["journal", owner?.name, "trash"],
    queryFn: () => journalRequest<{ memos: JsonValue[] }>("/trash"),
  });
  const action = useMutation({
    mutationFn: ({ name, permanent }: { name: string; permanent?: boolean }) =>
      journalRequest(`/trash/${encodeURIComponent(name.replace(/^memos\//, ""))}${permanent ? "" : "/restore"}`, {
        method: permanent ? "DELETE" : "POST",
      }),
    onSuccess: () => setPurge(undefined),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ["journal"] });
      await client.invalidateQueries({ queryKey: ["memos"] });
      await client.invalidateQueries({ queryKey: ["attachments"] });
    },
  });
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-8">
      <Link to="/" className="text-sm text-muted-foreground underline">
        {t("journal.back-to-records")}
      </Link>
      <header>
        <h1 className="text-2xl">{t("journal.trash")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("journal.trash-description")}</p>
      </header>
      {records.isPending && <p role="status">{t("journal.loading")}</p>}
      {records.isError && <p role="alert">{records.error.message}</p>}
      {!records.isPending && !records.data?.memos.length && <p className="text-muted-foreground">{t("journal.trash-empty")}</p>}
      {records.data?.memos.map((raw) => {
        const memo = fromJson(MemoSchema, raw);
        return (
          <article className="space-y-3 rounded-xl border p-5" key={memo.name}>
            <p className="whitespace-pre-wrap break-words leading-7">{memo.content || t("journal.media-record")}</p>
            {memo.attachments.length > 0 && (
              <p className="text-sm text-muted-foreground">{t("journal.trash-attachments-restore", { count: memo.attachments.length })}</p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ name: memo.name })}>
                {t("common.restore")}
              </Button>
              <Button variant="ghost" disabled={action.isPending} onClick={() => setPurge(memo.name)}>
                {t("journal.trash-delete")}
              </Button>
            </div>
          </article>
        );
      })}
      {action.isError && (
        <p role="alert" className="text-destructive">
          {action.error.message}
        </p>
      )}
      <Dialog
        open={Boolean(purge)}
        onOpenChange={(open) => {
          if (!open) setPurge(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("journal.trash-delete-title")}</DialogTitle>
            <DialogDescription>{t("journal.trash-delete-description")}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPurge(undefined)}>
              {t("journal.trash-keep")}
            </Button>
            <Button
              variant="destructive"
              disabled={action.isPending}
              onClick={() => purge && action.mutate({ name: purge, permanent: true })}
            >
              {t("journal.trash-delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
