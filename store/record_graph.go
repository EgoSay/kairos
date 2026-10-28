package store

import (
	"context"
	"encoding/json"

	"github.com/pkg/errors"
)

// ErrGraphConflict rejects stale work after a source, permission or lease changed.
var ErrGraphConflict = errors.New("record graph work changed")

// GraphSource holds durable change intent and rebuildable semantic data, never original authority.
type GraphSource struct {
	MemoID            int32
	OwnerID           int32
	Revision          int64
	ProcessedRevision int64
	Profile           string
	Representation    json.RawMessage
	Dirty             bool
	LeaseUntil        int64
	LeaseToken        string
	Attempts          int
	NextAttemptTs     int64
	State             string
	ErrorCode         string
	UpdatedTs         int64
	Stage             string
	FailureStage      string
	LastAttemptTs     int64
	StatusVersion     int64
}

// FindGraphSource bounds source enumeration for workers, index warming and random roots.
type FindGraphSource struct {
	OwnerID               int32
	MemoIDs               []int32
	AfterID               int32
	Profile               string
	DueTs                 int64
	Limit                 int
	Offset                int
	ExcludeRepresentation bool
	ReadableOnly          bool
	ConnectedOnly         bool
	ExcludedUIDs          []string
	WorkState             string
	CurrentProfile        string
	Now                   int64
}

// GraphEdge stores one evidenced, undirected connection between source versions.
type GraphEdge struct {
	OwnerID   int32
	A         int32
	B         int32
	RevisionA int64
	RevisionB int64
	Profile   string
	Payload   json.RawMessage
}

// GraphPublication atomically completes a leased source and replaces its suggested edges.
type GraphPublication struct {
	Source        *GraphSource
	ExpectedEpoch int64
	Edges         []*GraphEdge
	Now           int64
}

// GraphCounts distinguishes durable work states without loading representations.
type GraphCounts struct {
	Total   int   `json:"total"`
	Ready   int   `json:"ready"`
	Pending int   `json:"pending"`
	Failed  int   `json:"failed"`
	MaxID   int32 `json:"-"`
}

// ListGraphSources returns a bounded owner-scoped page.
func (s *Store) ListGraphSources(ctx context.Context, find *FindGraphSource) ([]*GraphSource, error) {
	if find == nil || find.OwnerID <= 0 || find.Limit < 1 || find.Limit > 256 || len(find.MemoIDs) > 64 || find.Offset < 0 {
		return nil, errors.New("invalid graph source query")
	}
	return s.driver.ListGraphSources(ctx, find)
}

// ClaimGraphSource compares revision and lease before permitting background work.
func (s *Store) ClaimGraphSource(ctx context.Context, source *GraphSource, now int64) (bool, error) {
	if source.OwnerID <= 0 || source.MemoID <= 0 || source.LeaseToken == "" || source.LeaseUntil <= now {
		return false, errors.New("invalid graph lease")
	}
	return s.driver.ClaimGraphSource(ctx, source, now)
}

// PublishGraphSource prevents stale responses from replacing current results.
func (s *Store) PublishGraphSource(ctx context.Context, publication *GraphPublication) error {
	if publication == nil || publication.Source == nil || len(publication.Edges) > 12 || len(publication.Source.Representation) > 4<<20 {
		return errors.New("invalid graph publication")
	}
	source := publication.Source
	for _, edge := range publication.Edges {
		if edge.OwnerID != source.OwnerID || edge.A >= edge.B || (edge.A != source.MemoID && edge.B != source.MemoID) ||
			edge.Profile != source.Profile || !json.Valid(edge.Payload) || len(edge.Payload) > 12000 {
			return errors.New("invalid graph edge")
		}
	}
	return s.driver.PublishGraphSource(ctx, publication)
}

// DeferGraphSource releases a lease with a durable, safe error code and retry time.
func (s *Store) DeferGraphSource(ctx context.Context, source *GraphSource) error {
	return s.driver.DeferGraphSource(ctx, source)
}

// ListGraphEdges reads a bounded neighborhood of version-matched published connections.
func (s *Store) ListGraphEdges(ctx context.Context, owner, memoID int32, profile string, limit int) ([]*GraphEdge, error) {
	if owner <= 0 || memoID <= 0 || limit < 1 || limit > 24 {
		return nil, errors.New("invalid graph edge query")
	}
	return s.driver.ListGraphEdges(ctx, owner, memoID, profile, limit)
}

// GraphEpoch is advanced atomically with source and journal eligibility changes.
func (s *Store) GraphEpoch(ctx context.Context, owner int32) (int64, error) {
	return s.driver.GraphEpoch(ctx, owner)
}

// CountGraphSources reads indexed background progress.
func (s *Store) CountGraphSources(ctx context.Context, owner int32, profile string) (GraphCounts, error) {
	return s.driver.CountGraphSources(ctx, owner, profile)
}

// ReserveGraphBudget reserves micro-Neurons across owners sharing an account.
func (s *Store) ReserveGraphBudget(ctx context.Context, account, day string, amount, limit int64) (bool, error) {
	if len(account) != 64 || len(day) != 10 || amount <= 0 || limit <= 0 || limit > 9000*GraphNeuronUnits {
		return false, errors.New("invalid graph budget")
	}
	return s.driver.ReserveGraphBudget(ctx, account, day, amount, limit)
}

// RefundGraphBudget releases only a confirmed over-reservation after a complete response.
func (s *Store) RefundGraphBudget(ctx context.Context, account, day string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	return s.driver.RefundGraphBudget(ctx, account, day, amount)
}

// ReadGraphBudget returns this application's account-wide reservations for a UTC day.
func (s *Store) ReadGraphBudget(ctx context.Context, account, day string) (int64, error) {
	return s.driver.ReadGraphBudget(ctx, account, day)
}
