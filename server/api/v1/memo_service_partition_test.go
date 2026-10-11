package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/EgoSay/kairos/core/partition"
	"github.com/EgoSay/kairos/internal/webhook"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestAtomicPartitionSaveUsesOnlyCommittedDestination(t *testing.T) {
	require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist([]string{"127.0.0.1"}))
	t.Cleanup(func() { require.NoError(t, webhook.ConfigurePrivateDestinationAllowlist(nil)) })
	for _, action := range []string{"move", "remove", "same", "resume"} {
		t.Run(action, func(t *testing.T) {
			svc := newIntegrationService(t)
			owner := createSpaceTestUser(context.Background(), t, svc, "atomic-owner", store.RoleUser)
			ctx := userCtx(context.Background(), owner.ID)
			svc.JournalPartitions = partition.New(svc.Store, svc.readPartitionMemo)
			ps := svc.JournalPartitions
			a, err := ps.SavePartition(ctx, owner.ID, &partition.Partition{Name: "original"})
			require.NoError(t, err)
			b, err := ps.SavePartition(ctx, owner.ID, &partition.Partition{Name: "selected"})
			require.NoError(t, err)
			var receivedMu sync.Mutex
			received := []partition.Payload{}
			receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload partition.Payload
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				receivedMu.Lock()
				received = append(received, payload)
				receivedMu.Unlock()
				w.WriteHeader(http.StatusNoContent)
			}))
			defer receiver.Close()
			ta, err := ps.SaveTarget(ctx, owner.ID, &partition.Target{PartitionID: a.ID, Name: "original target", URL: receiver.URL + "/original", Enabled: true, AutoUpdate: true, Fields: partition.Fields{Content: true}})
			require.NoError(t, err)
			tb, err := ps.SaveTarget(ctx, owner.ID, &partition.Target{PartitionID: b.ID, Name: "selected target", URL: receiver.URL + "/selected", Enabled: true, AutoUpdate: true, Fields: partition.Fields{Content: true}})
			require.NoError(t, err)
			createRequest := &v1pb.CreateMemoRequest{MemoId: "stable-create", Memo: &v1pb.Memo{Content: "original words", Visibility: v1pb.Visibility_PRIVATE}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: a.ID}}
			memo, err := svc.CreateMemo(ctx, createRequest)
			require.NoError(t, err)
			_, err = svc.CreateMemo(ctx, createRequest)
			require.Equal(t, codes.AlreadyExists, status.Code(err), "a lost creation response must remain recoverable by stable ID")
			require.NoError(t, ps.ProcessDue(ctx))
			receivedMu.Lock()
			require.Len(t, received, 1)
			require.Equal(t, ta.ID, received[0].TargetID)
			received = nil
			receivedMu.Unlock()
			uid := strings.TrimPrefix(memo.Name, "memos/")
			if action == "resume" {
				require.NoError(t, ps.SuspendMemo(ctx, owner.ID, uid))
			}
			mapping, err := ps.GetMapping(ctx, owner.ID, uid)
			require.NoError(t, err)
			selected := a.ID
			if action == "move" {
				selected = b.ID
			}
			if action == "remove" {
				selected = ""
			}
			content := "new words must follow final selection"
			mask := &fieldmaskpb.FieldMask{Paths: []string{"content"}}
			if action == "resume" {
				content, mask.Paths = memo.Content, nil
			}
			saved, err := svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: content}, UpdateMask: mask, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: selected, ExpectedVersion: mapping.Version}})
			require.NoError(t, err)
			require.Equal(t, memo.CreateTime, saved.CreateTime)
			require.Equal(t, memo.UpdateTime, saved.UpdateTime)
			mapping, err = ps.GetMapping(ctx, owner.ID, uid)
			require.NoError(t, err)
			require.Equal(t, selected, mapping.PartitionID)
			require.False(t, mapping.Suspended)
			pending, err := svc.Store.ListJournalDocuments(ctx, &store.FindJournalDocument{OwnerID: &owner.ID, Kind: partition.PendingKind})
			require.NoError(t, err)
			require.Len(t, pending, 1, "save intent survives without a browser follow-up")
			// The worker uses a fresh context, as after a lost response/restart.
			require.NoError(t, ps.ProcessDue(context.Background()))
			require.NoError(t, ps.ProcessDue(context.Background()))
			receivedMu.Lock()
			defer receivedMu.Unlock()
			if action == "remove" {
				require.Empty(t, received)
				return
			}
			require.Len(t, received, 1, "retries must not create duplicate event IDs")
			expectedTarget := ta.ID
			if action == "move" {
				expectedTarget = tb.ID
			}
			require.Equal(t, expectedTarget, received[0].TargetID)
			require.Equal(t, content, *received[0].Content)
		})
	}
}

func TestAtomicPartitionSaveRejectsStaleAndUnauthorizedSelection(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "cas-owner", store.RoleUser)
	other := createSpaceTestUser(context.Background(), t, svc, "cas-other", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	svc.JournalPartitions = partition.New(svc.Store, svc.readPartitionMemo)
	p, err := svc.JournalPartitions.SavePartition(ctx, owner.ID, &partition.Partition{Name: "mine"})
	require.NoError(t, err)
	foreign, err := svc.JournalPartitions.SavePartition(ctx, other.ID, &partition.Partition{Name: "other"})
	require.NoError(t, err)
	memo, err := svc.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "unchanged", Visibility: v1pb.Visibility_PRIVATE}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: p.ID}})
	require.NoError(t, err)
	for _, tc := range []struct {
		name, selected string
		version        int64
		actor          int32
		code           codes.Code
	}{
		{"stale", "", 0, owner.ID, codes.Aborted},
		{"foreign partition", foreign.ID, 1, owner.ID, codes.NotFound},
		{"foreign memo", p.ID, 1, other.ID, codes.PermissionDenied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.UpdateMemo(userCtx(context.Background(), tc.actor), &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "must not persist"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: tc.selected, ExpectedVersion: tc.version}})
			require.Equal(t, tc.code, status.Code(err), "%v", err)
			current, err := svc.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
			require.NoError(t, err)
			require.Equal(t, memo.Content, current.Content)
		})
	}
}
