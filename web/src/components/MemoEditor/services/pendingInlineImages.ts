import { uniqBy } from "lodash-es";
import { v4 as uuidv4 } from "uuid";
import { buildManagedAttachmentMarkdown } from "@/utils/managed-attachment";
import type { EditorState } from "../state";
import { resolveInlineImageDraft } from "../utils/inlineImageDraft";
import { uploadService } from "./uploadService";

/** Complete offline inline jobs before memo save; every durable step is retryable. */
export async function resolvePendingInlineImages(
  initial: EditorState,
  checkpoint: (state: EditorState) => Promise<unknown>,
  signal: AbortSignal,
): Promise<EditorState> {
  let state = initial;
  const jobs = [...new Set(state.localFiles.flatMap((file) => (file.inlineUpload ? [file.inlineUpload.id] : [])))];
  for (const id of jobs) {
    signal.throwIfAborted();
    const indexes = state.localFiles.flatMap((file, index) => (file.inlineUpload?.id === id ? [index] : []));
    for (const index of indexes) {
      signal.throwIfAborted();
      let file = state.localFiles[index];
      if (!file.clientId && !file.inlineUpload!.attachment) {
        file = { ...file, clientId: uuidv4().replaceAll("-", "") };
        state = { ...state, localFiles: state.localFiles.map((current, position) => (position === index ? file : current)) };
        await checkpoint(state);
        signal.throwIfAborted();
      }
      const attachment = file.inlineUpload!.attachment ?? (await uploadService.uploadFile(file, signal));
      signal.throwIfAborted();
      state = {
        ...state,
        metadata: { ...state.metadata, attachments: uniqBy([...state.metadata.attachments, attachment], (item) => item.name) },
        localFiles: state.localFiles.map((current, position) =>
          position === index ? { ...current, inlineUpload: { ...current.inlineUpload!, attachment } } : current,
        ),
      };
      await checkpoint(state);
    }
    signal.throwIfAborted();
    const markdown = state.localFiles
      .filter((file) => file.inlineUpload?.id === id && file.inlineUpload.representative)
      .map((file) => buildManagedAttachmentMarkdown(file.inlineUpload!.attachment!))
      .join("\n\n");
    state = resolveInlineImageDraft(state, id, markdown);
    await checkpoint(state);
  }
  signal.throwIfAborted();
  return state;
}
