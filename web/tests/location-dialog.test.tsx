import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "@/components/MemoEditor/hooks/useLocation";
import { LocationDialog } from "@/components/MemoMetadata/Location/LocationDialog";
import { searchPublicPlaces } from "@/hooks/useJournalLocations";
import { type Location, LocationSchema } from "@/types/proto/api/v1/memo_service_pb";

const mocks = vi.hoisted(() => ({ save: vi.fn(), locate: vi.fn() }));
vi.mock("@/components/map/useReverseGeocoding", () => ({ lookupLocationName: vi.fn() }));
vi.mock("@/components/map/LazyLocationPicker", () => ({
  LazyLocationPicker: ({ onChange }: { onChange: (p: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onChange({ lat: 31, lng: 121 })}>
      选择地图上的地点
    </button>
  ),
}));
vi.mock("@/hooks/useJournalLocations", () => ({
  searchPublicPlaces: vi.fn(),
  useJournalLocations: () => ({
    data: { version: 1, places: [{ id: "office", name: "工作室", latitude: 32, longitude: 120 }], recent: [] },
    save: { mutateAsync: mocks.save, isPending: false },
    isError: false,
  }),
}));

function Harness({ original, onSave }: { original?: Location; onSave: (value?: Location) => void }) {
  const [open, setOpen] = useState(true);
  const draft = useLocation(original);
  const close = () => {
    draft.reset(original);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          draft.reset(original);
          setOpen(true);
        }}
      >
        重新打开位置
      </button>
      <LocationDialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        state={draft.state}
        onPositionChange={draft.handlePositionChange}
        onUpdateCoordinate={draft.updateCoordinate}
        onPlaceholderChange={draft.setPlaceholder}
        onLocate={draft.locate}
        onResolveName={() => void draft.resolveName()}
        onCancel={close}
        onConfirm={() => {
          onSave(draft.getLocation());
          setOpen(false);
        }}
      />
    </>
  );
}
describe("location dialog confirmation and public search", () => {
  beforeEach(() => {
    mocks.save.mockResolvedValue({});
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: mocks.locate } });
  });
  it("does not turn the default map viewport into a selected position", () => {
    const save = vi.fn();
    render(<Harness onSave={save} />);
    expect(screen.getByRole("button", { name: "确认此位置" })).toBeDisabled();
    expect(mocks.locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选择地图上的地点" }));
    expect(screen.getByRole("button", { name: "确认此位置" })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认此位置" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ latitude: 31, longitude: 121, placeholder: "" }));
  });
  it("cancels edits and reopens with the original value", async () => {
    const save = vi.fn();
    const original = create(LocationSchema, { latitude: 31, longitude: 121, placeholder: "原地点" });
    render(<Harness original={original} onSave={save} />);
    fireEvent.change(screen.getByLabelText("地点名称（可留空，仅保存坐标）"), { target: { value: "改过的名字" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重新打开位置" }));
    expect(screen.getByLabelText("地点名称（可留空，仅保存坐标）")).toHaveValue("原地点");
    expect(save).not.toHaveBeenCalled();
  });
  it("only searches on explicit submission, previews a result, then confirms it", async () => {
    vi.mocked(searchPublicPlaces).mockResolvedValue({
      places: [{ name: "人民公园", address: "上海人民公园", latitude: 31.23, longitude: 121.47 }],
    });
    const save = vi.fn();
    render(<Harness onSave={save} />);
    fireEvent.change(screen.getByLabelText("搜索公开地点名称"), { target: { value: "上海 人民公园" } });
    expect(searchPublicPlaces).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.click(await screen.findByRole("button", { name: "预览地点 人民公园，上海人民公园" }));
    expect(screen.getByLabelText("地点名称（可留空，仅保存坐标）")).toHaveValue("人民公园");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认此位置" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ latitude: 31.23, longitude: 121.47, placeholder: "人民公园" }));
  });
  it("renames a reusable place without confirming or rewriting a memo", async () => {
    const save = vi.fn();
    render(<Harness onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "工作室" }));
    fireEvent.change(screen.getByLabelText("地点名称（可留空，仅保存坐标）"), { target: { value: "我的工作室" } });
    fireEvent.click(screen.getByRole("button", { name: "更新常用地点名称" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({ version: 1, places: [{ id: "office", name: "我的工作室", latitude: 32, longitude: 120 }] }),
    );
    expect(save).not.toHaveBeenCalled();
  });
});
