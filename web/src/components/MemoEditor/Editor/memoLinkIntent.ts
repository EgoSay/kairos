import { isolateHistory } from "@codemirror/commands";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { literalMarkdownSourceRanges } from "./markdownTagRanges";

/** The host owns request identity; a cancelled request never changes the document. */
export interface MemoLinkRequest {
  id: number;
  memoName?: string;
  onLinked?: () => void;
}

interface Options {
  origin: string;
  onLinkRequest: (request: Omit<MemoLinkRequest, "id">) => void;
  onPastedMemo: (name: string | undefined) => void;
}

/** A current-instance record URL is a suggestion, never permission to fetch another origin. */
export function pastedMemoName(text: string, origin: string): string | undefined {
  const value = text.trim();
  if (!value || /\s/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(origin).origin || url.username || url.password) return undefined;
    const match = /^\/memos\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    return match ? `memos/${match[1]}` : undefined;
  } catch {
    return undefined;
  }
}

function clipboardMemoName(clipboard: DataTransfer | null, origin: string): string | undefined {
  if (!clipboard || clipboard.files?.length || Array.from(clipboard.items ?? []).some((item) => item.kind === "file")) return undefined;
  const text = clipboard.getData("text/plain").trim();
  const name = pastedMemoName(text, origin);
  if (!name) return undefined;
  const html = clipboard.getData("text/html");
  if (!html.trim()) return name;

  // Browsers often put the same copied URL in both clipboard formats. Inspect
  // that representation in an inert fragment; never render or fetch its nodes.
  const template = document.createElement("template");
  template.innerHTML = html;
  const nodes = Array.from(template.content.childNodes).filter(
    (node) =>
      node.nodeType !== Node.COMMENT_NODE && node.nodeName !== "META" && !(node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()),
  );
  const anchor = nodes[0];
  if (nodes.length !== 1 || !(anchor instanceof HTMLAnchorElement) || anchor.childElementCount !== 0 || anchor.textContent?.trim() !== text)
    return undefined;
  const href = anchor.getAttribute("href");
  if (!href) return undefined;
  try {
    return new URL(href, origin).href === new URL(text).href ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Optional [[ intent and a one-paste record-link hint, without changing stored Markdown. */
export function createMemoLinkIntent({ origin, onLinkRequest, onPastedMemo }: Options): Extension {
  let pastedName: string | undefined;
  return [
    Prec.highest(
      EditorView.domEventHandlers({
        paste(event) {
          pastedName = clipboardMemoName(event.clipboardData, origin);
          // Native CodeMirror paste dispatches synchronously when clipboard data
          // is available. Expire an unused observation if another handler cancels.
          queueMicrotask(() => {
            pastedName = undefined;
          });
          return false;
        },
      }),
    ),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      onPastedMemo(undefined);
      if (pastedName && update.transactions.some((transaction) => transaction.isUserEvent("input.paste"))) {
        onPastedMemo(pastedName);
        pastedName = undefined;
      }
      const { view, state } = update;
      if (view.composing || view.compositionStarted || !state.selection.main.empty || state.selection.ranges.length !== 1) return;
      const typed = update.transactions.some((transaction) => {
        if (!transaction.isUserEvent("input.type") || transaction.isUserEvent("input.type.compose")) return false;
        let bracket = false;
        transaction.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
          if (toB === state.selection.main.head && (inserted.toString() === "[" || inserted.toString() === "[[")) bracket = true;
        });
        return bracket;
      });
      const to = state.selection.main.head;
      const from = to - 2;
      if (!typed || from < 0 || state.doc.sliceString(from, to) !== "[[" || (from > 0 && state.doc.sliceString(from - 1, from) === "["))
        return;
      if (!literalMarkdownSourceRanges(state, from, to).some((range) => range.from <= from && range.to >= to)) return;
      const documentAtRequest = state.doc;
      onLinkRequest({
        onLinked: () => {
          // Selection movement is fine; edits, composition and editor replacement
          // invalidate the source range. Never remove text from a later draft.
          if (!view.dom.isConnected || view.state.doc !== documentAtRequest || view.compositionStarted) return;
          view.dispatch({
            changes: { from, to, insert: "" },
            userEvent: "input",
            annotations: isolateHistory.of("full"),
            scrollIntoView: true,
          });
        },
      });
    }),
  ];
}
