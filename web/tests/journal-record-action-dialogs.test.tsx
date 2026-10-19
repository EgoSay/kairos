import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JournalMemo from "@/components/JournalMemo";
import MemoActionMenu from "@/components/MemoActionMenu";
import { State } from "@/types/proto/api/v1/common_pb";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const { request, getMemo } = vi.hoisted(() => ({ request: vi.fn(), getMemo: vi.fn() }));
vi.mock("@/hooks/useJournalQueries", () => ({
  journalRequest: request,
  useJournalPreferences: () => ({ data: { timezone: "UTC" } }),
}));
vi.mock("@/connect", () => ({ memoServiceClient: { getMemo }, getRequestToken: vi.fn() }));
vi.mock("@/components/MemoActionMenu/hooks", () => ({
  useMemoActionHandlers: () => ({ isInMemoDetailPage: true, pinPending: false }),
}));
vi.mock("@/components/JournalReviewActions", () => ({ default: () => null }));
vi.mock("@/components/ConfirmDialog", () => ({ default: () => null }));
vi.mock("@/components/MemoContent", () => ({ default: () => <p>current original record</p> }));
vi.mock("@/components/MemoMetadata", () => ({ AttachmentGallery: () => null, MemoMetadataRows: () => null }));
vi.mock("@/components/PreviewImageDialog", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userTagsSetting: undefined }) }));
vi.mock("@/contexts/JournalSessionContext", () => ({ useJournalSession: () => ({ expanded: new Set(), setExpanded: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/owner" }) }));
vi.mock("@/hooks/useMemoPin", () => ({ useMemoPin: () => ({ pending: false, toggle: vi.fn() }) }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

beforeEach(() => {
  request.mockReset();
  getMemo.mockReset();
  request.mockImplementation(async (path: string) =>
    path.endsWith("/revisions")
      ? { revisions: [{ id: "old", createdTs: 1_700_000_000, memo: { name: "memos/one", content: "recoverable private version" } }] }
      : { available: true, sha256: "original-digest" },
  );
  getMemo.mockResolvedValue({ attachments: [{ name: "attachments/original", filename: "original.png" }] });
});

describe.each([
  ["desktop", 1280],
  ["narrow viewport", 390],
] as const)("record menu dialog lifecycle: %s", (_viewport, width) => {
  it.each([
    ["detail", "journal.recent-versions"],
    ["detail", "journal.originals"],
    ["archived", "journal.recent-versions"],
    ["archived", "journal.originals"],
    ["journal card", "journal.recent-versions"],
    ["journal card", "journal.originals"],
  ] as const)("keeps %s / %s mounted after the menu closes and returns focus on Escape", async (surface, title) => {
    vi.stubGlobal("innerWidth", width);
    const memo = create(MemoSchema, {
      name: "memos/one",
      creator: "users/owner",
      content: "current original record",
      state: surface === "archived" ? State.ARCHIVED : State.NORMAL,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{surface === "journal card" ? <JournalMemo memo={memo} /> : <MemoActionMenu memo={memo} />}</MemoryRouter>
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole("button", { name: surface === "journal card" ? "journal.record-options" : "common.more" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: title }));
    const dialog = await screen.findByRole("dialog", { name: title });
    await waitFor(() => expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(dialog).toBeVisible();
    expect(
      await within(dialog).findByText(title === "journal.recent-versions" ? "journal.restore-version" : "journal.download-original"),
    ).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    client.clear();
    vi.unstubAllGlobals();
  });
});
