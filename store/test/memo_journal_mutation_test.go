package test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestMemoJournalMutationRollsBackBodyAndOutboxOnConflict(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "atomic-cas", CreatorID: owner.ID, Content: "private original", Visibility: store.Private})
	require.NoError(t, err)
	doc := &store.JournalDocument{OwnerID: owner.ID, Kind: "partition-mapping", Key: memo.UID, Payload: json.RawMessage(`{"partitionId":"original"}`)}
	_, err = s.PutJournalDocument(ctx, doc, 0)
	require.NoError(t, err)
	// The API prepared a selection from version 1; another device commits first.
	doc.Payload = json.RawMessage(`{"partitionId":"concurrent"}`)
	_, err = s.PutJournalDocument(ctx, doc, 1)
	require.NoError(t, err)
	doc.Payload = json.RawMessage(`{"partitionId":"local"}`)
	content := "new words must not survive a failed selection"
	err = s.ApplyMemoMutation(ctx, &store.MemoMutation{
		MemoID: memo.ID, MemoCreatorID: owner.ID, ExpectedMemoContent: memo.Content,
		MemoUpdate: &store.UpdateMemo{ID: memo.ID, Content: &content},
		JournalDocuments: []*store.JournalDocumentMutation{
			{Document: &store.JournalDocument{OwnerID: owner.ID, Kind: "partition-pending", Key: "atomic-intent", Payload: json.RawMessage(`{}`)}, ExpectedVersion: 0},
			{Document: doc, ExpectedVersion: 1},
		},
	})
	require.ErrorIs(t, err, store.ErrMemoMutationConflict)
	actual, err := s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.Equal(t, memo.Content, actual.Content)
	pending, err := s.GetJournalDocument(ctx, owner.ID, "partition-pending", "atomic-intent")
	require.NoError(t, err)
	require.Nil(t, pending, "the outbox must roll back with the content and selection")
	mapping, err := s.GetJournalDocument(ctx, owner.ID, "partition-mapping", memo.UID)
	require.NoError(t, err)
	require.JSONEq(t, `{"partitionId":"concurrent"}`, string(mapping.Payload))
}

func TestMemoJournalConcurrentPartitionOnlyWriters(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "atomic-concurrent", CreatorID: owner.ID, Content: "unchanged", Visibility: store.Private})
	require.NoError(t, err)
	start, results := make(chan struct{}), make(chan error, 2)
	for _, destination := range []string{"a", "b"} {
		go func(destination string) {
			payload, _ := json.Marshal(map[string]string{"partitionId": destination})
			<-start
			results <- s.ApplyMemoMutation(ctx, &store.MemoMutation{MemoID: memo.ID, MemoCreatorID: owner.ID, ExpectedMemoContent: memo.Content,
				MemoUpdate: &store.UpdateMemo{ID: memo.ID}, JournalDocuments: []*store.JournalDocumentMutation{{Document: &store.JournalDocument{OwnerID: owner.ID, Kind: "partition-mapping", Key: memo.UID, Payload: payload}, ExpectedVersion: 0}}})
		}(destination)
	}
	close(start)
	successes := 0
	for range 2 {
		err := <-results
		if err == nil {
			successes++
		} else {
			require.ErrorIs(t, err, store.ErrMemoMutationConflict)
		}
	}
	require.Equal(t, 1, successes)
	actual, err := s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.Equal(t, memo.Content, actual.Content)
	require.Equal(t, memo.CreatedTs, actual.CreatedTs)
	require.Equal(t, memo.UpdatedTs, actual.UpdatedTs)
}
