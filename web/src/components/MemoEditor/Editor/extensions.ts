import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { placeholder as cmPlaceholder, dropCursor, EditorView, type KeyBinding, keymap } from "@codemirror/view";
import { runFormattingCommand } from "@/components/MemoEditor/Editor/formatting";
import type { EditorCommandId } from "@/components/MemoEditor/formatting/commands";
import { memoMarkdownExtensions } from "@/utils/memo-markdown-extension";
import { htmlClipboardMarkdown } from "./clipboard";
import { headingDecorations } from "./headingDecorations";
import { liftListItem, sinkListItem } from "./listIndent";
import { livePreview, previewCompartment } from "./livePreview";
import { tagAutocomplete } from "./tagAutocomplete";
import { tagMentionDecorations } from "./tagMentionDecorations";
import { memoEditorTheme } from "./theme";
import { uploadAnchorField } from "./uploadAnchors";

// Key bindings layered below the autocomplete keymap so its completion-specific
// keys win while the popup is open. On a list item, Tab/Shift-Tab nest /
// outdent it (marker-aware, CommonMark-valid); elsewhere they fall through to
// indentWithTab's plain indent. Escape blurs the editor so keyboard users keep
// an escape hatch out of the otherwise Tab-trapping editor.
const editorKeys: KeyBinding[] = [
  {
    key: "Escape",
    run: (view) => {
      if (view.dom.closest("[data-focus-mode]")) return false;
      view.contentDOM.blur();
      return true;
    },
  },
  { key: "Tab", run: sinkListItem },
  { key: "Shift-Tab", run: liftListItem },
];

const formattingKey = (key: string, command: EditorCommandId): KeyBinding => ({
  key,
  run: (view) => {
    runFormattingCommand(view, command);
    return true;
  },
});

// Familiar cross-platform Markdown formatting keys. These stay separate from
// CodeMirror's Markdown keymap, which only handles structural Enter/Backspace.
const formattingKeys: KeyBinding[] = [
  formattingKey("Mod-b", "bold"),
  formattingKey("Mod-i", "italic"),
  formattingKey("Shift-Mod-s", "strikethrough"),
  formattingKey("Mod-e", "code"),
  formattingKey("Mod-Alt-c", "codeBlock"),
  formattingKey("Mod-Alt-0", "paragraph"),
  formattingKey("Shift-Mod-7", "orderedList"),
  formattingKey("Shift-Mod-8", "bulletList"),
  formattingKey("Shift-Mod-9", "taskList"),
  formattingKey("Mod-Alt-1", "heading1"),
  formattingKey("Mod-Alt-2", "heading2"),
  formattingKey("Mod-Alt-3", "heading3"),
];

/** The gesture that handed files to the editor: a drop lands at a document position, a paste has none. */
export type EditorFileOrigin = { source: "paste"; position?: number } | { source: "drop"; position: number };

export interface EditorExtensionsOptions {
  placeholder: string;
  sourceMode?: boolean;
  onChange: (markdown: string) => void;
  onFiles: (files: File[], origin: EditorFileOrigin) => void;
  onUpdate: () => void;
  onSubmit: () => void;
  getTags: () => string[];
  /** Consume the explicit one-shot plain-paste choice, independently of native shortcuts. */
  consumePlainPaste?: () => boolean;
}

export const placeholderCompartment = new Compartment();

function clipboardFiles(event: ClipboardEvent): File[] {
  const clipboard = event.clipboardData;
  if (!clipboard) return [];

  const itemFiles = Array.from(clipboard.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return itemFiles.length > 0 ? itemFiles : Array.from(clipboard.files ?? []);
}

export function buildEditorExtensions({
  placeholder,
  sourceMode = false,
  onChange,
  onFiles,
  onUpdate,
  onSubmit,
  getTags,
  consumePlainPaste,
}: EditorExtensionsOptions): Extension[] {
  // Submitting must outrank defaultKeymap's own Mod-Enter (insertBlankLine): the save
  // shortcut ends the memo, it must not also edit the document. Meta and Ctrl are bound
  // explicitly (not via the platform-dependent Mod-) so Cmd+Enter and Ctrl+Enter both
  // submit everywhere, matching the historical window-level shortcut.
  const submit = (view: EditorView) => {
    if (view.composing) return false;
    onSubmit();
    return true;
  };
  const submitKeys: KeyBinding[] = [
    { key: "Meta-Enter", run: submit },
    { key: "Ctrl-Enter", run: submit },
  ];

  let plainPaste = false;
  return [
    previewCompartment.of(sourceMode ? [] : livePreview),
    // Core editing behavior. These are the pieces from CM6 setup that this memo
    // editor uses, without enabling multi-cursor selection.
    history(),
    dropCursor(),
    // Indent with spaces (markdown), matching the 2-space bullet nesting.
    indentUnit.of("  "),
    markdown({ extensions: memoMarkdownExtensions }),
    ...memoEditorTheme,
    EditorView.lineWrapping,
    // CodeMirror disables native text assistance because it is primarily a code
    // editor. Memos is a prose editor, so restore the browser behavior used by
    // the textarea editor before v0.30. Autocorrect also keeps Windows TSF input
    // out of Chrome's autocorrect-suppression path, which has dropped committed
    // text from the emoji picker.
    EditorView.contentAttributes.of({
      autocorrect: "on",
      autocapitalize: "on",
      spellcheck: "true",
    }),
    placeholderCompartment.of(cmPlaceholder(placeholder)),
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const clipboard = event.clipboardData;
        const files = clipboardFiles(event);
        const html = clipboard?.getData?.("text/html") || "";
        const plain = clipboard?.getData?.("text/plain") || "";
        // The explicit choice also works in browsers without a plain-paste
        // shortcut. Consume it even when the native gesture already requests it.
        const explicitPlainPaste = consumePlainPaste?.() ?? false;
        // Plain-text paste deliberately delegates to CodeMirror's native path.
        if (explicitPlainPaste || plainPaste) {
          plainPaste = false;
          // An image-only clipboard has no text to insert. Letting CodeMirror
          // paste an empty string would erase the highlighted prose.
          return !plain && !clipboard?.getData?.("text/uri-list");
        }
        if (files.length === 0 && !html) return false;
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        const placements: { token: string; file: File; offset: number }[] = [];
        let text = html
          ? htmlClipboardMarkdown(html, (localImageCount) => {
              // DataTransfer does not expose an HTML-node/file identity. Only
              // map a complete set of local slots; ambiguous files stay at the
              // paste caret and remote images retain their original links.
              if (localImageCount !== imageFiles.length) return undefined;
              const file = imageFiles[placements.length];
              if (!file) return undefined;
              const token = `\uFFFCkairos-image-${Date.now()}-${placements.length}\uFFFC`;
              placements.push({ token, file, offset: 0 });
              return token;
            })
          : plain;
        for (const placement of placements) {
          placement.offset = text.indexOf(placement.token);
          text = text.replace(placement.token, "");
        }
        const start = view.state.selection.main.from;
        if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
        for (const placement of placements) onFiles([placement.file], { source: "paste", position: start + placement.offset });
        const remaining = files.filter((file) => !placements.some((placement) => placement.file === file));
        if (remaining.length) onFiles(remaining, { source: "paste", position: view.state.selection.main.head });
        return true;
      },
      keydown: (event) => {
        plainPaste = event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
        return false;
      },
      drop: (event, view) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        onFiles(files, { source: "drop", position });
        return true;
      },
    }),
    tagMentionDecorations,
    headingDecorations,
    uploadAnchorField,
    // tagAutocomplete must precede the editing keymap so the completion popup's
    // Enter/Escape/arrow bindings win while it is open.
    tagAutocomplete(getTags),
    // Formatting keys precede defaultKeymap so the conventional Mod-I italic
    // shortcut wins over CodeMirror's generic selectParentSyntax binding.
    keymap.of([...submitKeys, ...editorKeys, ...formattingKeys, indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
      // Toolbar active-state depends only on the doc and selection; skip the
      // getActiveFormats tree walk on focus/viewport/measure-only updates.
      if (u.docChanged || u.selectionSet) onUpdate();
    }),
  ];
}
