package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestContentReferencesSaveAndManualReferencesAreIndependent(t *testing.T) {
	svc := newIntegrationService(t)
	svc.Profile.InstanceURL = "https://journal.example"
	owner := createSpaceTestUser(context.Background(), t, svc, "body-link-owner", store.RoleUser)
	visitor := createSpaceTestUser(context.Background(), t, svc, "body-link-visitor", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	target, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "原来的想法", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	manual := &v1pb.MemoRelation{Type: v1pb.MemoRelation_REFERENCE, RelatedMemo: &v1pb.MemoRelation_Memo{Name: target.Name}}
	body := "https://journal.example/" + target.Name + "\n\n[再看一次](/" + target.Name + ")"
	source, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: body, Visibility: v1pb.Visibility_PUBLIC, Relations: []*v1pb.MemoRelation{manual}}})
	require.NoError(t, err)
	require.Len(t, source.Relations, 2, "manual and automatic provenance coexist; repeated body links deduplicate")
	backlinks, err := svc.ListMemoRelations(ctx, &v1pb.ListMemoRelationsRequest{Name: target.Name})
	require.NoError(t, err)
	require.Len(t, backlinks.Relations, 2)
	guestView, err := svc.GetMemo(userCtx(context.Background(), visitor.ID), &v1pb.GetMemoRequest{Name: source.Name})
	require.NoError(t, err)
	require.Empty(t, guestView.Relations, "public source cannot disclose its private target")
	updateBody := func(content string) *v1pb.Memo {
		saved, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: source.Name, Content: content}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
		require.NoError(t, err)
		return saved
	}
	saved := updateBody("继续当前思考")
	require.Len(t, saved.Relations, 1)
	require.Equal(t, v1pb.MemoRelation_REFERENCE, saved.Relations[0].Type)
	saved = updateBody(body)
	require.Len(t, saved.Relations, 2)
	_, err = svc.SetMemoRelations(ctx, &v1pb.SetMemoRelationsRequest{Name: source.Name})
	require.NoError(t, err)
	saved, err = svc.GetMemo(ctx, &v1pb.GetMemoRequest{Name: source.Name})
	require.NoError(t, err)
	require.Len(t, saved.Relations, 1)
	require.Equal(t, v1pb.MemoRelation_CONTENT_REFERENCE, saved.Relations[0].Type)
	saved = updateBody("`https://journal.example/" + target.Name + "`")
	require.Empty(t, saved.Relations)
}

func TestContentReferencesIgnoreUnavailableAndDoNotWriteOnRead(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "legacy-link-owner", store.RoleUser)
	other := createSpaceTestUser(context.Background(), t, svc, "legacy-link-other", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	hidden, err := svc.CreateMemo(userCtx(context.Background(), other.ID), &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "不能泄露的内容", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	target, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "可读记录"}})
	require.NoError(t, err)
	body := "[过去](/" + target.Name + ") [不可读](/" + hidden.Name + ") [失效](/memos/missing)"
	legacy, err := svc.Store.CreateMemo(ctx, &store.Memo{UID: "legacy-reference", CreatorID: owner.ID, Visibility: store.Private, Content: body})
	require.NoError(t, err)
	read, err := svc.GetMemo(ctx, &v1pb.GetMemoRequest{Name: buildMemoName(legacy.UID)})
	require.NoError(t, err)
	require.Empty(t, read.Relations)
	saved, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: read.Name, Content: body}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.NoError(t, err)
	require.Equal(t, body, saved.Content)
	require.Len(t, saved.Relations, 1)
	require.Equal(t, target.Name, saved.Relations[0].RelatedMemo.Name)
}
