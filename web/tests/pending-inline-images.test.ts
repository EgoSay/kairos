import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePendingInlineImages } from "@/components/MemoEditor/services/pendingInlineImages";
import { uploadService } from "@/components/MemoEditor/services/uploadService";
import { createInitialState, type EditorState } from "@/components/MemoEditor/state";
import { editInlineImageDraft } from "@/components/MemoEditor/utils/inlineImageDraft";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";

const remote = (id: string) => create(AttachmentSchema, { name: `attachments/${id}`, filename: `${id}.png`, type: "image/png" });
const initial = (separateJobs = false): EditorState => ({
  ...createInitialState(),
  content: "前后",
  localFiles: ["one", "two"].map((id) => ({
    file: new File([id], `${id}.png`, { type: "image/png" }),
    previewUrl: `blob:${id}`,
    clientId: id,
    inlineUpload: { id: separateJobs ? id : "job", position: 1, representative: true },
  })),
});
afterEach(() => vi.restoreAllMocks());

describe("headless pending inline recovery", () => {
  it.each([false, true])("checkpoints completed bytes and maps jobs on retry (separate jobs: %s)", async (separateJobs) => {
    let persisted = initial(separateJobs);
    const checkpoint = vi.fn(async (next: EditorState) => {
      persisted = next;
    });
    const upload = vi.spyOn(uploadService, "uploadFile").mockResolvedValueOnce(remote("one")).mockRejectedValueOnce(new Error("offline"));
    const signal = new AbortController().signal;
    await expect(resolvePendingInlineImages(persisted, checkpoint, signal)).rejects.toThrow("offline");
    expect(persisted.metadata.attachments.map((item) => item.name)).toEqual(["attachments/one"]);
    if (separateJobs) {
      expect(persisted.content).toContain("![one]");
      expect(persisted.localFiles).toHaveLength(1);
      expect(persisted.localFiles[0].inlineUpload?.position).toBeGreaterThan(1);
    } else {
      expect(persisted.content).toBe("前后");
      expect(persisted.localFiles[0].inlineUpload?.attachment?.name).toBe("attachments/one");
    }
    upload.mockResolvedValueOnce(remote("two"));
    const result = await resolvePendingInlineImages(persisted, checkpoint, signal);
    expect(upload.mock.calls.map(([file]) => file.clientId)).toEqual(["one", "two", "two"]);
    expect(result.localFiles).toEqual([]);
    expect(result.content).toBe("前\n\n![one](/file/attachments/one)\n\n![two](/file/attachments/two)\n\n后");
    expect(result.metadata.attachments).toHaveLength(2);
    expect(result.ui.pendingInlineImageInsertions).toBe(0);
    expect(persisted).toBe(result);
  });
  it("does not start a later file or checkpoint a stale response after cancellation", async () => {
    let complete!: (attachment: ReturnType<typeof remote>) => void;
    const upload = vi.spyOn(uploadService, "uploadFile").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const controller = new AbortController();
    const checkpoint = vi.fn();
    const pending = resolvePendingInlineImages(initial(), checkpoint, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    complete(remote("one"));
    await rejected;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toBe(controller.signal);
    expect(checkpoint).not.toHaveBeenCalled();
  });
  it("persists a missing stable ID before any upload and fails closed on local storage failure", async () => {
    const state = initial();
    state.localFiles = [{ ...state.localFiles[0], clientId: undefined }];
    const upload = vi.spyOn(uploadService, "uploadFile");
    const checkpoint = vi.fn().mockRejectedValue(new Error("quota"));
    await expect(resolvePendingInlineImages(state, checkpoint, new AbortController().signal)).rejects.toThrow("quota");
    expect(checkpoint.mock.calls[0][0].localFiles[0].clientId).toMatch(/^[a-f0-9]{32}$/);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("offline text anchor mapping", () => {
  it("moves anchors through prefix insertion, range deletion and insertion at the anchor", () => {
    let state = initial();
    state = editInlineImageDraft(state, "新增前后");
    expect(state.localFiles[0].inlineUpload?.position).toBe(3);
    state = editInlineImageDraft(state, "新增前中后", { from: 3, to: 3 });
    expect(state.localFiles[0].inlineUpload?.position).toBe(3);
    state = editInlineImageDraft(state, "后", { from: 0, to: 4 });
    expect(state.localFiles[0].inlineUpload?.position).toBe(0);
  });
  it("uses the actual selection to distinguish repeated text insertion and backspace", () => {
    let state = { ...initial(), content: "aaaa" };
    state = editInlineImageDraft(state, "aaaaa", { from: 0, to: 0 });
    expect(state.localFiles[0].inlineUpload?.position).toBe(2);
    state = editInlineImageDraft(state, "aaaa", { from: 1, to: 1, inputType: "deleteContentBackward" });
    expect(state.localFiles[0].inlineUpload?.position).toBe(1);
  });
});
