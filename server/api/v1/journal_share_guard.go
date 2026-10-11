package v1

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/EgoSay/kairos/store"
)

// The owner-wide CAS orders sharing approvals against recovery's withdrawal
// scan. Capture it before either operation reads its source records; commit its
// increment with the share or recovered body, so neither can cross the other.
func (s *APIV1Service) prepareJournalShareGuard(ctx context.Context, owner int32) (*store.JournalDocumentMutation, error) {
	doc, err := s.Store.GetJournalDocument(ctx, owner, "share-guard", "main")
	if err != nil {
		return nil, err
	}
	version := int64(0)
	if doc != nil {
		version = doc.Version
	}
	return &store.JournalDocumentMutation{Document: &store.JournalDocument{OwnerID: owner, Kind: "share-guard", Key: "main", Payload: json.RawMessage(`{}`)}, ExpectedVersion: version}, nil
}

func (s *APIV1Service) commitJournalShare(ctx context.Context, owner int32, doc *store.JournalDocument, version int64, checks []store.MemoRecordCheck, guard *store.JournalDocumentMutation) (*store.JournalDocument, error) {
	if len(checks) == 0 {
		return nil, store.ErrMemoMutationConflict
	}
	slices.SortFunc(checks, func(a, b store.MemoRecordCheck) int { return int(a.MemoID - b.MemoID) })
	anchor, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &checks[0].MemoID, CreatorID: &owner})
	if err != nil {
		return nil, err
	}
	if anchor == nil {
		return nil, store.ErrMemoMutationConflict
	}
	err = s.Store.ApplyMemoMutation(ctx, &store.MemoMutation{
		MemoID: anchor.ID, MemoCreatorID: owner, ExpectedMemoContent: anchor.Content, RecordChecks: checks,
		Policy:           memoWritePolicy(owner, false),
		JournalDocuments: []*store.JournalDocumentMutation{guard, {Document: doc, ExpectedVersion: version}},
	})
	if err != nil {
		return nil, err
	}
	return s.Store.GetJournalDocument(ctx, owner, doc.Kind, doc.Key)
}
