# MemoEditor Architecture

## Overview

MemoEditor is a three-layer component around one CodeMirror 6 editor. It stores **raw Markdown, verbatim** with no parse/serialize round-trip. Visual mode is the default: headings, marks, tasks, links, tables, code and managed images render in place, including on the active line. Hidden syntax has paired deletion handling so editing visible prose does not leave broken delimiters. The optional Markdown source action in More changes a decoration compartment, retaining the same document, selection and undo history. Complex Markdown stays in the document even when the visual layer does not render it. Everything above the editor boundary talks Markdown through `EditorController`.

## Architecture

Tag insertion and completion serialize punctuation-bearing names as `#"books/Title:Edition"`.
The source editor keeps the quotes; the reader displays the original tag name and filtering uses its exact value.

Location selection uses an anchored picker. Favorites, recent places, name-only
places and public search results select directly into the memo draft and return
to the editor. Map movement and device coordinates still require an explicit choice.
Opening/cancelling restores the memo's value; only “使用当前位置” requests device
location. Manual selection/name changes invalidate older device and geocoding
responses. Coordinates can be saved without a name, and `nameOnly` explicitly
stores a personal place label without inventing coordinates. Reusable place names are
owner-scoped server documents and never rewrite historical records. Public-place
search and name lookup require explicit submission through the rate-limited
server provider; no editor-open or keystroke triggers an external lookup.

Association uses the same debounced candidate query and rows as Quick Find.
Selecting a candidate updates draft metadata only; the relation is committed
with the memo save. The `[[` shortcut opens that picker and removes its trigger
only after a successful selection. Pasting a same-origin memo URL offers an
explicit association action, revalidates the target and never fetches another
origin. Closing either picker returns to the same editor selection.

```
┌─────────────────────────────────────────┐
│   Presentation Layer (Components)       │
│   - EditorToolbar, EditorContent, etc.  │
└─────────────────┬───────────────────────┘
                  │ EditorController
┌─────────────────▼───────────────────────┐
│   State Layer (reducer over an external │
│   store; per-slice subscriptions)       │
│   - state/, useEditorContext(),         │
│     useEditorSelector()                 │
│   - state.content  ← markdown (the      │
│     single source of truth)             │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│   Service Layer (Business Logic)        │
│   - services/ (pure functions)          │
└─────────────────────────────────────────┘
```

## Directory Structure

```
MemoEditor/
├── index.tsx               # The shell: EditorProvider + MemoEditorImpl
├── loader.ts               # loadMemoEditor(): the shared lazy-load entry point
├── state/                  # State management (reducer, actions, context)
├── services/               # Business logic (pure functions)
├── components/             # UI components
│   ├── EditorContent.tsx   # Hosts Editor; forwards its EditorController ref
│   ├── EditorMetadata.tsx  # Attachment strip below the document
│   └── ...
├── hooks/                  # React hooks (utilities)
│   ├── useMemoSave.ts      # Save transaction, cache invalidation, and reset
│   └── useFocusMode.ts     # Scroll lock and layout-stable focus presentation
├── Editor/                 # The CodeMirror 6 decorated-source editor
│   ├── index.tsx               # React wrapper: mounts the EditorView, owns the
│   │                           #   controller refs, syncs initialContent in/out
│   ├── extensions.ts           # buildEditorExtensions(): assembles the CM extension set
│   ├── livePreview.ts          # Direct StateField decorations; visual/source compartment
│   ├── clipboard.ts            # HTML semantic paste; no style import or remote image fetch
│   ├── memoLinkIntent.ts        # Optional [[ picker and explicit same-origin pasted-link action
│   ├── theme.ts                # Syntax-highlight style + editor theme (CSS-var colors)
│   ├── tagMentionDecorations.ts# ViewPlugin that decorates #tag / @mention spans
│   ├── markdownTagRanges.ts    # Markdown syntax-tree adapter for the shared tag scanner
│   ├── tagAutocomplete.ts      # CM autocompletion source for #tag
│   ├── uploadAnchors.ts        # Widget decorations holding a slot per in-flight upload
│   ├── formatting.ts           # FormattingController impl (toggle marks, headings, lists)
│   ├── controller.ts           # EditorController impl over an EditorView
│   └── ...                     # Heading/list/viewport decorations, editor.css
├── formatting/
│   └── commands.ts         # Backend-agnostic catalog of formatting verbs
├── Toolbar/                # EditorToolbar, FormattingToolbar, InsertMenu, AudienceMenu
├── constants.ts
└── types/                  # EditorController / FormattingController, component props,
                            #   attachment and insert-menu types
```

## Key Concepts

### State Management

A reducer (`state/reducer.ts`) drives an **external store**, not a `useReducer` in the provider, and consumers subscribe to just the slice they read via `useEditorSelector` (`useSyncExternalStore` under the hood). Content changes on every keystroke, so routing it through a single context value would re-render every consumer — toolbar, insert menu, metadata — per keystroke; with per-slice subscriptions only the components whose slice actually changed re-render. All state changes still go through action creators.

`state.content` holds the document as a **markdown string** and is the single source of truth. Because the editor stores markdown verbatim, `state.content` is exactly the editor's document — there is no encoding or normalization step.

### The editor contract

`types/editorController.ts` defines `EditorController` — document access (`getMarkdown`, `setMarkdown`, `insertMarkdown`), cursor and focus (`focus`, `hasFocus`, `isEmpty`, `getCursor`, `setCursor`, `scrollToCursor`, `selectAll`), the upload-anchor group below, plus an optional `formatting` capability. Callers outside the editor implementation use this interface exclusively and never reach into CodeMirror internals.

`Editor/controller.ts` implements `EditorController` over a CodeMirror `EditorView`: `getMarkdown` is just `view.state.doc.toString()`, `setMarkdown` replaces the whole document, and `insertMarkdown` block-pads the insertion so it lands as its own block.

`createUploadAnchor`/`updateUploadAnchor`/`resolveUploadAnchor`/`cancelUploadAnchor`/`getUploadAnchorPosition` drive `Editor/uploadAnchors.ts`, a `StateField` of widget decorations that hold a place in the document while an attachment uploads and carry its progress, failure message, and retry/keep affordances. `resolveUploadAnchor` replaces the anchor with the finished markdown (block-padded the same way `insertMarkdown` is); resolving with empty markdown cancels instead, as does `cancelUploadAnchor`. Anchors stay before text typed at the paste point, move through earlier edits and advance later queued images when an earlier image resolves. Completion maps the current selection rather than moving focus back to the upload location.

`FormattingController` (same file in `types/`) is the rich-formatting surface the expanded and selection toolbars drive: `run(commandId, ctx?)`, `getLink()`, `getActiveFormats()`, and `subscribe(listener)`. Link editing updates the target of an existing link; an explicit empty target removes the link and retains its label. `Editor/formatting.ts` implements it by editing the markdown source directly — toggling inline marks (`**` and `*`) and single-backtick code delimiters, line prefixes (`-`, `1.`, and `- [ ]`, each followed by a space), and ATX heading prefixes (`#`…) — and by reading active state from the Lezer syntax tree at the caret.

### Formatting command catalog

`formatting/commands.ts` is the single, editor-agnostic catalog of formatting verbs (`EDITOR_COMMANDS`, `EditorCommandId`, `ActiveFormatState`, `isCommandActive`). It is metadata only — labels (i18n keys), icons, and grouping — with no dependency on any concrete editor. The toolbar and the active-state highlighting derive everything from this catalog; `Editor/formatting.ts` supplies how each verb is applied to the live CodeMirror document. To add a verb, add one entry here and an active-state mapping if it represents persistent formatting. The initial catalog includes marks, inline/block code, headings, lists/tasks, quotes, horizontal rules and links. A direct image button shares the managed upload path.

### Editor extensions

`Editor/extensions.ts` exports `buildEditorExtensions()`, which composes the CodeMirror extension set: `@codemirror/lang-markdown` (with GFM), line wrapping, a reconfigurable placeholder, the editor theme, the `#tag`/`@mention` decoration plugin, the `#tag` autocomplete, and an update listener that pushes document changes back to the reducer via `onChange`. It also binds the save shortcut: `Meta-Enter` and `Ctrl-Enter` both call `onSubmit`, bound explicitly rather than through the platform-dependent `Mod-` so either works everywhere, and ordered ahead of `defaultKeymap`'s own `Mod-Enter` (`insertBlankLine`) so saving never also edits the document. The paste handler retains mixed text and files. Actual images use inline upload anchors at the caret, or at their semantic HTML positions when the clipboard provides them; other files remain attachments. HTML paste keeps basic headings, emphasis, lists, code and links without source styles. Remote HTML images become links and are never downloaded implicitly. Clipboard files map to HTML image positions only when the complete set of local blob/data/file slots matches the actual image files; ambiguous files are inserted once at the paste caret while source links remain readable. Preformatted code preserves its internal blank lines. More includes an optional one-shot plain-paste action; clicking it again cancels the intent. A semantic HTML paste also offers “保留纯文本” until the next document edit, replacing only that pasted range. That paste inserts the clipboard text verbatim and consumes the intent. The native Shift+Cmd/Ctrl+V shortcut also remains available when the browser dispatches a paste event. Plain Markdown paste and ordinary text drops otherwise remain CodeMirror-owned.

The app formatting keymap sits ahead of CodeMirror's generic `defaultKeymap`: `Mod-B`/`Mod-I` toggle bold/italic, `Mod-Shift-S` toggles strikethrough, `Mod-E` toggles inline code, `Mod-Alt-C` toggles a code block, `Mod-Alt-0` restores paragraph text, `Mod-Alt-1` through `Mod-Alt-3` select heading levels, and `Mod-Shift-7` through `Mod-Shift-9` toggle ordered, bullet, and task lists. CodeMirror's Markdown keymap remains enabled separately for structural `Enter` and `Backspace` behavior.

`Editor/theme.ts` defines the decorated-source look: a `HighlightStyle` over the Lezer markdown highlight tags (headings, strong, emphasis, code, links, quotes, markers) and an `EditorView.theme`. Colors come from CSS custom properties so light/dark themes just work. This is the editor's own styling — the read-only memo view styles itself separately via `@/lib/markdownStyles`.

### Tags and mentions

`#tag` autocomplete, decoration, and read-only rendering all use the shared scanner in `@/utils/tag-grammar`. The scanner owns tag syntax and Unicode/emoji recognition; each surface supplies only its Markdown context:

- `Editor/markdownTagRanges.ts` adapts the CodeMirror syntax tree into literal-source ranges, excluding links, code, math, raw HTML syntax, escapes, and entities before calling the shared scanner.
- `Editor/tagMentionDecorations.ts` decorates the tag matches returned by that adapter; mention recognition remains separate.
- `Editor/tagAutocomplete.ts` scans the raw input at the cursor and offers known tags from `useTagCounts`, including inside code, links, and escapes. Bare `#` offers all tags except at an opening heading marker (manual completion still works there). Nested paths match by prefix, path segment, or substring, including an unfinished child after `/`.
- `@/utils/remark-plugins/remark-tag` is the read-only renderer's Markdown AST adapter to the same scanner.

### Services

Pure TypeScript functions containing business logic. No React hooks, easy to test.

### Suggestions

Hosts of a new top-level memo (Home, the global composer) pass `useMemoSuggestions()`
into the `suggestions` prop; edits and comments omit the bar. `lib/memo-suggestions.ts`
merges typed candidates from providers and keeps the strongest source per id
(selection, then search, then the selected View). `lib/suggestion-expression.ts` is a
small Boolean CEL reader shared by the providers; unsupported syntax never falls back
to scanning free text.

- Tags: explicit tag conditions and selected tags. `insertTag()` is one isolated undo
  step at the caret that keeps selected text and honors the current Markdown context.
- Checklist: task-list conditions in saved Views or filters; a negative
  task-list or incomplete-task condition suppresses it.
- Visibility: exactly one explicit audience across filters and View, otherwise nothing.
  Space visibility also requires actual Space placement.

`EditorSuggestions` hides until the draft has text, drops suggestions already satisfied
(via the Markdown-aware `getTags()` / `hasChecklist()`, so code examples do not count)
or already accepted, and shows at most three across kinds. Acceptance history lives in
the editor store so Undo or reverting a choice does not immediately resuggest it, and it
clears with the draft on reset; nothing is persisted with the memo. `SuggestionsBar` is
payload-agnostic; a new kind extends the `MemoSuggestion` union and its
eligibility/application in `EditorSuggestions`.

### Presentation: inline vs hosted

Every instance is one of two things, and `onFocusModeExit` is the switch:

- **Inline** (prop omitted) — the editor sits in page flow and owns its presentation. A visible Focus button expands the same mounted editor; the header's visible exit returns it to page flow. Formatting starts collapsed (`kairos-editor-formatting-toolbar-v2`), the visible Format action opens it, and a short contextual toolbar appears for a text selection. Escape closes a child dialog/menu first and otherwise exits inline focus. Mode changes do not save, cancel or reset a draft.
- **Hosted** (prop supplied) — a host presents the editor full-screen and owns that frame; `contexts/GlobalMemoEditorContext.tsx` is the one today. The editor mounts straight into focus mode and exits by calling back to dismiss the host, so the header exit reads as Close rather than minimize. Format and More remain available; focus mode does not force the formatting toolbar open.

Photos, associations and locations are direct quiet toolbar actions. Less frequent actions, including audio recording, attachments, starting a tag, source mode and plain paste, remain in More. `startTag()` inserts an inline `#` at the caret without replacing selected text and leaves the caret immediately after it; block-oriented `insertMarkdown()` retains its existing semantics. The optional personal-journal partition picker uses a compact menu and only shows a name after selection. Configured outgoing destinations remain visible beside the explicit “保存并同步” action.

Those toggles travel as a single optional `viewToggles` object (`types/components.ts`) down `EditorToolbar` → `InsertMenu`, so they can only appear or disappear together.

### Destination and visibility

`AudienceMenu` is one dropdown for a memo's visibility and, where allowed, its Space. Visibility options come first; the Space is an optional row below them that never names the empty state: it reads "Add to space" until one is chosen, then shows the Space, and the selected Space in its submenu toggles back off (a check at rest, an ✕ under the pointer or keyboard, always an ✕ on touch). New top-level memos and edits of top-level memos the user can manage offer the row; a host-provided `defaultSpace` fixes a new memo's placement, and comments never offer it because their Space is the parent's. The destination lives in editor metadata: it is sent on creation, and an edit that changes it sends `space` and `visibility` together so the server can validate the move as one transition. Clearing a Space-only audience resets it to Private; adding a Space never changes the audience. Drafts retain destination and visibility alongside content, attachments, and location. Long names are truncated, with their full text retained for accessible labels and hover titles. Moving a memo between Spaces happens here; there is no separate move dialog.

### Lifecycle hooks

Cross-cutting React workflows stay outside the editor shell. `useMemoSave`
coordinates validation, persistence, query invalidation, and post-save reducer
state. `useFocusMode` owns focus mode's DOM lifecycle, including restoring the
previous body scroll style, retaining each mode's editor scroll position and preserving the editor's place in grid layouts. The focus frame keeps its header and bottom actions visible at ordinary viewport sizes; a shrinkable flex chain confines document scrolling to the same CodeMirror scroller in both modes. Attachments, relations and suggestions scroll within a bounded metadata region, separate from the save toolbar. The document retains a six-rem minimum viewport. If large text or a short visible viewport leaves too little room, the outer frame can also scroll so the header, document and save controls remain reachable; its position is retained per mode along with the document position. Scroll restoration follows viewport sizing, and switching again cancels any old restoration frame. Width and height changes do not animate, so they cannot invalidate the restored scroll range. Child dialogs return focus to that same editor without replacing its document or selection. Focus bounds track `visualViewport` changes so the frame follows the visible keyboard area. Reduced-motion preferences disable presentation transitions. Visual/source reconfiguration waits until composition ends.

### Components

Thin presentation components that dispatch actions and render UI.

## Usage

```typescript
import MemoEditor from "@/components/MemoEditor";

// Create mode: omit `memo`. Pass an existing Memo to edit it instead.
<MemoEditor
  cacheKey="home-composer"
  onConfirm={(name) => console.log('Saved:', name)}
  onCancel={() => console.log('Cancelled')}
/>
```

## Testing

Services are pure functions — easy to unit test without React.

```typescript
const state = createInitialState(); // from state/types.ts
const result = await memoService.save(state, { memoName: 'memos/123' });
```

## Personal journal durability

`useDurableDraft` persists text, the original edit baseline and selected `File` bytes to owner-scoped IndexedDB entries. The provider is keyed by account identity, so account changes create a fresh editor store. Unmount aborts active inline upload requests and stops subsequent files; late results cannot enter a different owner's editor. `journal-drafts.ts` serializes writes per key and reports success only after the transaction commits. Cleared or saved drafts are removed in that same ordering; unavailable/quota-exhausted storage never claims a successful local save. Inline upload jobs persist their mapped position, representative file order, original Blob, stable attachment ID and completed upload results in these same entries. After refresh, widgets rebuild and the first unfinished job resumes on reconnect; completed parts are not uploaded again. Consecutive jobs resolve in order, and the upload service reuses a stable ID when a response was lost. The attachment strip excludes these in-body objects to avoid double presentation. A pending inline job blocks record save until its Markdown references resolve, while the draft's separate status reports actual local persistence. Explicit offline saves without unresolved inline insertions use a separate pending queue. `PendingRecords` resumes those saves with stable memo/attachment IDs and exposes cold-start offline drafts without replacing an occupied editor. Cold offline text edits remap durable inline anchors through the actual text change. Pending synchronization first checkpoints completed uploads and resolved image Markdown, then saves the record, so refresh/retry retains both original placement and successful parts. The pending runner and its save/upload requests are cancelled with the owner editor lifetime. Moving a draft into the durable pending queue also removes its legacy localStorage copy after the durable operation succeeds.

The editor defaults to private and a fresh personal partition selection. Files are uploaded before the memo transaction. The final partition selection and its observed mapping version travel in that same request; the server commits record fields, mapping CAS and a durable outbound intent together. Partition-only changes are valid saves without touching the body or dates. A failed selection retains the draft and never reports that the body saved separately. Recording always keeps the audio file; transcription is a separately editable candidate and only enters the body after acceptance.

Edits compare the originally opened record, including date, location and attachments. The client sends `X-Memos-Expected-Record-Sha256`; `lib/journal-record-version.ts` and `store.MemoRecordSnapshot.Hash` use a shared UTF-8 length-prefixed tuple with IEEE754 coordinate bits. The database drivers recheck that complete tuple under the memo mutation transaction, including for metadata-only changes. A conflict retains the local draft and opens a comparison; accepting a new baseline is an explicit action, with another comparison at save time. A shared hash vector and concurrent metadata mutation tests protect the protocol.


Editor regression coverage lives in `editor-live-preview`, `inline-image-recovery`,
`editor-focus-viewport`, `memo-editor-paste-files`, `editor-upload-anchor`,
`editor-formatting`, `editor` and the existing draft/save suites under `web/tests/`.
Unit composition and visual-viewport events verify state handling; browser clipboard,
layout and IndexedDB reload checks remain separate acceptance evidence.
