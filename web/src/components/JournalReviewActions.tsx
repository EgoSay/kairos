import { EyeOffIcon, SparklesIcon } from "lucide-react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useJournalPreferences, useUpdateJournalPreferences } from "@/hooks/useJournalQueries";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

/** Both the original record and quiet readers expose the same optional actions. */
export default function JournalReviewActions({ name }: { name: string }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const preferences = useJournalPreferences();
  const update = useUpdateJournalPreferences();
  const excluded = preferences.data?.excludedMemoNames.includes(name) ?? false;
  return (
    <>
      <DropdownMenuItem
        disabled={!preferences.data || update.isPending}
        className="min-h-11"
        onClick={() => {
          if (!preferences.data) return;
          const names = new Set(preferences.data.excludedMemoNames);
          if (excluded) names.delete(name);
          else names.add(name);
          update.mutate({ excludedMemoNames: [...names] }, { onError: () => toast.error(t("journal.review-action-error")) });
        }}
      >
        <EyeOffIcon />
        {excluded ? t("journal.review-include") : t("journal.review-exclude")}
      </DropdownMenuItem>
      <DropdownMenuItem className="min-h-11" onClick={() => navigate(`${ROUTES.JOURNAL_INSIGHTS}?${new URLSearchParams({ memo: name })}`)}>
        <SparklesIcon />
        {t("journal.review-ai")}
      </DropdownMenuItem>
    </>
  );
}
