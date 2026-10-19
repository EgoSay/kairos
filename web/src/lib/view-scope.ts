/**
 * [INPUT]: MemoFilter model, combineCELFilters, journalDayRange/journalDate, buildSearchFacetConditions, Translations
 * [OUTPUT]: ViewScope, DynamicRangePreset, DYNAMIC_RANGE_PRESETS, DYNAMIC_RANGE_LABEL_KEYS, emitViewConditions,
 *           composeViewFilter, parseViewFilter, mergeScopes, scopeFromFilters, withTimeSelection, emptyViewScope,
 *           dynamicRangePreset
 * [POS]: lib 的视图条件双向桥 —— CEL 存储串 ⇄ 可视化条件模型的唯一翻译层，被 ViewComposer/MemoFilters/QuickFind 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { type FilterFactor, type MemoFilter } from "@/contexts/MemoFilterContext";
import { combineCELFilters } from "@/lib/cel-filter";
import { journalDate, journalDayRange } from "@/lib/journal";
import { buildSearchFacetConditions } from "@/lib/memo-search";
import type { Translations } from "@/utils/i18n";

/**
 * A saved view is a CEL string; this module is the two-way bridge between that
 * string and the visual condition model. The composer emits one canonical shape
 * per condition, so the parser only recognizes that grammar — anything else is
 * preserved verbatim as `residual` and ANDed back unchanged.
 */
export interface ViewScope {
  filters: MemoFilter[];
  residual: string;
}

export const emptyViewScope = (): ViewScope => ({ filters: [], residual: "" });

/** Rolling windows stay dynamic because `now` folds per query compile. */
export interface DynamicRangePreset {
  /** `dateRange` factor value. */
  id: string;
  /** CEL duration literal for rolling presets; absent for calendar presets. */
  duration?: string;
  /** Canonical expression emitted for this preset. */
  cel: string;
}

const rolling = (id: string, hours: number): DynamicRangePreset => ({
  id,
  duration: `${hours}h`,
  cel: `created_ts >= now - duration("${hours}h")`,
});

export const DYNAMIC_RANGE_PRESETS: readonly DynamicRangePreset[] = [
  rolling("rolling:24h", 24),
  rolling("rolling:7d", 168),
  rolling("rolling:30d", 720),
  rolling("rolling:90d", 2160),
  { id: "year", cel: "created_ts.getFullYear() == now.getFullYear()" },
];

export const dynamicRangePreset = (id: string): DynamicRangePreset | undefined => DYNAMIC_RANGE_PRESETS.find((preset) => preset.id === id);

/** Static key map keeps computed t() calls (and the locale audit) out of components. */
export const DYNAMIC_RANGE_LABEL_KEYS: Record<string, Translations> = {
  "rolling:24h": "view.range.rolling-24h",
  "rolling:7d": "view.range.rolling-7d",
  "rolling:30d": "view.range.rolling-30d",
  "rolling:90d": "view.range.rolling-90d",
  year: "view.range.year",
};

const PROPERTY_CONDITIONS: ReadonlyArray<[FilterFactor, string]> = [
  ["property.hasImage", "has_image"],
  ["property.hasAudio", "has_audio"],
  ["property.hasAttachment", "has_attachment"],
  ["property.hasLink", "has_link"],
  ["property.hasCode", "has_code"],
  ["property.hasTaskList", "has_task_list"],
  ["property.hasLocation", "has_location"],
];

// These four live outside the search facet emitter, so views emit them inline.
const VIEW_EXTRA_PROPERTIES: ReadonlyArray<[FilterFactor, string]> = PROPERTY_CONDITIONS.filter(([factor]) =>
  ["property.hasLink", "property.hasCode", "property.hasTaskList", "property.hasLocation"].includes(factor),
);

/** Time factors are mutually exclusive: picking one clears the rest. */
const TIME_FACTORS: readonly FilterFactor[] = ["dateStart", "dateEnd", "dateRange", "displayTime"];

/** Replaces a scope's time selection; callers pick either fixed days or a dynamic preset. */
export const withTimeSelection = (
  filters: MemoFilter[],
  selection: { kind: "fixed"; start: string; end: string } | { kind: "dynamic"; preset: string } | { kind: "none" },
): MemoFilter[] => {
  const rest = filters.filter((filter) => !TIME_FACTORS.includes(filter.factor));
  if (selection.kind === "fixed" && selection.start && selection.end) {
    return [...rest, { factor: "dateStart", value: selection.start }, { factor: "dateEnd", value: selection.end }];
  }
  if (selection.kind === "dynamic") {
    return [...rest, { factor: "dateRange", value: selection.preset }];
  }
  return rest;
};

/**
 * Canonical clause strings for the view-supported subset of MemoFilter. Kept in
 * lockstep with `parseViewFilter`. The facet domain (tags, dates, partition,
 * untagged) delegates to `buildSearchFacetConditions` so saved views and live
 * search can never drift apart; the remaining factors emit their canonical
 * shapes inline.
 */
export const emitViewConditions = (filters: MemoFilter[], timezone: string): string[] => {
  const conditions: string[] = [];
  for (const filter of filters) {
    switch (filter.factor) {
      case "contentSearch":
        conditions.push(`content.contains(${JSON.stringify(filter.value)})`);
        break;
      case "celSearch":
        if (filter.value.trim()) conditions.push(filter.value.trim());
        break;
      case "dateRange":
        conditions.push(dynamicRangePreset(filter.value)?.cel ?? "false");
        break;
      case "pinned":
        conditions.push("pinned");
        break;
      default: {
        const property = VIEW_EXTRA_PROPERTIES.find(([factor]) => factor === filter.factor);
        if (property) conditions.push(property[1]);
        break;
      }
    }
  }
  conditions.push(...buildSearchFacetConditions(filters, timezone));
  return conditions;
};

/** Scope → stored filter. Clauses are sorted so equivalent scopes compare equal textually. */
export const composeViewFilter = (scope: ViewScope, timezone: string): string => {
  const conditions = emitViewConditions(scope.filters, timezone).sort();
  const residual = scope.residual.trim();
  if (residual) conditions.push(residual);
  return combineCELFilters(...conditions) ?? "";
};

// ---------------------------------------------------------------------------
// CEL → scope recognition
// ---------------------------------------------------------------------------

const isQuoted = (value: string): boolean => value.startsWith('"') && value.endsWith('"') && value.length >= 2;

/** Splits on a top-level operator, honoring parens and JSON string literals. */
const splitTopLevel = (expr: string, operator: "&&" | "||"): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && char === operator[0] && expr.slice(i, i + 2) === operator) {
      parts.push(expr.slice(start, i));
      i += 1;
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

/** Removes parentheses that enclose the whole clause, repeatedly. */
const stripParens = (clause: string): string => {
  let current = clause.trim();
  while (current.startsWith("(") && current.endsWith(")")) {
    // The outer "(" only wraps the whole clause if it closes at the very end.
    let depth = 0;
    let inString = false;
    let escaped = false;
    let enclosing = true;
    for (let i = 0; i < current.length; i++) {
      const char = current[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        if (depth === 0 && i !== current.length - 1) enclosing = false;
        if (depth < 0) enclosing = false;
        if (!enclosing) break;
      }
    }
    if (!enclosing || depth !== 0) break;
    current = current.slice(1, -1).trim();
  }
  return current;
};

const parseJsonString = (literal: string): string | undefined => {
  if (!isQuoted(literal)) return undefined;
  try {
    const value = JSON.parse(literal);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The two emitted tag shapes: `"tag" in explicit_tags` (exact) and
 * `"tag" in tags || tags.exists(t, t.startsWith("tag/"))` (with descendants).
 * A bare `"x" in tags` is not an emitted shape, so it falls to residual.
 */
const parseTagBranch = (clause: string): { tag: string; descendants: boolean } | undefined => {
  const bare = /^("(?:[^"\\]|\\.)*") in explicit_tags$/.exec(clause);
  if (bare) {
    const tag = parseJsonString(bare[1]);
    return tag === undefined ? undefined : { tag, descendants: false };
  }
  const branch = /^("(?:[^"\\]|\\.)*") in tags \|\| tags\.exists\(t, t\.startsWith\(("(?:[^"\\]|\\.)*")\)\)$/.exec(clause);
  if (!branch) return undefined;
  const tag = parseJsonString(branch[1]);
  const prefix = parseJsonString(branch[2]);
  if (tag === undefined || prefix !== `${tag}/`) return undefined;
  return { tag, descendants: true };
};

const TIMESTAMP_LITERAL = /timestamp\(\s*(?:(\d+)|("(?:[^"\\]|\\.)*"))\s*\)/;

const timestampToEpoch = (match: RegExpExecArray): number | undefined => {
  if (match[1]) return Number(match[1]);
  const iso = parseJsonString(match[2]);
  if (!iso) return undefined;
  const epoch = Date.parse(iso);
  return Number.isFinite(epoch) ? Math.floor(epoch / 1000) : undefined;
};

/** Inverse of the `journalDayRange` bound: the local date whose day starts at `bound`. */
const boundToDate = (bound: number, timezone: string): string => journalDate(new Date(bound * 1000), timezone);

const prevDate = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

const ROLLING_SECONDS: ReadonlyMap<number, string> = new Map(
  DYNAMIC_RANGE_PRESETS.flatMap((preset) => (preset.duration ? [[Number(preset.duration.slice(0, -1)) * 3600, preset.id] as const] : [])),
);

const ROLLING_CLAUSE = /^created_ts >= now - duration\("(\d+)([hms])"\)$/;

const classifyClause = (clause: string, timezone: string): MemoFilter[] | "residual" => {
  const contains = /^content\.contains\(("(?:[^"\\]|\\.)*")\)$/.exec(clause);
  if (contains) {
    const value = parseJsonString(contains[1]);
    return value === undefined ? "residual" : [{ factor: "contentSearch", value }];
  }

  if (clause === "pinned") return [{ factor: "pinned", value: "true" }];
  if (clause === "size(tags) == 0") return [{ factor: "untagged", value: "true" }];

  const property = PROPERTY_CONDITIONS.find(([, cel]) => cel === clause);
  if (property) return [{ factor: property[0], value: "true" }];

  const partition = /^journal_partition == ("(?:[^"\\]|\\.)*")$/.exec(clause);
  if (partition) {
    const value = parseJsonString(partition[1]);
    return value === undefined ? "residual" : [{ factor: "partition", value }];
  }

  const startBound = /^created_ts >= /.exec(clause);
  if (startBound) {
    const rest = clause.slice(startBound[0].length);
    const rollingMatch = ROLLING_CLAUSE.exec(clause);
    if (rollingMatch) {
      const n = Number(rollingMatch[1]);
      const seconds = rollingMatch[2] === "h" ? n * 3600 : rollingMatch[2] === "m" ? n * 60 : n;
      const preset = ROLLING_SECONDS.get(seconds);
      return preset ? [{ factor: "dateRange", value: preset }] : "residual";
    }
    const bound = TIMESTAMP_LITERAL.exec(rest.trim());
    if (bound && bound.index === 0 && bound[0].length === rest.trim().length) {
      const epoch = timestampToEpoch(bound);
      // Only a bound that is exactly a local-day start survives the round trip.
      if (epoch === undefined || journalDayRange(boundToDate(epoch, timezone), timezone)?.start !== epoch) return "residual";
      return [{ factor: "dateStart", value: boundToDate(epoch, timezone) }];
    }
    return "residual";
  }
  const endBound = /^created_ts < /.exec(clause);
  if (endBound) {
    const rest = clause.slice(endBound[0].length).trim();
    const bound = TIMESTAMP_LITERAL.exec(rest);
    if (bound && bound.index === 0 && bound[0].length === rest.length) {
      const epoch = timestampToEpoch(bound);
      // The end bound is the first instant of the day after the range ends.
      if (epoch === undefined) return "residual";
      const endDate = prevDate(boundToDate(epoch, timezone));
      if (journalDayRange(endDate, timezone)?.end !== epoch) return "residual";
      return [{ factor: "dateEnd", value: endDate }];
    }
    return "residual";
  }

  if (clause === "created_ts.getFullYear() == now.getFullYear()" || clause === "now.getFullYear() == created_ts.getFullYear()") {
    return [{ factor: "dateRange", value: "year" }];
  }

  const negated = /^!\s*(.*)$/.exec(clause);
  if (negated) {
    const inner = stripParens(negated[1]);
    const branch = parseTagBranch(inner);
    if (branch)
      return [{ factor: "tagExclude", value: branch.tag }, ...(branch.descendants ? [] : [{ factor: "tagExact" as const, value: "true" }])];
    return "residual";
  }

  const branch = parseTagBranch(clause);
  if (branch) {
    return [{ factor: "tagSearch", value: branch.tag }, ...(branch.descendants ? [] : [{ factor: "tagExact" as const, value: "true" }])];
  }

  return "residual";
};

/** CEL → scope. Unrecognized clauses keep their text in `residual`, still ANDed on save. */
export const parseViewFilter = (cel: string, timezone: string): ViewScope => {
  const filters: MemoFilter[] = [];
  const residual: string[] = [];

  for (const raw of splitTopLevel(cel.trim(), "&&")) {
    const clause = stripParens(raw);
    // A single tag branch is itself an `||` expression, so classify first and
    // only treat leftovers as multi-branch groups.
    const recognized = classifyClause(clause, timezone);
    if (recognized !== "residual") {
      filters.push(...recognized);
      continue;
    }
    const orParts = splitTopLevel(clause, "||");
    const andParts = orParts.length > 1 ? [] : splitTopLevel(clause, "&&");
    const parts = orParts.length > 1 ? orParts : andParts;
    if (parts.length > 1) {
      const branches = parts.map((part) => parseTagBranch(stripParens(part)));
      if (branches.every((branch) => branch !== undefined)) {
        for (const branch of branches) {
          filters.push({ factor: "tagSearch", value: (branch as { tag: string }).tag });
          if (!(branch as { descendants: boolean }).descendants) filters.push({ factor: "tagExact", value: "true" });
        }
        if (orParts.length > 1) filters.push({ factor: "tagMatch", value: "any" });
        continue;
      }
    }
    residual.push(clause);
  }

  const seen = new Set<string>();
  return {
    filters: filters.filter((filter) => {
      const key = `${filter.factor}:${filter.value}`;
      return seen.has(key) ? false : (seen.add(key), true);
    }),
    residual: residual.join(" && "),
  };
};

/** Union two scopes (e.g. live filters + the currently selected view), deduped. */
export const mergeScopes = (a: ViewScope, b: ViewScope): ViewScope => {
  const seen = new Set<string>();
  return {
    filters: [...a.filters, ...b.filters].filter((filter) => {
      const key = `${filter.factor}:${filter.value}`;
      return seen.has(key) ? false : (seen.add(key), true);
    }),
    residual: [a.residual, b.residual].filter(Boolean).join(" && "),
  };
};

/** What "save as view" captures from live filters: search state stays, scope flags don't. */
export const scopeFromFilters = (filters: MemoFilter[]): ViewScope => {
  const kept: MemoFilter[] = [];
  const residual: string[] = [];
  for (const filter of filters) {
    if (filter.factor === "celSearch") {
      if (filter.value.trim()) residual.push(filter.value.trim());
      continue;
    }
    // Request-level flags (`includeArchived`) and day navigation (`displayTime`)
    // are not record conditions, so they do not enter a saved view. displayTime
    // becomes a fixed created_ts range per the view's original-date semantics.
    if (filter.factor === "includeArchived" || filter.factor === "visibility") continue;
    if (filter.factor === "displayTime") {
      kept.push({ factor: "dateStart", value: filter.value }, { factor: "dateEnd", value: filter.value });
      continue;
    }
    kept.push(filter);
  }
  return { filters: kept, residual: residual.join(" && ") };
};
