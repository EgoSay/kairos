import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon, MapIcon, MapPinIcon, NavigationIcon, PencilIcon, XIcon } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { useLocation } from "@/components/MemoEditor/hooks/useLocation";
import { LazyLocationPicker } from "@/components/map/LazyLocationPicker";
import type { MapPoint } from "@/components/map/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { type NamedPlace, type PlaceCandidate, searchPublicPlaces, useJournalLocations } from "@/hooks/useJournalLocations";
import { type Location, LocationSchema } from "@/types/proto/api/v1/memo_service_pb";

interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  state: ReturnType<typeof useLocation>["state"];
  onPositionChange: (position: MapPoint, name?: string) => void;
  onUpdateCoordinate: (type: "lat" | "lng", value: string) => void;
  onPlaceholderChange: (placeholder: string) => void;
  onLocate: () => void;
  onResolveName: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSelect: (location: Location) => void;
  onReturnToEditor?: () => void;
}

const asLocation = (place: Pick<NamedPlace, "name" | "latitude" | "longitude" | "nameOnly">) =>
  create(LocationSchema, {
    placeholder: place.name,
    ...(place.nameOnly ? { nameOnly: true } : { latitude: place.latitude, longitude: place.longitude }),
  });

/** A place is picked beside the editor. Public map services only mount after
 * an explicit map action; a personal name needs no coordinates or lookup. */
export const LocationDialog = ({
  open,
  onOpenChange,
  anchorRef,
  state,
  onPositionChange,
  onUpdateCoordinate,
  onPlaceholderChange,
  onLocate,
  onResolveName,
  onCancel,
  onConfirm,
  onSelect,
  onReturnToEditor,
}: LocationDialogProps) => {
  const locations = useJournalLocations(open);
  const titleId = useId();
  const labelId = useId();
  const [view, setView] = useState<"quick" | "map" | "manage">("quick");
  const [query, setQuery] = useState("");
  const [mapQuery, setMapQuery] = useState("");
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [selectedFavorite, setSelectedFavorite] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const sequence = useRef(0);
  const searchController = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    sequence.current += 1;
    searchController.current?.abort();
    setView("quick");
    setQuery("");
    setMapQuery("");
    setResults([]);
    setSearching(false);
    setSearched(false);
    setError("");
    setSelectedFavorite("");
    setSavedMessage("");
    setMapError(false);
    return () => {
      sequence.current += 1;
      searchController.current?.abort();
    };
  }, [open]);
  const editFavorite = (place: NamedPlace) => {
    setSelectedFavorite(place.id);
    setSavedMessage("");
    if (place.nameOnly) {
      onUpdateCoordinate("lat", "");
      onUpdateCoordinate("lng", "");
      onPlaceholderChange(place.name);
    } else onPositionChange({ lat: place.latitude, lng: place.longitude }, place.name);
  };
  const search = async () => {
    const request = ++sequence.current;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setError("");
    setResults([]);
    setSearched(false);
    try {
      const value = await searchPublicPlaces(mapQuery.trim(), controller.signal);
      if (request !== sequence.current) return;
      setResults(value.places);
      setSearched(true);
    } catch (failure) {
      if (request !== sequence.current) return;
      setError(failure instanceof Error ? failure.message : "地点搜索失败，可以重试或只记地点名。");
    } finally {
      if (request === sequence.current) setSearching(false);
    }
  };
  const saveFavorite = async () => {
    if (!state.placeholder.trim() || !locations.data || (!state.position && (state.latInput.trim() || state.lngInput.trim()))) return;
    const request = sequence.current;
    const id = selectedFavorite || crypto.randomUUID();
    const place: NamedPlace = {
      id,
      name: state.placeholder.trim(),
      latitude: state.position?.lat ?? 0,
      longitude: state.position?.lng ?? 0,
      ...(!state.position ? { nameOnly: true } : {}),
    };
    try {
      await locations.save.mutateAsync({
        version: locations.data.version,
        places: [...locations.data.places.filter((item) => item.id !== id), place],
      });
      if (request !== sequence.current) return;
      setSelectedFavorite(id);
      setSavedMessage("常用地点已保存，历史记录保持原样。");
    } catch {
      /* Retain input and expose the mutation error below. */
    }
  };
  const removeFavorite = async (id: string) => {
    if (!locations.data) return;
    const request = sequence.current;
    try {
      await locations.save.mutateAsync({ version: locations.data.version, places: locations.data.places.filter((item) => item.id !== id) });
      if (request !== sequence.current) return;
      if (selectedFavorite === id) setSelectedFavorite("");
      setSavedMessage("已移除常用地点，记录中的位置仍保留。");
    } catch {
      /* Preserve input and show the action error. */
    }
  };
  const matches = (place: NamedPlace) => place.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const favorites = (locations.data?.places ?? []).filter(matches);
  const recent = (locations.data?.recent ?? [])
    .filter(matches)
    .filter(
      (place) =>
        !favorites.some(
          (favorite) =>
            favorite.name === place.name &&
            Boolean(favorite.nameOnly) === Boolean(place.nameOnly) &&
            (place.nameOnly || (favorite.latitude === place.latitude && favorite.longitude === place.longitude)),
        ),
    );
  const locationName = (
    <div className="space-y-2">
      <Label htmlFor={labelId}>地点名称</Label>
      <Input
        id={labelId}
        placeholder="给这个地方一个自己的名字"
        maxLength={200}
        value={state.placeholder}
        onChange={(event) => onPlaceholderChange(event.target.value)}
      />
    </div>
  );
  const suggestions = (places: NamedPlace[], title: string) =>
    places.length > 0 && (
      <section className="space-y-1" aria-label={title}>
        <h3 className="px-2 pt-2 text-xs text-muted-foreground">{title}</h3>
        {places.map((place) => (
          <button
            key={place.id}
            type="button"
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted"
            onClick={() => onSelect(asLocation(place))}
          >
            <MapPinIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{place.name}</span>
          </button>
        ))}
      </section>
    );
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(value) => {
        if (!value) onReturnToEditor?.();
      }}
    >
      <PopoverContent
        anchor={anchorRef}
        align="start"
        side="top"
        sideOffset={8}
        role="dialog"
        aria-labelledby={titleId}
        className="w-[min(23rem,calc(100vw-2rem))] max-h-[min(38rem,calc(100dvh-2rem))] overflow-y-auto rounded-xl p-3 [&_button]:min-h-11 [&_input]:min-h-11"
      >
        <header className="mb-3 flex items-center gap-2">
          {view !== "quick" && (
            <Button type="button" size="icon" variant="ghost" aria-label="返回地点选择" onClick={() => setView("quick")}>
              <ArrowLeftIcon className="size-4" />
            </Button>
          )}
          <h2 id={titleId} className="flex-1 font-medium">
            {view === "quick" ? "添加位置" : view === "map" ? "在地图上选择" : "常用地点"}
          </h2>
          <Button type="button" size="icon" variant="ghost" aria-label="取消" onClick={onCancel}>
            <XIcon className="size-4" />
          </Button>
        </header>
        {view === "quick" && (
          <div className="space-y-2">
            <Input
              aria-label="搜索自己的地点或只记名称"
              placeholder="搜索常用地点，或记一个名字"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && query.trim()) {
                  event.preventDefault();
                  onSelect(create(LocationSchema, { placeholder: query.trim(), nameOnly: true }));
                }
              }}
            />
            <div className="max-h-60 overflow-y-auto">
              {suggestions(favorites, "常用地点")}
              {suggestions(recent, "最近使用")}
              {locations.isPending && (
                <p role="status" className="p-2 text-sm text-muted-foreground">
                  正在读取地点…
                </p>
              )}
              {query.trim() && (
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted"
                  onClick={() => onSelect(create(LocationSchema, { placeholder: query.trim(), nameOnly: true }))}
                >
                  <PencilIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">只记“{query.trim()}”</span>
                </button>
              )}
              {!locations.isPending && favorites.length === 0 && recent.length === 0 && !query.trim() && (
                <p className="px-2 py-3 text-sm text-muted-foreground">写下地点名就可以，例如“家”或“楼下咖啡店”。</p>
              )}
            </div>
            <Button type="button" variant="ghost" className="w-full justify-start" disabled={state.locating} onClick={onLocate}>
              <NavigationIcon className="size-4" />
              {state.locating ? "正在获取设备位置…" : "使用当前位置"}
            </Button>
            {state.locationError && (
              <p role="alert" className="px-2 text-sm text-muted-foreground">
                {state.locationError}
              </p>
            )}
            {state.deviceCandidate && state.position && (
              <section className="space-y-3 rounded-lg border p-3" aria-label="设备位置候选">
                <p role="status" className="text-sm text-muted-foreground">
                  {state.accuracyMeters === undefined
                    ? "设备未报告定位精度，请核对后使用。"
                    : `设备报告精度约 ±${Math.ceil(state.accuracyMeters)} 米。${state.accuracyMeters > 200 ? "当前精度较低，请核对后使用。" : "请核对后使用。"}`}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {state.position.lat.toFixed(5)}°, {state.position.lng.toFixed(5)}°
                </p>
                {locationName}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setView("map")}>
                    查看地图
                  </Button>
                  <Button type="button" onClick={onConfirm}>
                    使用此位置
                  </Button>
                </div>
              </section>
            )}
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => setView("map")}>
              <MapIcon className="size-4" />
              搜索地图上的地点
            </Button>
            <Button type="button" variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => setView("manage")}>
              管理常用地点
            </Button>
          </div>
        )}
        {locations.isError && (
          <div className="mt-2 text-sm">
            <p role="alert">常用地点读取失败，仍可只记名称或使用地图。</p>
            <Button type="button" variant="ghost" onClick={() => void locations.refetch()}>
              重试读取地点
            </Button>
          </div>
        )}
        {view === "map" && (
          <div className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (mapQuery.trim().length >= 2) void search();
              }}
            >
              <Input
                aria-label="搜索公开地点名称"
                placeholder="城市、公园或车站"
                value={mapQuery}
                maxLength={200}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
                }}
                onChange={(event) => {
                  sequence.current += 1;
                  searchController.current?.abort();
                  setSearching(false);
                  setSearched(false);
                  setResults([]);
                  setError("");
                  setMapQuery(event.target.value);
                }}
              />
              <Button type="submit" variant="outline" disabled={searching || mapQuery.trim().length < 2}>
                {searching ? "搜索中…" : "搜索"}
              </Button>
            </form>
            <p className="text-xs leading-5 text-muted-foreground">
              搜索将关键词发送至 OSM；识别名称会发送所选坐标。私人地址可以返回后只记名称。
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {searched && results.length === 0 && (
              <p role="status" className="text-sm">
                没有找到地点，可补充城市名，或返回后只记名称。
              </p>
            )}
            {results.length > 0 && (
              <ul aria-label="地点搜索结果" className="max-h-48 overflow-y-auto divide-y rounded-lg border">
                {results.map((place, index) => (
                  <li key={`${place.latitude},${place.longitude},${index}`}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-muted"
                      aria-label={`选择地点 ${place.name}，${place.address}`}
                      onClick={() => onSelect(asLocation(place))}
                    >
                      <span className="block text-sm font-medium">{place.name}</span>
                      <span className="block text-xs text-muted-foreground">{place.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="h-44 overflow-hidden rounded-xl bg-muted/30">
              {open && (
                <LazyLocationPicker
                  key={mapAttempt}
                  className="h-full"
                  latlng={state.position}
                  onError={() => setMapError(true)}
                  onChange={(position) => {
                    setSelectedFavorite("");
                    onPositionChange(position);
                  }}
                />
              )}
            </div>
            {mapError && (
              <p role="alert" className="text-sm">
                底图未完整加载，已选坐标仍保留。
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => {
                    setMapError(false);
                    setMapAttempt((value) => value + 1);
                  }}
                >
                  重新加载地图
                </button>
              </p>
            )}
            {!state.position && <p className="text-sm text-muted-foreground">地图仅供浏览，点击地图才能选择位置。</p>}
            {state.deviceCandidate && state.accuracyMeters !== undefined && (
              <p role="status" className="text-sm text-muted-foreground">
                设备报告精度约 ±{Math.ceil(state.accuracyMeters)} 米{state.accuracyMeters > 200 ? "，当前精度较低，请核对。" : "。"}
              </p>
            )}
            {locationName}
            <Button type="button" size="sm" variant="ghost" disabled={!state.position || state.resolving} onClick={onResolveName}>
              {state.resolving ? "正在识别名称…" : "识别地点名称"}
            </Button>
            {state.nameError && (
              <p role="alert" className="text-sm text-muted-foreground">
                {state.nameError}
              </p>
            )}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm">填写经纬度</summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(
                  [
                    ["lat", "纬度", state.latInput],
                    ["lng", "经度", state.lngInput],
                  ] as const
                ).map(([type, label, value]) => (
                  <label key={type} className="space-y-1 text-sm">
                    {label}
                    <Input
                      inputMode="decimal"
                      value={value}
                      onChange={(event) => {
                        setSelectedFavorite("");
                        onUpdateCoordinate(type, event.target.value);
                      }}
                    />
                  </label>
                ))}
              </div>
              {(state.latInput || state.lngInput) && !state.position && (
                <p className="mt-2 text-sm text-destructive">请填写有效纬度（−90 至 90）和经度（−180 至 180）。</p>
              )}
            </details>
            <p className="text-xs text-muted-foreground">
              地点数据 ©{" "}
              <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap contributors
              </a>{" "}
              ·{" "}
              <a className="underline" href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">
                Nominatim
              </a>
            </p>
            <Button type="button" className="w-full" onClick={onConfirm} disabled={!state.position}>
              使用此位置
            </Button>
          </div>
        )}
        {view === "manage" && (
          <div className="space-y-3">
            {(locations.data?.places ?? []).map((place) => (
              <div key={place.id} className="flex items-center gap-2 rounded-lg border pl-3">
                <span className="min-w-0 flex-1 truncate text-sm">{place.name}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`编辑常用地点 ${place.name}`}
                  onClick={() => editFavorite(place)}
                >
                  <PencilIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`移除常用地点 ${place.name}`}
                  disabled={locations.save.isPending}
                  onClick={() => void removeFavorite(place.id)}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            ))}
            {locationName}
            <p className="text-xs text-muted-foreground">
              {state.position ? "保留已选坐标；修改常用名称不会改动历史记录。" : "只保存地点名，也可以在地图上补充坐标。"}
            </p>
            <Button type="button" variant="outline" onClick={() => setView("map")}>
              在地图上调整
            </Button>
            <Button
              type="button"
              className="w-full"
              disabled={
                !state.placeholder.trim() ||
                (!state.position && Boolean(state.latInput.trim() || state.lngInput.trim())) ||
                !locations.data ||
                locations.isError ||
                locations.save.isPending
              }
              onClick={() => void saveFavorite()}
            >
              {locations.save.isPending ? "保存中…" : selectedFavorite ? "更新常用地点名称" : "保存为常用地点"}
            </Button>
            {locations.save.error && (
              <p role="alert" className="text-sm text-destructive">
                常用地点未保存：{locations.save.error.message}。输入仍保留，可重试。
              </p>
            )}
            {savedMessage && (
              <p role="status" className="text-xs text-muted-foreground">
                {savedMessage}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
