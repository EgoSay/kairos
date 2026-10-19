import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import { journalRequest } from "@/hooks/useJournalQueries";
import i18n from "@/i18n";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";
import type { Translations } from "@/utils/i18n";

export interface BackupReceipt {
  status: string;
  snapshotId?: string;
  repositoryId?: string;
  sourceTs?: number;
  startedTs?: number;
  completedTs?: number;
  attemptTs?: number;
  restoredTs?: number;
  checkedTs?: number;
  counts?: Record<string, number>;
  bytes?: number;
  durationSeconds?: number;
  mediaComplete?: boolean;
  manifestVerified?: boolean;
  applicationVerified?: boolean;
  isolationId?: string;
  instanceVersion?: string;
  applicationVerification?: {
    checkId: string;
    status: string;
    startedTs: number;
    completedTs?: number;
    testedVersion?: string;
    testedCommit?: string;
    imageId?: string;
    message?: string;
    sourceIndexMigration?: { migratedRows: number; parserCommit: string };
  };
  errorType?: string;
  message?: string;
  stale?: boolean;
  lagSeconds?: number | null;
}
export interface BackupConfig {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  intervalSeconds: number;
  retention: { daily: number; monthly: number; yearly: number };
  credentialsConfigured: boolean;
  recoveryPasswordConfigured: boolean;
  repositoryId: string;
}
export interface BackupJob {
  id: string;
  action: string;
  status: string;
  startedTs: number;
  completedTs?: number;
  error?: string;
  result?: { draftToken?: string; status?: string; backup?: BackupReceipt };
}
export interface CloudBackupStatus {
  state: string;
  updatedTs: number;
  source: string;
  config: BackupConfig;
  enabled: boolean;
  timerState: string;
  nextRun: string;
  stale: boolean;
  lastSuccess?: BackupReceipt;
  lastAttempt?: BackupReceipt;
  currentTask?: { phase: string; startedTs: number };
  history: BackupReceipt[];
  integrity?: { status: string; checkedTs: number; snapshotIds?: string[]; repositoryId?: string };
  restores: BackupReceipt[];
  monitor: { configured: boolean; delivery?: BackupReceipt; stale?: boolean };
  independentReplica: BackupReceipt;
  job?: BackupJob;
}
const key = ["journal", "cloud-backup"] as const;
export function useCloudBackup() {
  const user = useCurrentUser();
  return useQuery({
    queryKey: [...key, user?.name],
    queryFn: ({ signal }) => journalRequest<CloudBackupStatus>("/cloud-backup/status", { signal }),
    enabled: user?.role === User_Role.ADMIN,
    refetchInterval: 5_000,
    retry: false,
  });
}
export function useCloudBackupAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, payload = {} }: { action: string; payload?: Record<string, unknown> }) =>
      journalRequest<BackupJob>(`/cloud-backup/${action}`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}
export function backupTime(timestamp?: number) {
  return timestamp ? new Date(timestamp * 1000).toLocaleString(i18n.language || "en") : i18n.t("journal.backup-no-record");
}
const backupStateKeys: Record<string, Translations> = {
  success: "journal.state-success",
  failed: "journal.state-failed",
  running: "journal.state-running",
  paused: "journal.state-paused",
  stale: "journal.state-stale",
  unknown: "journal.status-unknown",
};
export function backupStateLabel(state: string): Translations {
  return backupStateKeys[state] ?? "journal.status-unknown";
}
