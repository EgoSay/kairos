import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import JournalRecordHistoryDialog from "@/components/JournalRecordHistoryDialog";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: request }));

beforeEach(() => {
  request.mockReset();
});

it.each([
  true,
  false,
])("distinguishes an initial read failure from empty history and retries successfully: has versions %s", async (hasVersions) => {
  let finishRetry!: (result: unknown) => void;
  request.mockRejectedValueOnce(new Error("temporary unavailable")).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRetry = resolve;
      }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <JournalRecordHistoryDialog name="memos/record" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load versions");
  const emptyMessage = "No recent versions of this record yet.";
  expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  await act(async () => {
    finishRetry({
      revisions: hasVersions
        ? [{ id: "recovered", createdTs: 1_700_000_000, memo: { name: "memos/record", content: "recovered version after retry" } }]
        : [],
    });
  });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  if (hasVersions) {
    expect(await screen.findByText("recovered version after retry")).toBeInTheDocument();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  } else {
    expect(await screen.findByText(emptyMessage)).toBeVisible();
    expect(screen.queryByText("Restore this version")).not.toBeInTheDocument();
  }
  expect(screen.getByRole("dialog", { name: "Recent versions" })).toBeVisible();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith("/memos/record/revisions");
  client.clear();
});

it.each([true, false])("refreshes derived authorization caches only after a successful restore: %s", async (success) => {
  request.mockImplementation(async (path: string) => {
    if (path.endsWith("/restore")) {
      if (!success) throw new Error("历史原件暂时不可用，当前记录已保留");
      return {};
    }
    return { revisions: [{ id: "old", createdTs: 1_700_000_000, memo: { name: "memos/record", content: "previous private content" } }] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const caches = [
    ["memos", "record"],
    ["journal", "shares"],
    ["journal", "insights"],
    ["journal-partitions", "deliveries"],
  ];
  for (const key of caches) client.setQueryData(key, { previouslyVisible: true });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <JournalRecordHistoryDialog name="memos/record" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/old shares are withdrawn/)).toBeVisible();
  const restore = await screen.findByText("Restore this version");
  const details = restore.closest("details");
  if (!details) throw new Error("revision details were not rendered");
  fireEvent.click(details.querySelector("summary")!);
  fireEvent.click(restore);
  if (success) {
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  } else {
    expect(await screen.findByRole("alert")).toHaveTextContent("历史原件暂时不可用");
    expect(onOpenChange).not.toHaveBeenCalled();
  }
  for (const key of caches) expect(client.getQueryState(key)?.isInvalidated).toBe(success);
});
