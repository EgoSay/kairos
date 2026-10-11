import { useEffect, useRef, useState } from "react";
import type { useLocation } from "@/components/MemoEditor/hooks/useLocation";
import { LazyLocationPicker } from "@/components/map/LazyLocationPicker";
import type { MapPoint } from "@/components/map/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type NamedPlace, type PlaceCandidate, searchPublicPlaces, useJournalLocations } from "@/hooks/useJournalLocations";

interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReturnType<typeof useLocation>["state"];
  onPositionChange: (position: MapPoint, name?: string) => void;
  onUpdateCoordinate: (type: "lat" | "lng", value: string) => void;
  onPlaceholderChange: (placeholder: string) => void;
  onLocate: () => void;
  onResolveName: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onReturnToEditor?: () => void;
}

export const LocationDialog = ({
  open,
  onOpenChange,
  state,
  onPositionChange,
  onUpdateCoordinate,
  onPlaceholderChange,
  onLocate,
  onResolveName,
  onCancel,
  onConfirm,
  onReturnToEditor,
}: LocationDialogProps) => {
  const locations = useJournalLocations(open);
  const [query, setQuery] = useState("");
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
    setQuery("");
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
  const select = (place: Pick<NamedPlace, "name" | "latitude" | "longitude">, id = "") => {
    setSelectedFavorite(id);
    setSavedMessage("");
    onPositionChange({ lat: place.latitude, lng: place.longitude }, place.name);
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
      const value = await searchPublicPlaces(query.trim(), controller.signal);
      if (request !== sequence.current) return;
      setResults(value.places);
      setSearched(true);
    } catch (failure) {
      if (request !== sequence.current) return;
      setError(failure instanceof Error ? failure.message : "地点搜索失败，请重试或手动选点。");
    } finally {
      if (request === sequence.current) setSearching(false);
    }
  };
  const saveFavorite = async () => {
    if (!state.position || !state.placeholder.trim() || !locations.data) return;
    const request = sequence.current;
    const id = selectedFavorite || crypto.randomUUID();
    const place = { id, name: state.placeholder.trim(), latitude: state.position.lat, longitude: state.position.lng };
    try {
      await locations.save.mutateAsync({
        version: locations.data.version,
        places: [...locations.data.places.filter((item) => item.id !== id), place],
      });
      if (request !== sequence.current) return;
      setSelectedFavorite(id);
      setSavedMessage("常用地点已保存；历史记录的位置与名称没有改变。");
    } catch {
      /* Mutation error retains the user's draft below. */
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
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(value) => {
        if (!value) onReturnToEditor?.();
      }}
    >
      <DialogContent
        className="max-w-[min(34rem,calc(100vw-2rem))] h-[min(46rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] p-0! [&>div]:min-h-0 [&>div]:overflow-hidden [&>div]:gap-0 [&_button]:min-h-11 [&_input]:min-h-11"
        showCloseButton={false}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <header className="space-y-2">
            <DialogTitle className="font-serif text-xl">添加位置</DialogTitle>
            <DialogDescription className="text-sm">选择后预览并确认；打开此页不会改变原位置。</DialogDescription>
          </header>
          <Button
            type="button"
            variant="outline"
            disabled={state.locating}
            onClick={() => {
              setSelectedFavorite("");
              onLocate();
            }}
          >
            {state.locating ? "正在获取设备位置…" : "使用当前位置"}
          </Button>
          {state.locationError && (
            <p role="alert" className="text-sm text-destructive">
              {state.locationError}
            </p>
          )}
          {state.accuracyMeters !== undefined && (
            <p role="status" className="text-sm">
              设备报告精度约 ±{Math.ceil(state.accuracyMeters)} 米。
              {state.accuracyMeters > 200 ? "当前精度较低，请核对地图或手动选点后确认。" : "请核对候选位置后确认。"}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim().length >= 2) void search();
            }}
          >
            <Input
              aria-label="搜索公开地点名称"
              placeholder="搜索公开地点，如城市、公园、车站"
              value={query}
              maxLength={200}
              onChange={(event) => {
                sequence.current += 1;
                searchController.current?.abort();
                setSearching(false);
                setSearched(false);
                setResults([]);
                setError("");
                setQuery(event.target.value);
              }}
            />
            <Button type="submit" variant="outline" disabled={searching || query.trim().length < 2}>
              {searching ? "搜索中…" : "搜索"}
            </Button>
          </form>
          <p className="text-xs leading-5 text-muted-foreground">
            搜索会将关键词发送至 OSM 地点服务；“识别地点名称”会发送所选坐标。私人地址可直接手动命名，避免向外部服务提交私人信息。
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {searched && results.length === 0 && (
            <p role="status" className="text-sm">
              没有找到地点，可补充城市名后搜索，或手动选点。
            </p>
          )}
          {results.length > 0 && (
            <ul aria-label="地点搜索结果" className="max-h-40 overflow-y-auto divide-y rounded-lg border">
              {results.map((place, index) => (
                <li key={`${place.latitude},${place.longitude},${index}`}>
                  <button
                    type="button"
                    className="w-full min-h-11 px-3 py-2 text-left hover:bg-muted"
                    aria-label={`预览地点 ${place.name}，${place.address}`}
                    onClick={() => select(place)}
                  >
                    <span className="block text-sm font-medium">{place.name}</span>
                    <span className="block text-xs text-muted-foreground">{place.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {locations.isError && (
            <div className="text-sm">
              <p role="alert">常用地点读取失败，仍可手动选择。</p>
              <Button type="button" variant="ghost" onClick={() => void locations.refetch()}>
                重试读取地点
              </Button>
            </div>
          )}
          {locations.data && (
            <div className="space-y-3">
              {locations.data.places.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">常用地点</h3>
                  <div className="flex flex-wrap gap-2">
                    {locations.data.places.map((place) => (
                      <div key={place.id} className="flex rounded-lg border">
                        <button type="button" className="min-h-11 px-3 text-sm" onClick={() => select(place, place.id)}>
                          {place.name}
                        </button>
                        <button
                          type="button"
                          className="min-h-11 min-w-10 border-l text-sm text-muted-foreground"
                          aria-label={`移除常用地点 ${place.name}`}
                          disabled={locations.save.isPending}
                          onClick={() => void removeFavorite(place.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {locations.data.recent.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">最近记录中的地点</h3>
                  <div className="flex flex-wrap gap-2">
                    {locations.data.recent.map((place) => (
                      <Button key={place.id} type="button" size="sm" variant="outline" className="min-h-10" onClick={() => select(place)}>
                        {place.name}
                      </Button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          <div className="h-44 sm:h-52 rounded-xl overflow-hidden bg-muted/30">
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
          {!state.position && <p className="text-sm text-muted-foreground">地图当前仅供浏览，尚未选中任何位置。</p>}
          <div className="space-y-2">
            <Label htmlFor="memo-location-placeholder">地点名称（可留空，仅保存坐标）</Label>
            <Input
              id="memo-location-placeholder"
              placeholder="给这个地方一个自己的名字"
              maxLength={200}
              value={state.placeholder}
              onChange={(event) => onPlaceholderChange(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!state.position || state.resolving} onClick={onResolveName}>
                {state.resolving ? "正在识别名称…" : "识别地点名称"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!state.position || !state.placeholder.trim() || !locations.data || locations.isError || locations.save.isPending}
                onClick={() => void saveFavorite()}
              >
                {selectedFavorite ? "更新常用地点名称" : "保存为常用地点"}
              </Button>
            </div>
            {state.nameError && (
              <p role="alert" className="text-sm text-destructive">
                {state.nameError}
              </p>
            )}
            {locations.save.error && (
              <p role="alert" className="text-sm text-destructive">
                常用地点未保存：{locations.save.error.message}。草稿仍保留，可重试。
              </p>
            )}
            {savedMessage && (
              <p role="status" className="text-xs text-muted-foreground">
                {savedMessage}
              </p>
            )}
          </div>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">高级：经纬度（WGS84）</summary>
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
              Nominatim 使用规则
            </a>
          </p>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t p-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!state.position}>
            确认此位置
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
};
