package v1

import (
	"context"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/EgoSay/kairos/core/partition"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func (s *APIV1Service) prepareMemoPartitionSave(ctx context.Context, user *store.User, memo *store.Memo, selection *v1pb.JournalPartitionSelection) ([]*store.JournalDocumentMutation, error) {
	if selection == nil {
		return nil, nil
	}
	if user.ID != memo.CreatorID {
		return nil, status.Error(codes.PermissionDenied, "only the author may select a personal partition")
	}
	if memo.RowStatus == store.Archived {
		return nil, status.Error(codes.FailedPrecondition, "restore the record before selecting a partition")
	}
	service := s.JournalPartitions
	if service == nil {
		service = partition.New(s.Store, s.readPartitionMemo)
	}
	documents, err := service.PrepareRecordSave(ctx, user.ID, memo.UID, &selection.PartitionId, selection.ExpectedVersion)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrMemoMutationConflict):
			return nil, status.Error(codes.Aborted, "partition changed while editing; local content was preserved")
		case errors.Is(err, partition.ErrNotFound):
			return nil, status.Error(codes.NotFound, "partition not found")
		default:
			return nil, status.Errorf(codes.Internal, "failed to prepare partition selection: %v", err)
		}
	}
	return documents, nil
}
