import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateSnippet } from "@/components/MemoCandidateList";
import { useLinkMemo } from "@/components/MemoEditor/hooks/useLinkMemo";
import { LinkMemoDialog } from "@/components/MemoMetadata/Relation/LinkMemoDialog";
import { State } from "@/types/proto/api/v1/common_pb";
import { type MemoRelation, MemoRelationSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/connect", () => ({ memoServiceClient: { listMemos: api.list } }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/me" }) }));
vi.mock("@/components/MemoContent", () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));

function Harness() {
  const [open, setOpen] = useState(false);
  const [relations, setRelations] = useState<MemoRelation[]>([create(MemoRelationSchema, { relatedMemo: { name: "memos/linked" } })]);
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const link = useLinkMemo({
    isOpen: open,
    currentMemoName: "memos/self",
    existingRelations: relations,
    onAddRelation: (relation) => {
      setRelations([...relations, relation]);
      setOpen(false);
    },
  });
  return (
    <>
      <textarea ref={editor} aria-label="正文" defaultValue="草稿仍在这里" />
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        关联
      </button>
      <output aria-label="草稿关联">{relations.map((relation) => relation.relatedMemo?.name).join(",")}</output>
      <LinkMemoDialog
        open={open}
        onOpenChange={setOpen}
        anchorRef={trigger}
        searchText={link.searchText}
        onSearchChange={link.setSearchText}
        onCompositionChange={link.setIsComposing}
        filteredMemos={link.filteredMemos}
        isFetching={link.isFetching}
        onSelectMemo={link.addMemoRelation}
        isAlreadyLinked={link.isAlreadyLinked}
        error={link.error}
        onRetry={link.retry}
        hasNextPage={link.hasNextPage}
        onLoadMore={link.fetchNextPage}
        isFetchingNextPage={link.isFetchingNextPage}
        onReturnToEditor={() => editor.current?.focus()}
      />
    </>
  );
}
const memo = (id: string, content = id, state = State.NORMAL) => create(MemoSchema, { name: `memos/${id}`, snippet: id, content, state });
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "关联" }));
  return view;
};

beforeEach(() => {
  api.list.mockReset();
});

describe("contextual relation picker", () => {
  it("selects a row in one click and returns to the same draft without a confirmation step", async () => {
    api.list.mockResolvedValue({ memos: [memo("self"), memo("linked"), memo("one")], nextPageToken: "" });
    setup();
    const candidate = await screen.findByRole("button", { name: "关联 one" });
    expect(screen.queryByRole("button", { name: "关联 self" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已关联 linked" })).toBeDisabled();
    fireEvent.click(candidate);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("草稿关联")).toHaveTextContent("memos/linked,memos/one");
    await waitFor(() => expect(screen.getByLabelText("正文")).toHaveFocus());
    expect(screen.getByLabelText("正文")).toHaveValue("草稿仍在这里");
  });

  it("expands a preview in place and supports keyboard selection with archived state visible", async () => {
    api.list.mockResolvedValue({ memos: [memo("linked"), memo("old", "完整的旧记录正文", State.ARCHIVED)], nextPageToken: "" });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "预览 old" }));
    expect(screen.getByRole("region", { name: "记录预览" })).toHaveTextContent("完整的旧记录正文");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("已归档")).toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: "搜索关联记录" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("草稿关联")).toHaveTextContent("memos/old"));
  });

  it("does not query unfinished IME text and leaves cancelled drafts unchanged", async () => {
    api.list.mockResolvedValue({ memos: [memo("one")], nextPageToken: "" });
    setup();
    await screen.findByRole("button", { name: "关联 one" });
    const input = screen.getByRole("combobox", { name: "搜索关联记录" });
    const before = api.list.mock.calls.length;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "zhong" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(api.list).toHaveBeenCalledTimes(before);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByLabelText("草稿关联")).toHaveTextContent("memos/linked");
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回继续写作" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("正文")).toHaveValue("草稿仍在这里");
    fireEvent.click(screen.getByRole("button", { name: "关联" }));
    await screen.findByRole("button", { name: "关联 one" });
    const reopened = screen.getByRole("combobox", { name: "搜索关联记录" });
    expect(reopened).toHaveValue("");
    fireEvent.keyDown(reopened, { key: "ArrowDown" });
    fireEvent.keyDown(reopened, { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("草稿关联")).toHaveTextContent("memos/one"));
  });

  it("finds a literal match beyond the stored snippet, preserving special characters", () => {
    const content = `${"旧内容".repeat(100)}这里有 [特殊].* 字符和中文${"后文".repeat(100)}`;
    expect(candidateSnippet({ content, snippet: "旧内容" }, "[特殊].*")).toContain("[特殊].*");
    expect(candidateSnippet({ content, snippet: "旧内容" }, "[特殊].*")).toMatch(/^….*…$/);
  });
});
