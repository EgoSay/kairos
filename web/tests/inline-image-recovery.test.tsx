import { create } from "@bufbuild/protobuf";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type PropsWithChildren, type RefObject, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadAnchorDescriptor } from "@/components/MemoEditor/Editor/uploadAnchors";
import { useInlineImageUpload } from "@/components/MemoEditor/hooks/useInlineImageUpload";
import { uploadService } from "@/components/MemoEditor/services";
import { createInitialState, EditorProvider, type EditorState, useEditorContext } from "@/components/MemoEditor/state";
import type { LocalFile } from "@/components/MemoEditor/types/attachment";
import type { EditorController } from "@/components/MemoEditor/types/editorController";
import { restoreJournalState, snapshotJournalState } from "@/lib/journal-drafts";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn() } }));
const image = (name: string): LocalFile => ({
  file: new File([name], name, { type: "image/png" }),
  previewUrl: `blob:${name}`,
  origin: "upload",
});
const remote = (name: string) => create(AttachmentSchema, { name: `attachments/${name}`, filename: `${name}.png`, type: "image/png" });
const mount = (initialEditorState = createInitialState(), strict = false) => {
  const descriptors: UploadAnchorDescriptor[] = [];
  let mappedPosition = 7;
  const controller = {
    getCursor: () => 7,
    getUploadAnchorPosition: () => mappedPosition,
    createUploadAnchor: vi.fn((descriptor: UploadAnchorDescriptor) => descriptors.push(descriptor)),
    updateUploadAnchor: vi.fn((descriptor: UploadAnchorDescriptor) => descriptors.push(descriptor)),
    resolveUploadAnchor: vi.fn(),
    cancelUploadAnchor: vi.fn(),
    insertMarkdown: vi.fn(),
  } as unknown as EditorController;
  const wrapper = ({ children }: PropsWithChildren) =>
    strict ? (
      <StrictMode>
        <EditorProvider initialEditorState={initialEditorState}>{children}</EditorProvider>
      </StrictMode>
    ) : (
      <EditorProvider initialEditorState={initialEditorState}>{children}</EditorProvider>
    );
  const hook = renderHook(
    () => ({ uploads: useInlineImageUpload({ current: controller } as RefObject<EditorController>), editor: useEditorContext() }),
    { wrapper, reactStrictMode: strict },
  );
  return {
    ...hook,
    controller,
    descriptors,
    setPosition: (value: number) => {
      mappedPosition = value;
    },
  };
};
beforeEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = vi.fn((file: Blob) => `blob:restored-${(file as File).name}`);
});

describe("durable inline images", () => {
  it("keeps original bytes, stable IDs and mapped caret placement offline, then resumes online", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const upload = vi.spyOn(uploadService, "uploadFile").mockResolvedValue(remote("photo"));
    const first = mount();
    const file = image("photo.png");
    act(() => first.result.current.uploads.insertLocalImages([file], 7));
    expect(upload).not.toHaveBeenCalled();
    expect(first.result.current.editor.getState().ui.pendingInlineImageInsertions).toBe(1);
    first.setPosition(17);
    act(() => first.result.current.editor.dispatch(first.result.current.editor.actions.updateContent("前面增加内容后的草稿")));
    const snapshot = await snapshotJournalState(first.result.current.editor.getState());
    const saved = snapshot.localFiles[0];
    expect(saved.file).toBe(file.file);
    expect(saved.clientId).toMatch(/^[a-f0-9]{32}$/);
    expect(saved.inlineUpload?.position).toBe(17);
    expect(saved).not.toHaveProperty("previewUrl");
    expect(first.descriptors.at(-1)?.message).not.toContain("已保留");
    first.unmount();
    const restored = restoreJournalState({ key: "home", owner: "users/test", kind: "draft", state: snapshot, updatedAt: 1 });
    expect(restored.ui.pendingInlineImageInsertions).toBe(1);
    const second = mount(restored);
    expect(second.controller.createUploadAnchor).toHaveBeenCalledWith(expect.anything(), 17);
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(second.controller.resolveUploadAnchor).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toEqual(expect.objectContaining({ clientId: saved.clientId, file: file.file }));
    expect(second.result.current.editor.getState().localFiles).toEqual([]);
    expect(second.result.current.editor.getState().ui.pendingInlineImageInsertions).toBe(0);
    expect(second.result.current.editor.getState().metadata.attachments.map((attachment) => attachment.name)).toEqual([
      "attachments/photo",
    ]);
  });
  it("does not reupload completed parts after refresh and retries the failed part with the same ID", async () => {
    const upload = vi.spyOn(uploadService, "uploadFile").mockResolvedValueOnce(remote("first")).mockRejectedValueOnce(new Error("offline"));
    const first = mount();
    act(() => first.result.current.uploads.insertLocalImages([image("first.png"), image("second.png")]));
    await waitFor(() => expect(first.descriptors.at(-1)?.status).toBe("failed"));
    const snapshot = await snapshotJournalState(first.result.current.editor.getState());
    expect(snapshot.localFiles[0].inlineUpload?.attachment?.name).toBe("attachments/first");
    const secondID = snapshot.localFiles[1].clientId;
    first.unmount();
    upload.mockResolvedValueOnce(remote("second"));
    const restored = restoreJournalState({ key: "home", owner: "users/test", kind: "draft", state: snapshot, updatedAt: 1 });
    const second = mount(restored);
    await waitFor(() => expect(second.controller.resolveUploadAnchor).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls.map(([file]) => file.file.name)).toEqual(["first.png", "second.png", "second.png"]);
    expect(upload.mock.calls[2][0].clientId).toBe(secondID);
    expect(second.controller.resolveUploadAnchor).toHaveBeenCalledWith(
      expect.any(String),
      "![first](/file/attachments/first)\n\n![second](/file/attachments/second)",
    );
    expect(second.result.current.editor.getState().metadata.attachments).toHaveLength(2);
  });
  it("serializes continuous paste jobs so a slower first upload cannot reverse their order", async () => {
    let finishFirst!: (attachment: ReturnType<typeof remote>) => void;
    const upload = vi
      .spyOn(uploadService, "uploadFile")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(remote("second"));
    const hook = mount();
    act(() => {
      hook.result.current.uploads.insertLocalImages([image("first.png")]);
      hook.result.current.uploads.insertLocalImages([image("second.png")]);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(hook.result.current.editor.getState().localFiles).toHaveLength(2);
    await act(async () => finishFirst(remote("first")));
    await waitFor(() => expect(hook.controller.resolveUploadAnchor).toHaveBeenCalledTimes(2));
    expect(vi.mocked(hook.controller.resolveUploadAnchor).mock.calls.map(([, source]) => source)).toEqual([
      "![first](/file/attachments/first)",
      "![second](/file/attachments/second)",
    ]);
  });
  it("does not start another upload after the owner editor unmounts while a request fails", async () => {
    let rejectFirst!: (error: Error) => void;
    const upload = vi
      .spyOn(uploadService, "uploadFile")
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(remote("second"));
    const hook = mount();
    act(() => hook.result.current.uploads.insertLocalImages([image("first.png"), image("second.png")]));
    expect(upload).toHaveBeenCalledTimes(1);
    const signal = upload.mock.calls[0][1];
    expect(signal?.aborted).toBe(false);
    hook.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => rejectFirst(new Error("request ended after logout")));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("restarts Strict Mode's aborted restoration with stable IDs and ignores its stale response", async () => {
    let firstSignal: AbortSignal | undefined;
    let finishStale!: (attachment: ReturnType<typeof remote>) => void;
    const upload = vi
      .spyOn(uploadService, "uploadFile")
      .mockImplementationOnce((_file, signal) => {
        firstSignal = signal;
        return new Promise((resolve) => {
          finishStale = resolve;
        });
      })
      .mockResolvedValueOnce(remote("photo"));
    const file = { ...image("photo.png"), clientId: "stable", inlineUpload: { id: "restored", position: 7, representative: true } };
    const hook = mount({ ...createInitialState(), localFiles: [file] }, true);
    await waitFor(() => expect(hook.controller.resolveUploadAnchor).toHaveBeenCalledTimes(1));
    expect(firstSignal?.aborted).toBe(true);
    expect(upload.mock.calls.map(([local]) => local.clientId)).toEqual(["stable", "stable"]);
    await act(async () => finishStale(remote("stale")));
    expect(hook.result.current.editor.getState().metadata.attachments.map((attachment) => attachment.name)).toEqual(["attachments/photo"]);
    expect(hook.controller.resolveUploadAnchor).toHaveBeenCalledTimes(1);
  });

  it("restores in React strict mode without leaving the pending upload untracked", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const file = { ...image("photo.png"), clientId: "stable", inlineUpload: { id: "restored", position: 7, representative: true } };
    const initial: EditorState = { ...createInitialState(), localFiles: [file] };
    const hook = mount(initial, true);
    expect(hook.result.current.editor.getState().ui.pendingInlineImageInsertions).toBe(1);
    expect(hook.result.current.editor.getState().localFiles[0].clientId).toBe("stable");
    expect(hook.descriptors.at(-1)?.status).toBe("failed");
  });
});
