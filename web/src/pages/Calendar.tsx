import { Navigate, useLocation, useParams } from "react-router-dom";
import { buildCalendarPath, CalendarView, parseCalendarParams } from "@/components/CalendarView";
import type { CalendarRouteParams } from "@/components/CalendarView/paths";
import { Button } from "@/components/ui/button";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { journalDate } from "@/lib/journal";
import { collectionPathForLocation } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

/** `/calendar/:year?/:month?/:day?` — anything that is not a real date lands on this month. */
const Calendar = () => {
  const t = useTranslate();
  const location = useLocation();
  const user = useCurrentUser();
  const preferences = useJournalPreferences();
  const state = parseCalendarParams(useParams<CalendarRouteParams>());
  if (!state) {
    if (user && preferences.isPending) return <p role="status">{t("journal.calendar-settings-loading")}</p>;
    if (user && preferences.isError) return <Button onClick={() => preferences.refetch()}>{t("journal.calendar-settings-retry")}</Button>;
    const month = journalDate(new Date(), preferences.data?.timezone ?? "Asia/Shanghai").slice(0, 7);
    return (
      <Navigate
        to={{ pathname: collectionPathForLocation(buildCalendarPath(month), location.pathname), search: location.search }}
        replace
      />
    );
  }
  return <CalendarView month={state.month} date={state.date} />;
};

export default Calendar;
