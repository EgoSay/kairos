package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/EgoSay/kairos/core/memoexport"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestNameOnlyLocationSaveExportImportAndAgentContract(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	svc.Profile.Version = "1.1.0-test"
	owner := createSpaceTestUser(ctx, t, svc, "location-roundtrip", store.RoleUser)
	ownerCtx := userCtx(ctx, owner.ID)
	memo, err := svc.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "test record", Location: &v1pb.Location{Placeholder: "楼下咖啡店", NameOnly: true}}})
	require.NoError(t, err)
	memo, err = svc.GetMemo(ownerCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.True(t, memo.Location.NameOnly)
	require.Equal(t, "楼下咖啡店", memo.Location.Placeholder)
	place, ok := svc.agentMemo(memo, "Asia/Shanghai")["location"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, map[string]any{"name": "楼下咖啡店", "nameOnly": true}, place)

	var export bytes.Buffer
	require.NoError(t, svc.WriteMemoExport(ownerCtx, owner, &export))
	archive, err := memoexport.Read(bytes.NewReader(export.Bytes()), int64(export.Len()))
	require.NoError(t, err)
	require.Len(t, archive.Memos, 1)
	require.True(t, archive.Memos[0].Location.NameOnly)
	encoded, err := json.Marshal(archive.Memos[0].Location)
	require.NoError(t, err)
	require.JSONEq(t, `{"placeholder":"楼下咖啡店","nameOnly":true}`, string(encoded))

	restored := newIntegrationService(t)
	restoreOwner := createSpaceTestUser(ctx, t, restored, "location-restore", store.RoleUser)
	restoreCtx := userCtx(ctx, restoreOwner.ID)
	_, err = restored.ImportMemoExport(restoreCtx, restoreOwner, archive, v1pb.ImportMemosRequest_SKIP)
	require.NoError(t, err)
	restoredMemo, err := restored.GetMemo(restoreCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.True(t, restoredMemo.Location.NameOnly)
	require.Equal(t, "楼下咖啡店", restoredMemo.Location.Placeholder)

	// A client that drops the additive flag cannot silently invent a geographic pin.
	legacyUpdate := &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "old client body", Location: &v1pb.Location{Placeholder: "楼下咖啡店"}}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "location"}}}
	_, err = svc.UpdateMemo(ownerCtx, legacyUpdate)
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
	unchanged, err := svc.GetMemo(ownerCtx, &v1pb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, "test record", unchanged.Content)
	require.True(t, unchanged.Location.NameOnly)
	bodyOnly, err := svc.UpdateMemo(ownerCtx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "body-only update"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.NoError(t, err)
	require.True(t, bodyOnly.Location.NameOnly)
	require.Equal(t, "楼下咖啡店", bodyOnly.Location.Placeholder)
	uid := strings.TrimPrefix(memo.Name, "memos/")
	stored, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	currentHash, err := svc.journalRecordHash(ctx, stored)
	require.NoError(t, err)
	stored.Payload.Location.NameOnly = false
	legacyHash, err := svc.journalRecordHash(ctx, stored)
	require.NoError(t, err)
	_, err = svc.UpdateMemo(metadata.NewIncomingContext(ownerCtx, metadata.Pairs("x-memos-expected-record-sha256", legacyHash)), legacyUpdate)
	require.Equal(t, codes.Aborted, status.Code(err))
	currentCtx := metadata.NewIncomingContext(ownerCtx, metadata.Pairs("x-memos-expected-record-sha256", currentHash))

	// A legacy point at 0,0 remains a real point when explicitly selected.
	memo, err = svc.UpdateMemo(currentCtx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Location: &v1pb.Location{Placeholder: "origin"}}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"location"}}})
	require.NoError(t, err)
	require.False(t, memo.Location.NameOnly)
	require.Equal(t, map[string]any{"name": "origin", "nameOnly": false, "latitude": 0.0, "longitude": 0.0}, svc.agentMemo(memo, "Asia/Shanghai")["location"])
	memo, err = svc.UpdateMemo(ownerCtx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Location: &v1pb.Location{Placeholder: "家", NameOnly: true}}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"location"}}})
	require.NoError(t, err)
	require.True(t, memo.Location.NameOnly)
}

func TestLocationRejectsAmbiguousAndInvalidCoordinates(t *testing.T) {
	for _, location := range []*v1pb.Location{
		{NameOnly: true}, {NameOnly: true, Placeholder: "  "},
		{NameOnly: true, Placeholder: strings.Repeat("名", 201)},
		{NameOnly: true, Placeholder: "家", Latitude: 31},
		{Latitude: math.NaN()}, {Longitude: math.Inf(1)}, {Latitude: 91},
	} {
		require.Equal(t, codes.InvalidArgument, status.Code(validateMemoLocation(location)))
	}
	require.NoError(t, validateMemoLocation(&v1pb.Location{Placeholder: "legacy", Latitude: 0, Longitude: 0}))
	require.NoError(t, validateMemoLocation(&v1pb.Location{Placeholder: strings.Repeat("legacy", 100), Latitude: 31, Longitude: 121}))
	require.NoError(t, validateMemoLocation(&v1pb.Location{Placeholder: "家", NameOnly: true}))
}
