import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ViewComposerDialog from "@/components/ViewComposer";
import { AppSidebarProvider, useAppSidebar } from "@/contexts/AppSidebarContext";
import type { ViewScope } from "@/lib/view-scope";
import { MemoView_IconSchema, MemoViewSchema } from "@/types/proto/api/v1/user_service_pb";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  setMemoView: vi.fn(),
  retry: vi.fn(),
  views: [] as Array<{ name: string; title: string; filter: string }>,
  candidates: { memos: [] as Array<{ name: string; content: string }>, isFetching: false, isError: false, hasNextPage: false },
}));

vi.mock("@/connect", () => ({ userServiceClient: { createMemoView: mocks.create, updateMemoView: mocks.update } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/steven" }) }));
vi.mock("@/hooks/useUserQueries", () => ({
  useMemoViews: () => ({ data: mocks.views }),
  useAllUserStats: () => ({ data: [] }),
  userKeys: { memoViews: () => ["views"] },
}));
vi.mock("@/hooks/useJournalQueries", () => ({
  useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai" }, isPending: false }),
}));
vi.mock("@/hooks/useJournalPartitionQueries", () => ({
  useJournalPartitions: () => ({ data: { partitions: [{ id: "p1", name: "Work" }] } }),
}));
vi.mock("@/hooks/useMemoCandidateSearch", () => ({
  useMemoCandidateSearch: () => ({ ...mocks.candidates, retry: mocks.retry }),
}));
vi.mock("@/contexts/MemoFilterContext", () => ({
  useMemoFilterContext: () => ({ setMemoView: mocks.setMemoView, filters: [], removeFilter: vi.fn(), setFilters: vi.fn() }),
}));
vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: Record<string, unknown>) => [key, ...Object.values(params ?? {})].join(" "),
}));

const TAG_SCOPE: ViewScope = { filters: [{ factor: "tagSearch", value: "work" }], residual: "" };
// Stored form: the tag group keeps its own parens and combineCELFilters wraps
// every clause once more — exactly what the live search path emits as well.
const TAG_CEL = '((("work" in tags || tags.exists(t, t.startsWith("work/")))))';
const RESIDUAL = "created_ts.getMonth() == now.getMonth()";
const emoji = create(MemoView_IconSchema, { value: { case: "emoji", value: "🌱" } });
const existingView = create(MemoViewSchema, {
  name: "users/steven/views/garden",
  title: "Garden",
  filter: `("work" in tags || tags.exists(t, t.startsWith("work/"))) && pinned && ${RESIDUAL}`,
  icon: emoji,
});

const Harness = () => {
  const { setViewComposer } = useAppSidebar();
  const [opened, setOpened] = useState(false);
  return (
    <>
      <button type="button" onClick={() => (setViewComposer({ scope: TAG_SCOPE }), setOpened(true))}>
        open-create
      </button>
      <button type="button" onClick={() => (setViewComposer({ editing: existingView }), setOpened(true))}>
        open-edit
      </button>
      <button type="button" onClick={() => setViewComposer({})}>
        open-empty
      </button>
      <output data-testid="opened">{String(opened)}</output>
      <ViewComposerDialog />
    </>
  );
};

const renderComposer = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/"]}>
        <AppSidebarProvider>
          <Harness />
        </AppSidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.views = [];
  mocks.candidates = { memos: [], isFetching: false, isError: false, hasNextPage: false };
  mocks.create.mockImplementation(({ validateOnly, memoView }: { validateOnly?: boolean; memoView: { filter: string } }) =>
    validateOnly && memoView.filter.includes("!!!")
      ? Promise.reject(new Error("invalid syntax"))
      : Promise.resolve({ name: "users/steven/views/new-view" }),
  );
  mocks.update.mockResolvedValue({});
});

describe("view composer", () => {
  it("saves a scoped filter by name only and lands on the new view", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-create" }));

    // The carried-in condition is already visible; the name is all that is missing.
    expect(screen.getByText("#work")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "common.name" }), { target: { value: "Work" } });

    // Validation is automatic — the same create call the server uses to compile.
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ validateOnly: true })));
    await waitFor(() => expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenLastCalledWith({
        parent: "users/steven",
        memoView: { name: "", title: "Work", filter: TAG_CEL, icon: undefined },
      }),
    );
    expect(mocks.setMemoView).toHaveBeenCalledWith("new-view");
  });

  it("keeps an unrecognizable legacy clause verbatim as an advanced condition", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-edit" }));

    // Visual clauses become chips; the calendar-month clause stays verbatim.
    expect(screen.getByText("#work")).toBeInTheDocument();
    expect(screen.getByText("view.facet.pinned")).toBeInTheDocument();
    // The residual clause is visible verbatim on its chip — never silently converted.
    expect(screen.getByRole("button", { name: new RegExp(RESIDUAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeInTheDocument();
    expect(screen.getByLabelText("view.advanced")).toHaveValue(RESIDUAL);

    await waitFor(() => expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          memoView: expect.objectContaining({
            name: existingView.name,
            title: "Garden",
            icon: emoji,
            filter: `${TAG_CEL} && (pinned) && (${RESIDUAL})`,
          }),
          updateMask: expect.objectContaining({ paths: ["title", "filter", "icon"] }),
        }),
      ),
    );
  });

  it("shows a concrete validation error and keeps the draft", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-empty" }));
    fireEvent.click(screen.getByRole("button", { name: "view.advanced" }));
    fireEvent.change(screen.getByLabelText("view.advanced"), { target: { value: "!!!" } });
    fireEvent.change(screen.getByRole("textbox", { name: "common.name" }), { target: { value: "Broken" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("invalid syntax"));
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    // The draft survives: cancel and reopening is a fresh dialog, but staying is untouched.
    expect(screen.getByRole("textbox", { name: "common.name" })).toHaveValue("Broken");
  });

  it("blocks saving when the conditions duplicate another view", async () => {
    mocks.views = [{ name: "users/steven/views/work", title: "Existing work", filter: TAG_CEL }];
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-create" }));
    fireEvent.change(screen.getByRole("textbox", { name: "common.name" }), { target: { value: "Work copy" } });

    await screen.findByText(/view\.duplicate-conditions/);
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("offers retry and empty states for the preview instead of failing silently", async () => {
    mocks.candidates.isError = true;
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-create" }));
    expect(screen.getByText("view.preview-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "search.retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it("saves on Enter from the name field once conditions are valid", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-create" }));
    const nameInput = screen.getByRole("textbox", { name: "common.name" });
    expect(nameInput).toHaveFocus();

    fireEvent.change(nameInput, { target: { value: "Work" } });
    // Enter while validation is still pending must not save half-ready state.
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect(mocks.create).not.toHaveBeenCalledWith(expect.objectContaining({ memoView: expect.objectContaining({ title: "Work" }) }));

    await waitFor(() => expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled());
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.create).toHaveBeenLastCalledWith({
        parent: "users/steven",
        memoView: { name: "", title: "Work", filter: TAG_CEL, icon: undefined },
      }),
    );
  });

  it("closing without saving leaves nothing behind", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "open-create" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Whatever was called was a dry run — nothing was actually written.
    expect(mocks.create.mock.calls.every(([request]) => (request as { validateOnly?: boolean }).validateOnly)).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
