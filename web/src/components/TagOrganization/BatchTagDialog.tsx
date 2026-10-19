import { create } from "@bufbuild/protobuf";
import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMemoSelection } from "@/contexts/MemoSelectionContext";
import { useBatchUpdateMemoTags } from "@/hooks/useMemoTagMutations";
import { BatchUpdateMemoTagsRequestSchema, type MemoTagOperationFailure } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

const MAX_BATCH = 200;

// Splits a free-form tag input into valid tag values (comma/space separated,
// leading '#' tolerated).
const parseTagInput = (input: string): string[] => [
  ...new Set(
    input
      .split(/[\s,]+/)
      .map((value) => value.trim().replace(/^#/, ""))
      .filter(Boolean),
  ),
];

interface Props {
  names: string[];
  onClose: () => void;
}

// Adds and removes tags across the selected memos. Shared tags (on every
// selected memo) are listed as removable checkboxes; partial tags are shown
// so the user understands the scope before applying.
const BatchTagDialog = ({ names, onClose }: Props) => {
  const t = useTranslate();
  const selection = useMemoSelection();
  const batch = useBatchUpdateMemoTags();
  const [addInput, setAddInput] = useState("");
  const [removals, setRemovals] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<MemoTagOperationFailure[]>([]);
  const [done, setDone] = useState(false);

  // Shared vs partial split over resolved memos. Names whose memo was never
  // loaded (select-all-matching) contribute nothing; they still get the
  // operation applied server-side.
  const { shared, partial } = useMemo(() => {
    const tagSets = names
      .map((name) => selection?.memoFor(name)?.explicitTags)
      .filter((tags): tags is string[] => tags !== undefined)
      .map((tags) => new Set(tags));
    if (tagSets.length === 0) return { shared: [] as string[], partial: [] as string[] };
    const shared = [...tagSets[0]].filter((tag) => tagSets.every((set) => set.has(tag)));
    const partial = [...new Set(tagSets.flatMap((set) => [...set]))].filter((tag) => !shared.includes(tag));
    return { shared, partial };
  }, [names, selection]);

  const addTags = parseTagInput(addInput);
  const removeTags = [...removals];
  const conflict = addTags.some((tag) => removals.has(tag));
  const canSubmit = (addTags.length > 0 || removeTags.length > 0) && !conflict && !batch.isPending;

  const apply = async (targets: string[]) => {
    // The server caps one batch at 200 names; larger selections run in slices.
    const slices: string[][] = [];
    for (let index = 0; index < targets.length; index += MAX_BATCH) {
      slices.push(targets.slice(index, index + MAX_BATCH));
    }
    const failed: MemoTagOperationFailure[] = [];
    for (const slice of slices) {
      const response = await batch.mutateAsync(create(BatchUpdateMemoTagsRequestSchema, { names: slice, addTags, removeTags }));
      failed.push(...response.failures);
    }
    return failed;
  };

  const submit = async () => {
    try {
      const failed = await apply(failures.length > 0 ? failures.map((failure) => failure.name) : names);
      setFailures(failed);
      setDone(true);
      if (failed.length === 0) {
        toast.success(t("tagOps.applied", { count: names.length - failed.length }));
        selection?.exit();
        onClose();
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("tagOps.batch-title", { count: names.length })}</DialogTitle>
          <DialogDescription>{t("tagOps.batch-description")}</DialogDescription>
        </DialogHeader>

        {!done || failures.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("tagOps.add-label")}</label>
              <Input value={addInput} onChange={(event) => setAddInput(event.target.value)} placeholder={t("tagOps.add-placeholder")} />
            </div>

            {shared.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">{t("tagOps.remove-label")}</p>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {shared.map((tag) => (
                    <label key={tag} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={removals.has(tag)}
                        onCheckedChange={(checked) =>
                          setRemovals((current) => {
                            const next = new Set(current);
                            if (checked) {
                              next.add(tag);
                            } else {
                              next.delete(tag);
                            }
                            return next;
                          })
                        }
                      />
                      <span className="font-mono">#{tag}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {partial.length > 0 && (
              <p className="text-xs text-muted-foreground">{t("tagOps.partial-tags", { tags: partial.join(", ") })}</p>
            )}
            {conflict && <p className="text-xs text-destructive">{t("tagOps.conflict")}</p>}

            {failures.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                <p className="mb-1 font-medium">{t("tagOps.failures-title", { count: failures.length })}</p>
                {failures.slice(0, 5).map((failure) => (
                  <p key={failure.name} className="truncate text-muted-foreground">
                    {failure.name}: {failure.message}
                  </p>
                ))}
                <p className="mt-1 text-muted-foreground">{t("tagOps.retry-hint")}</p>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {failures.length > 0 ? t("tagOps.retry-failed", { count: failures.length }) : t("tagOps.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchTagDialog;
