import { describe, expect, it } from "vitest";
import { buildSearchFacetConditions, keywordSearchFilter, tagBranchFilter } from "@/lib/memo-search";

describe("visual search uses the shared server filter", () => {
  it("treats Chinese, quotes, percent and expression-like input as text", () => {
    expect(keywordSearchFilter('中文 "引号" 50%_ 中文')).toBe(
      'content.contains("中文") && content.contains("\\\"引号\\\"") && content.contains("50%_")',
    );
    expect(keywordSearchFilter("pinned || has_image")).toBe(
      'content.contains("pinned") && content.contains("||") && content.contains("has_image")',
    );
  });
  it("matches tag segments and exposes exact matching separately", () => {
    expect(tagBranchFilter("人生/阅读")).toBe('("人生/阅读" in tags || tags.exists(t, t.startsWith("人生/阅读/")))');
    expect(tagBranchFilter("人生/阅读", false)).toBe('"人生/阅读" in tags');
    const conditions = buildSearchFacetConditions([
      { factor: "tagSearch", value: "人生" },
      { factor: "tagSearch", value: "工作" },
      { factor: "tagMatch", value: "any" },
      { factor: "tagExclude", value: "人生/家庭" },
      { factor: "tagExact", value: "true" },
    ]);
    expect(conditions).toEqual(['("人生" in tags || "工作" in tags)', '!("人生/家庭" in tags)']);
  });
  it("uses the journal timezone including 23-hour days and inclusive end dates", () => {
    expect(
      buildSearchFacetConditions(
        [
          { factor: "dateStart", value: "2026-03-08" },
          { factor: "dateEnd", value: "2026-03-08" },
          { factor: "untagged", value: "true" },
          { factor: "property.hasImage", value: "true" },
          { factor: "partition", value: "" },
        ],
        "America/New_York",
      ),
    ).toEqual([
      `created_ts >= timestamp(${Date.parse("2026-03-08T05:00:00Z") / 1000})`,
      `created_ts < timestamp(${Date.parse("2026-03-09T04:00:00Z") / 1000})`,
      "size(tags) == 0",
      "has_image",
      'journal_partition == ""',
    ]);
    expect(buildSearchFacetConditions([{ factor: "dateStart", value: "2026-02-30" }])).toEqual(["false"]);
  });
});
