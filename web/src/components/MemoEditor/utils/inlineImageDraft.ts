import type { EditorState } from "../state";

/** Padding shared by the live editor and durable, headless pending-record sync. */
export function blockPad(before: string, after: string): { prefix: string; suffix: string } {
  const prefix = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return { prefix, suffix };
}

export interface TextEditSelection {
  from: number;
  to: number;
  inputType?: string;
}

/** Match a textarea edit while retaining the live editor's before-insertion anchor bias. */
export function editInlineImageDraft(state: EditorState, content: string, selection?: TextEditSelection): EditorState {
  const previous = state.content;
  let from = 0;
  while (from < previous.length && from < content.length && previous[from] === content[from]) from++;
  let to = previous.length;
  let end = content.length;
  while (to > from && end > from && previous[to - 1] === content[end - 1]) {
    to--;
    end--;
  }
  if (selection) {
    let selectedFrom = selection.from;
    let selectedTo = selection.to;
    const deleted = previous.length - content.length;
    if (selectedFrom === selectedTo && deleted > 0) {
      if (selection.inputType === "deleteContentBackward") selectedFrom = Math.max(0, selectedFrom - deleted);
      if (selection.inputType === "deleteContentForward") selectedTo = Math.min(previous.length, selectedTo + deleted);
    }
    const insertedLength = content.length - (previous.length - (selectedTo - selectedFrom));
    if (
      insertedLength >= 0 &&
      previous.slice(0, selectedFrom) === content.slice(0, selectedFrom) &&
      previous.slice(selectedTo) === content.slice(selectedFrom + insertedLength)
    ) {
      from = selectedFrom;
      to = selectedTo;
      end = from + insertedLength;
    }
  }
  const delta = end - to;
  return {
    ...state,
    content,
    localFiles: state.localFiles.map((file) => {
      if (!file.inlineUpload) return file;
      const old = Math.min(Math.max(file.inlineUpload.position, 0), previous.length);
      const position = old <= from ? old : old >= to ? old + delta : from;
      return { ...file, inlineUpload: { ...file.inlineUpload, position } };
    }),
  };
}

/** Resolve one durable upload job, moving later colocated jobs after its Markdown. */
export function resolveInlineImageDraft(state: EditorState, id: string, markdown: string): EditorState {
  const job = state.localFiles.find((file) => file.inlineUpload?.id === id)?.inlineUpload;
  if (!job) return state;
  const position = Math.min(Math.max(job.position, 0), state.content.length);
  const before = state.content.slice(0, position);
  const after = state.content.slice(position);
  const { prefix, suffix } = blockPad(before, after);
  const inserted = markdown ? prefix + markdown + suffix : "";
  const localFiles = state.localFiles
    .filter((file) => file.inlineUpload?.id !== id)
    .map((file) => {
      if (!file.inlineUpload || file.inlineUpload.position < position) return file;
      return { ...file, inlineUpload: { ...file.inlineUpload, position: file.inlineUpload.position + inserted.length } };
    });
  return {
    ...state,
    content: before + inserted + after,
    localFiles,
    ui: {
      ...state.ui,
      pendingInlineImageInsertions: new Set(localFiles.flatMap((file) => (file.inlineUpload ? [file.inlineUpload.id] : []))).size,
    },
  };
}
