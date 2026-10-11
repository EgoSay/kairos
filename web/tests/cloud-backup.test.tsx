import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CloudBackupConfiguration from "@/components/Backup/CloudBackupConfiguration";
import type { CloudBackupStatus } from "@/hooks/useCloudBackup";
import JournalBackupStatus from "@/pages/JournalBackupStatus";
import { User_Role } from "@/types/proto/api/v1/user_service_pb";

const state = vi.hoisted(() => ({
  query: { data: undefined as CloudBackupStatus | undefined, isPending: false, isError: false, error: new Error("offline") },
  action: { isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() },
  user: { name: "users/owner", role: 1 },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => state.user }));
vi.mock("@/hooks/useCloudBackup", async (original) => ({
  ...(await original<typeof import("@/hooks/useCloudBackup")>()),
  useCloudBackup: () => state.query,
  useCloudBackupAction: () => state.action,
}));
vi.mock("@/lib/journal-drafts", () => ({ journalDrafts: { list: async () => [{}, {}] } }));

const renderPage = (element: React.ReactNode) => render(<MemoryRouter>{element}</MemoryRouter>);
const fixture = (): CloudBackupStatus => ({
  state: "success",
  updatedTs: 1,
  source: "server",
  enabled: true,
  timerState: "active",
  nextRun: "next",
  stale: false,
  config: {
    endpoint: "https://example.com",
    region: "auto",
    bucket: "private",
    prefix: "restic",
    intervalSeconds: 300,
    retention: { daily: 30, monthly: 12, yearly: 100 },
    credentialsConfigured: true,
    recoveryPasswordConfigured: true,
    repositoryId: "current",
  },
  lastSuccess: { status: "success", sourceTs: 1, completedTs: 2, snapshotId: "abc" },
  history: [{ status: "success", snapshotId: "abc", sourceTs: 1, repositoryId: "current" }],
  restores: [],
  monitor: { configured: false },
  independentReplica: { status: "unknown" },
});

describe("cloud backup evidence and configuration gates", () => {
  beforeEach(() => {
    state.query.data = fixture();
    state.query.isError = false;
    state.user.role = User_Role.ADMIN;
    state.action.mutate.mockReset();
    state.action.mutateAsync.mockReset();
  });
  it("keeps activation disabled until this draft passes both connection and complete trial backup", async () => {
    state.action.mutateAsync.mockResolvedValue({ id: "test-job", status: "running" });
    const page = renderPage(<CloudBackupConfiguration />);
    expect(screen.getByRole("button", { name: "3. 保存并启用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "1. 检测实际读写" }));
    await waitFor(() => expect(state.action.mutateAsync).toHaveBeenCalledTimes(1));
    state.query.data!.job = { id: "test-job", action: "test", status: "success", startedTs: 1, result: { draftToken: "verified-draft" } };
    page.rerender(
      <MemoryRouter>
        <CloudBackupConfiguration />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "2. 完整试备份" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "3. 保存并启用" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "another-bucket" } });
    expect(screen.getByRole("button", { name: "2. 完整试备份" })).toBeDisabled();
  });
  it("does not show stale fetched success as current health after a refresh error", async () => {
    state.query.isError = true;
    renderPage(<JournalBackupStatus />);
    expect(screen.getByRole("heading", { name: "状态未知" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("之前的成功回执不能证明当前正常");
    expect(screen.getByRole("button", { name: "立即备份" })).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/本机保留 2 份草稿/)).toBeInTheDocument());
    expect(screen.getByText(/应用可用性：待实际实例验证/)).toBeInTheDocument();
  });
  it("does not send a restore from an old destination receipt to the current repository", () => {
    state.query.data!.history[0].repositoryId = "old";
    renderPage(<JournalBackupStatus />);
    fireEvent.click(screen.getByText(/备份成功 ·/));
    expect(screen.getByRole("button", { name: "从此快照隔离恢复并核验" })).toBeDisabled();
  });
  it("does not claim the cached configuration is healthy while the agent is unavailable", () => {
    state.query.isError = true;
    renderPage(<CloudBackupConfiguration />);
    expect(screen.getByText(/活动配置：状态未知/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. 检测实际读写" })).toBeDisabled();
  });
  it("shows the actual restored test version separately from the backup identity and never hides the latest failure", () => {
    state.query.data!.history[0].instanceVersion = "1.0.1-backup";
    state.query.data!.restores = [
      {
        status: "isolated-verified",
        snapshotId: "abc",
        repositoryId: "current",
        manifestVerified: true,
        applicationVerified: true,
        applicationVerification: {
          checkId: "one",
          status: "success",
          startedTs: 1,
          completedTs: 2,
          testedVersion: "1.1.0",
          testedCommit: "actual-test-commit",
        },
      },
    ];
    const page = renderPage(<JournalBackupStatus />);
    expect(screen.getByText(/备份时应用标识：1.0.1-backup/)).toBeInTheDocument();
    expect(screen.getByText(/实际测试版本：1.1.0 · 提交：actual-test-commit/)).toBeInTheDocument();
    expect(screen.getByText(/应用可用性：已验证/)).toBeInTheDocument();
    state.query.data!.restores[0].applicationVerification!.status = "failed";
    page.rerender(
      <MemoryRouter>
        <JournalBackupStatus />
      </MemoryRouter>,
    );
    expect(screen.getByText(/应用可用性：最近检查未通过/)).toBeInTheDocument();
    expect(screen.queryByText(/应用可用性：已验证/)).not.toBeInTheDocument();
  });
});
