import { uniqBy } from "lodash-es";
import {
  CheckIcon,
  EllipsisIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  MapPinIcon,
  Maximize2Icon,
  MicIcon,
  PaperclipIcon,
  TypeIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { LinkMemoDialog, LocationDialog } from "@/components/MemoMetadata";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MemoRelation } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
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

  const { fileInputRef, selectingFlag, handleFileInputChange, handleUploadClick } = useFileUpload((newFiles: LocalFile[]) => {
    if (getState().ui.isLoading.saving) return;
    newFiles.forEach((file) => dispatch(actions.addLocalFile(file)));
  });

  const linkMemo = useLinkMemo({
    isOpen: linkDialogOpen,
    currentMemoName: props.memoName,
    existingRelations: relations,
    onAddRelation: (relation: MemoRelation) => {
      dispatch(actions.setMetadata({ relations: uniqBy([...relations, relation], (r) => r.relatedMemo?.name) }));
      setLinkDialogOpen(false);
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
    setLinkDialogOpen(true);
  }, []);

  const handleLocationClick = useCallback(() => {
    locationReset(initialLocation);
    setLocationDialogOpen(true);
  }, [initialLocation, locationReset]);

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
    { key: "inline-image", label: t("editor.insert-menu.insert-image"), icon: ImageIcon, onClick: handleInlineImageUploadClick },
    { key: "audio", label: t("editor.audio-recorder.trigger"), icon: MicIcon, onClick: props.onAudioRecorderClick },
    { key: "link", label: t("editor.insert-menu.link-memo"), icon: LinkIcon, onClick: handleOpenLinkDialog },
    { key: "location", label: t("editor.insert-menu.add-location"), icon: MapPinIcon, onClick: handleLocationClick },
  ];

  return (
    <>
      <Button type="button" variant="quiet" size="sm" className="min-h-10 gap-1" disabled={props.isSaving} onClick={handleOpenLinkDialog}>
        <LinkIcon className="size-4" />
        关联记录
      </Button>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        className="min-h-10 gap-1"
        title={t("tooltip.select-location")}
        disabled={props.isSaving}
        onClick={handleLocationClick}
      >
        <MapPinIcon className="size-4" />
        {initialLocation ? "修改位置" : "添加位置"}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              className="size-9 pointer-coarse:size-10"
              disabled={insertionDisabled}
              aria-label={t("editor.insert-menu.insert-image")}
              onClick={handleInlineImageUploadClick}
            />
          }
        >
          <ImageIcon className="size-[18px]" strokeWidth={1.7} />
        </TooltipTrigger>
        <TooltipContent>添加照片</TooltipContent>
      </Tooltip>
      {props.onAudioRecorderClick && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="quiet"
                size="icon"
                className="size-9 pointer-coarse:size-10"
                disabled={insertionDisabled}
                aria-label={t("editor.audio-recorder.trigger")}
                onClick={props.onAudioRecorderClick}
              />
            }
          >
            <MicIcon className="size-[18px]" strokeWidth={1.7} />
          </TooltipTrigger>
          <TooltipContent>录一段声音</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              className="size-9 pointer-coarse:size-10"
              disabled={insertionDisabled}
              aria-label={t("common.add")}
              title="更多选项"
            />
          }
        >
          {isUploading ? (
            <LoaderIcon className="size-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <EllipsisIcon className="size-[18px]" strokeWidth={1.7} />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" size="sm">
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
          {/* View toggles: focus mode + formatting-toolbar visibility. Absent
              when a host owns the editor's presentation — neither applies there. */}
          {viewToggles && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={viewToggles.onToggleFocusMode}>
                <Maximize2Icon />
                {t("editor.focus-mode")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={viewToggles.onToggleFormattingToolbar}>
                <TypeIcon />
                {t("editor.formatting-toolbar")}
                {viewToggles.isFormattingToolbarVisible && <CheckIcon className="ms-auto size-3.5" />}
              </DropdownMenuItem>
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
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        searchText={linkMemo.searchText}
        onSearchChange={linkMemo.setSearchText}
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
      />

      <LocationDialog
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
        onLocate={location.locate}
        onResolveName={() => void location.resolveName()}
        onReturnToEditor={props.onReturnToEditor}
      />
    </>
  );
};

export default InsertMenu;
