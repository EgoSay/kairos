import { create } from "@bufbuild/protobuf";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { memoServiceClient } from "@/connect";
import { useDebouncedEffect } from "@/hooks";
import { useBatchUpdateMemoTags, useDeleteTag, useRenameTag } from "@/hooks/useMemoTagMutations";
import { useTagCounts } from "@/hooks/useUserQueries";
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

// One action, one small dialog. The tag is already known from where the user
// clicked; the preview arrives on its own once the form is valid, so the only
// button left is the one that executes.
const TagActionDialog = ({ tag, action, onClose }: Props) => {
  const t = useTranslate();
  const renameTag = useRenameTag();
  const deleteTag = useDeleteTag();
  const batchUpdate = useBatchUpdateMemoTags();
  const { data: tagCount = {} } = useTagCounts(true);
  const mergeTargets = useMemo(
    () =>
      Object.entries(tagCount)
        .filter(([value]) => value !== tag)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [tagCount, tag],
  );

  const [newName, setNewName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [addInput, setAddInput] = useState("");
  const [removeInput, setRemoveInput] = useState("");
  const [descendants, setDescendants] = useState(false);
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
  const target = action === "merge" ? mergeTarget : newName.trim();

  // Live validation keeps the confirm button honest without a dead disabled state:
  // the reason is always visible under the offending field once it has input.
  const error = useMemo((): string | undefined => {
    if (action === "rename") {
      if (!target) return undefined; // untouched: silence, preview just hasn't started
      if (formatTag(target) === undefined) return t("tagOps.target-invalid");
      if (target === tag) return t("tagOps.same-tag");
    }
    if (action === "batch") {
      if (addTags.length === 0 && removeTags.length === 0) return undefined;
      if (addTags.some((value) => removeTags.includes(value))) return t("tagOps.conflict");
      if ([...addTags, ...removeTags].some((value) => formatTag(value) === undefined)) return t("tagOps.target-invalid");
    }
    return undefined;
  }, [action, target, tag, addTags, removeTags, t]);

  const formValid =
    action === "delete" ||
    (action === "rename" && target !== "" && formatTag(target) !== undefined && target !== tag) ||
    (action === "merge" && mergeTarget !== "") ||
    (action === "batch" && (addTags.length > 0 || removeTags.length > 0) && !error);

  // Impact previews are read-only (validateOnly), so they ride a plain query:
  // keystrokes and checkbox flips refetch automatically, no preview button.
  useDebouncedEffect(() => setDebouncedName(newName.trim()), 350, [newName]);
  const previewTarget = action === "rename" ? debouncedName : mergeTarget;
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

  const confirmLabel =
    action === "rename"
      ? t("tagOps.confirm-rename")
      : action === "merge"
        ? t("tagOps.confirm-merge")
        : action === "delete"
          ? t("tagOps.confirm-delete")
          : t("tagOps.apply");

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
            </div>
          )}

          {action === "merge" && (
            <div>
              <label className="mb-1 block text-sm font-medium">{t("tagOps.merge-target")}</label>
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger className="w-full font-mono">
                  <SelectValue placeholder={t("tagOps.merge-placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {mergeTargets.map(([value, amount]) => (
                    <SelectItem key={value} value={value}>
                      #{value} <span className="text-muted-foreground">{amount}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  {previewData.mergesIntoExisting && action === "rename" && (
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
