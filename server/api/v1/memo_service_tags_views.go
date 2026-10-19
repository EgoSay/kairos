package v1

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	"github.com/EgoSay/kairos/core/memotag"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

// tagOperationCost bills a management operation by its touched records, with
// a floor so an empty scope still costs one write unit.
func tagOperationCost(matched int) int {
	if matched < 1 {
		return 1
	}
	if matched > maxTagOperationMemos {
		return maxTagOperationMemos
	}
	return matched
}

// tagViewPlan returns the views whose filters reference the tag plus the
// pending rewrite per view. renamed is empty for a delete. Views whose
// rewritten filter fails validation are still listed as affected but carry
// no rewrite: leaving a stale reference beats corrupting a saved filter.
func (s *APIV1Service) tagViewPlan(ctx context.Context, user *store.User, tag, renamed string, subtree, descendantsExist bool) ([]*v1pb.TagOperationAffectedView, []tagViewRewrite, error) {
	views, err := s.Store.GetUserMemoViews(ctx, user.ID)
	if err != nil {
		return nil, nil, status.Errorf(codes.Internal, "failed to list memo views: %v", err)
	}
	var affected []*v1pb.TagOperationAffectedView
	var rewrites []tagViewRewrite
	for _, view := range views {
		next, changed := memotag.RewriteViewFilter(view.GetFilter(), tag, renamed, subtree, descendantsExist)
		if !changed {
			continue
		}
		affected = append(affected, &v1pb.TagOperationAffectedView{
			Name:  constructMemoViewName(user.Username, view.GetId()),
			Title: view.GetTitle(),
		})
		if err := s.validateFilter(ctx, next); err == nil {
			rewrites = append(rewrites, tagViewRewrite{viewID: view.GetId(), filter: next})
		}
	}
	return affected, rewrites, nil
}

// tagViewRewrite is one saved-view filter update to apply after confirmation.
type tagViewRewrite struct {
	viewID string
	filter string
}

// applyTagViewRewrites synchronously rewrites the saved filters that passed
// validation during planning.
func (s *APIV1Service) applyTagViewRewrites(ctx context.Context, user *store.User, rewrites []tagViewRewrite) error {
	for _, rewrite := range rewrites {
		if _, err := s.Store.UpdateUserMemoView(ctx, user.ID, rewrite.viewID, nil, &rewrite.filter, nil); err != nil {
			return status.Errorf(codes.Internal, "failed to update memo view: %v", err)
		}
	}
	return nil
}

// tagRulePlan lists the display-rule keys referencing the tag, and for a
// rename the literal key moves to apply. Regex-pattern keys are reported as
// affected but never rewritten.
func (s *APIV1Service) tagRulePlan(ctx context.Context, user *store.User, tag, renamed string, subtree bool) ([]string, []tagRuleRewrite, error) {
	setting, err := s.tagRulesSetting(ctx, user.ID)
	if err != nil {
		return nil, nil, err
	}
	var affected []string
	var rewrites []tagRuleRewrite
	for key := range setting.GetTags().GetTags() {
		if !memotag.RuleKeyReferenced(key, tag, subtree) {
			continue
		}
		affected = append(affected, key)
		if renamed != "" {
			if next, ok := memotag.RenameRuleKey(key, tag, renamed, subtree); ok {
				rewrites = append(rewrites, tagRuleRewrite{oldKey: key, newKey: next})
			}
		}
	}
	return affected, rewrites, nil
}

// tagRuleRewrite moves one literal display-rule key to its renamed value.
type tagRuleRewrite struct {
	oldKey string
	newKey string
}

// applyTagRuleRewrites renames literal rule keys inside the TAGS setting.
// When the renamed key already exists the merge keeps the target's metadata;
// the moved rule is dropped, matching tag-merge semantics.
func (s *APIV1Service) applyTagRuleRewrites(ctx context.Context, user *store.User, rewrites []tagRuleRewrite) error {
	if len(rewrites) == 0 {
		return nil
	}
	setting, err := s.tagRulesSetting(ctx, user.ID)
	if err != nil {
		return err
	}
	tags := setting.GetTags().GetTags()
	for _, rewrite := range rewrites {
		rule, ok := tags[rewrite.oldKey]
		if !ok {
			continue
		}
		if _, exists := tags[rewrite.newKey]; !exists {
			tags[rewrite.newKey] = rule
		}
		delete(tags, rewrite.oldKey)
	}
	if _, err := s.Store.UpsertUserSetting(ctx, setting); err != nil {
		return status.Errorf(codes.Internal, "failed to update tag rules: %v", err)
	}
	return nil
}

// tagRulesSetting loads the user's TAGS setting, seeding an empty map when
// none exists yet.
func (s *APIV1Service) tagRulesSetting(ctx context.Context, userID int32) (*storepb.UserSetting, error) {
	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &userID,
		Key:    storepb.UserSetting_TAGS,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get tag rules: %v", err)
	}
	if setting == nil {
		return &storepb.UserSetting{
			UserId: userID,
			Key:    storepb.UserSetting_TAGS,
			Value:  &storepb.UserSetting_Tags{Tags: &storepb.TagsUserSetting{Tags: map[string]*storepb.UserTagMetadata{}}},
		}, nil
	}
	cloned, ok := proto.Clone(setting).(*storepb.UserSetting)
	if !ok {
		return nil, status.Error(codes.Internal, "failed to clone tag rules")
	}
	if cloned.GetTags() == nil {
		cloned.Value = &storepb.UserSetting_Tags{Tags: &storepb.TagsUserSetting{}}
	}
	if cloned.GetTags().GetTags() == nil {
		cloned.GetTags().Tags = map[string]*storepb.UserTagMetadata{}
	}
	return cloned, nil
}
