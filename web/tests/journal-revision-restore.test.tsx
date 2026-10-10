import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import JournalRecordHistoryDialog from "@/components/JournalRecordHistoryDialog";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: request }));

beforeEach(() => {
  request.mockReset();
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
  expect(screen.getByText(/旧分享撤回，同步暂停/)).toBeVisible();
  const restore = await screen.findByText("恢复这个版本");
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
