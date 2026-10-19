package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/EgoSay/kairos/core/partition"
	"github.com/EgoSay/kairos/internal/webhook"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/store"
)

func createTagTestMemo(ctx context.Context, t *testing.T, svc *APIV1Service, uid, content string) *v1pb.Memo {
	t.Helper()
	memo, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{MemoId: uid, Memo: &v1pb.Memo{Content: content, Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	return memo
}

func getTagTestMemo(ctx context.Context, t *testing.T, svc *APIV1Service, uid string) *store.Memo {
	t.Helper()
	memo, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.NotNil(t, memo)
	return memo
}

func TestBatchUpdateMemoTagsAddsRemovesAndIsIdempotent(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)

	first := createTagTestMemo(ctx, t, svc, "tag-b1", "morning run #health")
	second := createTagTestMemo(ctx, t, svc, "tag-b2", "plain words")

	response, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:      []string{first.Name, second.Name},
		AddTags:    []string{"review"},
		RemoveTags: []string{"health"},
	})
	require.NoError(t, err)
	require.Empty(t, response.Failures)
	require.Len(t, response.Memos, 2)
	require.Equal(t, "morning run\n#review", response.Memos[0].Content)
	require.Equal(t, []string{"review"}, response.Memos[0].ExplicitTags)
	require.Equal(t, "plain words\n#review", response.Memos[1].Content)

	// Same request again: health is already absent, review already present.
	again, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:      []string{first.Name, second.Name},
		AddTags:    []string{"review"},
		RemoveTags: []string{"health"},
	})
	require.NoError(t, err)
	require.Empty(t, again.Failures)
	require.Equal(t, "morning run\n#review", getTagTestMemo(ctx, t, svc, "tag-b1").Content)
}

func TestBatchUpdateMemoTagsScopedByTag(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)

	inScope := createTagTestMemo(ctx, t, svc, "tag-s1", "memo one #work")
	createTagTestMemo(ctx, t, svc, "tag-s2", "memo two #work/deep")
	createTagTestMemo(ctx, t, svc, "tag-s3", "memo three #life")

	// Scope by #work including descendants: both tagged memos gain #triaged.
	response, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		ScopeTag:                "work",
		ScopeIncludeDescendants: true,
		AddTags:                 []string{"triaged"},
	})
	require.NoError(t, err)
	require.Empty(t, response.Failures)
	require.Zero(t, response.RemainingCount)
	require.Equal(t, "memo one #work\n#triaged", getTagTestMemo(ctx, t, svc, "tag-s1").Content)
	require.Equal(t, "memo two #work/deep\n#triaged", getTagTestMemo(ctx, t, svc, "tag-s2").Content)
	require.Equal(t, "memo three #life", getTagTestMemo(ctx, t, svc, "tag-s3").Content)

	// Exact scope: tag-s2 authors only work/deep, so it falls outside "work".
	exact, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		ScopeTag:   "work",
		RemoveTags: []string{"work"},
	})
	require.NoError(t, err)
	require.Empty(t, exact.Failures)
	require.Equal(t, "memo one\n#triaged", getTagTestMemo(ctx, t, svc, "tag-s1").Content)
	require.Equal(t, "memo two #work/deep\n#triaged", getTagTestMemo(ctx, t, svc, "tag-s2").Content)

	// names and scope_tag are mutually exclusive.
	_, err = svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:    []string{inScope.Name},
		ScopeTag: "work",
		AddTags:  []string{"x"},
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

func TestBatchUpdateMemoTagsRejectsConflictAndTrash(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	memo := createTagTestMemo(ctx, t, svc, "tag-b3", "words")

	_, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:      []string{memo.Name},
		AddTags:    []string{"dup"},
		RemoveTags: []string{"dup"},
	})
	require.Equal(t, codes.InvalidArgument, status.Code(err))

	trashed := createTagTestMemo(ctx, t, svc, "tag-b4", "binned")
	_, err = svc.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "trash", Key: "tag-b4", Payload: []byte(`{"deletedTs":1}`)}, 0)
	require.NoError(t, err)
	response, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:   []string{trashed.Name, memo.Name},
		AddTags: []string{"tag"},
	})
	require.NoError(t, err)
	require.Len(t, response.Failures, 1)
	require.Equal(t, trashed.Name, response.Failures[0].Name)
	require.Len(t, response.Memos, 1)
}

func TestBatchUpdateMemoTagsKeepsQueuedDeliveryAlive(t *testing.T) {
	require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist([]string{"127.0.0.1"}))
	t.Cleanup(func() { require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist(nil)) })
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	svc.JournalPartitions = partition.New(svc.Store, svc.readPartitionMemo)
	ps := svc.JournalPartitions

	p, err := ps.SavePartition(ctx, owner.ID, &partition.Partition{Name: "outbox"})
	require.NoError(t, err)
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	_, err = ps.SaveTarget(ctx, owner.ID, &partition.Target{PartitionID: p.ID, Name: "hook", URL: receiver.URL, Enabled: true, AutoUpdate: true, Fields: partition.Fields{Content: true}})
	require.NoError(t, err)

	memo := createTagTestMemo(ctx, t, svc, "tag-q1", "queued words #a")
	_, err = ps.Assign(ctx, owner.ID, "tag-q1", p.ID, 0)
	require.NoError(t, err)
	queued, err := ps.Commit(ctx, owner.ID, "tag-q1", false)
	require.NoError(t, err)
	require.Len(t, queued, 1)
	require.Equal(t, "pending", queued[0].Status)
	staleRevision := queued[0].Revision

	_, err = svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:      []string{memo.Name},
		RemoveTags: []string{"a"},
	})
	require.NoError(t, err)

	deliveries, err := ps.ListDeliveries(ctx, owner.ID)
	require.NoError(t, err)
	require.Len(t, deliveries, 1)
	require.Equal(t, "pending", deliveries[0].Status, "the queued intent survives tag organization")
	require.NotEqual(t, staleRevision, deliveries[0].Revision, "the revision tracks the rewritten content")

	require.NoError(t, ps.ProcessDue(ctx))
	deliveries, err = ps.ListDeliveries(ctx, owner.ID)
	require.NoError(t, err)
	require.Equal(t, "delivered", deliveries[0].Status)
}

func TestBatchUpdateMemoTagsCapturesRevisionAndModifiedTs(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	memo := createTagTestMemo(ctx, t, svc, "tag-h1", "entry #old")

	_, err := svc.BatchUpdateMemoTags(ctx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:      []string{memo.Name},
		RemoveTags: []string{"old"},
	})
	require.NoError(t, err)

	revisions, err := svc.Store.ListJournalDocuments(ctx, &store.FindJournalDocument{OwnerID: &owner.ID, Kind: "revision", KeyPrefix: "tag-h1"})
	require.NoError(t, err)
	require.NotEmpty(t, revisions, "a revision snapshot precedes the rewrite")

	provenance, err := svc.Store.GetJournalDocument(ctx, owner.ID, "provenance", "tag-h1")
	require.NoError(t, err)
	require.NotNil(t, provenance)
	var values map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(provenance.Payload, &values))
	var modified int64
	require.NoError(t, json.Unmarshal(values["modifiedTs"], &modified))
	require.Positive(t, modified)
}

func TestRenameTagRewritesDescendantsAndReferences(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)

	createTagTestMemo(ctx, t, svc, "tag-r1", "first #work")
	createTagTestMemo(ctx, t, svc, "tag-r2", "second #work/deep #keep")
	createTagTestMemo(ctx, t, svc, "tag-r3", "untouched #play")
	require.NoError(t, svc.Store.AddUserMemoView(ctx, owner.ID, &storepb.MemoViewsUserSetting_MemoView{
		Id: "work-view", Title: "Work", Filter: `"work" in tags`,
	}))
	_, err := svc.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: owner.ID,
		Key:    storepb.UserSetting_TAGS,
		Value: &storepb.UserSetting_Tags{Tags: &storepb.TagsUserSetting{Tags: map[string]*storepb.UserTagMetadata{
			"work":  {BlurContent: true},
			"^wo.*": {BlurContent: true},
		}}},
	})
	require.NoError(t, err)

	preview, err := svc.RenameTag(ctx, &v1pb.RenameTagRequest{OldTag: "work", NewTag: "job", IncludeDescendants: true, ValidateOnly: true})
	require.NoError(t, err)
	require.Equal(t, int32(2), preview.AffectedMemos)
	require.ElementsMatch(t, []string{"work", "work/deep"}, preview.AffectedTags)
	require.False(t, preview.MergesIntoExisting)
	require.Len(t, preview.AffectedViews, 1)
	require.ElementsMatch(t, []string{"work", "^wo.*"}, preview.AffectedTagRules)
	require.Equal(t, "first #work", getTagTestMemo(ctx, t, svc, "tag-r1").Content, "preview writes nothing")

	response, err := svc.RenameTag(ctx, &v1pb.RenameTagRequest{OldTag: "work", NewTag: "job", IncludeDescendants: true})
	require.NoError(t, err)
	require.Empty(t, response.Failures)
	require.Equal(t, "first #job", getTagTestMemo(ctx, t, svc, "tag-r1").Content)
	require.Equal(t, "second #job/deep #keep", getTagTestMemo(ctx, t, svc, "tag-r2").Content)
	require.Equal(t, "untouched #play", getTagTestMemo(ctx, t, svc, "tag-r3").Content)

	views, err := svc.Store.GetUserMemoViews(ctx, owner.ID)
	require.NoError(t, err)
	require.Equal(t, `"job" in tags`, views[0].GetFilter(), "saved-view filter follows the rename")

	setting, err := svc.Store.GetUserSetting(ctx, &store.FindUserSetting{UserID: &owner.ID, Key: storepb.UserSetting_TAGS})
	require.NoError(t, err)
	rules := setting.GetTags().GetTags()
	require.Contains(t, rules, "job", "literal rule key renamed")
	require.NotContains(t, rules, "work")
	require.Contains(t, rules, "^wo.*", "regex keys are reported but never rewritten")
}

func TestRenameTagReportsMergeIntoExisting(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	createTagTestMemo(ctx, t, svc, "tag-m1", "alpha #old")
	createTagTestMemo(ctx, t, svc, "tag-m2", "beta #existing")

	preview, err := svc.RenameTag(ctx, &v1pb.RenameTagRequest{OldTag: "old", NewTag: "existing", ValidateOnly: true})
	require.NoError(t, err)
	require.True(t, preview.MergesIntoExisting)

	_, err = svc.RenameTag(ctx, &v1pb.RenameTagRequest{OldTag: "old", NewTag: "existing"})
	require.NoError(t, err)
	require.Equal(t, "alpha #existing", getTagTestMemo(ctx, t, svc, "tag-m1").Content)
}

func TestDeleteTagRemovesTokenKeepsRecordAndRewritesView(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)

	createTagTestMemo(ctx, t, svc, "tag-d1", "entry #gone #gone/sub #stay")
	require.NoError(t, svc.Store.AddUserMemoView(ctx, owner.ID, &storepb.MemoViewsUserSetting_MemoView{
		Id: "gone-view", Title: "Gone", Filter: `"gone" in explicit_tags`,
	}))

	preview, err := svc.DeleteTag(ctx, &v1pb.DeleteTagRequest{Tag: "gone", IncludeDescendants: true, ValidateOnly: true})
	require.NoError(t, err)
	require.Equal(t, int32(1), preview.AffectedMemos)
	require.ElementsMatch(t, []string{"gone", "gone/sub"}, preview.AffectedTags)
	require.Len(t, preview.AffectedViews, 1)

	_, err = svc.DeleteTag(ctx, &v1pb.DeleteTagRequest{Tag: "gone", IncludeDescendants: true})
	require.NoError(t, err)
	updated := getTagTestMemo(ctx, t, svc, "tag-d1")
	require.Equal(t, "entry #stay", updated.Content)
	require.Equal(t, []string{"stay"}, updated.Payload.GetExplicitTags())

	views, err := svc.Store.GetUserMemoViews(ctx, owner.ID)
	require.NoError(t, err)
	require.Equal(t, `"/" in explicit_tags`, views[0].GetFilter(), "deleted tag literals become never-matching")
}

func TestTagOperationsRejectCrossUserAndInvalid(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "tag-owner", store.RoleUser)
	other := createSpaceTestUser(context.Background(), t, svc, "tag-other", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	otherCtx := userCtx(context.Background(), other.ID)
	memo := createTagTestMemo(ctx, t, svc, "tag-x1", "mine #a")

	// Other users cannot batch-edit or manage the owner's records.
	response, err := svc.BatchUpdateMemoTags(otherCtx, &v1pb.BatchUpdateMemoTagsRequest{
		Names:   []string{memo.Name},
		AddTags: []string{"hijack"},
	})
	require.NoError(t, err)
	require.Len(t, response.Failures, 1)
	require.Equal(t, "permissiondenied", response.Failures[0].Code)

	preview, err := svc.RenameTag(otherCtx, &v1pb.RenameTagRequest{OldTag: "a", NewTag: "b", ValidateOnly: true})
	require.NoError(t, err)
	require.Zero(t, preview.AffectedMemos, "management scope is the caller's own records")

	_, err = svc.RenameTag(ctx, &v1pb.RenameTagRequest{OldTag: "a", NewTag: "a"})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
	_, err = svc.RenameTag(ctx, &v1pb.RenameTagRequest{OldTag: "a b", NewTag: "b"})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}
