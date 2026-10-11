import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { useLocation } from "@/components/MemoEditor/hooks/useLocation";
import { LocationDialog } from "@/components/MemoMetadata/Location/LocationDialog";
import { journalRequest } from "@/hooks/useJournalQueries";

vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice" }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ journalRequest: vi.fn() }));
vi.mock("@/components/map/LazyLocationPicker", () => ({ LazyLocationPicker: () => null }));
vi.mock("@/components/map/useReverseGeocoding", () => ({ lookupLocationName: vi.fn() }));
function Harness() {
  const [open, setOpen] = useState(true);
  const draft = useLocation();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        再次添加位置
      </button>
      <LocationDialog
        open={open}
        onOpenChange={setOpen}
        state={draft.state}
        onPositionChange={draft.handlePositionChange}
        onUpdateCoordinate={draft.updateCoordinate}
        onPlaceholderChange={draft.setPlaceholder}
        onLocate={draft.locate}
        onResolveName={() => void draft.resolveName()}
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      />
    </>
  );
}
it("reloads recent places on immediate reopen after a record was saved elsewhere", async () => {
  vi.mocked(journalRequest)
    .mockResolvedValueOnce({ places: [], version: 0, recent: [] })
    .mockResolvedValueOnce({
      places: [],
      version: 0,
      recent: [{ id: "new-place", name: "刚保存的地点", latitude: 31, longitude: 121 }],
    });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(journalRequest).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "再次添加位置" }));
  expect(await screen.findByRole("button", { name: "刚保存的地点" })).toBeInTheDocument();
  expect(journalRequest).toHaveBeenCalledTimes(2);
});
