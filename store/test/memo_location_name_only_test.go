package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

// Run under each DRIVER: persistence, SQL map scope and transaction CAS use the
// actual driver so a JSON dialect mismatch cannot hide behind render-only tests.
func TestMemoNameOnlyLocationRoundTripMapScopeAndCAS(t *testing.T) {
	ctx := context.Background()
	s := NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := createTestingHostUser(ctx, s)
	require.NoError(t, err)
	fixtures := map[string]*storepb.MemoPayload_Location{
		"personal-name": {Placeholder: "楼下咖啡店", NameOnly: true},
		"legacy-origin": {Placeholder: "origin"},
		"actual-point":  {Placeholder: "公园", Latitude: 31.2, Longitude: 121.4},
		"no-place":      nil,
	}
	for uid, location := range fixtures {
		_, err := s.CreateMemo(ctx, &store.Memo{UID: uid, CreatorID: owner.ID, Content: "same original #生活", Visibility: store.Private, Payload: &storepb.MemoPayload{Location: location}})
		require.NoError(t, err)
	}
	query := func(filter string) []string {
		t.Helper()
		memos, err := s.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID, Filters: []string{filter}})
		require.NoError(t, err)
		var uids []string
		for _, memo := range memos {
			uids = append(uids, memo.UID)
		}
		return uids
	}
	require.ElementsMatch(t, []string{"personal-name", "legacy-origin", "actual-point"}, query(`has_location`))
	require.ElementsMatch(t, []string{"legacy-origin", "actual-point"}, query(`has_location && !location_name_only`))
	require.Equal(t, []string{"personal-name"}, query(`location_name_only`))

	uid := "personal-name"
	memo, err := s.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.True(t, memo.Payload.Location.NameOnly)
	require.Equal(t, "楼下咖啡店", memo.Payload.Location.Placeholder)
	// Running current migration/backfill over populated data must preserve both
	// the new flag and old points. No DDL migration is necessary for JSON fields.
	require.NoError(t, s.Migrate(ctx))
	reloaded, err := s.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.Equal(t, memo.Payload.Location, reloaded.Payload.Location)
	content := "body-only edit #生活"
	require.NoError(t, s.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Content: &content}))
	memo, err = s.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.True(t, memo.Payload.Location.NameOnly)
	snapshot := store.MemoRecordSnapshot{Content: memo.Content, CreatedTs: memo.CreatedTs, UpdatedTs: memo.UpdatedTs, Visibility: memo.Visibility, RowStatus: memo.RowStatus, Location: memo.Payload.Location}
	currentHash := snapshot.Hash()
	snapshot.Location = &storepb.MemoPayload_Location{Placeholder: "楼下咖啡店"}
	staleHash := snapshot.Hash()
	require.NotEqual(t, staleHash, currentHash)
	update := &store.UpdateMemo{ID: memo.ID, Payload: &storepb.MemoPayload{Location: &storepb.MemoPayload_Location{Placeholder: "origin"}}}
	mutation := &store.MemoMutation{MemoID: memo.ID, MemoCreatorID: owner.ID, ExpectedMemoContent: memo.Content, ExpectedRecordHash: staleHash, MemoUpdate: update}
	require.ErrorIs(t, s.ApplyMemoMutation(ctx, mutation), store.ErrMemoMutationConflict)
	memo, err = s.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.True(t, memo.Payload.Location.NameOnly)
	mutation.ExpectedRecordHash = currentHash
	require.NoError(t, s.ApplyMemoMutation(ctx, mutation))
	memo, err = s.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.False(t, memo.Payload.Location.NameOnly)
	require.Zero(t, memo.Payload.Location.Latitude)
	require.Zero(t, memo.Payload.Location.Longitude)
	require.ElementsMatch(t, []string{"personal-name", "legacy-origin", "actual-point"}, query(`has_location && !location_name_only`))
	require.Empty(t, query(`location_name_only`))
}
