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
    expect(screen.getByRole("button", { name: "3. Save and enable" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "1. Test real read/write" }));
    await waitFor(() => expect(state.action.mutateAsync).toHaveBeenCalledTimes(1));
    state.query.data!.job = { id: "test-job", action: "test", status: "success", startedTs: 1, result: { draftToken: "verified-draft" } };
    page.rerender(
      <MemoryRouter>
        <CloudBackupConfiguration />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "2. Full trial backup" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "3. Save and enable" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "another-bucket" } });
    expect(screen.getByRole("button", { name: "2. Full trial backup" })).toBeDisabled();
  });
  it("does not show stale fetched success as current health after a refresh error", async () => {
    state.query.isError = true;
    renderPage(<JournalBackupStatus />);
    expect(screen.getByRole("heading", { name: "Status unknown" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("A past success doesn't prove things are healthy now");
    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/This device keeps 2 drafts/)).toBeInTheDocument());
    expect(screen.getByText(/Application usability: Awaiting real-instance verification/)).toBeInTheDocument();
  });
  it("does not send a restore from an old destination receipt to the current repository", () => {
    state.query.data!.history[0].repositoryId = "old";
    renderPage(<JournalBackupStatus />);
    fireEvent.click(screen.getByText(/Backup succeeded ·/));
    expect(screen.getByRole("button", { name: "Isolated restore and verify from this snapshot" })).toBeDisabled();
  });
  it("does not claim the cached configuration is healthy while the agent is unavailable", () => {
    state.query.isError = true;
    renderPage(<CloudBackupConfiguration />);
    expect(screen.getByText(/Active configuration: Status unknown/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. Test real read/write" })).toBeDisabled();
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
    expect(screen.getByText(/App version at backup: 1.0.1-backup/)).toBeInTheDocument();
    expect(screen.getByText(/Tested version: 1.1.0 · Commit: actual-test-commit/)).toBeInTheDocument();
    expect(screen.getByText(/Application usability: Verified/)).toBeInTheDocument();
    state.query.data!.restores[0].applicationVerification!.status = "failed";
    page.rerender(
      <MemoryRouter>
        <JournalBackupStatus />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Application usability: Last check failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Application usability: Verified/)).not.toBeInTheDocument();
  });
});
