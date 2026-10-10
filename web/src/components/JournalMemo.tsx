import { timestampDate } from "@bufbuild/protobuf/wkt";
import { MoreHorizontalIcon, PinIcon, PinOffIcon } from "lucide-react";
import { type MouseEvent, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CLAMP_PREVIEW_HEIGHT_PX } from "@/components/ClampedSection";
import JournalOriginalsDialog from "@/components/JournalOriginalsDialog";
import JournalRecordActions from "@/components/JournalRecordActions";
import JournalRecordHistoryDialog from "@/components/JournalRecordHistoryDialog";
import JournalReviewActions from "@/components/JournalReviewActions";
import MemoContent from "@/components/MemoContent";
import { AttachmentGallery, MemoMetadataRows } from "@/components/MemoMetadata";
import { separateAttachments } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import { useImagePreview } from "@/components/MemoView/hooks/useImagePreview";
import { createMemoNavigationState } from "@/components/MemoView/navigation";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useJournalSession } from "@/contexts/JournalSessionContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalPreferences } from "@/hooks/useJournalQueries";
import { useMemoPin } from "@/hooks/useMemoPin";
import { isMemoBlurred } from "@/lib/tag";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { filterInlineManagedAttachments } from "@/utils/managed-attachment";

/** An original record, with no social counters, automatic playback or generated preamble. */
export default function JournalMemo({ memo }: { memo: Memo }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const pin = useMemoPin(memo);
  const parentPage = `${location.pathname}${location.search}`;
  const preferences = useJournalPreferences();
  const { expanded, setExpanded } = useJournalSession();
  const { userTagsSetting } = useAuth();
  const [revealed, setRevealed] = useState(false);
  const [recordDialog, setRecordDialog] = useState<"history" | "originals" | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const hidden = isMemoBlurred(memo, userTagsSetting) && !revealed;
  const isExpanded = expanded.has(memo.name);
  const long = memo.content.length > 700;
  const { previewState, openPreview, setPreviewOpen } = useImagePreview();
  const handleMemoContentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || target.closest("a")) return;
    const source = target.getAttribute("src");
    if (source) openPreview(source);
  };
  const attachments = useMemo(() => separateAttachments(filterInlineManagedAttachments(memo.content, memo.attachments)), [memo]);
  const date = memo.createTime ? timestampDate(memo.createTime) : undefined;
  const dateText = date?.toLocaleString("zh-CN", {
    timeZone: preferences.data?.timezone || "Asia/Shanghai",
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <article className="rounded-xl border border-border/60 bg-card px-5 py-5 sm:px-7 sm:py-6">
      <header className="mb-4 flex min-h-11 items-center justify-between gap-3">
        <Link
          to={`/${memo.name}`}
          state={createMemoNavigationState(parentPage)}
          className="rounded-md text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <time dateTime={date?.toISOString()}>{dateText || "打开原记录"}</time>
        </Link>
        <div className="flex items-center gap-1">
          {user?.name === memo.creator && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pin.pending}
              aria-label={memo.pinned ? "取消置顶" : "置顶"}
              aria-pressed={memo.pinned}
              onClick={pin.toggle}
              className="min-h-11 gap-1 text-muted-foreground"
            >
              {memo.pinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}
              {memo.pinned ? "已置顶" : "置顶"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={menuTriggerRef}
              render={<Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="记录选项" />}
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" finalFocus={recordDialog ? false : undefined}>
              {user?.name === memo.creator && (
                <JournalRecordActions
                  name={memo.name}
                  onOpenHistory={() => setRecordDialog("history")}
                  onOpenOriginals={() => setRecordDialog("originals")}
                />
              )}
              <DropdownMenuItem
                onClick={() => navigate(`/${memo.name}`, { state: createMemoNavigationState(parentPage) })}
                className="min-h-11"
              >
                打开原记录
              </DropdownMenuItem>
              {user?.name === memo.creator && <JournalReviewActions name={memo.name} />}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {hidden ? (
        <Button variant="outline" onClick={() => setRevealed(true)}>
          显示这条记录
        </Button>
      ) : (
        <div className="space-y-4">
          <div
            className={long && !isExpanded ? "relative overflow-hidden" : undefined}
            style={long && !isExpanded ? { maxHeight: CLAMP_PREVIEW_HEIGHT_PX } : undefined}
          >
            <MemoContent
              memoName={memo.name}
              parentPage={parentPage}
              content={memo.content}
              attachments={memo.attachments}
              contentClassName="leading-7"
              compact={long && !isExpanded}
              readonly
              onClick={handleMemoContentClick}
            />
            {long && !isExpanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-card to-transparent" />
            )}
          </div>
          {long && (
            <Button
              variant="ghost"
              onClick={() => setExpanded(memo.name, !isExpanded)}
              aria-expanded={isExpanded}
              className="min-h-11 px-0 text-muted-foreground"
            >
              {isExpanded ? "收起" : "展开全文"}
            </Button>
          )}
          <AttachmentGallery visual={attachments.visual} onImagePreview={openPreview} />
          <MemoMetadataRows
            audio={attachments.audio}
            docs={attachments.docs}
            relations={[]}
            currentMemoName={memo.name}
            parentPage={parentPage}
          />
        </div>
      )}
      {recordDialog === "history" && (
        <JournalRecordHistoryDialog name={memo.name} open onOpenChange={() => setRecordDialog(null)} finalFocus={menuTriggerRef} />
      )}
      {recordDialog === "originals" && (
        <JournalOriginalsDialog name={memo.name} open onOpenChange={() => setRecordDialog(null)} finalFocus={menuTriggerRef} />
      )}
      {previewState.items.length > 0 && (
        <PreviewImageDialog
          open={previewState.open}
          onOpenChange={setPreviewOpen}
          items={previewState.items}
          initialIndex={previewState.index}
        />
      )}
    </article>
  );
}
