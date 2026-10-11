package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestJournalSearchScopeCountsAndPinLifecycle(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "search-owner", store.RoleUser)
	other := createSpaceTestUser(context.Background(), t, svc, "search-other", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	var records []*v1pb.Memo
	for _, uid := range []string{"normal", "archive", "trash"} {
		memo, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{MemoId: uid, Memo: &v1pb.Memo{Content: "同一天 #人生/阅读 #人生/家庭", Visibility: v1pb.Visibility_PRIVATE}})
		require.NoError(t, err)
		records = append(records, memo)
		if uid != "normal" {
			_, err = svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, State: v1pb.State_ARCHIVED}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}}})
			require.NoError(t, err)
		}
	}
	_, err := svc.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "trash", Key: "trash", Payload: []byte(`{"deletedTs":1}`)}, 0)
	require.NoError(t, err)
	_, err = svc.CreateMemo(userCtx(context.Background(), other.ID), &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "#人生/阅读", Visibility: v1pb.Visibility_PUBLIC}})
	require.NoError(t, err)
	req := &v1pb.ListMemosRequest{IncludeArchived: true, PageSize: 1, Filter: `("人生" in tags || tags.exists(t, t.startsWith("人生/")))`}
	var names []string
	for {
		response, err := svc.ListMemos(ctx, req)
		require.NoError(t, err)
		for _, memo := range response.Memos {
			names = append(names, memo.Name)
		}
		if response.NextPageToken == "" {
			break
		}
		req.PageToken = response.NextPageToken
	}
	require.ElementsMatch(t, []string{records[0].Name, records[1].Name}, names)
	stats, err := svc.ListAllUserStats(ctx, &v1pb.ListAllUserStatsRequest{IncludeArchived: true, Filter: req.Filter})
	require.NoError(t, err)
	require.Len(t, stats.Stats, 1)
	require.Equal(t, int32(2), stats.Stats[0].TagCount["人生"], "one record with two descendants counts once")
	_, err = svc.ListMemos(context.Background(), &v1pb.ListMemosRequest{IncludeArchived: true})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
	pin := &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: records[0].Name, Pinned: true}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"pinned"}}}
	pinned, err := svc.UpdateMemo(ctx, pin)
	require.NoError(t, err)
	require.True(t, pinned.Pinned)
	require.Equal(t, records[0].CreateTime, pinned.CreateTime)
	require.Equal(t, records[0].UpdateTime, pinned.UpdateTime)
	pin.Memo.Pinned = false
	_, err = svc.UpdateMemo(userCtx(context.Background(), other.ID), pin)
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	for _, state := range []v1pb.State{v1pb.State_ARCHIVED, v1pb.State_NORMAL} {
		updated, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: pinned.Name, State: state}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}}})
		require.NoError(t, err)
		require.True(t, updated.Pinned)
		require.Equal(t, pinned.CreateTime, updated.CreateTime)
	}
}
