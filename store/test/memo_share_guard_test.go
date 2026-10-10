package test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestMemoSharingCASUsesFullContentAndGuard(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "share-race", CreatorID: owner.ID, Content: "approved", Visibility: store.Private})
	require.NoError(t, err)
	hash := func(m *store.Memo) string {
		return (store.MemoRecordSnapshot{Content: m.Content, CreatedTs: m.CreatedTs, UpdatedTs: m.UpdatedTs, Visibility: m.Visibility, RowStatus: m.RowStatus}).Hash()
	}
	guard := func(version int64) *store.JournalDocumentMutation {
		return &store.JournalDocumentMutation{Document: &store.JournalDocument{OwnerID: owner.ID, Kind: "share-guard", Key: "main", Payload: json.RawMessage(`{}`)}, ExpectedVersion: version}
	}
	share := func(uid string, version int64, expected string) (*store.MemoShare, error) {
		return s.CreateMemoShare(ctx, &store.MemoShare{UID: uid, CreatorID: owner.ID, MemoID: memo.ID, Policy: &store.MemoWritePolicy{ActorUserID: owner.ID, CreatingShare: true}, ExpectedRecordHash: expected, JournalDocuments: []*store.JournalDocumentMutation{guard(version)}})
	}
	first, err := share("approved-share", 0, hash(memo))
	require.NoError(t, err)
	require.Positive(t, first.ID)
	_, err = share("stale-share", 0, hash(memo))
	require.ErrorIs(t, err, store.ErrMemoMutationConflict, "same-second grants cannot reuse a prior authorization version")
	changed := "private edited body"
	require.NoError(t, s.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Content: &changed}))
	_, err = share("stale-body", 1, hash(memo))
	require.ErrorIs(t, err, store.ErrMemoMutationConflict)
	current, err := s.GetJournalDocument(ctx, owner.ID, "share-guard", "main")
	require.NoError(t, err)
	require.Equal(t, int64(1), current.Version, "failed hash validation does not consume authorization")
	grants, err := s.ListMemoShares(ctx, &store.FindMemoShare{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Len(t, grants, 1)
	memo, err = s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	start, results := make(chan struct{}), make(chan error, 2)
	for _, uid := range []string{"concurrent-a", "concurrent-b"} {
		go func(uid string) {
			<-start
			_, err := share(uid, 1, hash(memo))
			results <- err
		}(uid)
	}
	close(start)
	successes := 0
	for range 2 {
		if err := <-results; err == nil {
			successes++
		} else {
			require.ErrorIs(t, err, store.ErrMemoMutationConflict)
		}
	}
	require.Equal(t, 1, successes, "one authorization version may commit only once")
}

func TestJournalShareMultiRecordCASRollsBackAllAuthorization(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	first, err := s.CreateMemo(ctx, &store.Memo{UID: "first-share-check", CreatorID: owner.ID, Content: "first approved", Visibility: store.Private})
	require.NoError(t, err)
	second, err := s.CreateMemo(ctx, &store.Memo{UID: "second-share-check", CreatorID: owner.ID, Content: "second approved", Visibility: store.Private})
	require.NoError(t, err)
	checks := []store.MemoRecordCheck{}
	for _, memo := range []*store.Memo{first, second} {
		hash := (store.MemoRecordSnapshot{Content: memo.Content, CreatedTs: memo.CreatedTs, UpdatedTs: memo.UpdatedTs, Visibility: memo.Visibility, RowStatus: memo.RowStatus}).Hash()
		checks = append(checks, store.MemoRecordCheck{MemoID: memo.ID, CreatorID: owner.ID, Hash: hash})
	}
	changed := "second changed after preview"
	require.NoError(t, s.UpdateMemo(ctx, &store.UpdateMemo{ID: second.ID, Content: &changed}))
	err = s.ApplyMemoMutation(ctx, &store.MemoMutation{MemoID: first.ID, MemoCreatorID: owner.ID, ExpectedMemoContent: first.Content, RecordChecks: checks,
		Policy: &store.MemoWritePolicy{ActorUserID: owner.ID},
		JournalDocuments: []*store.JournalDocumentMutation{
			{Document: &store.JournalDocument{OwnerID: owner.ID, Kind: "share-guard", Key: "main", Payload: json.RawMessage(`{}`)}},
			{Document: &store.JournalDocument{OwnerID: owner.ID, Kind: "share", Key: "candidate", Payload: json.RawMessage(`{"mode":"dynamic"}`)}},
		},
	})
	require.ErrorIs(t, err, store.ErrMemoMutationConflict)
	for _, kind := range []string{"share-guard", "share"} {
		docs, err := s.ListJournalDocuments(ctx, &store.FindJournalDocument{OwnerID: &owner.ID, Kind: kind})
		require.NoError(t, err)
		require.Empty(t, docs, "no partially approved share or consumed guard may survive")
	}
}

func TestMemoShareGuardBelongsToRecordOwnerForAdministrator(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	admin, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	owner, err := createTestingUserWithRole(ctx, s, "record-author", store.RoleUser)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "admin-share-source", CreatorID: owner.ID, Content: "approved", Visibility: store.Private})
	require.NoError(t, err)
	hash := (store.MemoRecordSnapshot{Content: memo.Content, CreatedTs: memo.CreatedTs, UpdatedTs: memo.UpdatedTs, Visibility: memo.Visibility, RowStatus: memo.RowStatus}).Hash()
	create := func(uid string, guardOwner int32) (*store.MemoShare, error) {
		return s.CreateMemoShare(ctx, &store.MemoShare{UID: uid, MemoID: memo.ID, CreatorID: admin.ID, Policy: &store.MemoWritePolicy{ActorUserID: admin.ID, CreatingShare: true}, ExpectedRecordHash: hash, JournalDocuments: []*store.JournalDocumentMutation{{Document: &store.JournalDocument{OwnerID: guardOwner, Kind: "share-guard", Key: "main", Payload: json.RawMessage(`{}`)}}}})
	}
	_, err = create("wrong-actor-guard", admin.ID)
	require.ErrorIs(t, err, store.ErrMemoPermissionDenied)
	grant, err := create("correct-owner-guard", owner.ID)
	require.NoError(t, err)
	require.Equal(t, admin.ID, grant.CreatorID, "grant keeps acting administrator attribution")
	guard, err := s.GetJournalDocument(ctx, owner.ID, "share-guard", "main")
	require.NoError(t, err)
	require.Equal(t, int64(1), guard.Version)
	actorGuard, err := s.GetJournalDocument(ctx, admin.ID, "share-guard", "main")
	require.NoError(t, err)
	require.Nil(t, actorGuard)
}
