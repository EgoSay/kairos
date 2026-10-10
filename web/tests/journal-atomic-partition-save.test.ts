import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoService } from "@/components/MemoEditor/services/memoService";
import { createInitialState } from "@/components/MemoEditor/state";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const client = vi.hoisted(() => ({ getMemo: vi.fn(), updateMemo: vi.fn(), createMemo: vi.fn() }));
const partition = vi.hoisted(() => ({ getMemoPartition: vi.fn(), finishPartitionSave: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: client, attachmentServiceClient: {} }));
vi.mock("@/hooks/useJournalPartitionQueries", () => partition);

describe("atomic editor partition saves", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["next", "", "paused"])("persists a partition-only selection %s without changing body or dates", async (partitionId) => {
    const memo = create(MemoSchema, { name: "memos/one", content: "original", visibility: Visibility.PRIVATE });
    const state = { ...createInitialState(), ...memoService.fromMemo(memo) };
    state.metadata = { ...state.metadata, journalPartitionId: partitionId, journalPartitionExplicit: true };
    partition.getMemoPartition.mockResolvedValue({ partitionId: "old", version: 4, suspended: partitionId === "paused" });
    client.getMemo.mockResolvedValue(memo);
    client.updateMemo.mockResolvedValue(memo);
    expect(await memoService.save(state, { memoName: memo.name })).toMatchObject({ hasChanges: true });
    expect(client.updateMemo).toHaveBeenCalledOnce();
    expect(client.updateMemo.mock.calls[0][0].updateMask.paths).toEqual([]);
    expect(client.updateMemo.mock.calls[0][0].journalPartition).toMatchObject({ partitionId, expectedVersion: 4n });
    expect(partition.finishPartitionSave).not.toHaveBeenCalled();
  });
  it("submits changed words and final destination together, with no second save", async () => {
    const memo = create(MemoSchema, { name: "memos/one", content: "original", visibility: Visibility.PRIVATE });
    const state = { ...createInitialState(), ...memoService.fromMemo(memo), content: "new words" };
    state.metadata = { ...state.metadata, journalPartitionId: "selected", journalPartitionExplicit: true, journalPartitionVersion: 4 };
    partition.getMemoPartition.mockResolvedValue({ partitionId: "old", version: 4 });
    client.getMemo.mockResolvedValue(memo);
    client.updateMemo.mockResolvedValue(memo);
    await memoService.save(state, { memoName: memo.name });
    expect(client.updateMemo).toHaveBeenCalledOnce();
    expect(client.updateMemo.mock.calls[0][0]).toMatchObject({
      memo: { content: "new words" },
      journalPartition: { partitionId: "selected", expectedVersion: 4n },
    });
    expect(partition.finishPartitionSave).not.toHaveBeenCalled();
  });
  it("keeps the draft selection on failure and retries the same atomic request", async () => {
    const memo = create(MemoSchema, { name: "memos/one", content: "original", visibility: Visibility.PRIVATE });
    const state = { ...createInitialState(), ...memoService.fromMemo(memo) };
    state.metadata = { ...state.metadata, journalPartitionId: "selected", journalPartitionExplicit: true, journalPartitionVersion: 4 };
    partition.getMemoPartition.mockResolvedValue({ partitionId: "old", version: 4 });
    client.getMemo.mockResolvedValue(memo);
    client.updateMemo.mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable)).mockResolvedValue(memo);
    await expect(memoService.save(state, { memoName: memo.name })).rejects.toMatchObject({ code: Code.Unavailable });
    expect(state.metadata.journalPartitionId).toBe("selected");
    await expect(memoService.save(state, { memoName: memo.name })).resolves.toMatchObject({ hasChanges: true });
    expect(client.updateMemo.mock.calls[0]).toEqual(client.updateMemo.mock.calls[1]);
  });
  it("does not overwrite a partition changed since the editor opened", async () => {
    const memo = create(MemoSchema, { name: "memos/one", content: "original", visibility: Visibility.PRIVATE });
    const state = { ...createInitialState(), ...memoService.fromMemo(memo), content: "my words" };
    state.metadata = { ...state.metadata, journalPartitionId: "selected", journalPartitionExplicit: true, journalPartitionVersion: 4 };
    partition.getMemoPartition.mockResolvedValue({ partitionId: "other device", version: 5 });
    client.getMemo.mockResolvedValue(memo);
    await expect(memoService.save(state, { memoName: memo.name })).rejects.toMatchObject({ code: Code.Aborted });
    expect(client.updateMemo).not.toHaveBeenCalled();
    expect(state.content).toBe("my words");
  });
  it("keeps the no-change result for an unchanged selection", async () => {
    const memo = create(MemoSchema, { name: "memos/one", content: "original", visibility: Visibility.PRIVATE });
    const state = { ...createInitialState(), ...memoService.fromMemo(memo) };
    state.metadata = { ...state.metadata, journalPartitionId: "same", journalPartitionExplicit: true, journalPartitionVersion: 4 };
    partition.getMemoPartition.mockResolvedValue({ partitionId: "same", version: 4 });
    client.getMemo.mockResolvedValue(memo);
    await expect(memoService.save(state, { memoName: memo.name })).resolves.toMatchObject({ hasChanges: false });
    expect(client.updateMemo).not.toHaveBeenCalled();
  });
  it("recovers a lost creation response only when its committed destination also matches", async () => {
    const state = { ...createInitialState(), content: "new record" };
    state.metadata = { ...state.metadata, journalPartitionId: "selected", journalPartitionExplicit: true };
    const memo = create(MemoSchema, { name: `memos/${state.clientId}`, content: state.content, visibility: state.metadata.visibility });
    client.createMemo.mockRejectedValue(new ConnectError("exists", Code.AlreadyExists));
    client.getMemo.mockResolvedValue(memo);
    partition.getMemoPartition.mockResolvedValueOnce({ partitionId: "selected", version: 1 });
    await expect(memoService.save(state, {})).resolves.toMatchObject({ memoName: memo.name, hasChanges: true });
    expect(client.createMemo.mock.calls[0][0].journalPartition).toMatchObject({ partitionId: "selected", expectedVersion: 0n });
    partition.getMemoPartition.mockResolvedValueOnce({ partitionId: "another", version: 2 });
    await expect(memoService.save(state, {})).rejects.toMatchObject({ code: Code.AlreadyExists });
  });
});
