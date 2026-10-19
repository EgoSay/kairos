package v1

import (
	"context"
	"slices"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/EgoSay/kairos/core/access"
	"github.com/EgoSay/kairos/core/memopayload"
	"github.com/EgoSay/kairos/core/memotag"
	"github.com/EgoSay/kairos/internal/ratelimit"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

const (
	// maxBatchTagNames caps one batch request; larger selections retry in slices.
	maxBatchTagNames = 200
	// maxTagOperationMemos caps one management operation; remaining_count lets a
	// caller continue idempotently.
	maxTagOperationMemos = 1000
	// maxTagRewriteAttempts bounds CAS retries per memo.
	maxTagRewriteAttempts = 3
)

// BatchUpdateMemoTags applies one add/remove tag set across selected memos.
// Each memo is rewritten independently; per-memo failures are itemized rather
// than aborting the batch, and a no-change memo still counts as success so
// retries stay idempotent.
func (s *APIV1Service) BatchUpdateMemoTags(ctx context.Context, request *v1pb.BatchUpdateMemoTagsRequest) (*v1pb.BatchUpdateMemoTagsResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get current user")
	}
	if user == nil {
		return nil, status.Error(codes.Unauthenticated, "user not authenticated")
	}
	scoped := request.ScopeTag != ""
	if scoped == (len(request.Names) > 0) {
		return nil, status.Error(codes.InvalidArgument, "set exactly one of names or scope_tag")
	}
	if len(request.Names) > maxBatchTagNames {
		return nil, status.Errorf(codes.InvalidArgument, "batch limited to %d memos", maxBatchTagNames)
	}
	if scoped && !memotag.ValidateTag(request.ScopeTag) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid tag %q", request.ScopeTag)
	}
	for _, tag := range request.AddTags {
		if !memotag.ValidateTag(tag) {
			return nil, status.Errorf(codes.InvalidArgument, "invalid tag %q", tag)
		}
	}
	for _, tag := range request.RemoveTags {
		if !memotag.ValidateTag(tag) {
			return nil, status.Errorf(codes.InvalidArgument, "invalid tag %q", tag)
		}
	}
	if conflicts := memotag.ConflictingTags(request.AddTags, request.RemoveTags); len(conflicts) > 0 {
		return nil, status.Errorf(codes.InvalidArgument, "cannot add and remove the same tag: %s", strings.Join(conflicts, ", "))
	}
	if len(request.AddTags) == 0 && len(request.RemoveTags) == 0 {
		return nil, status.Error(codes.InvalidArgument, "nothing to add or remove")
	}
	if scoped {
		return s.batchUpdateScopedTags(ctx, user, request)
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), len(request.Names)); err != nil {
		return nil, err
	}

	response := &v1pb.BatchUpdateMemoTagsResponse{}
	changed := false
	for _, name := range request.Names {
		memo, failure := s.loadTagRewriteTarget(ctx, user, name)
		if failure != nil {
			response.Failures = append(response.Failures, failure)
			continue
		}
		updated, didChange, err := s.applyTagRewrite(ctx, memo, func(current *store.Memo, content string) (string, error) {
			toAdd, toRemove, hasWork := memotag.PlanBatch(current.Payload.GetExplicitTags(), request.AddTags, request.RemoveTags)
			if !hasWork {
				return content, nil
			}
			var err error
			if len(toRemove) > 0 {
				if content, err = s.MarkdownService.RemoveTags([]byte(content), toRemove, false); err != nil {
					return "", err
				}
			}
			if len(toAdd) > 0 {
				if content, err = s.MarkdownService.AppendTags([]byte(content), toAdd); err != nil {
					return "", err
				}
			}
			return content, nil
		})
		if err != nil {
			response.Failures = append(response.Failures, tagOperationFailure(name, err))
			continue
		}
		changed = changed || didChange
		_, _, converted, err := s.buildUpdatedMemoState(ctx, updated.ID)
		if err != nil {
			response.Failures = append(response.Failures, tagOperationFailure(name, err))
			continue
		}
		response.Memos = append(response.Memos, converted)
	}
	if changed {
		s.SSEHub.publishMemoChanged()
	}
	return response, nil
}

// batchUpdateScopedTags applies the add/remove set to every record authoring
// request.ScopeTag. The scope is resolved server-side so the operation tracks
// the tag's live membership rather than a client-side name snapshot.
func (s *APIV1Service) batchUpdateScopedTags(ctx context.Context, user *store.User, request *v1pb.BatchUpdateMemoTagsRequest) (*v1pb.BatchUpdateMemoTagsResponse, error) {
	scope, err := s.tagOperationScope(ctx, user, request.ScopeTag, request.ScopeIncludeDescendants)
	if err != nil {
		return nil, err
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), tagOperationCost(len(scope.memos))); err != nil {
		return nil, err
	}

	changed, failures, processed := s.rewriteTagScope(ctx, user, scope.memos, func(current *store.Memo, content string) (string, error) {
		toAdd, toRemove, hasWork := memotag.PlanBatch(current.Payload.GetExplicitTags(), request.AddTags, request.RemoveTags)
		if !hasWork {
			return content, nil
		}
		var err error
		if len(toRemove) > 0 {
			if content, err = s.MarkdownService.RemoveTags([]byte(content), toRemove, false); err != nil {
				return "", err
			}
		}
		if len(toAdd) > 0 {
			if content, err = s.MarkdownService.AppendTags([]byte(content), toAdd); err != nil {
				return "", err
			}
		}
		return content, nil
	})
	if changed {
		s.SSEHub.publishMemoChanged()
	}
	return &v1pb.BatchUpdateMemoTagsResponse{
		Failures:       failures,
		RemainingCount: int32(len(scope.memos) - processed),
	}, nil
}

// RenameTag renames a tag everywhere it is authored, optionally including
// descendant paths. Renaming onto an existing tag merges them. validate_only
// returns the preview without writing; update_references (default true) also
// rewrites saved-view filters and literal display-rule keys.
func (s *APIV1Service) RenameTag(ctx context.Context, request *v1pb.RenameTagRequest) (*v1pb.RenameTagResponse, error) {
	user, err := s.tagOperationUser(ctx)
	if err != nil {
		return nil, err
	}
	if !memotag.ValidateTag(request.OldTag) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid tag %q", request.OldTag)
	}
	if !memotag.ValidateTag(request.NewTag) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid tag %q", request.NewTag)
	}
	if request.OldTag == request.NewTag {
		return nil, status.Error(codes.InvalidArgument, "new tag equals old tag")
	}

	scope, err := s.tagOperationScope(ctx, user, request.OldTag, request.IncludeDescendants)
	if err != nil {
		return nil, err
	}
	merge, err := s.tagExistsInCorpus(ctx, user, request.NewTag)
	if err != nil {
		return nil, err
	}
	views, viewRewrites, err := s.tagViewPlan(ctx, user, request.OldTag, request.NewTag, request.IncludeDescendants, scope.descendantsExist)
	if err != nil {
		return nil, err
	}
	rules, ruleRewrites, err := s.tagRulePlan(ctx, user, request.OldTag, request.NewTag, request.IncludeDescendants)
	if err != nil {
		return nil, err
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), tagOperationCost(len(scope.memos))); err != nil {
		return nil, err
	}

	response := &v1pb.RenameTagResponse{
		AffectedMemos:      int32(len(scope.memos)),
		AffectedTags:       scope.affectedTags,
		MergesIntoExisting: merge,
		AffectedViews:      views,
		AffectedTagRules:   rules,
	}
	if request.ValidateOnly {
		return response, nil
	}

	rename := s.MarkdownService.RenameTag
	if request.IncludeDescendants {
		rename = s.MarkdownService.RenameTagTree
	}
	changed, failures, processed := s.rewriteTagScope(ctx, user, scope.memos, func(_ *store.Memo, content string) (string, error) {
		return rename([]byte(content), request.OldTag, request.NewTag)
	})
	response.Failures = failures
	response.RemainingCount = int32(len(scope.memos) - processed)

	if request.GetUpdateReferences() || request.UpdateReferences == nil {
		if err := s.applyTagViewRewrites(ctx, user, viewRewrites); err != nil {
			return nil, err
		}
		if err := s.applyTagRuleRewrites(ctx, user, ruleRewrites); err != nil {
			return nil, err
		}
	}
	if changed {
		s.SSEHub.publishMemoChanged()
	}
	return response, nil
}

// DeleteTag removes an authored tag token from matching records without
// deleting the records themselves. Display rules are reported but kept:
// dropping a tag from content is not the same as discarding its appearance.
func (s *APIV1Service) DeleteTag(ctx context.Context, request *v1pb.DeleteTagRequest) (*v1pb.DeleteTagResponse, error) {
	user, err := s.tagOperationUser(ctx)
	if err != nil {
		return nil, err
	}
	if !memotag.ValidateTag(request.Tag) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid tag %q", request.Tag)
	}

	scope, err := s.tagOperationScope(ctx, user, request.Tag, request.IncludeDescendants)
	if err != nil {
		return nil, err
	}
	views, viewRewrites, err := s.tagViewPlan(ctx, user, request.Tag, "", request.IncludeDescendants, scope.descendantsExist)
	if err != nil {
		return nil, err
	}
	rules, _, err := s.tagRulePlan(ctx, user, request.Tag, "", request.IncludeDescendants)
	if err != nil {
		return nil, err
	}
	if err := s.throttleAndCharge(ratelimit.ScopeWriteUser, userKey(user.ID), tagOperationCost(len(scope.memos))); err != nil {
		return nil, err
	}

	response := &v1pb.DeleteTagResponse{
		AffectedMemos:    int32(len(scope.memos)),
		AffectedTags:     scope.affectedTags,
		AffectedViews:    views,
		AffectedTagRules: rules,
	}
	if request.ValidateOnly {
		return response, nil
	}

	changed, failures, processed := s.rewriteTagScope(ctx, user, scope.memos, func(_ *store.Memo, content string) (string, error) {
		return s.MarkdownService.RemoveTags([]byte(content), []string{request.Tag}, request.IncludeDescendants)
	})
	response.Failures = failures
	response.RemainingCount = int32(len(scope.memos) - processed)

	if request.GetUpdateReferences() || request.UpdateReferences == nil {
		if err := s.applyTagViewRewrites(ctx, user, viewRewrites); err != nil {
			return nil, err
		}
	}
	if changed {
		s.SSEHub.publishMemoChanged()
	}
	return response, nil
}

// tagScope is the preview of one tag operation: the matched memos, each
// memo's explicit tags inside the operation's scope, and the distinct values
// across them.
type tagScope struct {
	memos            []*store.Memo
	explicit         map[int32][]string
	affectedTags     []string
	descendantsExist bool
}

// tagOperationScope lists the caller's own non-trash records whose explicit
// tags match, without loading their content. The payload still carries
// explicit_tags, which is enough for previews and rewrite planning.
func (s *APIV1Service) tagOperationScope(ctx context.Context, user *store.User, tag string, descendants bool) (*tagScope, error) {
	limit := maxTagOperationMemos + 1
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		CreatorID:       &user.ID,
		ExcludeComments: true,
		ExcludeTrashed:  true,
		ExcludeContent:  true,
		Filters:         []string{memotag.MatchFilter(tag, descendants)},
		Limit:           &limit,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to find memos for tag %q: %v", tag, err)
	}
	scope := &tagScope{explicit: map[int32][]string{}}
	for _, memo := range memos {
		for _, value := range memo.Payload.GetExplicitTags() {
			if !memotag.IsTagValue(value, tag, descendants) {
				continue
			}
			scope.explicit[memo.ID] = append(scope.explicit[memo.ID], value)
			if strings.HasPrefix(value, tag+"/") {
				scope.descendantsExist = true
			}
			if !slices.Contains(scope.affectedTags, value) {
				scope.affectedTags = append(scope.affectedTags, value)
			}
		}
		scope.memos = append(scope.memos, memo)
	}
	return scope, nil
}

// tagExistsInCorpus reports whether the caller's records already author the
// tag or one of its descendants — the preview's merge signal.
func (s *APIV1Service) tagExistsInCorpus(ctx context.Context, user *store.User, tag string) (bool, error) {
	limit := 1
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		CreatorID:       &user.ID,
		ExcludeComments: true,
		ExcludeTrashed:  true,
		ExcludeContent:  true,
		Filters:         []string{memotag.MatchFilter(tag, true)},
		Limit:           &limit,
	})
	if err != nil {
		return false, status.Errorf(codes.Internal, "failed to check tag %q: %v", tag, err)
	}
	return len(memos) > 0, nil
}

// rewriteTagScope applies rewrite to up to maxTagOperationMemos matched memos.
// It returns whether any memo changed, itemized failures, and how many were
// processed so the caller can compute remaining_count.
func (s *APIV1Service) rewriteTagScope(
	ctx context.Context,
	user *store.User,
	matched []*store.Memo,
	rewrite func(*store.Memo, string) (string, error),
) (bool, []*v1pb.MemoTagOperationFailure, int) {
	var failures []*v1pb.MemoTagOperationFailure
	changed := false
	processed := 0
	for _, memo := range matched {
		if processed >= maxTagOperationMemos {
			break
		}
		processed++
		name := buildMemoName(memo.UID)
		if !access.CanManageMemo(user, memo) {
			failures = append(failures, &v1pb.MemoTagOperationFailure{Name: name, Code: strings.ToLower(codes.PermissionDenied.String()), Message: "permission denied"})
			continue
		}
		_, didChange, err := s.applyTagRewrite(ctx, memo, func(current *store.Memo, content string) (string, error) {
			return rewrite(current, content)
		})
		if err != nil {
			failures = append(failures, tagOperationFailure(name, err))
			continue
		}
		changed = changed || didChange
	}
	return changed, failures, processed
}

// loadTagRewriteTarget resolves a batch name to a memo the caller may manage,
// returning an itemized failure instead of an error.
func (s *APIV1Service) loadTagRewriteTarget(ctx context.Context, user *store.User, name string) (*store.Memo, *v1pb.MemoTagOperationFailure) {
	uid, err := ExtractMemoUIDFromName(name)
	if err != nil {
		return nil, &v1pb.MemoTagOperationFailure{Name: name, Code: strings.ToLower(codes.InvalidArgument.String()), Message: "invalid memo name"}
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return nil, &v1pb.MemoTagOperationFailure{Name: name, Code: strings.ToLower(codes.Internal.String()), Message: err.Error()}
	}
	if memo == nil || !access.CanManageMemo(user, memo) {
		return nil, &v1pb.MemoTagOperationFailure{Name: name, Code: strings.ToLower(codes.PermissionDenied.String()), Message: "memo not found or not writable"}
	}
	return memo, nil
}

// applyTagRewrite is the shared per-memo tag-organize pipeline: rewrite the
// authored content, re-derive the payload, snapshot the prior revision, and
// commit under a content CAS. Conflicts re-read and re-plan up to
// maxTagRewriteAttempts. It deliberately bypasses the normal commit path so
// no external delivery is enqueued; queued deliveries instead have their
// revision refreshed to stay deliverable.
func (s *APIV1Service) applyTagRewrite(ctx context.Context, memo *store.Memo, rewrite func(current *store.Memo, content string) (string, error)) (*store.Memo, bool, error) {
	for attempt := 0; attempt < maxTagRewriteAttempts; attempt++ {
		// Always re-read: callers may pass a content-less scope listing, and
		// the CAS must compare against the freshest authored content anyway.
		current, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memo.UID})
		if err != nil {
			return nil, false, status.Errorf(codes.Internal, "failed to reload memo: %v", err)
		}
		if current == nil {
			return nil, false, status.Error(codes.NotFound, "memo no longer exists")
		}
		trash, err := s.Store.GetJournalDocument(ctx, current.CreatorID, "trash", current.UID)
		if err != nil {
			return nil, false, status.Errorf(codes.Internal, "failed to inspect record lifecycle: %v", err)
		}
		if trash != nil {
			return nil, false, status.Error(codes.FailedPrecondition, "record is in the trash")
		}
		nextContent, err := rewrite(current, current.Content)
		if err != nil {
			return nil, false, status.Errorf(codes.Internal, "failed to rewrite memo tags: %v", err)
		}
		if nextContent == current.Content {
			return current, false, nil
		}
		next := *current
		next.Content = nextContent
		if err := memopayload.RebuildMemoPayload(ctx, &next, s.MarkdownService); err != nil {
			return nil, false, status.Errorf(codes.Internal, "failed to rebuild memo payload: %v", err)
		}
		if err := s.captureJournalRevision(ctx, current); err != nil {
			return nil, false, status.Errorf(codes.Internal, "failed to capture journal revision: %v", err)
		}
		err = s.applyMemoMutation(ctx, current, nil, &store.UpdateMemo{ID: current.ID, Content: &nextContent, Payload: next.Payload}, nil, nil, true)
		if err != nil {
			if status.Code(err) == codes.Aborted {
				continue
			}
			return nil, false, err
		}
		now := time.Now().Unix()
		if err := s.markJournalRecordModified(ctx, current.CreatorID, current.UID, now); err != nil {
			return nil, false, status.Errorf(codes.Internal, "failed to mark record modified: %v", err)
		}
		if s.JournalPartitions != nil {
			if err := s.JournalPartitions.RefreshDeliveryRevisions(ctx, current.CreatorID, current.UID); err != nil {
				return nil, false, status.Errorf(codes.Internal, "failed to refresh queued deliveries: %v", err)
			}
		}
		return &next, true, nil
	}
	return nil, false, status.Error(codes.Aborted, "record changed while saving; local content was preserved")
}

// tagOperationUser authenticates a management operation.
func (s *APIV1Service) tagOperationUser(ctx context.Context) (*store.User, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get current user")
	}
	if user == nil {
		return nil, status.Error(codes.Unauthenticated, "user not authenticated")
	}
	return user, nil
}

// tagOperationFailure converts an error to an itemized failure entry.
func tagOperationFailure(name string, err error) *v1pb.MemoTagOperationFailure {
	code := status.Code(err)
	if code == codes.Unknown {
		code = codes.Internal
	}
	return &v1pb.MemoTagOperationFailure{Name: name, Code: strings.ToLower(code.String()), Message: status.Convert(err).Message()}
}
