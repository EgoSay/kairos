package test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestContentReferenceTransactionPreservesManualAndSkipsMissingTarget(t *testing.T) {
	f := newMemoMutationFixture(t)
	mutation := f.mutation()
	mutation.ReferenceRelations = []*store.MemoRelation{{MemoID: f.memo.ID, RelatedMemoID: f.target.ID, Type: store.MemoRelationReference}}
	mutation.ReplaceContentReferences = true
	mutation.ContentReferences = []*store.MemoRelation{
		{MemoID: f.memo.ID, RelatedMemoID: f.target.ID, Type: store.MemoRelationContentReference},
		{MemoID: f.memo.ID, RelatedMemoID: f.next.ID, Type: store.MemoRelationContentReference},
	}
	mutation.SkipUnavailableReferenceRelations = true
	require.NoError(t, f.store.DeleteMemo(f.ctx, &store.DeleteMemo{ID: f.next.ID}))
	require.NoError(t, f.store.ApplyMemoMutation(f.ctx, mutation))
	links, err := f.store.ListMemoRelations(f.ctx, &store.FindMemoRelation{MemoID: &f.memo.ID})
	require.NoError(t, err)
	require.Len(t, links, 2)
	mutation = &store.MemoMutation{MemoID: f.memo.ID, MemoCreatorID: f.owner.ID, ExpectedMemoContent: "updated content", ReplaceContentReferences: true}
	require.NoError(t, f.store.ApplyMemoMutation(f.ctx, mutation))
	links, err = f.store.ListMemoRelations(f.ctx, &store.FindMemoRelation{MemoID: &f.memo.ID})
	require.NoError(t, err)
	require.Len(t, links, 1)
	require.Equal(t, store.MemoRelationReference, links[0].Type)
}

func TestContentReferenceFailureRollsBackBodyAndBothRelationSources(t *testing.T) {
	f := newMemoMutationFixture(t)
	mutation := f.mutation()
	mutation.ReplaceContentReferences = true
	mutation.ContentReferences = []*store.MemoRelation{{MemoID: f.memo.ID, RelatedMemoID: f.next.ID, Type: store.MemoRelationContentReference}}
	// An attachment race must leave the body and both relation sources intact.
	require.NoError(t, f.store.UpdateAttachment(f.ctx, &store.UpdateAttachment{ID: f.kept.ID, MemoID: &f.target.ID}))
	before := f.state()
	require.Error(t, f.store.ApplyMemoMutation(f.ctx, mutation))
	require.Equal(t, before, f.state())
}
