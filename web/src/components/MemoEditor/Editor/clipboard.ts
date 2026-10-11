/** A small semantic clipboard converter. It never imports styles or fetches images. */
export function htmlClipboardMarkdown(html: string, localImage?: (localImageCount: number) => string | undefined): string {
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const localImages = new Set(
    Array.from(root.querySelectorAll("img")).filter((image) => /^(blob:|data:image\/|file:)/i.test(image.getAttribute("src") || "")),
  );
  // Collapse layout whitespace only. Literal code bytes must survive conversion.
  const literals: string[] = [];
  let literalPrefix = "\uFFFCkairos-code-";
  while (root.textContent?.includes(literalPrefix)) literalPrefix += "-";
  const protect = (text: string) => {
    const token = `${literalPrefix}${literals.length}\uFFFC`;
    literals.push(text);
    return token;
  };
  const safeLink = (href: string) =>
    /^(https?:|mailto:|\/|#)/i.test(href) ? href.replaceAll(" ", "%20").replaceAll("(", "%28").replaceAll(")", "%29") : "";
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "noscript", "svg"].includes(tag)) return "";
    if (tag === "pre" || tag === "code") {
      const text = node.textContent || "";
      const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
      const fence = "`".repeat(Math.max(tag === "pre" ? 3 : 1, longest + 1));
      return tag === "pre"
        ? `\n\n${fence}\n${protect(text.replace(/\n$/, ""))}\n${fence}\n\n`
        : `${fence}${protect(/^`|`$/.test(text) ? ` ${text} ` : text)}${fence}`;
    }
    const body = Array.from(node.childNodes, render).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${body}**`;
    if (tag === "em" || tag === "i") return `*${body}*`;
    if (["del", "s", "strike"].includes(tag)) return `~~${body}~~`;
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${body.trim()}\n\n`;
    if (tag === "blockquote")
      return `\n\n${body
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    if (tag === "li") {
      const index = Array.from(node.parentElement?.children || []).indexOf(node) + 1;
      return `${node.parentElement?.tagName === "OL" ? `${index}.` : "-"} ${body.trim().replace(/\n/g, "\n  ")}\n`;
    }
    if (tag === "ul" || tag === "ol") return `\n\n${body}\n\n`;
    if (tag === "a") {
      const href = safeLink(node.getAttribute("href") || "");
      return href ? `[${body}](${href})` : body;
    }
    // Clipboard files are ingested separately. A remote <img> stays a link so
    // copying a webpage never silently downloads a third-party image.
    if (tag === "img") {
      const token = localImages.has(node as HTMLImageElement) ? localImage?.(localImages.size) : undefined;
      if (token) return `\n\n${token}\n\n`;
      const href = safeLink(node.getAttribute("src") || "");
      return href ? `[${node.getAttribute("alt") || "图片"}](${href})` : node.getAttribute("alt") || "";
    }
    if (tag === "hr") return "\n\n---\n\n";
    if (["p", "div", "section", "article"].includes(tag)) return `\n\n${body.trim()}\n\n`;
    return body;
  };
  let markdown = Array.from(root.childNodes, render)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  for (const [index, literal] of literals.entries()) {
    markdown = markdown.replace(`${literalPrefix}${index}\uFFFC`, (_token, offset: number, source: string) => {
      // A surrounding quote/list already indented the protected line. Carry
      // its Markdown prefix across literal newlines when restoring the bytes.
      const prefix = source.slice(source.lastIndexOf("\n", offset - 1) + 1, offset);
      return /^[ \t>]*$/.test(prefix) ? literal.replace(/\n/g, `\n${prefix}`) : literal;
    });
  }
  return markdown;
}
