import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/** Resolve only canonical current-instance or root-relative record links. */
export function memoNameFromURL(href: string, origins: readonly string[]): string | undefined {
  if (!href || /[\s\\]/.test(href) || href.startsWith("//")) return undefined;
  try {
    const url = new URL(href, origins[0]);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !origins.some((origin) => url.origin === new URL(origin).origin))
      return undefined;
    if (!href.startsWith("/") && !/^https?:\/\//i.test(href)) return undefined;
    const match = /^\/memos\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    return match ? `memos/${match[1]}` : undefined;
  } catch {
    return undefined;
  }
}

export function recordExcerpt(memo: Memo): string {
  const excerpt = memo.snippet.trim().replace(/\s+/g, " ");
  if (excerpt) return excerpt;
  if (memo.attachments.some((attachment) => attachment.type.startsWith("image/"))) return "图片记录";
  if (memo.attachments.some((attachment) => attachment.type.startsWith("audio/"))) return "音频记录";
  return memo.attachments.length ? "附件记录" : "空白记录";
}

export interface MemoReferenceRange {
  from: number;
  to: number;
  href: string;
  name: string;
  label?: string;
  block: boolean;
}

/** Real Markdown nodes keep code, images and escaped text outside the reference model. */
export function memoReferenceRanges(content: string, origins: readonly string[]): MemoReferenceRange[] {
  const root = fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const definitions = new Map(root.children.flatMap((node) => (node.type === "definition" ? [[node.identifier, node.url] as const] : [])));
  const ranges: MemoReferenceRange[] = [];
  type Node = {
    type: string;
    value?: string;
    url?: string;
    identifier?: string;
    children?: Node[];
    position?: { start: { offset?: number }; end: { offset?: number } };
  };
  const text = (node: Node): string => node.value ?? node.children?.map(text).join("") ?? "";
  const walk = (node: Node, parent?: Node) => {
    if (node.type === "image" || node.type === "imageReference") return;
    const href = node.type === "link" ? node.url : node.type === "linkReference" ? definitions.get(node.identifier ?? "") : undefined;
    const name = href && memoNameFromURL(href, origins);
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (href && name && from !== undefined && to !== undefined) {
      const label = text(node);
      const custom = label !== href && label !== "";
      ranges.push({
        from,
        to,
        href,
        name,
        label: custom ? label : undefined,
        block: !custom && parent?.type === "paragraph" && parent.children?.length === 1,
      });
      return;
    }
    for (const child of node.children ?? []) walk(child, node);
  };
  walk(root);
  return ranges;
}
