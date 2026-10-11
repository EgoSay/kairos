import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoService } from "@/components/MemoEditor/services/memoService";
import { uploadService } from "@/components/MemoEditor/services/uploadService";
import { createInitialState } from "@/components/MemoEditor/state";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const client = vi.hoisted(() => ({ getMemo: vi.fn(), updateMemo: vi.fn(), createMemo: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: client, attachmentServiceClient: {} }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("pending save owner lifetime", () => {
  it("stops before any request when already cancelled", async () => {
    const upload = vi.spyOn(uploadService, "uploadFiles");
    const controller = new AbortController();
    controller.abort();
    await expect(memoService.save({ ...createInitialState(), content: "private" }, {}, controller.signal)).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
    expect(client.createMemo).not.toHaveBeenCalled();
  });
  it("does not create after uploads finish for a disposed owner", async () => {
    let finish!: () => void;
    const upload = vi.spyOn(uploadService, "uploadFiles").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([]);
        }),
    );
    const controller = new AbortController();
    const pending = memoService.save({ ...createInitialState(), content: "private" }, {}, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    finish();
    await rejected;
    expect(upload.mock.calls[0][1]).toBe(controller.signal);
    expect(client.createMemo).not.toHaveBeenCalled();
  });
  it("does not update after its baseline read resolves for a disposed owner", async () => {
    const baseline = create(MemoSchema, { name: "memos/one", content: "before", visibility: Visibility.PRIVATE });
    const controller = new AbortController();
    client.getMemo.mockImplementation(async () => {
      controller.abort();
      return baseline;
    });
    await expect(
      memoService.save(
        { ...createInitialState(), ...memoService.fromMemo(baseline), content: "after" },
        { memoName: baseline.name },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(client.getMemo).toHaveBeenCalledWith({ name: baseline.name }, { signal: controller.signal });
    expect(client.updateMemo).not.toHaveBeenCalled();
  });
  it("binds a live creation request to the original owner's cancellation signal", async () => {
    const controller = new AbortController();
    client.createMemo.mockResolvedValue(create(MemoSchema, { name: "memos/new" }));
    await memoService.save({ ...createInitialState(), content: "private" }, {}, controller.signal);
    expect(client.createMemo.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});
