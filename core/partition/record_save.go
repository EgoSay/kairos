package partition

import (
	"context"
	"encoding/json"
	"uuid"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/store"
)

// PendingKind is a durable save outbox, written with the memo and mapping.
const PendingKind = "partition-pending"

// PrepareRecordSave validates a selection without changing persistent state.
// The caller must apply all documents in the same transaction as the memo.
// A nil partitionID preserves the current mapping, including suspension.
func (s *Service) PrepareRecordSave(ctx context.Context, owner int32, memoUID string, partitionID *string, expectedVersion int64) ([]*store.JournalDocumentMutation, error) {
	old, err := s.GetMapping(ctx, owner, memoUID)
	if err != nil {
		return nil, err
	}
	if partitionID != nil && (expectedVersion < 0 || old.Version != expectedVersion) {
		return nil, store.ErrMemoMutationConflict
	}
	documents := []*store.JournalDocumentMutation{}
	if partitionID != nil && *partitionID != "" {
		p, err := s.Repo.GetJournalDocument(ctx, owner, PartitionKind, *partitionID)
		if err != nil {
			return nil, err
		}
		if p == nil {
			return nil, ErrNotFound
		}
		documents = append(documents, &store.JournalDocumentMutation{Document: p, ExpectedVersion: p.Version, CheckOnly: true})
	}
	next := *old
	changed := partitionID != nil && (*partitionID != old.PartitionID || old.Suspended)
	if changed {
		next.PartitionID, next.Suspended = *partitionID, false
	}
	payload, err := json.Marshal(next)
	if err != nil {
		return nil, err
	}
	documents = append(documents, &store.JournalDocumentMutation{
		Document:        &store.JournalDocument{OwnerID: owner, Kind: MappingKind, Key: memoUID, Payload: payload},
		ExpectedVersion: old.Version, CheckOnly: !changed,
	})
	// A worker can resume this intent even if the process or request ends after
	// committing. Unique outbox IDs avoid an ABA race with worker acknowledgements.
	pendingPayload, err := json.Marshal(map[string]string{"memoUid": memoUID})
	if err != nil {
		return nil, err
	}
	documents = append(documents, &store.JournalDocumentMutation{
		Document:        &store.JournalDocument{OwnerID: owner, Kind: PendingKind, Key: uuid.NewV4().String(), Payload: pendingPayload},
		ExpectedVersion: 0,
	})
	return documents, nil
}

// ReconcileRecordSaves converts committed save intents to idempotent deliveries.
// Failed processing retains the outbox entry for a later worker attempt.
func (s *Service) ReconcileRecordSaves(ctx context.Context) error {
	docs, err := s.Repo.ListJournalDocuments(ctx, &store.FindJournalDocument{Kind: PendingKind})
	if err != nil {
		return err
	}
	for _, doc := range docs {
		if err := s.reconcileRecordSave(ctx, doc); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reconcileRecordSave(ctx context.Context, doc *store.JournalDocument) error {
	var pending struct {
		MemoUID string `json:"memoUid"`
	}
	if err := json.Unmarshal(doc.Payload, &pending); err != nil {
		return err
	}
	if pending.MemoUID == "" {
		return ErrInvalid
	}
	mapping, err := s.GetMapping(ctx, doc.OwnerID, pending.MemoUID)
	if err != nil {
		return err
	}
	deliveries, err := s.ListDeliveries(ctx, doc.OwnerID)
	if err != nil {
		return err
	}
	for _, delivery := range deliveries {
		if delivery.MemoUID != pending.MemoUID || delivery.Event != "upsert" || !cancelable(delivery.Status) {
			continue
		}
		if _, _, err := s.authorize(ctx, doc.OwnerID, delivery, false); err != nil {
			if !errors.Is(err, ErrNotFound) {
				return err
			}
			s.cancelInflight(doc.OwnerID, delivery.TargetID)
			delivery.Status = "cancelled"
			if err := s.saveDelivery(ctx, doc.OwnerID, delivery); err != nil {
				return err
			}
		}
	}
	targets, err := s.ListTargets(ctx, doc.OwnerID, "")
	if err != nil {
		return err
	}
	for _, target := range targets {
		if target.PartitionID != mapping.PartitionID {
			if err := s.queueRetractions(ctx, doc.OwnerID, pending.MemoUID, target.PartitionID); err != nil {
				return err
			}
		}
	}
	if _, err := s.Commit(ctx, doc.OwnerID, pending.MemoUID, false); err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	err = s.Repo.DeleteJournalDocument(ctx, doc.OwnerID, PendingKind, doc.Key, doc.Version)
	if errors.Is(err, store.ErrJournalConflict) {
		return nil
	}
	return err
}
