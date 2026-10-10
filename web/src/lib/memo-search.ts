import type { MemoFilter } from "@/contexts/MemoFilterContext";
import { journalDayRange } from "@/lib/journal";

/** Quotes every word as data; plain search never interprets a user's expression. */
export const keywordSearchFilter = (query: string): string | undefined => {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))];
  return terms.length ? terms.map((term) => `content.contains(${JSON.stringify(term)})`).join(" && ") : undefined;
};

/** Match a complete path segment, including historical tags without stored ancestors. */
export const tagBranchFilter = (tag: string, descendants = true): string =>
  descendants
    ? `(${JSON.stringify(tag)} in tags || tags.exists(t, t.startsWith(${JSON.stringify(`${tag}/`)})))`
    : `${JSON.stringify(tag)} in tags`;

export const searchIncludesArchived = (filters: MemoFilter[]): boolean =>
  filters.some((filter) => filter.factor === "includeArchived" && filter.value === "true");

/** Shared by all collection views; filtering happens before server pagination. */
export const buildSearchFacetConditions = (filters: MemoFilter[], timezone = "Asia/Shanghai"): string[] => {
  const conditions: string[] = [];
  const descendants = !filters.some((filter) => filter.factor === "tagExact" && filter.value === "true");
  const included = filters.filter((filter) => filter.factor === "tagSearch");
  const anyTag = filters.some((filter) => filter.factor === "tagMatch" && filter.value === "any");
  if (included.length) {
    conditions.push(`(${included.map((filter) => tagBranchFilter(filter.value, descendants)).join(anyTag ? " || " : " && ")})`);
  }
  for (const filter of filters) {
    switch (filter.factor) {
      case "tagExclude":
        conditions.push(`!(${tagBranchFilter(filter.value, descendants)})`);
        break;
      case "untagged":
        conditions.push("size(tags) == 0");
        break;
      case "dateStart":
      case "dateEnd": {
        const range = journalDayRange(filter.value, timezone);
        conditions.push(
          range
            ? `created_ts ${filter.factor === "dateStart" ? ">=" : "<"} timestamp(${filter.factor === "dateStart" ? range.start : range.end})`
            : "false",
        );
        break;
      }
      case "partition":
        conditions.push(`journal_partition == ${JSON.stringify(filter.value)}`);
        break;
      case "property.hasImage":
        conditions.push("has_image");
        break;
      case "property.hasAudio":
        conditions.push("has_audio");
        break;
      case "property.hasAttachment":
        conditions.push("has_attachment");
        break;
    }
  }
  return conditions;
};
