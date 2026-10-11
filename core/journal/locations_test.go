package journal_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/core/journal"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
	storetest "github.com/EgoSay/kairos/store/test"
)

func TestNamedPlacesOwnerCASAndHistoricalNames(t *testing.T) {
	ctx := context.Background()
	s := storetest.NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := s.CreateUser(ctx, &store.User{Username: "places-owner", Role: store.RoleAdmin})
	require.NoError(t, err)
	other, err := s.CreateUser(ctx, &store.User{Username: "places-other", Role: store.RoleUser})
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &store.Memo{UID: "location-original", CreatorID: owner.ID, Visibility: store.Private, Content: "record",
		Payload: &storepb.MemoPayload{Location: &storepb.MemoPayload_Location{Latitude: 0, Longitude: 0, Placeholder: "历史名称"}}})
	require.NoError(t, err)
	initial := journal.NamedPlaces{Places: []journal.NamedPlace{{ID: "home", Name: "现在的名字", Latitude: 0, Longitude: 0}}}
	saved, err := journal.SaveNamedPlaces(ctx, s, owner.ID, initial)
	require.NoError(t, err)
	require.EqualValues(t, 1, saved.Version)
	_, err = journal.SaveNamedPlaces(ctx, s, owner.ID, initial)
	require.ErrorIs(t, err, store.ErrJournalConflict)
	saved.Places[0].Name = "修改后的常用名称"
	saved, err = journal.SaveNamedPlaces(ctx, s, owner.ID, saved)
	require.NoError(t, err)
	unchanged, err := s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.Equal(t, "历史名称", unchanged.Payload.GetLocation().Placeholder)
	private, err := journal.GetNamedPlaces(ctx, s, other.ID)
	require.NoError(t, err)
	require.Empty(t, private.Places)
	recent, err := journal.RecentPlaces(ctx, s, owner.ID)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	require.Equal(t, "历史名称", recent[0].Name)
	_, err = s.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "trash", Key: memo.UID, Payload: json.RawMessage(`{}`)}, 0)
	require.NoError(t, err)
	recent, err = journal.RecentPlaces(ctx, s, owner.ID)
	require.NoError(t, err)
	require.Empty(t, recent)
	saved.Places[0].Latitude = 91
	_, err = journal.SaveNamedPlaces(ctx, s, owner.ID, saved)
	require.Error(t, err)
	valid, err := journal.GetNamedPlaces(ctx, s, owner.ID)
	require.NoError(t, err)
	require.Equal(t, 0.0, valid.Places[0].Latitude)
}

func TestNameOnlyPlacesDoNotCollapseIntoOriginAndRemainOwnerScoped(t *testing.T) {
	ctx := context.Background()
	s := storetest.NewTestingStore(ctx, t)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	owner, err := s.CreateUser(ctx, &store.User{Username: "named-owner", Role: store.RoleAdmin})
	require.NoError(t, err)
	for index, location := range []*storepb.MemoPayload_Location{
		{Placeholder: "家", NameOnly: true},
		{Placeholder: "咖啡店", NameOnly: true},
		{Placeholder: "zero point", Latitude: 0, Longitude: 0},
		{Placeholder: "家", NameOnly: true},
	} {
		_, err := s.CreateMemo(ctx, &store.Memo{UID: fmt.Sprintf("place-%d", index), CreatorID: owner.ID, Content: "record", Visibility: store.Private, Payload: &storepb.MemoPayload{Location: location}})
		require.NoError(t, err)
	}
	recent, err := journal.RecentPlaces(ctx, s, owner.ID)
	require.NoError(t, err)
	require.Len(t, recent, 3)
	nameOnly := 0
	for _, place := range recent {
		if place.NameOnly {
			nameOnly++
			encoded, err := json.Marshal(place)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "latitude")
			require.NotContains(t, string(encoded), "longitude")
		}
	}
	require.Equal(t, 2, nameOnly)
	saved, err := journal.SaveNamedPlaces(ctx, s, owner.ID, journal.NamedPlaces{Places: []journal.NamedPlace{{ID: "home", Name: "家", NameOnly: true}}})
	require.NoError(t, err)
	loaded, err := journal.GetNamedPlaces(ctx, s, owner.ID)
	require.NoError(t, err)
	require.True(t, loaded.Places[0].NameOnly)
	saved.Places[0].Latitude = 1
	_, err = journal.SaveNamedPlaces(ctx, s, owner.ID, saved)
	require.Error(t, err)
}
