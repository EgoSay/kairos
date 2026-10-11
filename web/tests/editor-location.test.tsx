import { create } from "@bufbuild/protobuf";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "@/components/MemoEditor/hooks/useLocation";
import { lookupLocationName } from "@/components/map/useReverseGeocoding";
import { LocationSchema } from "@/types/proto/api/v1/memo_service_pb";

vi.mock("@/components/map/useReverseGeocoding", () => ({ lookupLocationName: vi.fn() }));
const device = vi.fn();
const original = () => create(LocationSchema, { latitude: 31.2, longitude: 121.4, placeholder: "原来的名字" });
const position = (latitude = 32, longitude = 122, accuracy = 1000) =>
  ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;

describe("editor location session", () => {
  beforeEach(() => {
    device.mockReset();
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: device } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("preserves the original on open/cancel and never automatically locates or resolves names", () => {
    const { result } = renderHook(() => useLocation(original()));
    expect(device).not.toHaveBeenCalled();
    expect(lookupLocationName).not.toHaveBeenCalled();
    act(() => result.current.handlePositionChange({ lat: 1, lng: 2 }, "草稿"));
    act(() => result.current.reset(original()));
    expect(result.current.getLocation()).toMatchObject(original());
  });
  it("never substitutes the map center and accepts explicit zero coordinates without a name", () => {
    const { result } = renderHook(() => useLocation());
    expect(result.current.getLocation()).toBeUndefined();
    act(() => result.current.updateCoordinate("lat", "0"));
    expect(result.current.getLocation()).toBeUndefined();
    act(() => result.current.updateCoordinate("lng", "0"));
    expect(result.current.getLocation()).toMatchObject({ latitude: 0, longitude: 0, placeholder: "" });
    act(() => result.current.updateCoordinate("lat", "91"));
    expect(result.current.getLocation()).toBeUndefined();
    act(() => result.current.updateCoordinate("lat", "12oops"));
    expect(result.current.getLocation()).toBeUndefined();
  });
  it("ignores a late device result after a manual selection and after cancel/reopen", () => {
    const { result } = renderHook(() => useLocation(original()));
    act(() => result.current.locate());
    const first = device.mock.calls[0][0] as PositionCallback;
    act(() => result.current.handlePositionChange({ lat: 1, lng: 2 }, "手选"));
    act(() => first(position()));
    expect(result.current.getLocation()).toMatchObject({ latitude: 1, longitude: 2, placeholder: "手选" });
    act(() => result.current.locate());
    const second = device.mock.calls[1][0] as PositionCallback;
    act(() => result.current.reset(original()));
    act(() => second(position()));
    expect(result.current.getLocation()).toMatchObject(original());
  });
  it("keeps the previous location on denied permission, timeout and unavailable position", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLocation(original()));
    for (const code of [1, 2, 3]) {
      act(() => result.current.locate());
      const fail = device.mock.lastCall![1] as PositionErrorCallback;
      act(() => fail({ code } as GeolocationPositionError));
      expect(result.current.state.locationError).not.toBe("");
      expect(result.current.getLocation()).toMatchObject(original());
      expect(result.current.state.locating).toBe(false);
    }
    act(() => result.current.locate());
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.state.locationError).toContain("超时");
    act(() => (device.mock.lastCall![0] as PositionCallback)(position()));
    expect(result.current.getLocation()).toMatchObject(original());
  });
  it("exposes low accuracy for confirmation and does not reverse-geocode device coordinates automatically", () => {
    const { result } = renderHook(() => useLocation());
    act(() => result.current.locate());
    act(() => (device.mock.lastCall![0] as PositionCallback)(position()));
    expect(result.current.state.accuracyMeters).toBe(1000);
    expect(result.current.state.locating).toBe(false);
    expect(lookupLocationName).not.toHaveBeenCalled();
  });
  it("does not let late names override a manual name or another selected point", async () => {
    let complete!: (value: { name: string }) => void;
    vi.mocked(lookupLocationName).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { result } = renderHook(() => useLocation(original()));
    let task!: Promise<void>;
    act(() => {
      task = result.current.resolveName();
    });
    act(() => result.current.setPlaceholder("我自己的名字"));
    await act(async () => {
      complete({ name: "迟到的名称" });
      await task;
    });
    expect(result.current.state.placeholder).toBe("我自己的名字");
    act(() => {
      task = result.current.resolveName();
    });
    act(() => result.current.handlePositionChange({ lat: 5, lng: 6 }, "另一处"));
    await act(async () => {
      complete({ name: "更早地点的名字" });
      await task;
    });
    expect(result.current.getLocation()).toMatchObject({ latitude: 5, longitude: 6, placeholder: "另一处" });
  });
  it("allows saving verified coordinates when name lookup fails", async () => {
    vi.mocked(lookupLocationName).mockRejectedValue(new Error("名称服务不可用"));
    const { result } = renderHook(() => useLocation());
    act(() => result.current.handlePositionChange({ lat: 31, lng: 121 }));
    await act(() => result.current.resolveName());
    expect(result.current.state.nameError).toBe("名称服务不可用");
    expect(result.current.getLocation()).toMatchObject({ latitude: 31, longitude: 121, placeholder: "" });
  });
  it("preserves a name-only place on reopen and does not treat invalid coordinate edits as one", () => {
    const label = create(LocationSchema, { placeholder: "家", nameOnly: true });
    const { result } = renderHook(() => useLocation(label));
    expect(result.current.state.position).toBeUndefined();
    expect(result.current.getLocation()).toMatchObject({ placeholder: "家", nameOnly: true });
    act(() => result.current.updateCoordinate("lat", "31"));
    expect(result.current.getLocation()).toBeUndefined();
    act(() => result.current.updateCoordinate("lng", "121"));
    expect(result.current.getLocation()).toMatchObject({ placeholder: "家", nameOnly: false, latitude: 31, longitude: 121 });
  });
  it("ignores late coordinates after selecting a name-only place", () => {
    const { result } = renderHook(() => useLocation());
    act(() => result.current.locate());
    const complete = device.mock.calls[0][0] as PositionCallback;
    act(() => result.current.reset(create(LocationSchema, { placeholder: "咖啡店", nameOnly: true })));
    act(() => complete(position()));
    expect(result.current.getLocation()).toMatchObject({ placeholder: "咖啡店", nameOnly: true });
    expect(result.current.state.position).toBeUndefined();
  });
});
