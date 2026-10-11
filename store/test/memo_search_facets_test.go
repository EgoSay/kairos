package test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

func TestMemoSearchFacetsAndPinnedPagination(t *testing.T) {
	ctx := context.Background()
	db := NewTestingStore(ctx, t)
	defer db.Close()
	owner, err := createTestingHostUser(ctx, db)
	require.NoError(t, err)
	fixtures := []struct {
		uid    string
		tags   []string
		mime   string
		pinned bool
		ts     int64
	}{
		{"untagged-missing", nil, "image/png", false, 100},
		{"untagged-empty", []string{}, "audio/wav", false, 200},
		{"untagged-null", nil, "", false, 300},
		{"branch-both", []string{"人生/阅读", "人生/家庭"}, "image/jpeg", true, 50},
		{"branch-child", []string{"人生/阅读/笔记"}, "application/pdf", true, 60},
		{"similar", []string{"人生观/阅读"}, "", false, 400},
		{"other-parent", []string{"工作/阅读"}, "", false, 500},
	}
	for _, fixture := range fixtures {
		memo, err := db.CreateMemo(ctx, &store.Memo{UID: fixture.uid, CreatorID: owner.ID, Content: `中文 "引号" 50%_`, Visibility: store.Private, Pinned: fixture.pinned, Payload: &storepb.MemoPayload{Tags: fixture.tags}})
		require.NoError(t, err)
		require.NoError(t, db.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, CreatedTs: &fixture.ts, Pinned: &fixture.pinned}))
		if fixture.uid == "untagged-empty" || fixture.uid == "untagged-null" {
			payload := `{"tags":[]}`
			if fixture.uid == "untagged-null" {
				payload = `{"tags":null}`
			}
			// Fixed synthetic fixture values work identically on all three drivers.
			_, err = db.GetDriver().GetDB().ExecContext(ctx, fmt.Sprintf("UPDATE memo SET payload = '%s' WHERE id = %d", payload, memo.ID))
			require.NoError(t, err)
		}
		if fixture.mime != "" {
			_, err = db.CreateAttachment(ctx, &store.Attachment{UID: fixture.uid + "-file", CreatorID: owner.ID, MemoID: &memo.ID, Filename: "中文 + #.png", Type: fixture.mime})
			require.NoError(t, err)
		}
	}
	_, err = db.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "partition-mapping", Key: "branch-both", Payload: []byte(`{"partitionId":"life"}`)}, 0)
	require.NoError(t, err)
	cases := []struct {
		filter string
		want   []string
	}{
		{`size(tags) == 0`, []string{"untagged-missing", "untagged-empty", "untagged-null"}},
		{`size(tags) == 0 && has_image`, []string{"untagged-missing"}},
		{`has_audio == true && has_attachment`, []string{"untagged-empty"}},
		{`has_image == false && has_attachment`, []string{"untagged-empty", "branch-child"}},
		{`("人生" in tags || tags.exists(t, t.startsWith("人生/")))`, []string{"branch-both", "branch-child"}},
		{`("人生/阅读" in tags || tags.exists(t, t.startsWith("人生/阅读/"))) && !("人生/家庭" in tags)`, []string{"branch-child"}},
		{`"人生/阅读" in tags`, []string{"branch-both"}},
		{`journal_partition == "life"`, []string{"branch-both"}},
		{`journal_partition == "" && has_image`, []string{"untagged-missing"}},
		{`created_ts >= timestamp(100) && created_ts < timestamp(300) && content.contains("中文") && content.contains("\"引号\"") && content.contains("50%_")`, []string{"untagged-missing", "untagged-empty"}},
	}
	for _, test := range cases {
		t.Run(test.filter, func(t *testing.T) {
			limit := 1
			var got []string
			for offset := 0; ; offset++ {
				rows, err := db.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID, Filters: []string{test.filter}, Limit: &limit, Offset: &offset})
				require.NoError(t, err)
				if len(rows) == 0 {
					break
				}
				got = append(got, rows[0].UID)
				require.LessOrEqual(t, len(got), len(fixtures))
			}
			require.ElementsMatch(t, test.want, got)
		})
	}
	rows, err := db.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID, OrderByPinned: true, OrderByTimeAsc: true})
	require.NoError(t, err)
	require.Equal(t, "branch-child", rows[0].UID)
	require.Equal(t, "branch-both", rows[1].UID)
	require.Equal(t, "untagged-missing", rows[2].UID)
	archived := store.Archived
	require.NoError(t, db.UpdateMemo(ctx, &store.UpdateMemo{ID: rows[0].ID, RowStatus: &archived}))
	reordered, err := db.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID, OrderByPinned: true})
	require.NoError(t, err)
	require.Equal(t, "branch-both", reordered[0].UID)
	require.True(t, rows[0].Pinned)
}
