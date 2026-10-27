package store

import (
	"context"
	"errors"
)

type MemoRelationType string

const (
	// MemoRelationReference is the type for a reference memo relation.
	MemoRelationReference MemoRelationType = "REFERENCE"
	// MemoRelationContentReference is derived from saved Markdown, independently of manual references.
	MemoRelationContentReference MemoRelationType = "CONTENT_REFERENCE"
	// MemoRelationComment is the type for a comment memo relation.
	MemoRelationComment MemoRelationType = "COMMENT"
)

type MemoRelation struct {
	MemoID        int32
	RelatedMemoID int32
	Type          MemoRelationType
}

// MemoRelationEndpointSnapshot is the memo-local database state used to
// authorize one endpoint during a reference-relation mutation.
type MemoRelationEndpointSnapshot struct {
	ActorUserID int32
	Actor       MemoActorState

	EndpointID         int32
	EndpointCreatorID  int32
	EndpointRowStatus  RowStatus
	EndpointVisibility Visibility
	EndpointSpaceID    *int32
	EndpointTrashed    bool

	EndpointSpaceExists  bool
	EndpointMemberActive bool
}

// ValidateMemoRelationEndpointRead applies authenticated memo-local read
// policy to an endpoint. An active instance administrator passes the audience
// checks; structural validity still applies.
func ValidateMemoRelationEndpointRead(snapshot *MemoRelationEndpointSnapshot) error {
	if snapshot == nil || !snapshot.Actor.Active {
		return ErrMemoPermissionDenied
	}
	if snapshot.EndpointID <= 0 || snapshot.EndpointTrashed {
		return ErrMemoMutationConflict
	}
	if snapshot.EndpointRowStatus != Normal && snapshot.EndpointRowStatus != Archived {
		return ErrMemoMutationConflict
	}
	if !isValidVisibility(snapshot.EndpointVisibility) {
		return ErrMemoMutationConflict
	}
	if snapshot.EndpointVisibility == SpaceAudience &&
		(snapshot.EndpointSpaceID == nil || !snapshot.EndpointSpaceExists) {
		return ErrMemoMutationConflict
	}
	if snapshot.Actor.Admin {
		return nil
	}
	if snapshot.EndpointRowStatus == Archived && snapshot.EndpointCreatorID != snapshot.ActorUserID {
		return ErrMemoPermissionDenied
	}

	switch snapshot.EndpointVisibility {
	case Public, Protected:
		return nil
	case Private:
		if snapshot.EndpointCreatorID != snapshot.ActorUserID {
			return ErrMemoPermissionDenied
		}
		return nil
	case SpaceAudience:
		if !snapshot.EndpointMemberActive {
			return ErrMemoPermissionDenied
		}
		return nil
	default:
		return ErrMemoMutationConflict
	}
}

type FindMemoRelation struct {
	MemoID        *int32
	RelatedMemoID *int32
	Type          *MemoRelationType
	MemoFilter    *string
	// SourceMemoRowStatus filters the relation source memo before pagination.
	SourceMemoRowStatus *RowStatus
	// MemoIDList matches relations where memo_id OR related_memo_id is in the list.
	MemoIDList []int32
	// SourceMemoIDList matches relations where memo_id is in the list.
	SourceMemoIDList []int32
	// RelatedMemoIDList matches relations where related_memo_id is in the list.
	RelatedMemoIDList []int32
	Limit             *int
	Offset            *int
}

type DeleteMemoRelation struct {
	MemoID        *int32
	RelatedMemoID *int32
	Type          *MemoRelationType
}

// ValidateMemoRelationDelete ensures the generic deletion path can only
// mutate reference relations. COMMENT relations are immutable context and are
// removed only as part of the lifecycle of an incident memo.
func ValidateMemoRelationDelete(delete *DeleteMemoRelation) error {
	if delete == nil {
		return errors.New("memo relation deletion is required")
	}
	if delete.Type == nil || *delete.Type != MemoRelationReference {
		return errors.New("only REFERENCE memo relations may be deleted")
	}
	if delete.MemoID == nil && delete.RelatedMemoID == nil {
		return errors.New("memo relation deletion requires an endpoint")
	}
	if (delete.MemoID != nil && *delete.MemoID <= 0) || (delete.RelatedMemoID != nil && *delete.RelatedMemoID <= 0) {
		return errors.New("memo relation deletion has an invalid endpoint")
	}
	return nil
}

func (s *Store) UpsertMemoRelation(ctx context.Context, create *MemoRelation) (*MemoRelation, error) {
	if create == nil || create.Type != MemoRelationReference {
		return nil, errors.New("only REFERENCE memo relations may be persisted")
	}
	return s.driver.UpsertMemoRelation(ctx, create)
}

func (s *Store) ListMemoRelations(ctx context.Context, find *FindMemoRelation) ([]*MemoRelation, error) {
	return s.driver.ListMemoRelations(ctx, find)
}

func (s *Store) DeleteMemoRelation(ctx context.Context, delete *DeleteMemoRelation) error {
	if err := ValidateMemoRelationDelete(delete); err != nil {
		return err
	}
	return s.driver.DeleteMemoRelation(ctx, delete)
}

// PruneUnavailableReference removes an optional outgoing reference during save.
// The source and immutable COMMENT context are never optional authorization.
func (m *MemoMutation) PruneUnavailableReference(endpointID int32) bool {
	if !m.SkipUnavailableReferenceRelations || endpointID == m.MemoID || (m.CommentContextMemoID != nil && endpointID == *m.CommentContextMemoID) {
		return false
	}
	filtered := make([]*MemoRelation, 0, len(m.ReferenceRelations))
	removed := false
	for _, relation := range m.ReferenceRelations {
		if relation != nil && relation.RelatedMemoID == endpointID {
			removed = true
			continue
		}
		filtered = append(filtered, relation)
	}
	if removed {
		m.ReferenceRelations = filtered
	}
	content := make([]*MemoRelation, 0, len(m.ContentReferences))
	for _, relation := range m.ContentReferences {
		if relation != nil && relation.RelatedMemoID == endpointID {
			removed = true
			continue
		}
		content = append(content, relation)
	}
	m.ContentReferences = content
	return removed
}

// AllReferenceRelations returns both independently managed sources for endpoint checks.
func (m *MemoMutation) AllReferenceRelations() []*MemoRelation {
	return append(append([]*MemoRelation{}, m.ReferenceRelations...), m.ContentReferences...)
}
