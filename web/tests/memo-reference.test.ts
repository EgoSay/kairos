import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { getEditorReferenceRelations, getRelationBuckets } from "@/components/MemoMetadata/Relation/relationHelpers";
import { memoNameFromURL, memoReferenceRanges, recordExcerpt } from "@/lib/memo-reference";
import { MemoRelation_Type, MemoRelationSchema, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const origins = ["https://journal.example"];
describe("record references", () => {
  it("recognizes only the exact instance and canonical record path", () => {
    expect(memoNameFromURL("https://journal.example/memos/one/?view=full#section", origins)).toBe("memos/one");
    expect(memoNameFromURL("/memos/one", origins)).toBe("memos/one");
    for (const href of [
      "//evil.example/memos/one",
      "https://journal.example.evil/memos/one",
      "https://user:pass@journal.example/memos/one",
      "javascript:alert(1)",
      "/memos/a%2fb",
      "/memos/shares/token",
      "memos/one",
      "/memos/one\\two",
    ])
      expect(memoNameFromURL(href, origins)).toBeUndefined();
  });
  it("distinguishes cards, inline references and authored labels without changing source", () => {
    const source =
      "https://journal.example/memos/one\n\n继续看 https://journal.example/memos/two 的想法\n\n[我的命名](/memos/three)\n\n[旧记录][ref]\n\n[ref]: /memos/four";
    const ranges = memoReferenceRanges(source, origins);
    expect(ranges.map(({ name, block, label }) => ({ name, block, label }))).toEqual([
      { name: "memos/one", block: true, label: undefined },
      { name: "memos/two", block: false, label: undefined },
      { name: "memos/three", block: false, label: "我的命名" },
      { name: "memos/four", block: false, label: "旧记录" },
    ]);
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe("https://journal.example/memos/one");
    expect(
      memoReferenceRanges(
        "`https://journal.example/memos/one`\n\n```\nhttps://journal.example/memos/two\n```\n\n![image](/memos/three)\n\n\\[text](/memos/four)",
        origins,
      ),
    ).toEqual([]);
  });
  it("shows a media-only label and deduplicates display while retaining manual provenance", () => {
    expect(recordExcerpt(create(MemoSchema, { attachments: [{ type: "image/png" }] }))).toBe("图片记录");
    const manual = create(MemoRelationSchema, {
      type: MemoRelation_Type.REFERENCE,
      memo: { name: "memos/a" },
      relatedMemo: { name: "memos/b" },
    });
    const automatic = create(MemoRelationSchema, { ...manual, type: MemoRelation_Type.CONTENT_REFERENCE });
    expect(getRelationBuckets([automatic, manual], "memos/a").referencing).toHaveLength(1);
    expect(getRelationBuckets([automatic, manual], "memos/b").referenced).toHaveLength(1);
    expect(getEditorReferenceRelations([automatic, manual], "memos/a")).toEqual([manual]);
  });
});
