package test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

func TestMemoExplicitTagIndexesAndLegacyBackfill(t *testing.T) {
	ctx := context.Background()
	db := NewTestingStore(ctx, t)
	defer db.Close()
	owner, err := createTestingHostUser(ctx, db)
	require.NoError(t, err)
	contents := map[string]string{
		"exact-child":  "#人生修行/阅读",
		"exact-parent": "#人生修行",
		"exact-both":   "#人生修行/阅读 #人生修行 #人生修行/阅读",
		"exact-other":  "#工作/阅读 #人生修行者/阅读",
		"exact-code":   "`#人生修行`\n\n```markdown\n#人生修行\n```\n",
		"exact-quoted": `#"标签：特殊/50%" #literal_under`,
	}
	memos := map[string]*store.Memo{}
	for uid, content := range contents {
		memos[uid], err = db.CreateMemo(ctx, &store.Memo{UID: uid, CreatorID: owner.ID, Content: content, Visibility: store.Private,
			Payload: &storepb.MemoPayload{Tags: []string{"legacy-hierarchy"}, Location: &storepb.MemoPayload_Location{Placeholder: "keep", Latitude: 31, Longitude: 121}}})
		require.NoError(t, err)
	}
	query := func(expression string) []string {
		var got []string
		limit := 1
		for offset := 0; ; offset++ {
			rows, err := db.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID, Filters: []string{expression}, Limit: &limit, Offset: &offset})
			require.NoError(t, err)
			if len(rows) == 0 {
				break
			}
			got = append(got, rows[0].UID)
			require.LessOrEqual(t, len(got), len(contents))
		}
		return got
	}
	require.ElementsMatch(t, []string{"exact-parent", "exact-both"}, query(`"人生修行" in explicit_tags`))
	require.ElementsMatch(t, []string{"exact-child", "exact-both"}, query(`"人生修行/阅读" in explicit_tags`))
	require.Equal(t, []string{"exact-quoted"}, query(`"标签：特殊/50%" in explicit_tags`))
	// Simulate both legacy hierarchy-expanded and historical missing/null tag payloads.
	legacy := `{"tags":["人生修行","人生修行/阅读"],"location":{"placeholder":"keep","latitude":31,"longitude":121},"opaqueFuture":{"safe":true}}`
	for _, uid := range []string{"exact-child", "exact-both"} {
		_, err = db.GetDriver().GetDB().ExecContext(ctx, fmt.Sprintf("UPDATE memo SET payload = '%s' WHERE id = %d", legacy, memos[uid].ID))
		require.NoError(t, err)
	}
	for _, uid := range []string{"exact-parent", "exact-code"} {
		_, err = db.GetDriver().GetDB().ExecContext(ctx, fmt.Sprintf("UPDATE memo SET payload = '{\"tags\":null}' WHERE id = %d", memos[uid].ID))
		require.NoError(t, err)
	}
	require.NoError(t, db.Migrate(ctx))
	require.ElementsMatch(t, []string{"exact-parent", "exact-both"}, query(`"人生修行" in explicit_tags`))
	require.ElementsMatch(t, []string{"exact-child", "exact-both"}, query(`"人生修行/阅读" in explicit_tags`))
	var raw string
	require.NoError(t, db.GetDriver().GetDB().QueryRowContext(ctx, fmt.Sprintf("SELECT payload FROM memo WHERE id = %d", memos["exact-child"].ID)).Scan(&raw))
	var migrated, old map[string]any
	require.NoError(t, json.Unmarshal([]byte(raw), &migrated))
	require.NoError(t, json.Unmarshal([]byte(legacy), &old))
	require.Equal(t, []any{"人生修行/阅读"}, migrated["explicitTags"])
	require.Equal(t, float64(1), migrated["explicitTagsVersion"])
	delete(migrated, "explicitTags")
	delete(migrated, "explicitTagsVersion")
	require.Equal(t, old, migrated, "migration changes only derived index, retaining unknown metadata")
	row, err := db.GetMemo(ctx, &store.FindMemo{ID: &memos["exact-child"].ID})
	require.NoError(t, err)
	require.Equal(t, memos["exact-child"].Content, row.Content)
	require.Equal(t, memos["exact-child"].CreatedTs, row.CreatedTs)
	require.Equal(t, memos["exact-child"].UpdatedTs, row.UpdatedTs)
	require.Equal(t, store.Private, row.Visibility)
	require.NoError(t, db.Migrate(ctx))
	var second string
	require.NoError(t, db.GetDriver().GetDB().QueryRowContext(ctx, fmt.Sprintf("SELECT payload FROM memo WHERE id = %d", row.ID)).Scan(&second))
	require.Equal(t, raw, second, "backfill is idempotent")
	content := "#另一父级/同名"
	require.NoError(t, db.UpdateMemo(ctx, &store.UpdateMemo{ID: row.ID, Content: &content}))
	require.ElementsMatch(t, []string{"exact-both"}, query(`"人生修行/阅读" in explicit_tags`))
	require.Equal(t, []string{"exact-child"}, query(`"另一父级/同名" in explicit_tags`))
	row, err = db.GetMemo(ctx, &store.FindMemo{ID: &row.ID})
	require.NoError(t, err)
	require.Equal(t, "keep", row.Payload.Location.Placeholder)
	// A location-only writer may hold an old or untrusted payload. Its derived
	// index must follow the current content, not that stale payload.
	require.NoError(t, db.UpdateMemo(ctx, &store.UpdateMemo{ID: row.ID, Payload: &storepb.MemoPayload{
		Location: &storepb.MemoPayload_Location{Placeholder: "new place"}, ExplicitTags: []string{"forged"}, ExplicitTagsVersion: 1,
	}}))
	require.Equal(t, []string{"exact-child"}, query(`"另一父级/同名" in explicit_tags`))
	require.Empty(t, query(`"forged" in explicit_tags`))
	content = "No tags after replacement"
	require.NoError(t, db.UpdateMemo(ctx, &store.UpdateMemo{ID: row.ID, Content: &content, Payload: &storepb.MemoPayload{ExplicitTags: []string{"forged"}}}))
	require.Empty(t, query(`"另一父级/同名" in explicit_tags`))
	require.Empty(t, query(`"forged" in explicit_tags`))
}
