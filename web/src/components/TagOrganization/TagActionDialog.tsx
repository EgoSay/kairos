import { create } from "@bufbuild/protobuf";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HashIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { memoServiceClient } from "@/connect";
import { useDebouncedEffect } from "@/hooks";
import { useBatchUpdateMemoTags, useDeleteTag, useRenameTag } from "@/hooks/useMemoTagMutations";
import { useTagCounts } from "@/hooks/useUserQueries";
import { cn } from "@/lib/utils";
import { BatchUpdateMemoTagsRequestSchema, DeleteTagRequestSchema, RenameTagRequestSchema } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { formatTag } from "@/utils/tag-grammar";
import type { TagAction } from "./TagActionsMenu";

interface Props {
  /** The tag the user clicked — fixed for the dialog's lifetime. */
  tag: string;
  action: TagAction;
  onClose: () => void;
}

/** Normalized blast-radius report; delete responses simply have no merge flag. */
interface Impact {
  affectedMemos: number;
  affectedTags: string[];
  mergesIntoExisting: boolean;
  affectedRefs: number;
  remainingCount: number;
}

// Splits a free-form tag input into values (comma/space separated, '#' tolerated).
const parseTagInput = (input: string): string[] => [
  ...new Set(
    input
      .split(/[\s,]+/)
      .map((value) => value.trim().replace(/^#/, ""))
      .filter(Boolean),
  ),
];

/** Sentinel for "no parent" in the move dialog — not a valid tag, so no collision. */
const ROOT_PARENT = "\0top";

// One action, one small dialog. The tag is already known from where the user
// clicked; the preview arrives on its own once the form is valid, so the only
// button left is the one that executes.
const TagActionDialog = ({ tag, action, onClose }: Props) => {
  const t = useTranslate();
  const renameTag = useRenameTag();
  const deleteTag = useDeleteTag();
  const batchUpdate = useBatchUpdateMemoTags();
  const { data: tagCount = {} } = useTagCounts(true);

  const [newName, setNewName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [moveQuery, setMoveQuery] = useState("");
  const [moveParent, setMoveParent] = useState("");
  const [addInput, setAddInput] = useState("");
  const [removeInput, setRemoveInput] = useState("");
  // Moving a node in the tag tree carries its subtree along by default.
  const [descendants, setDescendants] = useState(action === "move");
  const [updateReferences, setUpdateReferences] = useState(true);
  const busy = renameTag.isPending || deleteTag.isPending || batchUpdate.isPending;

  const scopeCount = useMemo(
    () =>
      Object.entries(tagCount)
        .filter(([value]) => value === tag || (descendants && value.startsWith(`${tag}/`)))
        .reduce((total, [, amount]) => total + amount, 0),
    [tagCount, tag, descendants],
  );

  const addTags = parseTagInput(addInput);
  const removeTags = parseTagInput(removeInput);
  const target = newName.trim();
  const targetExists = target !== "" && tagCount[target] !== undefined;

  // Move (reparent) keeps the leaf name: `work/deep` under `life` becomes
  // `life/deep`. The current parent is offered but greyed out — choosing it is
  // a no-op. A tag can never move under itself or its own subtree.
  const leaf = tag.split("/").pop() ?? tag;
  const currentParent = tag.includes("/") ? tag.slice(0, tag.lastIndexOf("/")) : ROOT_PARENT;
  // "Up one level" reparents to the grandparent — for `a/b/c` that is `a`,
  // for `a/b` it is the top level (which the row then replaces).
  const grandParent =
    currentParent === ROOT_PARENT ? "" : currentParent.includes("/") ? currentParent.slice(0, currentParent.lastIndexOf("/")) : ROOT_PARENT;
  const invalidParent = (value: string) => value === tag || value.startsWith(`${tag}/`);
  const moveParentRows = useMemo(() => {
    const needle = moveQuery.trim().toLowerCase().replace(/^#/, "");
    return Object.entries(tagCount)
      .filter(([value]) => !invalidParent(value) && (!needle || value.toLowerCase().includes(needle)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagCount, moveQuery, tag]);
  // A typed name that isn't an existing row becomes the new parent verbatim.
  const typedParent = parseTagInput(moveQuery)[0] ?? "";
  const typedParentValid = typedParent !== "" && formatTag(typedParent) !== undefined && !invalidParent(typedParent);
  const typedParentIsNew = typedParentValid && tagCount[typedParent] === undefined;
  const effectiveParent = moveParent !== "" ? moveParent : typedParentValid ? typedParent : "";
  const moveNewTag = effectiveParent === "" ? "" : effectiveParent === ROOT_PARENT ? leaf : `${effectiveParent}/${leaf}`;

  // Live validation keeps the confirm button honest without a dead disabled state:
  // the reason is always visible under the offending field once it has input.
  const error = useMemo((): string | undefined => {
    if (action === "rename") {
      if (!target) return undefined; // untouched: silence, preview just hasn't started
      if (formatTag(target) === undefined) return t("tagOps.target-invalid");
      if (target === tag) return t("tagOps.same-tag");
    }
    if (action === "move" && effectiveParent !== "" && moveNewTag === tag) {
      return t("tagOps.move-same-position");
    }
    if (action === "batch") {
      if (addTags.length === 0 && removeTags.length === 0) return undefined;
      if (addTags.some((value) => removeTags.includes(value))) return t("tagOps.conflict");
      if ([...addTags, ...removeTags].some((value) => formatTag(value) === undefined)) return t("tagOps.target-invalid");
    }
    return undefined;
  }, [action, target, tag, addTags, removeTags, effectiveParent, moveNewTag, t]);

  const formValid =
    action === "delete" ||
    (action === "rename" && target !== "" && formatTag(target) !== undefined && target !== tag) ||
    (action === "move" && effectiveParent !== "" && moveNewTag !== tag) ||
    (action === "batch" && (addTags.length > 0 || removeTags.length > 0) && !error);

  // Impact previews are read-only (validateOnly), so they ride a plain query:
  // keystrokes and checkbox flips refetch automatically, no preview button.
  useDebouncedEffect(() => setDebouncedName(newName.trim()), 350, [newName]);
  const previewTarget = action === "rename" ? debouncedName : moveNewTag;
  const previewReady = action === "rename" ? formValid && debouncedName === newName.trim() : formValid;
  const preview = useQuery<Impact>({
    queryKey: ["tag-action-preview", action, tag, previewTarget, descendants],
    queryFn: async () => {
      const response =
        action === "delete"
          ? await memoServiceClient.deleteTag(create(DeleteTagRequestSchema, { tag, includeDescendants: descendants, validateOnly: true }))
          : await memoServiceClient.renameTag(
              create(RenameTagRequestSchema, { oldTag: tag, newTag: previewTarget, includeDescendants: descendants, validateOnly: true }),
            );
      return {
        affectedMemos: response.affectedMemos,
        affectedTags: response.affectedTags,
        mergesIntoExisting: "mergesIntoExisting" in response && response.mergesIntoExisting,
        affectedRefs: response.affectedViews.length + response.affectedTagRules.length,
        remainingCount: response.remainingCount,
      };
    },
    enabled: action !== "batch" && previewReady && !busy,
    placeholderData: keepPreviousData,
  });
  const previewData = preview.data;

  const execute = async () => {
    try {
      if (action === "batch") {
        // Scope runs in ≤1000-record chunks; keep calling until the server reports none left.
        let failures = 0;
        for (;;) {
          const response = await batchUpdate.mutateAsync(
            create(BatchUpdateMemoTagsRequestSchema, { scopeTag: tag, scopeIncludeDescendants: descendants, addTags, removeTags }),
          );
          failures += response.failures.length;
          if (response.remainingCount <= 0) break;
        }
        if (failures > 0) toast.error(t("tagOps.partial-failures", { count: failures }));
        else toast.success(t("tagOps.manage-done"));
      } else {
        const request =
          action === "delete"
            ? await deleteTag.mutateAsync(create(DeleteTagRequestSchema, { tag, includeDescendants: descendants, updateReferences }))
            : await renameTag.mutateAsync(
                create(RenameTagRequestSchema, {
                  oldTag: tag,
                  newTag: previewTarget,
                  includeDescendants: descendants,
                  updateReferences,
                }),
              );
        if (request.failures.length > 0) toast.error(t("tagOps.partial-failures", { count: request.failures.length }));
        else toast.success(t("tagOps.manage-done"));
      }
      onClose();
    } catch (requestError) {
      toast.error(String(requestError));
    }
  };

  const confirmLabel = {
    // Renaming onto an existing tag is a merge — say so on the button.
    rename: targetExists ? t("tagOps.confirm-merge") : t("tagOps.confirm-rename"),
    move: t("tagOps.confirm-move"),
    delete: t("tagOps.confirm-delete"),
    batch: t("tagOps.apply"),
  }[action];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`tagOps.dialog-${action}-title`)}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">#{tag}</span>
            {" · "}
            {t("tagOps.scope-count", { count: scopeCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {action === "rename" && (
            <div>
              <label className="mb-1 block text-sm font-medium">{t("tagOps.new-name")}</label>
              <Input className="font-mono" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
              {target !== "" && formatTag(target) !== undefined && target !== tag && (
                <p className={cn("mt-1 text-xs", targetExists ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {targetExists ? t("tagOps.target-exists", { count: tagCount[target] }) : t("tagOps.target-new")}
                </p>
              )}
            </div>
          )}

          {action === "move" && (
            <div>
              <div className="relative">
                <SearchIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="ps-8 font-mono"
                  value={moveQuery}
                  onChange={(event) => {
                    setMoveQuery(event.target.value);
                    setMoveParent("");
                  }}
                  placeholder={t("tagOps.move-search")}
                  autoFocus
                />
              </div>
              <div className="mt-1.5 flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1">
                {currentParent !== ROOT_PARENT && (
                  <button
                    type="button"
                    onClick={() => setMoveParent(grandParent)}
                    className={cn(
                      "flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted/60",
                      moveParent === grandParent && "bg-accent",
                    )}
                  >
                    {t("tagOps.move-up-one")}
                    <span className="font-mono text-2xs text-muted-foreground">
                      {grandParent === ROOT_PARENT ? t("tagOps.move-root") : `#${grandParent}`}
                    </span>
                  </button>
                )}
                {/* For a two-level tag "上一级" already lands on top level; skip the duplicate. */}
                {(currentParent === ROOT_PARENT || grandParent !== ROOT_PARENT) && (
                  <button
                    type="button"
                    disabled={currentParent === ROOT_PARENT}
                    onClick={() => setMoveParent(ROOT_PARENT)}
                    className={cn(
                      "flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted/60 disabled:opacity-45",
                      moveParent === ROOT_PARENT && "bg-accent",
                    )}
                  >
                    {t("tagOps.move-root")}
                    {currentParent === ROOT_PARENT && <span className="text-2xs text-muted-foreground">{t("tagOps.move-current")}</span>}
                  </button>
                )}
                {moveParentRows.map(([value, amount]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={value === currentParent}
                    onClick={() => {
                      setMoveParent(value);
                      setMoveQuery("");
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-left font-mono text-sm hover:bg-muted/60 disabled:opacity-45",
                      moveParent === value && "bg-accent",
                    )}
                  >
                    <HashIcon className="size-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate">{value}</span>
                    {value === currentParent ? (
                      <span className="text-2xs text-muted-foreground">{t("tagOps.move-current")}</span>
                    ) : (
                      <span className="text-2xs tabular-nums text-muted-foreground/60">{amount}</span>
                    )}
                  </button>
                ))}
                {typedParentIsNew && (
                  <p className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{t("tagOps.move-create", { parent: typedParent })}</p>
                )}
              </div>
              {moveNewTag !== "" && moveNewTag !== tag && (
                <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                  #{tag} → #{moveNewTag}
                </p>
              )}
            </div>
          )}

          {action === "batch" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("tagOps.add-label")}</label>
                <Input
                  className="font-mono"
                  value={addInput}
                  onChange={(event) => setAddInput(event.target.value)}
                  placeholder={t("tagOps.add-placeholder")}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("tagOps.remove-label-batch")}</label>
                <Input
                  className="font-mono"
                  value={removeInput}
                  onChange={(event) => setRemoveInput(event.target.value)}
                  placeholder={t("tagOps.remove-placeholder")}
                />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={descendants} onCheckedChange={(checked) => setDescendants(Boolean(checked))} />
            {t(`tagOps.descendants-${action}`)}
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {action !== "batch" && formValid && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              {preview.isPending && <p className="text-muted-foreground">{t("tagOps.preview-loading")}</p>}
              {preview.isError && <p className="text-destructive">{t("tagOps.preview-failed")}</p>}
              {previewData && (
                <ul className="list-disc ps-5 text-muted-foreground">
                  <li>{t("tagOps.preview-memos", { count: previewData.affectedMemos })}</li>
                  {previewData.affectedTags.length > 1 && (
                    <li className="font-mono text-xs">{previewData.affectedTags.map((value) => `#${value}`).join(" ")}</li>
                  )}
                  {previewData.mergesIntoExisting && (action === "rename" || action === "move") && (
                    <li className="text-amber-600 dark:text-amber-400">{t("tagOps.preview-merge")}</li>
                  )}
                  {previewData.remainingCount > 0 && <li>{t("tagOps.preview-remaining", { count: previewData.remainingCount })}</li>}
                  {previewData.affectedRefs > 0 && (
                    <li>
                      <label className="flex items-center gap-2 text-foreground">
                        <Checkbox checked={updateReferences} onCheckedChange={(checked) => setUpdateReferences(Boolean(checked))} />
                        {t("tagOps.update-refs-count", { count: previewData.affectedRefs })}
                      </label>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={action === "delete" ? "destructive" : "default"}
            disabled={busy || !formValid || (action !== "batch" && (!previewData || preview.isFetching))}
            onClick={execute}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TagActionDialog;
