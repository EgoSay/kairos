package v1

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/EgoSay/kairos/core/memoreference"
	"github.com/EgoSay/kairos/store"
)

// Optional body links use the same read policy and transactional endpoint checks
// as manual references. No URL is fetched and no denied target metadata escapes.
func (s *APIV1Service) prepareContentReferences(ctx context.Context, memo *store.Memo, content string) ([]*store.MemoRelation, error) {
	targets, err := memoreference.Targets(content, s.Profile.InstanceURL, s.MarkdownService)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read content references: %v", err)
	}
	var relations []*store.MemoRelation
	for _, uid := range targets {
		if uid == memo.UID {
			continue
		}
		target, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, ExcludeTrashed: true})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve content reference")
		}
		if target == nil {
			continue
		}
		if err := s.checkMemoReadAccess(ctx, target); err != nil {
			if status.Code(err) == codes.NotFound || status.Code(err) == codes.PermissionDenied || status.Code(err) == codes.Unauthenticated {
				continue
			}
			return nil, err
		}
		relations = append(relations, &store.MemoRelation{MemoID: memo.ID, RelatedMemoID: target.ID, Type: store.MemoRelationContentReference})
	}
	return relations, nil
}
