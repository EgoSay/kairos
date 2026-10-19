import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-hot-toast";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { journalRequest } from "@/hooks/useJournalQueries";
import { useTranslate } from "@/utils/i18n";

/** Menu commands only: the stable host owns dialogs beyond popup unmount. */
export default function JournalRecordActions({
  name,
  includeDelete = true,
  onOpenHistory,
  onOpenOriginals,
}: {
  name: string;
  includeDelete?: boolean;
  onOpenHistory: () => void;
  onOpenOriginals: () => void;
}) {
  const client = useQueryClient();
  const uid = encodeURIComponent(name.replace(/^memos\//, ""));
  const t = useTranslate();
  const remove = useMutation({
    mutationFn: () => journalRequest(`/memos/${uid}/trash`, { method: "POST" }),
    onSuccess: async () => {
      client.removeQueries({ queryKey: ["memos", "detail", name] });
      await client.invalidateQueries({ queryKey: ["memos"] });
      await client.invalidateQueries({ queryKey: ["journal"] });
      toast.success(t("journal.moved-to-trash"));
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <DropdownMenuItem className="min-h-11" onClick={onOpenHistory}>
        {t("journal.recent-versions")}
      </DropdownMenuItem>
      {includeDelete && (
        <DropdownMenuItem className="min-h-11" disabled={remove.isPending} onClick={() => remove.mutate()}>
          {t("journal.move-to-trash")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem className="min-h-11" onClick={onOpenOriginals}>
        {t("journal.originals")}
      </DropdownMenuItem>
    </>
  );
}
