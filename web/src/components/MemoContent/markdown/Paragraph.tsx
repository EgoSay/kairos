import type { Element } from "hast";
import { useRecordReading } from "@/components/RecordReference/RecordReadingContext";
import RecordReference from "@/components/RecordReference/RecordReference";
import { useLinkPreviewEnabled } from "@/contexts/ViewContext";
import { useNearViewport } from "@/hooks/useNearViewport";
import { markdownStyles } from "@/lib/markdownStyles";
import { memoNameFromURL } from "@/lib/memo-reference";
import { cn } from "@/lib/utils";
import LinkMetadataCard from "../LinkMetadataCard";
import { useMarkdownRenderContext } from "../MarkdownRenderContext";
import type { ReactMarkdownProps } from "./types";

interface ParagraphProps extends React.HTMLAttributes<HTMLParagraphElement>, ReactMarkdownProps {
  children: React.ReactNode;
  sourceName?: string;
}

interface DeferredLinkPreviewProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
  href: string;
}

export function getSingleLinkHref(node?: Element): string | undefined {
  if (!node || node.tagName !== "p") {
    return undefined;
  }

  const meaningfulChildren = node.children.filter((child) => {
    return !(child.type === "text" && child.value.trim() === "");
  });

  if (meaningfulChildren.length !== 1) {
    return undefined;
  }

  const onlyChild = meaningfulChildren[0];
  if (onlyChild.type !== "element" || onlyChild.tagName !== "a") {
    return undefined;
  }

  const href = onlyChild.properties?.href;
  // Only web links have metadata to preview; `tel:`/`sms:`/`mailto:` hand off to another app.
  if (typeof href !== "string" || (!/^https?:\/\//i.test(href) && !href.startsWith("/memos/"))) {
    return undefined;
  }

  const meaningfulLinkChildren = onlyChild.children.filter((child) => {
    return !(child.type === "text" && child.value.trim() === "");
  });

  if (meaningfulLinkChildren.length !== 1) {
    return undefined;
  }

  const onlyLinkChild = meaningfulLinkChildren[0];
  return onlyLinkChild.type === "text" && onlyLinkChild.value === href ? href : undefined;
}

const DeferredLinkPreview = ({ children, className, href, ...props }: DeferredLinkPreviewProps) => {
  const { ref: viewportRef, isNearViewport } = useNearViewport<HTMLParagraphElement>();
  const fallback = (
    <p ref={viewportRef} className={cn(markdownStyles.paragraph, className)} {...props}>
      {children}
    </p>
  );

  return <LinkMetadataCard url={href} fallback={fallback} enabled={isNearViewport} />;
};

export const Paragraph = ({ children, className, node, sourceName, ...props }: ParagraphProps) => {
  const { blockDepth } = useMarkdownRenderContext();
  const reader = useRecordReading();
  const linkPreviewEnabled = useLinkPreviewEnabled();
  const singleHref = getSingleLinkHref(node);
  const recordName = singleHref && memoNameFromURL(singleHref, reader.origins);
  if (recordName && singleHref) {
    return reader.enabled ? (
      <p className={cn(markdownStyles.paragraph, className)} {...props}>
        <RecordReference name={recordName} href={singleHref} sourceName={sourceName} />
      </p>
    ) : (
      <p className={cn(markdownStyles.paragraph, className)} {...props}>
        {children}
      </p>
    );
  }
  const href = blockDepth === 0 && linkPreviewEnabled ? singleHref : undefined;

  if (href) {
    return (
      <DeferredLinkPreview href={href} className={className} {...props}>
        {children}
      </DeferredLinkPreview>
    );
  }

  return (
    <p className={cn(markdownStyles.paragraph, className)} {...props}>
      {children}
    </p>
  );
};
