import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMemoShareFontCSS } from "@/components/MemoActionMenu/memoShareImageFonts";

const wenKaiCSS = readFileSync("node_modules/lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css", "utf8");

const styles: HTMLStyleElement[] = [];
const nodes: HTMLElement[] = [];
const preview = (css: string, text: string, family: string) => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  styles.push(style);
  // jsdom 29 drops @font-face-only descriptors (src/unicode-range). Restore
  // the browser CSSOM contract from the real CSS without mocking font selection.
  const blocks = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  const faces = (rules: CSSRuleList): CSSFontFaceRule[] =>
    Array.from(rules).flatMap((rule) =>
      rule.type === CSSRule.FONT_FACE_RULE
        ? [rule as CSSFontFaceRule]
        : "cssRules" in rule
          ? faces((rule as CSSGroupingRule).cssRules)
          : [],
    );
  faces(style.sheet!.cssRules).forEach((rule, index) => {
    const block = blocks[index];
    Object.defineProperty(rule, "cssText", { value: block[0] });
    vi.spyOn(rule.style, "getPropertyValue").mockImplementation(
      (name) => new RegExp(`${name}:\\s*([^;]+)`).exec(block[1])?.[1].trim() ?? "",
    );
  });
  const node = document.createElement("div");
  node.textContent = text;
  node.style.fontFamily = family;
  document.body.append(node);
  nodes.push(node);
  return node;
};

beforeEach(() => {
  const computedStyle = window.getComputedStyle.bind(window);
  // jsdom does not implement pseudo-element styles; default them to no content.
  const empty = document.createElement("span").style;
  empty.content = "none";
  vi.stubGlobal("getComputedStyle", (element: Element, pseudo?: string) => (pseudo ? empty : computedStyle(element)));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["font"], { type: "font/woff2" }) })),
  );
});

afterEach(() => {
  for (const element of [...styles.splice(0), ...nodes.splice(0)]) element.remove();
  vi.unstubAllGlobals();
});

it("embeds only the two WenKai subsets needed for a two-character note", async () => {
  const node = preview(wenKaiCSS, "记录", '"LXGW WenKai Screen", serif');
  const css = await getMemoShareFontCSS(node);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url).split("/").pop())
      .sort(),
  ).toEqual(["lxgwwenkaigbscreen-subset-117.woff2", "lxgwwenkaigbscreen-subset-118.woff2"]);
  expect(css.match(/@font-face/g)).toHaveLength(2);
  expect(css).toContain("data:font/woff2;base64,");
  expect(css).not.toContain('url("http');
});

it("does not download WenKai when the preview uses the system font", async () => {
  const css = await getMemoShareFontCSS(preview(wenKaiCSS, "记录", "sans-serif"));
  expect(css).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

it("handles wildcard and astral ranges, nested rules, and unsplit math fonts", async () => {
  const node = preview(
    `
    @media all {
      @font-face {font-family: Subset; src: url('/fonts/latin.woff2'); unicode-range: U+00??;}
      @font-face {font-family: Subset; src: url('/fonts/emoji.woff2'); unicode-range: U+1F600-1F64F;}
      @font-face {font-family: Subset; src: url('/fonts/cjk.woff2'); unicode-range: U+4E00-9FFF;}
    }
    @font-face {font-family: Math; src: url('/fonts/math.woff') format('woff'), url('/fonts/math.woff2') format('woff2');}
    @font-face {font-family: Unused; src: url('/fonts/unused.woff2');}
  `,
    "A😀",
    "Subset",
  );
  const math = document.createElement("span");
  math.style.fontFamily = "Math";
  math.textContent = "∑";
  node.append(math);
  const css = await getMemoShareFontCSS(node);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => new URL(String(url)).pathname)
      .sort(),
  ).toEqual(["/fonts/emoji.woff2", "/fonts/latin.woff2", "/fonts/math.woff2"]);
  expect(css).toContain("font-family: Math");
  expect(css).not.toContain("cjk.woff2");
  expect(css).not.toContain("unused.woff2");
});

it("includes generated list markers and pseudo-element glyphs", async () => {
  const node = preview(
    `
    @font-face {font-family: Subset; src: url('/fonts/digits.woff2'); unicode-range: U+30-39;}
    @font-face {font-family: Icon; src: url('/fonts/icon.woff2'); unicode-range: U+E001;}
  `,
    "记录",
    "Subset",
  );
  node.style.display = "list-item";
  const computedStyle = window.getComputedStyle.bind(window);
  const pseudo = document.createElement("span").style;
  pseudo.fontFamily = "Icon";
  pseudo.content = '"\\e001"';
  vi.stubGlobal("getComputedStyle", (element: Element, selector?: string) => (selector === "::before" ? pseudo : computedStyle(element)));
  await getMemoShareFontCSS(node);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reports font download failures instead of exporting silently missing glyphs", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  const node = preview('@font-face {font-family: Subset; src: url("/font.woff2");}', "记录", "Subset");
  await expect(getMemoShareFontCSS(node)).rejects.toThrow("Failed to load a font for image export");
});
