import { describe, expect, it } from "vitest";
import type { WanderDirection, WanderNeighborhood, WanderOriginal } from "@/hooks/useWanderQueries";
import { insertWanderBranch, readableWanderTrail, type WanderRoute } from "@/lib/wander";

const original = (name: string): WanderOriginal => ({
  name,
  content: `原文 ${name}`,
  createdTs: 1,
  revision: 1,
  tags: [],
  truncated: false,
});
const direction = (name: string): WanderDirection => ({
  original: original(name),
  hint: "双方原话的联系",
  sourceQuote: "原话",
  targetQuote: "原话",
  kind: "test",
  topic: "问题",
  topicId: "test",
  context: "",
  manual: false,
});
const node = (name: string, targets: string[] = []): WanderNeighborhood => ({
  root: original(name),
  directions: targets.map(direction),
  epoch: 1,
  profile: "test",
  state: "ready",
});
const route: WanderRoute = { history: ["a", "b", "c"], sources: { b: "a", c: "b" }, index: 0 };
const nodes = () =>
  new Map<string, WanderNeighborhood | undefined>([
    ["a", node("a", ["b"])],
    ["b", node("b", ["a", "c", "d"])],
    ["c", node("c", ["b"])],
  ]);
const read = (map = nodes(), blocked = new Set<string>()) =>
  readableWanderTrail(route, map, (value) => value.tags.includes("hidden"), blocked);

describe("continuous wander eligibility and branches", () => {
  it("reads a linked original from the validated parent's prepared result while its own neighborhood is loading", () => {
    const map = nodes();
    map.set("b", undefined);
    expect(read(map).map((entry) => entry.original.name)).toEqual(["a", "b"]);
  });
  it.each(["epoch", "profile"])("never mixes a %s from a different prepared graph", (field) => {
    const map = nodes();
    map.set("b", { ...node("b", ["c"]), [field]: field === "epoch" ? 2 : "new" });
    expect(read(map).map((entry) => entry.original.name)).toEqual(["a"]);
  });
  it("withdraws the record and downstream evidence as soon as full-memo access is denied", () => {
    expect(read(nodes(), new Set(["b"])).map((entry) => entry.original.name)).toEqual(["a"]);
    expect(read(nodes(), new Set(["a"]))).toEqual([]);
  });
  it("does not leak a blurred record through its next original or a connection", () => {
    const map = nodes();
    const hidden = node("b", ["c"]);
    hidden.root!.tags = ["hidden"];
    map.set("b", hidden);
    expect(read(map).map((entry) => entry.original.name)).toEqual(["a"]);
  });
  it("keeps a dismissed edge out of the reading hints while independently valid visited text stays readable", () => {
    const map = nodes();
    map.set("a", node("a"));
    const entries = read(map);
    expect(entries.map((entry) => entry.original.name)).toEqual(["a", "b", "c"]);
    expect(entries[1].direction).toBeUndefined();
  });
  it("rejects a new target revision explained by an old prepared quote", () => {
    const map = nodes();
    const changed = node("b", ["c"]);
    changed.root!.revision = 2;
    map.set("b", changed);
    expect(read(map).map((entry) => entry.original.name)).toEqual(["a"]);
  });
  it("inserts a branch and only changes the next hint when an actual connecting edge exists", () => {
    const next = insertWanderBranch(route, "b", "d", node("d", ["c"]));
    expect(next.history).toEqual(["a", "b", "d", "c"]);
    expect(next.sources).toEqual({ b: "a", d: "b", c: "d" });
    expect(route.history).toEqual(["a", "b", "c"]);
    expect(insertWanderBranch(route, "b", "d", node("d")).sources.c).toBe("b");
  });
  it("does not duplicate an existing record or accept an unrelated branch source", () => {
    expect(insertWanderBranch(route, "b", "a")).toBe(route);
    expect(insertWanderBranch(route, "not-on-path", "d")).toBe(route);
  });
});
