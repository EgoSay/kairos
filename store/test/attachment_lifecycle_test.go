package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestAttachmentLifecycleFiltersBeforePagination(t *testing.T) {
	ctx := context.Background()
	db := NewTestingStore(ctx, t)
	defer db.Close()
	owner, err := createTestingHostUser(ctx, db)
	require.NoError(t, err)
	var memoIDs []int32
	for _, uid := range []string{"active-media", "archived-media", "trashed-media"} {
		memo, err := db.CreateMemo(ctx, &store.Memo{UID: uid, CreatorID: owner.ID, Content: uid, Visibility: store.Private})
		require.NoError(t, err)
		memoIDs = append(memoIDs, memo.ID)
		if uid != "active-media" {
			archived := store.Archived
			require.NoError(t, db.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, RowStatus: &archived}))
		}
		_, err = db.CreateAttachment(ctx, &store.Attachment{UID: uid + "-file", CreatorID: owner.ID, MemoID: &memo.ID, Filename: uid, Type: "text/plain"})
		require.NoError(t, err)
	}
	_, err = db.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "trash", Key: "trashed-media", Payload: []byte(`{"deletedTs":1}`)}, 0)
	require.NoError(t, err)
	limit := 1
	var seen []int32
	for offset := 0; offset < 2; offset++ {
		list, err := db.ListAttachments(ctx, &store.FindAttachment{Access: &store.MemoAccessScope{UserID: &owner.ID}, ExcludeTrashed: true, Limit: &limit, Offset: &offset})
		require.NoError(t, err)
		require.Len(t, list, 1)
		seen = append(seen, *list[0].MemoID)
	}
	require.ElementsMatch(t, memoIDs[:2], seen)
	trash, err := db.ListAttachments(ctx, &store.FindAttachment{Access: &store.MemoAccessScope{UserID: &owner.ID}, OnlyTrashed: true, Limit: &limit})
	require.NoError(t, err)
	require.Len(t, trash, 1)
	require.Equal(t, memoIDs[2], *trash[0].MemoID)
	require.NoError(t, db.DeleteJournalDocument(ctx, owner.ID, "trash", "trashed-media", -1))
	restored, err := db.ListAttachments(ctx, &store.FindAttachment{Access: &store.MemoAccessScope{UserID: &owner.ID}, ExcludeTrashed: true})
	require.NoError(t, err)
	require.Len(t, restored, 3, "removing the marker restores visibility without rewriting attachment rows")
}
