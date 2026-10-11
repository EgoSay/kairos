import { SearchIcon, XIcon } from "lucide-react";
import { type RefObject, useEffect, useId, useState } from "react";
import MemoCandidateList, {
  candidateRowId,
  useCandidateLoadingIndicator,
  useMemoCandidateNavigation,
} from "@/components/MemoCandidateList";
import { Button } from "@/components/ui/button";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import { Popover, PopoverContent } from "@/components/ui/popover";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

interface LinkMemoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  searchText: string;
  onSearchChange: (text: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  filteredMemos: Memo[];
  isFetching: boolean;
  onSelectMemo: (memo: Memo) => void;
  isAlreadyLinked: (memoName: string) => boolean;
  error?: string;
  onRetry?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  onReturnToEditor?: () => void;
  timezone?: string;
  targeted?: boolean;
}

/** One contextual choice; the relation remains a draft until the memo is saved. */
export const LinkMemoDialog = (props: LinkMemoDialogProps) => {
  const listId = useId();
  const [isComposing, setIsComposing] = useState(false);
  const showLoading = useCandidateLoadingIndicator(props.isFetching);
  useEffect(() => {
    if (!props.open) setIsComposing(false);
  }, [props.open]);
  const navigation = useMemoCandidateNavigation(
    props.filteredMemos,
    `${props.open}:${props.searchText}`,
    props.onSelectMemo,
    props.isAlreadyLinked,
  );
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverContent
        anchor={props.anchorRef}
        align="start"
        side="top"
        sideOffset={8}
        aria-label="关联记录"
        className="w-[min(26rem,calc(100vw-2rem))] max-h-[min(34rem,75dvh)] overflow-y-auto rounded-xl p-2 shadow-lg"
        finalFocus={() => {
          props.onReturnToEditor?.();
          return false;
        }}
      >
        <div className="flex items-center gap-2 border-b px-1 pb-1">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            role="combobox"
            aria-label="搜索关联记录"
            aria-expanded={props.open}
            aria-controls={listId}
            aria-haspopup="grid"
            aria-autocomplete="list"
            aria-activedescendant={navigation.activeName ? candidateRowId(listId, navigation.activeName) : undefined}
            placeholder="想起哪一句？"
            value={props.searchText}
            onChange={(event) => props.onSearchChange(event.target.value)}
            onCompositionStart={() => {
              setIsComposing(true);
              props.onCompositionChange?.(true);
            }}
            onCompositionEnd={(event) => {
              props.onSearchChange(event.currentTarget.value);
              setIsComposing(false);
              props.onCompositionChange?.(false);
            }}
            onKeyDown={(event) => {
              if (isComposing || event.nativeEvent.isComposing || event.keyCode === 229) {
                if (event.key === "Escape") event.stopPropagation();
                return;
              }
              navigation.onKeyDown(event);
            }}
            autoFocus
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label="返回继续写作"
            onClick={() => props.onOpenChange(false)}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent ${FOCUS_VISIBLE_OUTLINE_CLASSES}`}
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {props.targeted ? "链接指向的记录" : props.searchText.trim() ? "匹配的记录" : "最近记录"} · 仅本人，包含归档
        </p>
        {showLoading && (
          <p role="status" className="px-3 py-5 text-sm text-muted-foreground">
            正在查找…
          </p>
        )}
        {props.error && (
          <div role="alert" className="space-y-2 px-3 py-4 text-sm">
            <p>{props.error}关键词已保留，可以重试。</p>
            <Button type="button" variant="outline" onClick={props.onRetry}>
              重试
            </Button>
          </div>
        )}
        {!props.isFetching && !props.error && !props.filteredMemos.length && (
          <p className="px-3 py-5 text-sm text-muted-foreground">没有匹配的记录，试试更短的关键词。</p>
        )}
        <MemoCandidateList
          key={props.open ? "open" : "closed"}
          id={listId}
          memos={props.filteredMemos}
          query={props.searchText}
          activeName={navigation.activeName}
          onSelect={props.onSelectMemo}
          action="关联"
          isDisabled={props.isAlreadyLinked}
          timezone={props.timezone}
          allowPreview
        />
        {props.hasNextPage && !props.error && (
          <div className="border-t pt-2">
            <Button type="button" variant="ghost" disabled={props.isFetchingNextPage} onClick={props.onLoadMore}>
              {props.isFetchingNextPage ? "正在加载…" : "继续加载记录"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
