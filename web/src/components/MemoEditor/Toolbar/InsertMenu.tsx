import { uniqBy } from "lodash-es";
import {
  CheckIcon,
  ClipboardIcon,
  CodeIcon,
  EllipsisIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  MapPinIcon,
  MicIcon,
  PaperclipIcon,
  TypeIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LinkMemoDialog, LocationDialog } from "@/components/MemoMetadata";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import type { MemoRelation } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { MemoLinkRequest } from "../Editor/memoLinkIntent";
import { useFileUpload, useLinkMemo, useLocation } from "../hooks";
import { useEditorContext, useEditorSelector } from "../state";
import type { InsertMenuProps } from "../types";
import type { LocalFile } from "../types/attachment";

const InsertMenu = (props: InsertMenuProps) => {
  const t = useTranslate();
  const { actions, dispatch, getState } = useEditorContext();
  const relations = useEditorSelector((s) => s.metadata.relations);
  const { location: initialLocation, onLocationChange, viewToggles, isUploading: isUploadingProp } = props;

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const inlineImageInputRef = useRef<HTMLInputElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const locationButtonRef = useRef<HTMLButtonElement>(null);
  const [activeLinkRequest, setActiveLinkRequest] = useState<MemoLinkRequest>();
  const handledLinkRequest = useRef<number | undefined>(undefined);
  const handledLocationRequest = useRef<number | undefined>(undefined);
  const { data: preferences } = useJournalPreferences();

  const { fileInputRef, selectingFlag, handleFileInputChange, handleUploadClick } = useFileUpload((newFiles: LocalFile[]) => {
    if (getState().ui.isLoading.saving) return;
    newFiles.forEach((file) => dispatch(actions.addLocalFile(file)));
  });

  const linkMemo = useLinkMemo({
    isOpen: linkDialogOpen,
    currentMemoName: props.memoName,
    existingRelations: relations,
    requestedMemoName: activeLinkRequest?.memoName,
    requestId: activeLinkRequest?.id,
    onAddRelation: (relation: MemoRelation) => {
      dispatch(actions.setMetadata({ relations: uniqBy([...relations, relation], (r) => r.relatedMemo?.name) }));
      setLinkDialogOpen(false);
      activeLinkRequest?.onLinked?.();
    },
  });

  const location = useLocation(props.location);
  const {
    state: locationState,
    handlePositionChange: handleLocationPositionChange,
    getLocation,
    reset: locationReset,
    updateCoordinate,
    setPlaceholder,
  } = location;

  const isUploading = selectingFlag || isUploadingProp;
  const insertionDisabled = isUploading || props.isSaving;

  const handleOpenLinkDialog = useCallback(() => {
    setActiveLinkRequest(undefined);
    setLinkDialogOpen(true);
  }, []);

  const handleLocationClick = useCallback(() => {
    locationReset(initialLocation);
    setLocationDialogOpen(true);
  }, [initialLocation, locationReset]);

  useEffect(() => {
    if (!props.linkRequest || props.linkRequest.id === handledLinkRequest.current) return;
    handledLinkRequest.current = props.linkRequest.id;
    if (getState().ui.isLoading.saving) return;
    setActiveLinkRequest(props.linkRequest);
    setLinkDialogOpen(true);
  }, [props.linkRequest, getState]);

  useEffect(() => {
    if (!props.locationRequest || props.locationRequest === handledLocationRequest.current) return;
    handledLocationRequest.current = props.locationRequest;
    if (getState().ui.isLoading.saving) return;
    locationReset(initialLocation);
    setLocationDialogOpen(true);
  }, [props.locationRequest, getState, locationReset, initialLocation]);

  const handleLocationConfirm = useCallback(() => {
    const newLocation = getLocation();
    if (newLocation) {
      onLocationChange(newLocation);
      locationReset(newLocation);
      setLocationDialogOpen(false);
    }
  }, [getLocation, onLocationChange, locationReset]);

  const handleLocationCancel = useCallback(() => {
    locationReset(initialLocation);
    setLocationDialogOpen(false);
  }, [locationReset, initialLocation]);

  const handleAttachmentUploadClick = useCallback(() => {
    if (getState().ui.isLoading.saving) return;
    handleUploadClick();
  }, [getState, handleUploadClick]);

  const handleInlineImageUploadClick = useCallback(() => {
    if (getState().ui.isLoading.saving) return;
    inlineImageInputRef.current?.click();
  }, [getState]);

  const handleInlineImageInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) props.onInsertImages(files);
      event.target.value = "";
    },
    [props.onInsertImages],
  );

  // Insert actions (add content).
  const insertItems = [
    { key: "attachment", label: t("editor.insert-menu.add-attachment"), icon: PaperclipIcon, onClick: handleAttachmentUploadClick },
    { key: "audio", label: t("editor.audio-recorder.trigger"), icon: MicIcon, onClick: props.onAudioRecorderClick },
  ];

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        size="icon"
        className="size-11"
        disabled={insertionDisabled}
        aria-label={t("editor.insert-menu.insert-image")}
        title="添加照片"
        onClick={handleInlineImageUploadClick}
      >
        <ImageIcon className="size-[18px]" strokeWidth={1.7} />
      </Button>
      <Button
        ref={linkButtonRef}
        type="button"
        variant="quiet"
        size="sm"
        className="min-h-11 gap-1 px-2"
        aria-label="关联记录"
        disabled={props.isSaving}
        onClick={handleOpenLinkDialog}
      >
        <LinkIcon className="size-4" />
        关联
      </Button>
      <Button
        ref={locationButtonRef}
        type="button"
        variant="quiet"
        size="sm"
        className="min-h-11 gap-1 px-2"
        aria-label={initialLocation ? "修改位置" : "添加位置"}
        title={t("tooltip.select-location")}
        disabled={props.isSaving}
        onClick={handleLocationClick}
      >
        <MapPinIcon className="size-4" />
        位置
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="quiet" size="icon" className="size-11" disabled={props.isSaving} aria-label="更多选项" title="更多选项" />
          }
        >
          {isUploading ? (
            <LoaderIcon className="size-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <EllipsisIcon className="size-[18px]" strokeWidth={1.7} />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          size="sm"
          finalFocus={() => {
            props.onReturnToEditor?.();
            return false;
          }}
        >
          {props.onInsertTag && (
            <DropdownMenuItem className="min-h-10" onClick={props.onInsertTag} disabled={props.isSaving}>
              <HashIcon />
              添加标签
            </DropdownMenuItem>
          )}
          {insertItems.map((item) => (
            <DropdownMenuItem key={item.key} onClick={item.onClick} disabled={props.isSaving}>
              <item.icon />
              {item.label}
            </DropdownMenuItem>
          ))}
          {/* View toggles: formatting, optional source view and plain paste. Absent
              when a host owns the editor's presentation — neither applies there. */}
          {viewToggles && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={viewToggles.onToggleFormattingToolbar}>
                <TypeIcon />
                {t("editor.formatting-toolbar")}
                {viewToggles.isFormattingToolbarVisible && <CheckIcon className="ms-auto size-3.5" />}
              </DropdownMenuItem>
              {viewToggles.onToggleSourceMode && (
                <DropdownMenuItem onClick={viewToggles.onToggleSourceMode}>
                  <CodeIcon />
                  {viewToggles.sourceMode ? "返回可视化编辑" : "Markdown 源码"}
                </DropdownMenuItem>
              )}
              {viewToggles.onTogglePlainPaste && (
                <DropdownMenuItem onClick={viewToggles.onTogglePlainPaste}>
                  <ClipboardIcon />
                  下次粘贴仅保留文字
                  {viewToggles.plainPasteArmed && <CheckIcon className="ms-auto size-3.5" />}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Hidden file input */}
      <input
        className="hidden"
        ref={fileInputRef}
        disabled={insertionDisabled}
        onChange={handleFileInputChange}
        type="file"
        multiple={true}
        accept=""
      />

      <input
        className="hidden"
        ref={inlineImageInputRef}
        disabled={insertionDisabled}
        onChange={handleInlineImageInputChange}
        type="file"
        multiple={true}
        accept="image/*"
      />

      <LinkMemoDialog
        anchorRef={linkButtonRef}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        searchText={linkMemo.searchText}
        onSearchChange={linkMemo.setSearchText}
        onCompositionChange={linkMemo.setIsComposing}
        filteredMemos={linkMemo.filteredMemos}
        isFetching={linkMemo.isFetching}
        onSelectMemo={linkMemo.addMemoRelation}
        isAlreadyLinked={linkMemo.isAlreadyLinked}
        error={linkMemo.error}
        onRetry={linkMemo.retry}
        hasNextPage={linkMemo.hasNextPage}
        isFetchingNextPage={linkMemo.isFetchingNextPage}
        onLoadMore={linkMemo.fetchNextPage}
        onReturnToEditor={props.onReturnToEditor}
        targeted={linkMemo.isTargeted}
        timezone={preferences?.timezone}
      />

      <LocationDialog
        anchorRef={locationButtonRef}
        open={locationDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleLocationCancel();
        }}
        state={locationState}
        onPositionChange={handleLocationPositionChange}
        onUpdateCoordinate={updateCoordinate}
        onPlaceholderChange={setPlaceholder}
        onCancel={handleLocationCancel}
        onConfirm={handleLocationConfirm}
        onSelect={(next) => {
          onLocationChange(next);
          locationReset(next);
          setLocationDialogOpen(false);
        }}
        onLocate={location.locate}
        onResolveName={() => void location.resolveName()}
        onReturnToEditor={props.onReturnToEditor}
      />
    </>
  );
};

export default InsertMenu;
