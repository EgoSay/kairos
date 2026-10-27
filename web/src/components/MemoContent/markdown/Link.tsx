import { useRecordReading } from "@/components/RecordReference/RecordReadingContext";
import RecordReference from "@/components/RecordReference/RecordReference";
import { markdownStyles } from "@/lib/markdownStyles";
import { memoNameFromURL } from "@/lib/memo-reference";
import { cn } from "@/lib/utils";
import type { ReactMarkdownProps } from "./types";

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement>, ReactMarkdownProps {
  children: React.ReactNode;
  sourceName?: string;
}

/**
 * Link component for external links
 * Opens in new tab with security attributes
 */
export const Link = ({ children, className, href, node: _node, sourceName, ...props }: LinkProps) => {
  const reader = useRecordReading();
  const name = href && reader.enabled && memoNameFromURL(href, reader.origins);
  if (name && href)
    return <RecordReference name={name} href={href} sourceName={sourceName} label={children === href ? undefined : children} />;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(markdownStyles.link, className)} {...props}>
      {children}
    </a>
  );
};
