import { Maximize2Icon, Minimize2Icon, TypeIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useInstance } from "@/contexts/InstanceContext";
import { useLocalStorage } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { type Memo, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { canManageMemo } from "@/utils/user";
import { AudioRecorderPanel, EditorContent, EditorMetadata, FocusModeOverlay, TimestampPopover } from "./components";
import { EditorSuggestions } from "./components/EditorSuggestions";
import { PendingRecords } from "./components/PendingRecords";
import { RecordConflict } from "./components/RecordConflict";
import { FOCUS_MODE_STYLES, FORMATTING_TOOLBAR_STORAGE_KEY } from "./constants";
import type { EditorFileOrigin } from "./Editor/extensions";
import type { MemoLinkRequest } from "./Editor/memoLinkIntent";
import {
  splitInlineLocalFiles,
  toLocalFiles,
  useAttachmentTranscription,
  useAudioRecorder,
  useAutoSave,
  useBlobUrls,
  useFocusMode,
  useInlineImageUpload,
  useMemoInit,
  useMemoSave,
} from "./hooks";
import { useDurableDraft } from "./hooks/useDurableDraft";
import { cacheService, errorService, transcriptionService } from "./services";
import { EditorProvider, useEditorContext, useEditorSelector } from "./state";
import { EditorToolbar, FormattingToolbar } from "./Toolbar";
import { SelectionFormattingToolbar } from "./Toolbar/SelectionFormattingToolbar";
import type { EditorViewToggles, MemoEditorProps } from "./types";
import type { LocalFile } from "./types/attachment";
import type { EditorController } from "./types/editorController";

// A host that presents the editor full-screen supplies `onFocusModeExit`; its
// presence is what makes an instance hosted, so focus mode starts on and stays on.
const MemoEditor = (props: MemoEditorProps) => {
  const owner = useCurrentUser()?.name ?? "anonymous";
  // A new identity gets a fresh store; the old instance persists only to its
  // original owner key and cancels its remaining uploads during unmount.
  return (
    <EditorProvider key={owner} initialFocusMode={Boolean(props.onFocusModeExit)}>
      <MemoEditorImpl {...props} />
    </EditorProvider>
  );
};

const MemoEditorImpl: React.FC<MemoEditorProps> = ({
  className,
  cacheKey,
  memo,
  parentMemoName,
  suggestions = [],
  defaultSpace,
  defaultLocation,
  autoFocus,
  onFocusModeExit,
  onFocusModeChange,
  placeholder,
  defaultCreateTime,
  onConfirm,
  onCancel,
  onSavingChange,
}) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const editorRef = useRef<EditorController>(null);
  const { actions, dispatch, getState } = useEditorContext();
  // Subscribe only to the low-frequency slices this component renders from, so
  // typing (which changes content) does not re-render the editor shell and its
  // toolbar/metadata children.
  const isFocusMode = useEditorSelector((s) => s.ui.isFocusMode);
  // Report focus-mode changes so a host can react; inline hosts pass nothing.
  useEffect(() => {
    onFocusModeChange?.(isFocusMode);
  }, [isFocusMode, onFocusModeChange]);
  const isSaving = useEditorSelector((s) => s.ui.isLoading.saving);
  const hasTimestamp = useEditorSelector((s) => Boolean(s.timestamps.createTime));
  const { userGeneralSetting } = useAuth();
  const { aiSetting, fetchSetting } = useInstance();
  const [isAudioRecorderOpen, setIsAudioRecorderOpen] = useState(false);
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const [transcriptionCandidate, setTranscriptionCandidate] = useState<string>();
  const [conflict, setConflict] = useState<Memo>();
  const { createBlobUrl } = useBlobUrls();
  const saveMediaMetadata = userGeneralSetting?.saveMediaMetadata ?? false;
  const inlineImageUpload = useInlineImageUpload(editorRef);
  const [isFormattingToolbarVisible, setFormattingToolbarVisible] = useLocalStorage(FORMATTING_TOOLBAR_STORAGE_KEY, false);

  const [sourceMode, setSourceMode] = useState(false);
  const intentId = useRef(0);
  const [linkRequest, setLinkRequest] = useState<MemoLinkRequest>();
  const [locationRequest, setLocationRequest] = useState(0);
  const requestLink = useCallback((request: Omit<MemoLinkRequest, "id">) => {
    setLinkRequest({ ...request, id: ++intentId.current });
  }, []);
  const [plainPasteArmed, setPlainPasteArmed] = useState(false);
  const plainPasteRef = useRef(false);
  const consumePlainPaste = useCallback(() => {
    const armed = plainPasteRef.current;
    plainPasteRef.current = false;
    if (armed) setPlainPasteArmed(false);
    return armed;
  }, []);
  const memoName = memo?.name;
  // Replies are never placed independently: a comment's Space is its parent's.
  // An edited top-level memo can change its Space; a new one can unless its
  // host fixes the target (e.g. composing inside a Space).
  const draftSpace = useEditorSelector((s) => s.metadata.space);
  const canChooseSpace = memo ? !memo.parent && canManageMemo(memo, currentUser) : !parentMemoName && !defaultSpace;
  const editorSpace = memo ? draftSpace : parentMemoName ? undefined : (defaultSpace ?? draftSpace);
  const canTranscribe = useMemo(() => {
    const providerId = aiSetting.transcription?.providerId ?? "";
    if (!providerId) return false;
    const provider = aiSetting.providers.find((p) => p.id === providerId);
    return Boolean(provider?.apiKeySet);
  }, [aiSetting.providers, aiSetting.transcription?.providerId]);

  // Get default visibility from user settings
  const defaultVisibility = Visibility.PRIVATE;
  const durableCacheKey = memoName ? `edit:${memoName}` : cacheKey;
  const editorCacheKey = cacheService.key(currentUser?.name ?? "", durableCacheKey);

  const { isInitialized } = useMemoInit({
    editorRef,
    memo,
    cacheKey: durableCacheKey,
    username: currentUser?.name ?? "",
    autoFocus,
    defaultVisibility,
    defaultCreateTime,
    defaultLocation,
    canChooseSpace,
  });
  const isDraftCacheEnabled = true;
  const hasInitializedTimestamp = useRef(false);

  useEffect(() => {
    onSavingChange?.(isSaving);
  }, [isSaving, onSavingChange]);

  // Auto-save content to localStorage (subscribes to the store internally).
  const { discardDraft: discardLegacyDraft } = useAutoSave(currentUser?.name ?? "", durableCacheKey, isInitialized && isDraftCacheEnabled);
  const durable = useDurableDraft(currentUser?.name ?? "", editorCacheKey, isInitialized);
  const discardDraft = () => {
    discardLegacyDraft();
    durable.discard();
  };

  const { containerRef: editorContainerRef, placeholderHeight, captureScroll } = useFocusMode(isFocusMode);

  // Live-sync the draft's createTime/updateTime to the calendar-derived prop.
  // Only applies in create mode; edit mode owns its own timestamps. Runs after
  // initial mount (the seed value is set in useMemoInit), and again whenever
  // the prop changes — e.g., when the user picks a different calendar date
  // while the editor is open.
  useEffect(() => {
    if (memo) return;
    if (!isInitialized) return;
    if (!hasInitializedTimestamp.current) {
      hasInitializedTimestamp.current = true;
      return;
    }
    dispatch(
      actions.setTimestamps({
        createTime: defaultCreateTime,
        updateTime: defaultCreateTime,
      }),
    );
  }, [defaultCreateTime, memo, isInitialized, actions, dispatch]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void fetchSetting(InstanceSetting_Key.AI).catch(() => undefined);
  }, [currentUser, fetchSetting]);

  const insertTranscribedText = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.insertMarkdown(text);
    editor.scrollToCursor();
  }, []);

  const { transcribeAttachment, transcribingAttachment } = useAttachmentTranscription(setTranscriptionCandidate);

  const handleTranscribeRecordedAudio = useCallback(
    async (localFile: LocalFile) => {
      // Transcription never replaces the recording, including on success.
      dispatch(actions.addLocalFile(localFile));
      if (!canTranscribe) {
        setIsTranscribingAudio(false);
        setIsAudioRecorderOpen(false);
        return;
      }

      try {
        const text = (await transcriptionService.transcribeFile(localFile.file)).trim();
        if (!text) {
          toast.error(t("editor.audio-recorder.transcribe-empty"));
          return;
        }

        setTranscriptionCandidate(text);
        toast.success(t("editor.audio-recorder.transcribe-success"));
      } catch (error) {
        console.error(error);
        toast.error(errorService.getErrorMessage(error) || t("editor.audio-recorder.transcribe-error"));
      } finally {
        setIsTranscribingAudio(false);
        setIsAudioRecorderOpen(false);
      }
    },
    [actions, canTranscribe, dispatch, t],
  );

  const audioRecorder = useAudioRecorder({
    onRecordingComplete: (localFile, mode) => {
      if (mode === "transcribe") {
        void handleTranscribeRecordedAudio(localFile);
        return;
      }

      dispatch(actions.addLocalFile(localFile));
      setIsAudioRecorderOpen(false);
    },
    onRecordingEmpty: (mode) => {
      if (mode === "transcribe") {
        setIsTranscribingAudio(false);
        toast.error(t("editor.audio-recorder.transcribe-empty"));
      }
      setIsAudioRecorderOpen(false);
    },
  });

  // Mirror the recorder's busy state into the store so validationService.canSave
  // (consumed here and by EditorToolbar) can block saves mid-recording without
  // the reducer owning the recorder's full state.
  useEffect(() => {
    dispatch(actions.setRecorderBusy(audioRecorder.isBusy));
  }, [audioRecorder.isBusy, actions, dispatch]);

  // Both transcription paths insert into the draft when they land, so saving
  // waits for either one; the recorder itself is idle by then.
  useEffect(() => {
    dispatch(actions.setLoading("transcribing", isTranscribingAudio || Boolean(transcribingAttachment)));
  }, [isTranscribingAudio, transcribingAttachment, actions, dispatch]);

  useEffect(() => {
    if (!isAudioRecorderOpen) {
      return;
    }

    if (audioRecorder.status === "error" || audioRecorder.status === "unsupported") {
      toast.error(audioRecorder.error || t("editor.audio-recorder.error-description"));
      setIsAudioRecorderOpen(false);
    }
  }, [isAudioRecorderOpen, audioRecorder.error, audioRecorder.status, t]);

  const rememberCursor = useCallback(() => {
    const cursor = editorRef.current?.getCursor();
    if (cursor !== undefined) {
      cacheService.saveCursor(editorCacheKey, cursor);
    }
  }, [editorCacheKey]);

  // Hosted: focus mode is the host's frame, so leaving it dismisses the host.
  // Inline: focus mode is a view this editor owns and toggles in place.
  const handleToggleFocusMode = useCallback(() => {
    if (onFocusModeExit) {
      rememberCursor();
      onFocusModeExit();
      return;
    }
    captureScroll();
    dispatch(actions.toggleFocusMode());
    editorRef.current?.focus();
  }, [actions, dispatch, onFocusModeExit, rememberCursor, captureScroll]);

  useEffect(() => {
    if (!isFocusMode || onFocusModeExit) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], .cm-tooltip-autocomplete')) return;
      event.preventDefault();
      handleToggleFocusMode();
      editorRef.current?.focus();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isFocusMode, onFocusModeExit, handleToggleFocusMode]);

  const handleCancel = useCallback(() => {
    rememberCursor();
    onCancel?.();
  }, [onCancel, rememberCursor]);

  const handleToggleFormattingToolbar = useCallback(() => {
    setFormattingToolbarVisible((visible) => !visible);
  }, [setFormattingToolbarVisible]);

  const handleStartAudioRecording = async () => {
    setIsAudioRecorderOpen(true);
    await audioRecorder.startRecording();
  };

  const handleAudioRecorderClick = () => {
    if (audioRecorder.isBusy) {
      return;
    }

    void handleStartAudioRecording();
  };

  /**
   * Single ingest point for files the editor receives. Inline placement writes
   * images into the text (at `position`, else the caret) and attaches the rest;
   * otherwise everything joins the attachment list.
   */
  const handleFiles = useCallback(
    (files: File[], placement: { inline: false } | { inline: true; position?: number }) => {
      if (getState().ui.isLoading.saving) return;
      const localFiles = toLocalFiles(files, { createBlobUrl, saveMediaMetadata });
      const { inline, attachments } = placement.inline ? splitInlineLocalFiles(localFiles) : { inline: [], attachments: localFiles };
      attachments.forEach((file) => dispatch(actions.addLocalFile(file)));
      if (placement.inline) inlineImageUpload.insertLocalImages(inline, placement.position);
    },
    [actions, createBlobUrl, dispatch, getState, inlineImageUpload.insertLocalImages, saveMediaMetadata],
  );

  /** The ＋ menu's Insert image: inline at the caret. */
  const handleInsertImages = useCallback((files: File[]) => handleFiles(files, { inline: true }), [handleFiles]);

  /**
   * Images pasted or dropped into the editor share the same durable inline
   * upload path. Other files remain in the attachment list.
   */
  const handleEditorFiles = useCallback(
    (files: File[], origin: EditorFileOrigin) => handleFiles(files, { inline: true, position: origin.position }),
    [handleFiles],
  );

  const handleCancelAudioRecording = () => {
    setIsTranscribingAudio(false);
    audioRecorder.resetRecording();
    setIsAudioRecorderOpen(false);
  };

  const handleTranscribeAudioRecording = () => {
    if (!canTranscribe || isTranscribingAudio) {
      return;
    }

    setIsTranscribingAudio(true);
    const didStop = audioRecorder.stopRecording("transcribe");
    if (!didStop) {
      setIsTranscribingAudio(false);
    }
  };

  const viewToggles: EditorViewToggles = {
    isFormattingToolbarVisible,
    onToggleFormattingToolbar: handleToggleFormattingToolbar,
    sourceMode,
    onToggleSourceMode: () => {
      setSourceMode((value) => !value);
      editorRef.current?.focus();
    },
    plainPasteArmed,
    onTogglePlainPaste: () => {
      plainPasteRef.current = !plainPasteRef.current;
      setPlainPasteArmed(plainPasteRef.current);
      editorRef.current?.focus();
    },
  };

  const handleSave = useMemoSave({
    owner: currentUser?.name,
    memoName,
    parentMemoName,
    defaultSpace,
    defaultVisibility,
    defaultCreateTime,
    discardDraft,
    onConfirm,
    onConflict: setConflict,
    onCancel: onCancel ? handleCancel : undefined,
  });

  if (!isInitialized)
    return (
      <div className="min-h-28 w-full rounded-lg border p-4 text-sm text-muted-foreground" role="status">
        正在读取此设备的草稿…
      </div>
    );

  return (
    <>
      <FocusModeOverlay isActive={isFocusMode} onToggle={handleToggleFocusMode} />
      {conflict && <RecordConflict latest={conflict} onClose={() => setConflict(undefined)} />}

      {/*
        Layout structure:
        - Uses justify-between to push content to top and bottom
        - In focus mode: becomes fixed with specific spacing, editor grows to fill space
        - In normal mode: stays relative with max-height constraint
      */}
      {isFocusMode && placeholderHeight > 0 && (
        <div aria-hidden className={cn("w-full", className)} style={{ height: placeholderHeight }} />
      )}

      <div
        ref={editorContainerRef}
        data-focus-frame={isFocusMode || undefined}
        className={cn(
          "group relative w-full flex flex-col justify-between items-start bg-card px-4 pt-4 pb-3 rounded-xl border border-border/70 focus-within:border-primary/35 gap-3 sm:px-5 sm:pt-5",
          FOCUS_MODE_STYLES.transition,
          isFocusMode && cn(FOCUS_MODE_STYLES.container.base, FOCUS_MODE_STYLES.container.spacing),
          !isFocusMode && className,
        )}
      >
        {/* Content is primary; advanced representation choices stay in More. */}
        <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{memoName ? "编辑记录" : "记录此刻"}</span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="quiet"
              className="min-h-11 gap-1.5"
              aria-pressed={isFormattingToolbarVisible}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleToggleFormattingToolbar}
            >
              <TypeIcon className="size-4" />
              格式
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              className="min-h-11 gap-1.5"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleToggleFocusMode}
            >
              {isFocusMode ? (
                onFocusModeExit ? (
                  <XIcon className="size-4" />
                ) : (
                  <Minimize2Icon className="size-4" />
                )
              ) : (
                <Maximize2Icon className="size-4" />
              )}
              {isFocusMode ? (onFocusModeExit ? t("common.close") : t("editor.exit-focus-mode")) : "聚焦"}
            </Button>
          </div>
        </div>
        {sourceMode && (
          <Button type="button" size="sm" variant="secondary" onClick={viewToggles.onToggleSourceMode}>
            正在编辑源码 · 返回可视化编辑
          </Button>
        )}
        {plainPasteArmed && (
          <p className="shrink-0 text-xs text-muted-foreground" role="status">
            现在按 Cmd / Ctrl + V，下次粘贴仅保留文字。再次点击可取消。
          </p>
        )}
        {isFormattingToolbarVisible && (
          <FormattingToolbar className="shrink-0" controllerRef={editorRef} onInsertImages={handleInsertImages} />
        )}

        {(memoName || (!memo && hasTimestamp)) && (
          <div className="flex h-6 w-full shrink-0 items-center">
            <TimestampPopover />
          </div>
        )}

        {/* Editor content grows to fill available space in focus mode */}
        <EditorContent
          ref={editorRef}
          placeholder={placeholder}
          onSubmit={handleSave}
          onFiles={handleEditorFiles}
          sourceMode={sourceMode}
          consumePlainPaste={consumePlainPaste}
          onLinkRequest={requestLink}
        />
        {!sourceMode && !isFormattingToolbarVisible && <SelectionFormattingToolbar controllerRef={editorRef} />}

        {isAudioRecorderOpen && (audioRecorder.isBusy || isTranscribingAudio) && (
          <AudioRecorderPanel
            audioRecorder={{ status: audioRecorder.status, elapsedSeconds: audioRecorder.elapsedSeconds }}
            mediaStream={audioRecorder.recordingStream}
            onStop={audioRecorder.stopRecording}
            onCancel={handleCancelAudioRecording}
            onTranscribe={handleTranscribeAudioRecording}
            canTranscribe={canTranscribe}
            isTranscribing={isTranscribingAudio}
          />
        )}

        {transcriptionCandidate !== undefined && (
          <div className="w-full rounded border p-3 space-y-2">
            <label htmlFor="transcription-candidate" className="text-sm">
              转写候选文字 · 原录音会保留
            </label>
            <textarea
              id="transcription-candidate"
              className="w-full min-h-24 rounded border p-2"
              value={transcriptionCandidate}
              onChange={(event) => setTranscriptionCandidate(event.target.value)}
            />
            <div className="flex gap-3 text-sm">
              <button
                type="button"
                onClick={() => {
                  insertTranscribedText(transcriptionCandidate);
                  setTranscriptionCandidate(undefined);
                }}
              >
                加入正文
              </button>
              <button type="button" onClick={() => setTranscriptionCandidate(undefined)}>
                不用这段文字
              </button>
            </div>
          </div>
        )}
        {durable.status !== "idle" && (
          <div role="status" className="shrink-0 text-xs leading-4 text-muted-foreground/70">
            {durable.status === "saving"
              ? "正在保存草稿…"
              : durable.status === "saved"
                ? "草稿已保存在此设备"
                : durable.status === "failed"
                  ? "此设备未能保存草稿，请保留页面或复制内容。"
                  : ""}
          </div>
        )}
        {!memoName && !parentMemoName && <PendingRecords owner={currentUser?.name ?? ""} draftKey={editorCacheKey} />}
        {/* Metadata and toolbar grouped together at bottom */}
        <div className={cn("w-full shrink-0 flex flex-col gap-2", isFocusMode && "bg-card pt-2")}>
          {/* Long metadata must not displace the writing viewport or save actions. */}
          <div
            className={cn("w-full flex flex-col gap-2", isFocusMode && "overflow-y-auto")}
            style={isFocusMode ? { maxHeight: "min(8rem, calc(var(--kairos-focus-height, 100dvh) * 0.2))" } : undefined}
            role="region"
            aria-label="附件、关联与位置信息"
            tabIndex={isFocusMode ? 0 : undefined}
          >
            <EditorMetadata
              onEditLocation={() => {
                if (!isSaving) setLocationRequest((value) => value + 1);
              }}
              memoName={memoName}
              uploadingLocalFileURLs={inlineImageUpload.uploadingLocalFileURLs}
              onInsertAttachments={inlineImageUpload.insertRemoteImages}
              onInsertLocalFiles={inlineImageUpload.insertLocalImages}
              onTranscribeAttachment={canTranscribe ? transcribeAttachment : undefined}
              transcribingAttachment={transcribingAttachment}
              transcriptionDisabled={isSaving || audioRecorder.isBusy || isTranscribingAudio}
            />
            {!memo && !parentMemoName && isInitialized && suggestions.length > 0 && (
              <EditorSuggestions suggestions={suggestions} controllerRef={editorRef} space={editorSpace} />
            )}
          </div>
          <EditorToolbar
            linkRequest={linkRequest}
            locationRequest={locationRequest}
            onReturnToEditor={() => editorRef.current?.focus()}
            onSave={handleSave}
            onCancel={onCancel ? handleCancel : undefined}
            memoName={memoName}
            parentMemoName={parentMemoName}
            space={editorSpace}
            canChooseSpace={canChooseSpace}
            onAudioRecorderClick={handleAudioRecorderClick}
            viewToggles={viewToggles}
            onInsertImages={handleInsertImages}
            onInsertTag={() => {
              editorRef.current?.startTag();
            }}
          />
        </div>
      </div>
    </>
  );
};

export default MemoEditor;
