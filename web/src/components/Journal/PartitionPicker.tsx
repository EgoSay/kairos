import { CheckIcon, ChevronDownIcon, FolderIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useJournalPartitions, useJournalPartitionTargets } from "@/hooks/useJournalPartitionQueries";
import i18n from "@/i18n";
import { useTranslate } from "@/utils/i18n";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSyncChange?: (enabled: boolean) => void;
  disabled?: boolean;
  suspended?: boolean;
}
export default function PartitionPicker({ value, onChange, onSyncChange, disabled, suspended }: Props) {
  const t = useTranslate();
  const partitions = useJournalPartitions();
  const targets = useJournalPartitionTargets(value);
  const active = targets.data?.targets.filter((target) => target.enabled) ?? [];
  const hasSync = active.length > 0 && !suspended;
  useEffect(() => {
    onSyncChange?.(hasSync);
  }, [value, hasSync, onSyncChange]);
  if (!partitions.data?.partitions.length && !value) return null;
  const selected = partitions.data?.partitions.find((partition) => partition.id === value);
  const label = value ? (selected?.name ?? t("journal.partition-original")) : t("journal.partition-pick");
  return (
    <div className="min-w-0 max-w-full space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size={value ? "sm" : "icon"}
              className="h-9 max-w-40 gap-1.5 pointer-coarse:h-10"
              aria-label={t("journal.partition-label", { name: label })}
              title={label}
              disabled={disabled || partitions.isPending}
            />
          }
        >
          <FolderIcon className="size-4" strokeWidth={1.7} />
          {value && <span className="max-w-24 truncate">{label}</span>}
          {value && <ChevronDownIcon className="size-3 opacity-50" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44 max-w-64">
          <DropdownMenuItem className="min-h-10" disabled={disabled || partitions.isPending} onClick={() => onChange("")}>
            <span className="flex-1">{t("journal.partition-none")}</span>
            {!value && <CheckIcon className="size-4" />}
          </DropdownMenuItem>
          {partitions.data?.partitions.map((partition) => (
            <DropdownMenuItem
              key={partition.id}
              className="min-h-10"
              disabled={disabled || partitions.isPending}
              onClick={() => onChange(partition.id)}
            >
              <span className="min-w-0 flex-1 truncate">{partition.name}</span>
              {value === partition.id && <CheckIcon className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {value && targets.isPending && <p className="text-xs text-muted-foreground">{t("journal.partition-sync-checking")}</p>}
      {suspended && <p className="text-xs leading-5 text-muted-foreground">{t("journal.partition-sync-suspended")}</p>}
      {hasSync && (
        <p className="text-xs leading-5 text-muted-foreground">
          {t("journal.partition-sync-note", {
            targets: new Intl.ListFormat(i18n.language || "en", { type: "conjunction" }).format(active.map((target) => target.name)),
          })}
        </p>
      )}
      {targets.isError && value && (
        <p role="alert" className="text-xs text-destructive">
          {t("journal.partition-sync-error")}
        </p>
      )}
    </div>
  );
}
