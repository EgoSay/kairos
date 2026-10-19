/**
 * [INPUT]: AppSidebarContext.viewComposer 请求、MemoFilterContext、userServiceClient.createMemoView/updateMemoView、
 *          useMemoCandidateSearch、useJournalPreferences、view-scope 双向桥
 * [OUTPUT]: ViewComposerDialog（默认导出），挂在 RootLayout 的单一创建/编辑入口
 * [POS]: components/ViewComposer 的编排层 —— 条件 chips + SearchFacetPanel + 预览 + 校验 + 保存，高级表达式仅存于 residual
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookmarkIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  CodeIcon,
  HashIcon,
  ListFilterIcon,
  LoaderIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  ShapesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import { FacetPartitionSelect, FacetPropertyToggles, FacetTagFields } from "@/components/AppSidebar/SearchFacetPanel";
import CustomIconPicker from "@/components/CustomIconPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { userServiceClient } from "@/connect";
import { useAppSidebar, type ViewComposerRequest } from "@/contexts/AppSidebarContext";
import { type MemoFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPartitions } from "@/hooks/useJournalPartitionQueries";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useMemoCandidateSearch } from "@/hooks/useMemoCandidateSearch";
import { useMemoViews, userKeys } from "@/hooks/useUserQueries";
import { combineCELFilters } from "@/lib/cel-filter";
import { getErrorMessage } from "@/lib/error";
import { getMemoViewId, isMemoCollectionRoute } from "@/lib/memo-views";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { cn } from "@/lib/utils";
import { composeViewFilter, emptyViewScope, parseViewFilter, type ViewScope } from "@/lib/view-scope";
import { getCollectionHomePath, ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/v1/common_pb";
import { MemoView_IconSchema } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import { FacetGroup, type FacetGroupId, GROUP_FACTORS, TimeEditor } from "./facet-groups";
import { describeViewFilter, viewFilterIcon } from "./labels";

/**
 * One dialog for creating and editing views. Visual conditions are the primary
 * model; CEL lives only in the collapsed advanced section, verbatim.
 */
export default function ViewComposerDialog() {
  const { viewComposer, setViewComposer } = useAppSidebar();
  const { isPending } = useJournalPreferences();
  if (!viewComposer) return null;
  // Editing parses the stored CEL through the journal timezone — wait for it.
  if (viewComposer.editing && isPending) return null;
  const key = viewComposer.editing?.name ?? `new:${JSON.stringify(viewComposer.scope ?? {})}`;
  return <ComposerDialog key={key} request={viewComposer} onClose={() => setViewComposer(undefined)} />;
}

const ComposerDialog = ({ request, onClose }: { request: ViewComposerRequest; onClose: () => void }) => {
  const t = useTranslate();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const { setMemoView } = useMemoFilterContext();
  const { data: memoViews = [] } = useMemoViews(user?.name);
  const partitions = useJournalPartitions();
  const { data: preferences } = useJournalPreferences();
  const timezone = preferences?.timezone ?? "Asia/Shanghai";

  // Mounted fresh per request (keyed above), so lazy initializers capture it once.
  const [initial] = useState<ViewScope>(() =>
    request.editing ? parseViewFilter(request.editing.filter, timezone) : (request.scope ?? emptyViewScope()),
  );
  const [title, setTitle] = useState(request.editing?.title ?? "");
  const [icon, setIcon] = useState(request.editing?.icon);
  const [filters, setFilters] = useState<MemoFilter[]>(initial.filters);
  const [residual, setResidual] = useState(initial.residual);
  const [dateError, setDateError] = useState<string>();
  // The facet domain stays folded until asked for — an empty scope shows a dashed
  // invite instead of a wall of controls; inside, one accordion group at a time.
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<FacetGroupId | null>(null);
  // Bumping this drops half-typed drafts inside the facet groups (e.g. a lone start date).
  const [facetResetKey, setFacetResetKey] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial.residual));
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<{ state: "idle" | "checking" | "ok" | "error"; message?: string }>({ state: "idle" });

  const composed = useMemo(() => composeViewFilter({ filters, residual }, timezone), [filters, residual, timezone]);
  const keywords = filters.filter((filter) => filter.factor === "contentSearch").map((filter) => filter.value);
  const partitionName = (id: string) => partitions.data?.partitions.find((partition) => partition.id === id)?.name;

  // Fixed dates and dynamic presets are exclusive time semantics.
  const handleFacetChange = (next: MemoFilter[]) => {
    const hasFixed = next.some((filter) => filter.factor === "dateStart" || filter.factor === "dateEnd");
    setFilters(hasFixed ? next.filter((filter) => filter.factor !== "dateRange") : next);
  };

  // Server-side compile doubles as validation; debounced so typing stays quiet.
  useEffect(() => {
    if (!user?.name || !composed) {
      setValidation({ state: "idle" });
      return;
    }
    setValidation({ state: "checking" });
    const timer = window.setTimeout(() => {
      userServiceClient
        .createMemoView({
          parent: user.name,
          memoView: { name: "", title: "—", filter: composed },
          validateOnly: true,
        })
        .then(() => setValidation({ state: "ok" }))
        .catch((error: unknown) => setValidation({ state: "error", message: getErrorMessage(error) }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [composed, user?.name]);

  const previewFilter = combineCELFilters(buildMemoCreatorFilter(user?.name ?? ""), composed);
  const preview = useMemoCandidateSearch({
    filter: previewFilter,
    enabled: Boolean(user && composed),
    state: State.NORMAL,
    pageSize: 5,
  });

  // Duplicate detection compares normalized forms so clause order doesn't matter.
  const canonical = (cel: string) => composeViewFilter(parseViewFilter(cel, timezone), timezone);
  const duplicate = composed
    ? memoViews.find((view) => view.name !== request.editing?.name && canonical(view.filter) === canonical(composed))
    : undefined;
  const sameTitle = title.trim() ? memoViews.find((view) => view.name !== request.editing?.name && view.title === title.trim()) : undefined;

  const canSave =
    Boolean(user) && Boolean(title.trim()) && Boolean(composed) && !dateError && !duplicate && validation.state === "ok" && !saving;

  const handleSave = async () => {
    if (!canSave || !user) return;
    setSaving(true);
    try {
      if (request.editing) {
        await userServiceClient.updateMemoView({
          memoView: { name: request.editing.name, title: title.trim(), filter: composed, icon },
          updateMask: create(FieldMaskSchema, { paths: ["title", "filter", "icon"] }),
        });
        toast.success(t("view.update-success", { title: title.trim() }));
      } else {
        const created = await userServiceClient.createMemoView({
          parent: user.name,
          memoView: { name: "", title: title.trim(), filter: composed, icon },
        });
        toast.success(t("view.create-success", { title: title.trim() }));
        if (created.name) {
          const id = getMemoViewId(created.name);
          setMemoView(id);
          if (!isMemoCollectionRoute(location.pathname)) navigate(ROUTES.HOME);
          else navigate({ pathname: getCollectionHomePath(location), search: location.search });
        }
      }
      await queryClient.invalidateQueries({ queryKey: userKeys.memoViews(user.name) });
      onClose();
    } catch (error: unknown) {
      // Draft stays intact; the message names the failure so the retry is informed.
      toast.error(`${t("view.save-failed")} ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl" className="max-h-[84dvh]">
        <DialogTitle>{request.editing ? t("view.edit-title", { title: request.editing.title }) : t("view.create-title")}</DialogTitle>
        <DialogDescription>{t("view.description")}</DialogDescription>

        {/* Name and icon read as one field: the icon is the view's face, the input its name. */}
        <div className="flex items-center gap-1 rounded-md border border-border/70 bg-muted/20 pl-1.5 pr-3 transition-colors focus-within:border-foreground/30 focus-within:bg-background">
          <CustomIconPicker
            value={icon}
            onChange={(next) => setIcon(next ? create(MemoView_IconSchema, next) : undefined)}
            label={t("setting.memo-view.change-icon")}
            fallback={ListFilterIcon}
            triggerClassName="border-0 bg-transparent shadow-none hover:bg-accent"
          />
          <Input
            autoFocus
            value={title}
            placeholder={t("view.name-placeholder")}
            aria-label={t("common.name")}
            className="h-10 flex-1 border-0 bg-transparent px-1 shadow-none"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && canSave) void handleSave();
            }}
          />
        </div>
        {sameTitle && <p className="text-xs text-muted-foreground">{t("view.same-title", { title: sameTitle.title })}</p>}

        <section aria-label={t("view.conditions")} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">{t("view.conditions")}</h3>
            <div className="flex items-center gap-3">
              {validation.state === "checking" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LoaderIcon className="size-3 animate-spin" />
                  {t("view.checking")}
                </span>
              )}
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
                  FOCUS_VISIBLE_OUTLINE_CLASSES,
                )}
                aria-expanded={conditionsOpen}
                onClick={() => setConditionsOpen(!conditionsOpen)}
              >
                <ChevronDownIcon className={cn("size-3.5 transition-transform", conditionsOpen && "rotate-180")} />
                {conditionsOpen ? t("view.collapse-conditions") : t("view.edit-conditions")}
              </button>
            </div>
          </div>
          {filters.length === 0 && !residual ? (
            !conditionsOpen && (
              <button
                type="button"
                onClick={() => setConditionsOpen(true)}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
                  FOCUS_VISIBLE_OUTLINE_CLASSES,
                )}
              >
                <PlusIcon className="size-3.5" />
                {t("view.empty-conditions")}
              </button>
            )
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-1.5">
              {filters.map((filter, index) => {
                const FactorIcon = viewFilterIcon(filter);
                return (
                  <span
                    key={`${filter.factor}:${filter.value}:${index}`}
                    className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border/50 bg-accent/50 px-2.5 text-sm transition-colors hover:bg-accent"
                    title={filter.factor === "dateRange" ? t("view.range-dynamic-hint") : undefined}
                  >
                    <FactorIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-40 truncate font-medium text-foreground/80">{describeViewFilter(filter, t, partitionName)}</span>
                    <button
                      type="button"
                      aria-label={t("view.remove-condition", { label: describeViewFilter(filter, t, partitionName) })}
                      onClick={() => setFilters(filters.filter((_, i) => i !== index))}
                      className={cn("-mr-0.5 rounded-full text-muted-foreground hover:text-foreground", FOCUS_VISIBLE_OUTLINE_CLASSES)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                );
              })}
              {residual && (
                <button
                  type="button"
                  title={residual}
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  className={cn(
                    "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
                    FOCUS_VISIBLE_OUTLINE_CLASSES,
                  )}
                >
                  <CodeIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{residual}</span>
                </button>
              )}
            </div>
          )}
          {duplicate && <p className="text-xs text-destructive">{t("view.duplicate-conditions", { title: duplicate.title })}</p>}
          {validation.state === "error" && (
            <p role="alert" className="text-xs text-destructive">
              {t("view.validate-error", { message: validation.message })}
            </p>
          )}
        </section>

        {conditionsOpen && (
          <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
            <div className="divide-y divide-border/50">
              {(
                [
                  { id: "content", icon: SearchIcon, label: t("view.group.content") },
                  { id: "time", icon: CalendarClockIcon, label: t("view.group.time") },
                  { id: "tags", icon: HashIcon, label: t("view.group.tags") },
                  { id: "properties", icon: ShapesIcon, label: t("view.group.properties") },
                  { id: "partition", icon: BookmarkIcon, label: t("view.group.partition") },
                ] as const
              ).map(({ id, icon, label }) => (
                <FacetGroup
                  key={id}
                  icon={icon}
                  label={label}
                  count={filters.filter((filter) => GROUP_FACTORS[id].includes(filter.factor)).length}
                  open={openGroup === id}
                  onToggle={() => setOpenGroup(openGroup === id ? null : id)}
                >
                  {id === "content" && (
                    <Input
                      value={keywords.join(" ")}
                      placeholder={t("view.keyword-placeholder")}
                      aria-label={t("view.keyword-label")}
                      onChange={(event) => {
                        const words = [...new Set(event.target.value.trim().split(/\s+/).filter(Boolean))];
                        setFilters([
                          ...filters.filter((filter) => filter.factor !== "contentSearch"),
                          ...words.map((value) => ({ factor: "contentSearch" as const, value })),
                        ]);
                      }}
                    />
                  )}
                  {id === "time" && (
                    <TimeEditor
                      filters={filters}
                      onChange={handleFacetChange}
                      onDateValidationChange={setDateError}
                      resetKey={facetResetKey}
                      t={t}
                    />
                  )}
                  {id === "tags" && (
                    <FacetTagFields
                      filters={filters}
                      onChange={handleFacetChange}
                      scopeFilter={buildMemoCreatorFilter(user?.name ?? "")}
                      state={State.NORMAL}
                    />
                  )}
                  {id === "properties" && <FacetPropertyToggles filters={filters} onChange={handleFacetChange} />}
                  {id === "partition" && (
                    <div className="flex items-center">
                      <FacetPartitionSelect filters={filters} onChange={handleFacetChange} />
                    </div>
                  )}
                </FacetGroup>
              ))}
            </div>
            {filters.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFilters([]);
                  setDateError(undefined);
                  setFacetResetKey((key) => key + 1);
                }}
                className={cn(
                  "flex w-full items-center justify-center border-t border-border/50 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-destructive",
                  FOCUS_VISIBLE_OUTLINE_CLASSES,
                )}
              >
                {t("view.clear-conditions")}
              </button>
            )}
          </div>
        )}

        <section className="space-y-1.5">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
              FOCUS_VISIBLE_OUTLINE_CLASSES,
            )}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
            {t("view.advanced")}
          </button>
          {advancedOpen && (
            <>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={residual}
                placeholder='pinned && tag in ["work"]'
                aria-label={t("view.advanced")}
                onChange={(event) => setResidual(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("view.advanced-hint")}{" "}
                <a
                  href="https://github.com/EgoSay/kairos/blob/main/docs/usage.md#%E6%90%9C%E7%B4%A2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t("search.syntax-help")}
                </a>
              </p>
            </>
          )}
        </section>

        <section aria-label={t("view.preview")} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">{t("view.preview")}</h3>
            {composed && !preview.isFetching && !preview.isError && preview.memos.length > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {preview.memos.length}
                {preview.hasNextPage ? "+" : ""}
              </span>
            )}
          </div>
          {dateError && (
            <p role="alert" className="text-xs text-destructive">
              {dateError}
            </p>
          )}
          {!composed ? (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
              {t("view.preview-hint")}
            </p>
          ) : preview.isFetching ? (
            <p
              role="status"
              className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground"
            >
              <LoaderIcon className="size-3.5 animate-spin" />
              {t("view.preview-loading")}
            </p>
          ) : preview.isError ? (
            <div
              role="alert"
              className="rounded-lg border border-dashed border-destructive/40 px-3 py-3 text-center text-sm text-muted-foreground"
            >
              <p>{t("view.preview-error")}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => preview.retry()}>
                {t("search.retry")}
              </Button>
            </div>
          ) : preview.memos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
              {t("view.preview-empty")}
            </p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {preview.memos.map((memo) => (
                <li key={memo.name} className="px-3 py-2.5">
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={memo.createTime && timestampDate(memo.createTime).toISOString()}
                  >
                    {memo.createTime &&
                      timestampDate(memo.createTime).toLocaleDateString(undefined, { timeZone: timezone, dateStyle: "medium" })}
                  </time>
                  <p className="mt-0.5 line-clamp-2 break-words text-sm leading-6">{memo.snippet || memo.content}</p>
                </li>
              ))}
              {preview.hasNextPage && <li className="px-3 py-2 text-xs text-muted-foreground">{t("view.preview-more")}</li>}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t("view.scope-note")}</p>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {saving ? <LoaderIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
