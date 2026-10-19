import { describe, expect, it } from "vitest";
import type { MemoFilter } from "@/contexts/MemoFilterContext";
import { composeViewFilter, emptyViewScope, parseViewFilter, scopeFromFilters, type ViewScope, withTimeSelection } from "@/lib/view-scope";

const TZ = "Asia/Shanghai";

const normalize = (scope: ViewScope): ViewScope => ({
  filters: [...scope.filters].sort((a, b) => `${a.factor}:${a.value}`.localeCompare(`${b.factor}:${b.value}`)),
  residual: scope.residual,
});

const roundTrip = (scope: ViewScope, timezone = TZ) => normalize(parseViewFilter(composeViewFilter(scope, timezone), timezone));

const expectRoundTrip = (scope: ViewScope, timezone = TZ) => expect(roundTrip(scope, timezone)).toEqual(normalize(scope));

describe("view scope round trip", () => {
  it("round-trips every canonical condition kind", () => {
    expectRoundTrip({
      residual: "",
      filters: [
        { factor: "contentSearch", value: "今晚 月亮" },
        { factor: "contentSearch", value: 'quote "inside"' },
        { factor: "tagSearch", value: "人生修行/阅读" },
        { factor: "tagExclude", value: "work/差旅" },
        { factor: "untagged", value: "true" },
        { factor: "pinned", value: "true" },
        { factor: "property.hasImage", value: "true" },
        { factor: "property.hasAudio", value: "true" },
        { factor: "property.hasAttachment", value: "true" },
        { factor: "property.hasLink", value: "true" },
        { factor: "property.hasCode", value: "true" },
        { factor: "property.hasTaskList", value: "true" },
        { factor: "property.hasLocation", value: "true" },
        { factor: "partition", value: "abc123" },
        { factor: "dateStart", value: "2026-03-01" },
        { factor: "dateEnd", value: "2026-03-08" },
      ],
    });
  });

  it("round-trips tag groups in both match modes and subtag toggles", () => {
    const base = [{ factor: "tagSearch", value: "a" } as MemoFilter, { factor: "tagSearch", value: "b/c" } as MemoFilter];
    expectRoundTrip({ filters: base, residual: "" });
    expectRoundTrip({ filters: [...base, { factor: "tagMatch", value: "any" }], residual: "" });
    expectRoundTrip({ filters: [...base, { factor: "tagExact", value: "true" }], residual: "" });
    expectRoundTrip({ filters: [{ factor: "tagSearch", value: "solo" }], residual: "" });
  });

  it("round-trips every dynamic range preset", () => {
    for (const preset of ["rolling:24h", "rolling:7d", "rolling:30d", "rolling:90d", "year"]) {
      expectRoundTrip({ filters: [{ factor: "dateRange", value: preset }], residual: "" });
    }
  });

  it("round-trips fixed dates across DST and non-China zones", () => {
    const filters = [
      { factor: "dateStart", value: "2025-03-09" } as MemoFilter, // US spring-forward day
      { factor: "dateEnd", value: "2025-11-02" } as MemoFilter, // US fall-back day
    ];
    expectRoundTrip({ filters, residual: "" }, "America/New_York");
    expectRoundTrip({ filters, residual: "" }, "Pacific/Kiritimati");
  });

  it("keeps residual clauses verbatim through a round trip", () => {
    expectRoundTrip({
      residual: 'visibility == "PUBLIC" && size(content) > 280',
      filters: [{ factor: "pinned", value: "true" }],
    });
  });
});

describe("parseViewFilter on legacy expressions", () => {
  it("recognizes example filters from the old views page", () => {
    expect(parseViewFilter("pinned", TZ)).toEqual({ filters: [{ factor: "pinned", value: "true" }], residual: "" });
    expect(parseViewFilter("size(tags) == 0", TZ)).toEqual({ filters: [{ factor: "untagged", value: "true" }], residual: "" });
    const parsed = parseViewFilter('tag in ["work", "personal"]', TZ);
    expect(parsed.filters).toEqual([]);
    expect(parsed.residual).toBe('tag in ["work", "personal"]');
  });

  it("keeps unrecognizable clauses as residual instead of dropping them", () => {
    const parsed = parseViewFilter("has_task_list && has_incomplete_tasks && created_ts.getMonth() == now.getMonth()", TZ);
    expect(parsed.filters).toEqual([{ factor: "property.hasTaskList", value: "true" }]);
    expect(parsed.residual).toBe("has_incomplete_tasks && created_ts.getMonth() == now.getMonth()");
  });

  it("refuses to widen a non-day-aligned timestamp bound", () => {
    const parsed = parseViewFilter("created_ts >= timestamp(1704067200)", TZ); // 2024-01-01T00:00Z, not a tz day start
    expect(parsed.filters).toEqual([]);
    expect(parsed.residual).toBe("created_ts >= timestamp(1704067200)");
  });

  it("treats an unknown rolling duration as residual", () => {
    const parsed = parseViewFilter('created_ts >= now - duration("13h")', TZ);
    expect(parsed.filters).toEqual([]);
    expect(parsed.residual).toBe('created_ts >= now - duration("13h")');
  });

  it("leaves the raw search expression in residual", () => {
    const parsed = parseViewFilter('content.startsWith("TODO") || has_link', TZ);
    expect(parsed.residual).toBe('content.startsWith("TODO") || has_link');
  });
});

describe("scopeFromFilters", () => {
  it("drops request-scope flags and folds displayTime into a fixed day range", () => {
    const scope = scopeFromFilters([
      { factor: "includeArchived", value: "true" },
      { factor: "visibility", value: "PUBLIC" },
      { factor: "displayTime", value: "2026-10-19" },
      { factor: "tagSearch", value: "a" },
      { factor: "celSearch", value: "size(content) > 10" },
    ]);
    expect(scope.filters).toEqual([
      { factor: "dateStart", value: "2026-10-19" },
      { factor: "dateEnd", value: "2026-10-19" },
      { factor: "tagSearch", value: "a" },
    ]);
    expect(scope.residual).toBe("size(content) > 10");
  });
});

describe("withTimeSelection", () => {
  it("makes fixed dates and dynamic presets mutually exclusive", () => {
    const fixed: MemoFilter[] = [
      { factor: "dateStart", value: "2026-01-01" },
      { factor: "dateEnd", value: "2026-01-31" },
    ];
    const dynamic = withTimeSelection(fixed, { kind: "dynamic", preset: "rolling:7d" });
    expect(dynamic).toEqual([{ factor: "dateRange", value: "rolling:7d" }]);
    const back = withTimeSelection(dynamic, { kind: "fixed", start: "2026-02-01", end: "2026-02-10" });
    expect(back).toEqual([
      { factor: "dateStart", value: "2026-02-01" },
      { factor: "dateEnd", value: "2026-02-10" },
    ]);
    expect(withTimeSelection(back, { kind: "none" })).toEqual([]);
  });
});

describe("composeViewFilter", () => {
  it("emits canonical sorted clauses wrapped per condition", () => {
    const cel = composeViewFilter(
      {
        residual: "has_incomplete_tasks",
        filters: [
          { factor: "pinned", value: "true" },
          { factor: "untagged", value: "true" },
        ],
      },
      TZ,
    );
    expect(cel).toBe("(pinned) && (size(tags) == 0) && (has_incomplete_tasks)");
  });

  it("is empty for an empty scope", () => {
    expect(composeViewFilter(emptyViewScope(), TZ)).toBe("");
  });
});
