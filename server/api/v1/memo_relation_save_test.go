package v1

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestMemoSaveSkipsUnavailableReferencesWithoutLosingBody(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "reference-owner", store.RoleUser)
	other := createSpaceTestUser(context.Background(), t, svc, "reference-other", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	create := func(user int32, content string) *v1pb.Memo {
		m, err := svc.CreateMemo(userCtx(context.Background(), user), &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: content, Visibility: v1pb.Visibility_PRIVATE}})
		require.NoError(t, err)
		return m
	}
	source := create(owner.ID, "draft original")
	target := create(owner.ID, "visible target")
	hidden := create(other.ID, "private target must not leak")
	trashed := create(owner.ID, "trash must not leak")
	rec := journalRecordRequest(ctx, svc, http.MethodPost, "/memos/"+strings.TrimPrefix(trashed.Name, "memos/")+"/trash")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	relation := func(name string) *v1pb.MemoRelation {
		return &v1pb.MemoRelation{Type: v1pb.MemoRelation_REFERENCE, RelatedMemo: &v1pb.MemoRelation_Memo{Name: name}}
	}
	requested := []*v1pb.MemoRelation{relation(target.Name), relation(hidden.Name), relation(trashed.Name), relation("memos/missing-target"), relation(source.Name), relation(target.Name)}
	saved, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: source.Name, Content: "draft preserved", Relations: requested}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "relations"}}})
	require.NoError(t, err)
	require.Equal(t, "draft preserved", saved.Content)
	require.Len(t, saved.Relations, 1)
	require.Equal(t, target.Name, saved.Relations[0].RelatedMemo.Name)
	reverse, err := svc.ListMemoRelations(ctx, &v1pb.ListMemoRelationsRequest{Name: target.Name})
	require.NoError(t, err)
	require.Len(t, reverse.Relations, 1)
	require.Equal(t, source.Name, reverse.Relations[0].Memo.Name)
	_, err = svc.SetMemoRelations(ctx, &v1pb.SetMemoRelationsRequest{Name: source.Name, Relations: []*v1pb.MemoRelation{relation(hidden.Name)}})
	require.Error(t, err, "legacy dedicated relation endpoint retains strict errors")
	created, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "new body preserved", Relations: []*v1pb.MemoRelation{relation(hidden.Name), relation(target.Name)}}})
	require.NoError(t, err)
	require.Equal(t, "new body preserved", created.Content)
	require.Len(t, created.Relations, 1)
}

func TestMemoRelationsHideTrashedEndpointsAndRestoreBidirectionally(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "restore-rel-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	target, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "remembered original"}})
	require.NoError(t, err)
	source, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "new thought", Relations: []*v1pb.MemoRelation{{Type: v1pb.MemoRelation_REFERENCE, RelatedMemo: &v1pb.MemoRelation_Memo{Name: target.Name}}}}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(target.Name, "memos/")
	response := journalRecordRequest(ctx, svc, http.MethodPost, "/memos/"+uid+"/trash")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	links, err := svc.ListMemoRelations(ctx, &v1pb.ListMemoRelationsRequest{Name: source.Name})
	require.NoError(t, err)
	require.Empty(t, links.Relations, "trash content and identity must not leak in a relation card")
	response = journalRecordRequest(ctx, svc, http.MethodPost, "/trash/"+uid+"/restore")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	links, err = svc.ListMemoRelations(ctx, &v1pb.ListMemoRelationsRequest{Name: source.Name})
	require.NoError(t, err)
	require.Len(t, links.Relations, 1)
	require.Equal(t, target.Name, links.Relations[0].RelatedMemo.Name)
	reverse, err := svc.ListMemoRelations(ctx, &v1pb.ListMemoRelationsRequest{Name: target.Name})
	require.NoError(t, err)
	require.Len(t, reverse.Relations, 1)
	require.Equal(t, source.Name, reverse.Relations[0].Memo.Name)
}
