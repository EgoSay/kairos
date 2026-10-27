package postgres

import (
	"context"
	"database/sql"
	stderrors "errors"
	"slices"

	"github.com/EgoSay/kairos/store"
)

type postgresRelationMemoState struct {
	id         int32
	creatorID  int32
	rowStatus  store.RowStatus
	visibility store.Visibility
	spaceID    *int32
	trashed    bool
}

func validatePostgresMemoRelationEndpoints(ctx context.Context, tx *sql.Tx, mutation *store.MemoMutation) error {
	if !mutation.ReplaceReferenceRelations && !mutation.ReplaceContentReferences && mutation.CommentContextMemoID == nil {
		return nil
	}

	actorUserID := mutation.ActorUserID()
	actor, err := readPostgresMemoActor(ctx, tx, actorUserID)
	if err != nil {
		return err
	}

	endpointIDs := postgresRelationAuthorizationEndpointIDs(mutation)
	for _, endpointID := range endpointIDs {
		state, err := getPostgresRelationMemoState(ctx, tx, endpointID)
		if err != nil {
			if stderrors.Is(err, sql.ErrNoRows) {
				if mutation.PruneUnavailableReference(endpointID) {
					continue
				}
				return store.ErrMemoMutationConflict
			}
			return err
		}
		snapshot := &store.MemoRelationEndpointSnapshot{
			ActorUserID:        actorUserID,
			Actor:              actor,
			EndpointID:         state.id,
			EndpointCreatorID:  state.creatorID,
			EndpointRowStatus:  state.rowStatus,
			EndpointVisibility: state.visibility,
			EndpointSpaceID:    state.spaceID,
			EndpointTrashed:    state.trashed,
		}
		if state.spaceID != nil {
			snapshot.EndpointSpaceExists, snapshot.EndpointMemberActive, err = readPostgresMemoSpaceState(
				ctx, tx, *state.spaceID, actorUserID,
			)
			if err != nil {
				return err
			}
		}
		if err := store.ValidateMemoRelationEndpointRead(snapshot); err != nil {
			if actor.Active && mutation.PruneUnavailableReference(endpointID) {
				continue
			}
			return err
		}
	}
	return nil
}

func getPostgresRelationMemoState(ctx context.Context, tx *sql.Tx, memoID int32) (*postgresRelationMemoState, error) {
	state := &postgresRelationMemoState{}
	var spaceID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT id, creator_id, row_status, visibility, space_id,
 EXISTS(SELECT 1 FROM journal_document trash WHERE trash.owner_id=memo.creator_id AND trash.kind='trash' AND trash.document_key=memo.uid) FROM memo WHERE id = $1 FOR UPDATE`, memoID).Scan(
		&state.id, &state.creatorID, &state.rowStatus, &state.visibility, &spaceID, &state.trashed,
	); err != nil {
		return nil, err
	}
	state.spaceID = store.NullInt32Pointer(spaceID)
	return state, nil
}

func postgresRelationAuthorizationEndpointIDs(mutation *store.MemoMutation) []int32 {
	ids := make([]int32, 0, len(mutation.ReferenceRelations)+1)
	seen := make(map[int32]struct{}, len(mutation.ReferenceRelations)+1)
	add := func(id int32) {
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if mutation.MemoCreate == nil && mutation.MemoID > 0 {
		add(mutation.MemoID)
	} else if mutation.CommentContextMemoID != nil {
		add(*mutation.CommentContextMemoID)
	}
	for _, relation := range mutation.AllReferenceRelations() {
		if relation != nil {
			add(relation.RelatedMemoID)
		}
	}
	slices.Sort(ids)
	return ids
}
