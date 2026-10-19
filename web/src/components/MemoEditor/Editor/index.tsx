import { EditorState } from "@codemirror/state";
import { placeholder as cmPlaceholder, EditorView } from "@codemirror/view";
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTagCounts } from "@/hooks/useUserQueries";
import { cn } from "@/lib/utils";
import type { EditorController } from "../types/editorController";
import { createController } from "./controller";
import "./editor.css";
import { buildEditorExtensions, type EditorFileOrigin, placeholderCompartment } from "./extensions";
import { createFormattingController } from "./formatting";
import { livePreview, previewCompartment } from "./livePreview";
import type { MemoLinkRequest } from "./memoLinkIntent";

interface EditorProps {
  className: string;
  initialContent: string;
  contentIsExternal?: boolean;
  placeholder: string;
  onContentChange: (content: string) => void;
  onExternalContentApplied?: (content: string) => void;
  onFiles: (files: File[], origin: EditorFileOrigin) => void;
  /** Invoked by the in-editor save shortcut (Cmd/Ctrl+Enter). */
  onSubmit: () => void;
  isFocusMode?: boolean;
  sourceMode?: boolean;
  consumePlainPaste?: () => boolean;
  onLinkRequest?: (request: Omit<MemoLinkRequest, "id">) => void;
}

const Editor = forwardRef(function Editor(props: EditorProps, ref: React.ForwardedRef<EditorController>) {
  const {
    className,
    initialContent,
    contentIsExternal = true,
    placeholder,
    onContentChange,
    onExternalContentApplied,
    onFiles,
    onSubmit,
    isFocusMode,
    sourceMode = false,
    consumePlainPaste,
    onLinkRequest,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const applyingExternalContentRef = useRef(false);
  const pendingSourceModeRef = useRef<boolean | null>(null);
  const pendingExternalContentRef = useRef<string | null>(null);
  const onChangeRef = useRef(onContentChange);
  onChangeRef.current = onContentChange;
  const onExternalContentAppliedRef = useRef(onExternalContentApplied);
  onExternalContentAppliedRef.current = onExternalContentApplied;
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const consumePlainPasteRef = useRef(consumePlainPaste);
  consumePlainPasteRef.current = consumePlainPaste;
  const placeholderRef = useRef(placeholder);
  const listenersRef = useRef(new Set<() => void>());
  const [pasteAlternative, setPasteAlternative] = useState<(() => void) | undefined>();
  const [pastedMemo, setPastedMemo] = useState<string>();
  const onLinkRequestRef = useRef(onLinkRequest);
  onLinkRequestRef.current = onLinkRequest;
  // A user can only author their own memos. Reuse the current-user stats query
  // instead of fetching and aggregating every user's tags for autocomplete.
  const { data: tagData } = useTagCounts(true);
  const tags = useMemo(() => Object.keys(tagData ?? {}), [tagData]);
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  const applyExternalContent = useCallback((content: string) => {
    pendingExternalContentRef.current = null;
    const controller = controllerRef.current;
    if (!controller || controller.getMarkdown() === content) return;
    applyingExternalContentRef.current = true;
    try {
      controller.setMarkdown(content);
    } finally {
      applyingExternalContentRef.current = false;
    }
  }, []);

  // useLayoutEffect (not useEffect) so the EditorView — and its placeholder —
  // mount before the browser paints. With useEffect the first painted frame
  // shows an empty host, then the placeholder pops in (a load flicker).
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: initialContent,
        extensions: buildEditorExtensions({
          placeholder,
          sourceMode,
          onChange: (md) => {
            if (!applyingExternalContentRef.current) onChangeRef.current(md);
          },
          onFiles: (files, origin) => onFilesRef.current(files, origin),
          onUpdate: () => listenersRef.current.forEach((l) => l()),
          onSubmit: () => onSubmitRef.current(),
          getTags: () => tagsRef.current,
          consumePlainPaste: () => consumePlainPasteRef.current?.() ?? false,
          onPasteAlternative: (action) => setPasteAlternative(() => action),
          onLinkRequest: (request) => onLinkRequestRef.current?.(request),
          onPastedMemo: setPastedMemo,
        }),
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    controllerRef.current = createController(view, createFormattingController(view, listenersRef.current));
    const handleCompositionEnd = () => {
      // CodeMirror may flush its final Firefox/Android DOM mutations in a
      // microtask after compositionend. Queue behind that flush before
      // replacing the document with a deferred external value.
      queueMicrotask(() => {
        if (viewRef.current !== view || view.compositionStarted) return;
        if (pendingSourceModeRef.current !== null) {
          view.dispatch({ effects: previewCompartment.reconfigure(pendingSourceModeRef.current ? [] : livePreview) });
          pendingSourceModeRef.current = null;
        }
        const pendingContent = pendingExternalContentRef.current;
        if (pendingContent === null) return;
        applyExternalContent(pendingContent);
        // The composition may have emitted a newer local value after this
        // deferred external value entered the store. Reassert the applied
        // external value there too.
        onExternalContentAppliedRef.current?.(pendingContent);
      });
    };
    view.contentDOM.addEventListener("compositionend", handleCompositionEnd);
    return () => {
      view.contentDOM.removeEventListener("compositionend", handleCompositionEnd);
      view.destroy();
      viewRef.current = null;
      controllerRef.current = null;
    };
    // Mount once; external sync handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.compositionStarted) {
      pendingSourceModeRef.current = sourceMode;
      return;
    }
    view.dispatch({ effects: previewCompartment.reconfigure(sourceMode ? [] : livePreview) });
  }, [sourceMode]);

  useLayoutEffect(() => {
    if (placeholderRef.current === placeholder) return;
    placeholderRef.current = placeholder;
    viewRef.current?.dispatch({ effects: placeholderCompartment.reconfigure(cmPlaceholder(placeholder)) });
  }, [placeholder]);

  useLayoutEffect(() => {
    if (!contentIsExternal) return;
    const view = viewRef.current;
    if (!view) return;
    if (view.compositionStarted) {
      pendingExternalContentRef.current = initialContent;
      return;
    }
    applyExternalContent(initialContent);
  }, [applyExternalContent, contentIsExternal, initialContent]);

  // The controller is created in the mount layout effect above, which runs
  // before this (also layout-phase) handle, so controllerRef.current is set.
  useImperativeHandle(ref, () => controllerRef.current as EditorController, []);

  return (
    <div
      className={cn("relative flex w-full flex-col items-start justify-start bg-inherit", isFocusMode && "min-h-0 flex-1", className)}
      data-focus-mode={isFocusMode || undefined}
      data-source-mode={sourceMode || undefined}
    >
      <div ref={hostRef} className={cn("w-full font-content text-base", isFocusMode && "min-h-0 flex flex-col flex-1")} />
      {pasteAlternative && (
        <div className="mt-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground" role="status">
          <span>已保留内容格式</span>
          <button
            type="button"
            className="min-h-11 rounded-lg px-2 underline underline-offset-4 hover:bg-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={pasteAlternative}
          >
            保留纯文本
          </button>
        </div>
      )}
      {pastedMemo && onLinkRequest && (
        <div className="mt-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground" role="status">
          <span>这是 Kairos 中的一条记录</span>
          <button
            type="button"
            className="min-h-11 rounded-lg px-2 underline underline-offset-4 hover:bg-accent"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onLinkRequest({ memoName: pastedMemo, onLinked: () => setPastedMemo(undefined) })}
          >
            关联此记录
          </button>
        </div>
      )}
    </div>
  );
});

export default Editor;
