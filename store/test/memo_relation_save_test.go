package test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestMemoRelationSaveRechecksUnavailableTargetInsideTransaction(t *testing.T) {
	for _, change := range []string{"deleted", "trashed", "permission"} {
		t.Run(change, func(t *testing.T) {
			f := newMemoMutationFixture(t)
			target := f.next
			if change == "permission" {
				var err error
				target, err = f.store.CreateMemo(f.ctx, &store.Memo{UID: "foreign-target", CreatorID: f.peer.ID, Visibility: store.Public, Content: "previously readable"})
				require.NoError(t, err)
			}
			mutation := f.mutation()
			mutation.SkipUnavailableReferenceRelations = true
			mutation.Policy = &store.MemoWritePolicy{ActorUserID: f.owner.ID}
			mutation.ReferenceRelations = []*store.MemoRelation{{MemoID: f.memo.ID, RelatedMemoID: target.ID, Type: store.MemoRelationReference}, {MemoID: f.memo.ID, RelatedMemoID: f.target.ID, Type: store.MemoRelationReference}}
			// The target changes after the API has prepared the save but before its transaction.
			switch change {
			case "deleted":
				require.NoError(t, f.store.DeleteMemo(f.ctx, &store.DeleteMemo{ID: target.ID}))
			case "trashed":
				_, err := f.store.PutJournalDocument(f.ctx, &store.JournalDocument{OwnerID: target.CreatorID, Kind: "trash", Key: target.UID, Payload: json.RawMessage(`{"deletedTs":1}`)}, 0)
				require.NoError(t, err)
			case "permission":
				private := store.Private
				require.NoError(t, f.store.UpdateMemo(f.ctx, &store.UpdateMemo{ID: target.ID, Visibility: &private}))
			default:
				t.Fatalf("unknown target mutation: %s", change)
			}
			require.NoError(t, f.store.ApplyMemoMutation(f.ctx, mutation))
			actual, err := f.store.GetMemo(f.ctx, &store.FindMemo{ID: &f.memo.ID})
			require.NoError(t, err)
			require.Equal(t, "updated content", actual.Content)
			links, err := f.store.ListMemoRelations(f.ctx, &store.FindMemoRelation{MemoID: &f.memo.ID})
			require.NoError(t, err)
			require.Len(t, links, 1)
			require.Equal(t, f.target.ID, links[0].RelatedMemoID)
		})
	}
}

func TestMemoRelationSaveNeverSkipsSourceOrCommentAuthorization(t *testing.T) {
	f := newMemoMutationFixture(t)
	_, err := f.store.PutJournalDocument(f.ctx, &store.JournalDocument{OwnerID: f.owner.ID, Kind: "trash", Key: f.memo.UID, Payload: json.RawMessage(`{"deletedTs":1}`)}, 0)
	require.NoError(t, err)
	mutation := f.mutation()
	mutation.SkipUnavailableReferenceRelations = true
	require.Error(t, f.store.ApplyMemoMutation(f.ctx, mutation))
	actual, err := f.store.GetMemo(f.ctx, &store.FindMemo{ID: &f.memo.ID})
	require.NoError(t, err)
	require.Equal(t, f.memo.Content, actual.Content)
	comment := &store.Memo{UID: "not-created-comment", CreatorID: f.owner.ID, Content: "must not create", Visibility: store.Private}
	err = f.store.ApplyMemoMutation(f.ctx, &store.MemoMutation{MemoCreate: comment, CommentContextMemoID: &f.memo.ID, SkipUnavailableReferenceRelations: true, ReplaceReferenceRelations: true, ReferenceRelations: []*store.MemoRelation{{RelatedMemoID: f.memo.ID, Type: store.MemoRelationReference}}})
	require.Error(t, err)
	absent, err := f.store.GetMemo(f.ctx, &store.FindMemo{UID: &comment.UID})
	require.NoError(t, err)
	require.Nil(t, absent)
}

func TestMemoRelationSaveWaitsForConcurrentTargetDeleteAndCanRetry(t *testing.T) {
	f := newMemoMutationFixture(t)
	ctx, cancel := context.WithTimeout(f.ctx, 15*time.Second)
	defer cancel()
	blocker, err := f.store.GetDriver().GetDB().BeginTx(ctx, nil)
	require.NoError(t, err)
	defer blocker.Rollback()
	placeholder := "?"
	if getDriverFromEnv() == "postgres" {
		placeholder = "$1"
	}
	_, err = blocker.ExecContext(ctx, "DELETE FROM memo WHERE id = "+placeholder, f.next.ID)
	require.NoError(t, err)
	mutation := f.mutation()
	mutation.SkipUnavailableReferenceRelations = true
	done := make(chan error, 1)
	go func() { done <- f.store.ApplyMemoMutation(ctx, mutation) }()
	select {
	case err = <-done:
		require.FailNowf(t, "save did not wait for target deletion", "got %v while target delete was uncommitted", err)
	case <-time.After(200 * time.Millisecond):
	}
	require.NoError(t, blocker.Commit())
	select {
	case err = <-done:
	case <-ctx.Done():
		require.FailNow(t, "save did not resume after target deletion")
	}
	if errors.Is(err, store.ErrMemoMutationConflict) {
		// Serializable engines may refuse their old snapshot. A new request must
		// save the unchanged draft and omit the target, never require manual data loss.
		mutation = f.mutation()
		mutation.SkipUnavailableReferenceRelations = true
		err = f.store.ApplyMemoMutation(ctx, mutation)
	}
	require.NoError(t, err)
	saved, err := f.store.GetMemo(ctx, &store.FindMemo{ID: &f.memo.ID})
	require.NoError(t, err)
	require.Equal(t, "updated content", saved.Content)
	refs, err := f.store.ListMemoRelations(ctx, &store.FindMemoRelation{MemoID: &f.memo.ID})
	require.NoError(t, err)
	require.Empty(t, refs)
}
