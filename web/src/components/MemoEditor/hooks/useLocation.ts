import { create } from "@bufbuild/protobuf";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapPoint } from "@/components/map/types";
import { lookupLocationName } from "@/components/map/useReverseGeocoding";
import { type Location, LocationSchema } from "@/types/proto/api/v1/memo_service_pb";
import type { LocationState } from "../types/insertMenu";

interface DraftLocation extends LocationState {
  accuracyMeters?: number;
  deviceCandidate: boolean;
  locating: boolean;
  locationError: string;
  resolving: boolean;
  nameError: string;
}

const validPoint = (point?: MapPoint): point is MapPoint =>
  Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180);
const initialState = (location?: Location): DraftLocation => {
  const point = location && !location.nameOnly ? { lat: location.latitude, lng: location.longitude } : undefined;
  return {
    placeholder: location?.placeholder ?? "",
    position: validPoint(point) ? point : undefined,
    latInput: validPoint(point) ? String(point.lat) : "",
    lngInput: validPoint(point) ? String(point.lng) : "",
    deviceCandidate: false,
    locating: false,
    locationError: "",
    resolving: false,
    nameError: "",
  };
};

/** A location is a dialog draft until confirmed. Any manual action invalidates
 * older device and name responses, including after cancel/reopen. */
export const useLocation = (initialLocation?: Location) => {
  const [state, setState] = useState(() => initialState(initialLocation));
  const current = useRef(state);
  const revision = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lookup = useRef<AbortController | undefined>(undefined);
  const commit = useCallback((next: DraftLocation) => {
    current.current = next;
    setState(next);
  }, []);
  const invalidate = useCallback(() => {
    revision.current += 1;
    clearTimeout(timeout.current);
    lookup.current?.abort();
    return revision.current;
  }, []);
  useEffect(
    () => () => {
      invalidate();
    },
    [invalidate],
  );
  const reset = useCallback(
    (location?: Location) => {
      invalidate();
      commit(initialState(location));
    },
    [commit, invalidate],
  );
  const handlePositionChange = useCallback(
    (position: MapPoint, name = "") => {
      invalidate();
      if (!validPoint(position)) return;
      commit({ ...initialState(), position, placeholder: name, latInput: String(position.lat), lngInput: String(position.lng) });
    },
    [commit, invalidate],
  );
  const updateCoordinate = useCallback(
    (type: "lat" | "lng", value: string) => {
      invalidate();
      const next = {
        ...current.current,
        [type === "lat" ? "latInput" : "lngInput"]: value,
        locating: false,
        resolving: false,
        locationError: "",
        nameError: "",
        accuracyMeters: undefined,
        deviceCandidate: false,
      };
      const point = { lat: Number(next.latInput), lng: Number(next.lngInput) };
      next.position = next.latInput.trim() && next.lngInput.trim() && validPoint(point) ? point : undefined;
      commit(next);
    },
    [commit, invalidate],
  );
  const setPlaceholder = useCallback(
    (placeholder: string) => {
      invalidate();
      commit({ ...current.current, placeholder, locating: false, resolving: false, nameError: "" });
    },
    [commit, invalidate],
  );
  const locate = useCallback(() => {
    const request = invalidate();
    if (!navigator.geolocation || !window.isSecureContext) {
      commit({ ...current.current, locating: false, locationError: "暂时无法获取位置，可以选常用地点或输入名字。设备定位需要 HTTPS。" });
      return;
    }
    commit({ ...current.current, locating: true, resolving: false, locationError: "", nameError: "" });
    const fail = (code: number) => {
      if (request !== revision.current) return;
      revision.current += 1;
      clearTimeout(timeout.current);
      const message =
        code === 1
          ? "定位权限被拒绝，可以选常用地点或输入名字，也可在浏览器设置中允许后重试。"
          : code === 3
            ? "定位超时，可以选常用地点或输入名字。原位置未改变。"
            : "设备暂时无法确定位置，可以选常用地点或输入名字。";
      commit({ ...current.current, locating: false, locationError: message });
    };
    timeout.current = setTimeout(() => fail(3), 12_000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request !== revision.current) return;
        clearTimeout(timeout.current);
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (!validPoint(point)) {
          fail(2);
          return;
        }
        const accuracy = position.coords.accuracy;
        commit({
          ...initialState(),
          position: point,
          latInput: String(point.lat),
          lngInput: String(point.lng),
          accuracyMeters: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined,
          deviceCandidate: true,
        });
      },
      (error) => fail(error.code),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, [commit, invalidate]);
  const resolveName = useCallback(async () => {
    const point = current.current.position;
    if (!point) return;
    const request = invalidate();
    const controller = new AbortController();
    lookup.current = controller;
    commit({ ...current.current, locating: false, resolving: true, nameError: "" });
    try {
      const result = await lookupLocationName(point, controller.signal);
      if (request !== revision.current) return;
      commit({ ...current.current, placeholder: result.name, resolving: false });
    } catch (error) {
      if (request !== revision.current) return;
      commit({
        ...current.current,
        resolving: false,
        nameError: error instanceof Error ? error.message : "地点名称暂不可用，可手动填写或保留坐标。",
      });
    }
  }, [commit, invalidate]);
  const getLocation = useCallback((): Location | undefined => {
    const { position, placeholder } = current.current;
    if (!validPoint(position)) {
      // An incomplete manual coordinate edit must not silently become a name.
      if (current.current.latInput.trim() || current.current.lngInput.trim() || !placeholder.trim()) return undefined;
      return create(LocationSchema, { placeholder: placeholder.trim(), nameOnly: true });
    }
    return create(LocationSchema, { latitude: position.lat, longitude: position.lng, placeholder: placeholder.trim() });
  }, []);
  return { state, handlePositionChange, updateCoordinate, setPlaceholder, reset, getLocation, locate, resolveName };
};
