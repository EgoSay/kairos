const normalizeFamily = (family: string) =>
  family
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

const includesText = (range: string, codePoints: Set<number>): boolean => {
  if (!range) return true;
  return range.split(",").some((part) => {
    const match = /^U\+([\da-f?]+)(?:-([\da-f]+))?$/i.exec(part.trim());
    // Preserve an unfamiliar range instead of silently dropping a font.
    if (!match) return true;
    const start = Number.parseInt(match[1].replaceAll("?", "0"), 16);
    const end = Number.parseInt(match[2] ?? match[1].replaceAll("?", "f"), 16);
    return [...codePoints].some((point) => point >= start && point <= end);
  });
};

function fontRules(sheet: CSSStyleSheet | CSSGroupingRule): CSSFontFaceRule[] {
  try {
    return Array.from(sheet.cssRules).flatMap((rule) => {
      if (rule.type === CSSRule.FONT_FACE_RULE) return [rule as CSSFontFaceRule];
      if (rule.type === CSSRule.IMPORT_RULE) {
        const imported = (rule as CSSImportRule).styleSheet;
        return imported ? fontRules(imported) : [];
      }
      return "cssRules" in rule ? fontRules(rule as CSSGroupingRule) : [];
    });
  } catch {
    // Cross-origin stylesheets may not expose CSSOM. Do not fetch unrelated CSS.
    return [];
  }
}

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Embed only font families and unicode subsets needed by this share preview.
 * html-to-image's default collector embeds every subset of a used family.
 * Supply this CSS explicitly so a short note does not download the whole CJK font.
 */
export const getMemoShareFontCSS = async (node: HTMLElement): Promise<string> => {
  const families = new Set<string>();
  let text = node.textContent ?? "";
  for (const element of [node, ...node.querySelectorAll("*")]) {
    const style = getComputedStyle(element);
    for (const family of style.fontFamily.split(",")) families.add(normalizeFamily(family));
    // List markers are generated text and are absent from textContent.
    if (style.display === "list-item") text += "0123456789. •◦▪abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const pseudo of ["::before", "::after", "::marker"]) {
      const generated = getComputedStyle(element, pseudo);
      if (!generated.content || ["none", "normal"].includes(generated.content)) continue;
      for (const family of generated.fontFamily.split(",")) families.add(normalizeFamily(family));
      text += generated.content.replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
    }
  }
  const codePoints = new Set(Array.from(text, (character) => character.codePointAt(0)!));
  const rules = Array.from(node.ownerDocument.styleSheets)
    .flatMap(fontRules)
    .filter(
      (rule) =>
        families.has(normalizeFamily(rule.style.getPropertyValue("font-family"))) &&
        includesText(rule.style.getPropertyValue("unicode-range"), codePoints),
    );

  // Reuse a resource within this export; normal HTTP caching also reuses the
  // same hashed font URLs already loaded for the on-screen preview.
  const resources = new Map<string, Promise<string>>();
  const embedded = await Promise.all(
    rules.map(async (rule) => {
      const src = rule.style.getPropertyValue("src");
      const sources = [...src.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)(?:\s*format\(([^)]+)\))?/gi)];
      const source = sources.find((candidate) => /woff2/i.test(candidate[0])) ?? sources[0];
      if (!source) return rule.cssText;
      const url = new URL(source[1] ?? source[2] ?? source[3], rule.parentStyleSheet?.href ?? node.baseURI).href;
      if (!resources.has(url)) {
        resources.set(
          url,
          fetch(url).then(async (response) => {
            if (!response.ok) throw new Error("Failed to load a font for image export");
            return toDataUrl(await response.blob());
          }),
        );
      }
      const dataUrl = await resources.get(url);
      return rule.cssText.replace(src, `url("${dataUrl}")${source[4] ? ` format(${source[4]})` : ""}`);
    }),
  );
  return embedded.join("\n");
};
