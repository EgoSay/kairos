import { ArrowUpRightIcon, BookOpenIcon, ShuffleIcon, SparklesIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useJournalSession } from "@/contexts/JournalSessionContext";
import { useJournalPreferences, useUpdateJournalPreferences } from "@/hooks/useJournalQueries";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

export default function JournalExplore() {
  const t = useTranslate();
  const journeys = [
    {
      to: ROUTES.JOURNAL_REVIEW,
      icon: BookOpenIcon,
      title: t("journal.daily-review"),
      description: t("journal.review-desc"),
    },
    {
      to: ROUTES.JOURNAL_WANDER,
      icon: ShuffleIcon,
      title: t("journal.random-walk"),
      description: t("journal.walk-desc"),
    },
    {
      to: ROUTES.JOURNAL_INSIGHTS,
      icon: SparklesIcon,
      title: t("journal.ai-insights"),
      description: t("journal.insights-desc"),
    },
  ];
  const preferences = useJournalPreferences();
  const update = useUpdateJournalPreferences();
  const { setWander, setReviewDay } = useJournalSession();
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="mx-auto w-full max-w-2xl pb-12 pt-5 sm:pt-10 [&_button]:min-h-11">
      <header className="mb-10 px-1">
        <h1 className="font-content text-3xl font-medium">{t("journal.explore")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("journal.explore-tagline")}</p>
      </header>
      <div className="divide-y divide-border/65 rounded-xl border border-border/65 bg-card px-5 sm:px-7">
        {journeys.map(({ to, icon: Icon, title, description }) => (
          <Link
            key={to}
            to={to}
            onClick={() => {
              if (to === ROUTES.JOURNAL_WANDER) setWander(undefined);
              if (to === ROUTES.JOURNAL_REVIEW) setReviewDay(undefined);
            }}
            className="group flex min-h-32 items-center gap-5 rounded-sm py-6 outline-offset-4 focus-visible:outline-2"
          >
            <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <div className="flex-1">
              <h2 className="text-lg font-medium">{title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            <ArrowUpRightIcon className="size-4 text-muted-foreground/60 group-hover:text-foreground" />
          </Link>
        ))}
      </div>
      <details className="mt-10 px-1 text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-lg py-3 focus-visible:outline-2">{t("journal.calendar-prefs")}</summary>
        <div className="space-y-4 py-3">
          {preferences.isPending && <p role="status">{t("journal.settings-loading")}</p>}
          {preferences.isError && (
            <Button variant="outline" onClick={() => preferences.refetch()}>
              {t("journal.settings-retry")}
            </Button>
          )}
          {preferences.data && (
            <>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={preferences.data.calendarVisible}
                  disabled={update.isPending}
                  onChange={(event) => update.mutate({ calendarVisible: event.target.checked })}
                />
                {t("journal.calendar-show")}
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={preferences.data.calendarColor}
                  disabled={update.isPending}
                  onChange={(event) => update.mutate({ calendarColor: event.target.checked })}
                />
                {t("journal.calendar-color")}
              </label>
              <label className="block space-y-2">
                <span>{t("journal.calendar-timezone")}</span>
                <select
                  className="min-h-11 w-full rounded-sm border border-border bg-background px-3 text-foreground"
                  value={preferences.data.timezone}
                  disabled={update.isPending}
                  onChange={(event) => update.mutate({ timezone: event.target.value })}
                >
                  {[
                    ...new Set([
                      preferences.data.timezone,
                      deviceTimezone,
                      "Asia/Shanghai",
                      "UTC",
                      "Asia/Tokyo",
                      "Europe/London",
                      "Europe/Paris",
                      "America/New_York",
                      "America/Los_Angeles",
                      "Australia/Sydney",
                    ]),
                  ].map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                      {timezone === deviceTimezone ? t("journal.this-device") : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs leading-6">{t("journal.timezone-note")}</p>
              {preferences.data.excludedMemoNames.length > 0 && (
                <div className="space-y-3">
                  <p>{t("journal.excluded-records")}</p>
                  {preferences.data.excludedMemoNames.map((name) => (
                    <div key={name} className="flex items-center justify-between gap-3">
                      <Link className="underline underline-offset-4" to={`/${name}`}>
                        {t("journal.open-original")}
                      </Link>
                      <Button
                        variant="ghost"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ excludedMemoNames: preferences.data?.excludedMemoNames.filter((value) => value !== name) })
                        }
                      >
                        {t("journal.restore-visible")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {update.isError && (
            <p role="alert" className="text-destructive">
              {t("journal.preference-save-error")}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
