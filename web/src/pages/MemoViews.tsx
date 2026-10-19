import { useQueryClient } from "@tanstack/react-query";
import { CodeIcon, FilterIcon, MoreVerticalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import MemoViewIcon from "@/components/MemoViewIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { describeViewFilter, viewFilterIcon } from "@/components/ViewComposer/labels";
import { userServiceClient } from "@/connect";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPartitions } from "@/hooks/useJournalPartitionQueries";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useMemoViews, userKeys } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { getMemoViewId } from "@/lib/memo-views";
import { parseViewFilter } from "@/lib/view-scope";
import type { MemoView } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";

interface MemoViewsRouteState {
  openCreate?: boolean;
  memoView?: MemoView;
}

/** Manage page for saved views; every create/edit goes through the composer dialog. */
const MemoViews = () => {
  const t = useTranslate();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: memoViews = [], isPending, isError, refetch } = useMemoViews(user?.name);
  const { memoView: selectedMemoView, setMemoView } = useMemoFilterContext();
  const { setViewComposer } = useAppSidebar();
  const { data: preferences } = useJournalPreferences();
  const partitions = useJournalPartitions();
  const timezone = preferences?.timezone ?? "Asia/Shanghai";
  const [deleteTarget, setDeleteTarget] = useState<MemoView | undefined>();

  // The composer reads each view's stored CEL through the same bridge it saves
  // with, so this list and the edit dialog always agree.
  const scopes = useMemo(
    () => new Map(memoViews.map((view) => [view.name, parseViewFilter(view.filter, timezone)])),
    [memoViews, timezone],
  );
  const partitionName = (id: string) => partitions.data?.partitions.find((partition) => partition.id === id)?.name;

  // Legacy deep links (sidebar navigated here before the composer existed)
  // still land correctly: the state just opens the dialog instead of a form.
  useEffect(() => {
    const state = location.state as MemoViewsRouteState | null;
    if (!state) return;
    if (state.memoView) setViewComposer({ editing: state.memoView });
    else if (state.openCreate) setViewComposer({});
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key, location.pathname, location.state, navigate, setViewComposer]);

  const confirmDeleteMemoView = async () => {
    if (!deleteTarget) return;
    try {
      await userServiceClient.deleteMemoView({ name: deleteTarget.name });
      await queryClient.invalidateQueries({ queryKey: userKeys.memoViews(user?.name) });
      if (selectedMemoView === getMemoViewId(deleteTarget.name)) setMemoView(undefined);
      toast.success(t("setting.memo-view.delete-success", { title: deleteTarget.title }));
    } catch (error: unknown) {
      await handleError(error, toast.error, { context: "Delete memo view" });
    } finally {
      setDeleteTarget(undefined);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FilterIcon className="h-4 w-4" />
            <span className="text-sm font-medium">{t("common.views")}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">{t("common.views")}</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("view.page-description")}</p>
        </div>
        {user && (
          <Button onClick={() => setViewComposer({})}>
            <PlusIcon className="h-4 w-4" />
            {t("common.create")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{t("view.all-views")}</h2>
          {!isPending && !isError && <Badge variant="outline">{memoViews.length}</Badge>}
        </div>

        {isPending ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("view.loading")}</p>
        ) : isError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("view.load-failed")}</p>
            <Button variant="outline" className="mt-4" onClick={() => void refetch()}>
              {t("search.retry")}
            </Button>
          </div>
        ) : memoViews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">{t("view.empty-title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("view.empty-description")}</p>
            {user && (
              <Button variant="outline" className="mt-4" onClick={() => setViewComposer({})}>
                <PlusIcon className="size-4" />
                {t("setting.memo-view.create")}
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {memoViews.map((memoView) => {
              const scope = scopes.get(memoView.name);
              return (
                <div
                  key={memoView.name}
                  className="grid gap-3 bg-background px-4 py-3 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_2rem]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <MemoViewIcon icon={memoView.icon} className="size-4 text-base" />
                      <span className="truncate">{memoView.title}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{getMemoViewId(memoView.name)}</div>
                  </div>
                  <div className="flex min-w-0 flex-wrap content-start items-center gap-1.5" title={memoView.filter}>
                    {!scope || (scope.filters.length === 0 && !scope.residual) ? (
                      <span className="text-xs text-muted-foreground">{t("view.all-records")}</span>
                    ) : (
                      <>
                        {scope.filters.map((filter, index) => {
                          const FactorIcon = viewFilterIcon(filter);
                          return (
                            <span
                              key={`${filter.factor}:${filter.value}:${index}`}
                              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/50 bg-accent/50 px-2.5 text-sm"
                            >
                              <FactorIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="max-w-40 truncate font-medium text-foreground/80">
                                {describeViewFilter(filter, t, partitionName)}
                              </span>
                            </span>
                          );
                        })}
                        {scope.residual && (
                          <span
                            className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 font-mono text-xs text-muted-foreground"
                            title={scope.residual}
                          >
                            <CodeIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{scope.residual}</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="justify-self-end" />}>
                      <MoreVerticalIcon className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setViewComposer({ editing: memoView })}>
                        <PencilIcon className="h-4 w-4" />
                        {t("common.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(memoView)}>
                        <Trash2Icon className="h-4 w-4" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        title={t("setting.memo-view.delete-confirm", { title: deleteTarget?.title ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDeleteMemoView}
        confirmVariant="destructive"
      />
    </section>
  );
};

export default MemoViews;
