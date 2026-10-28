package store

import (
	"context"

	"github.com/pkg/errors"
)

// GraphNeuronUnits preserves fractional Neurons without per-request rounding.
const GraphNeuronUnits int64 = 1_000_000

// GraphCall records one reservation and its eventual settlement, without journal text.
type GraphCall struct {
	ID           string `json:"id"`
	OwnerID      int32  `json:"-"`
	MemoID       int32  `json:"-"`
	Revision     int64  `json:"revision"`
	Stage        string `json:"stage"`
	Account      string `json:"-"`
	Day          string `json:"day"`
	Reserved     int64  `json:"reservedUnits"`
	Charged      int64  `json:"chargedUnits"`
	UsageKind    string `json:"usageKind"`
	InputTokens  int64  `json:"inputTokens"`
	OutputTokens int64  `json:"outputTokens"`
	Outcome      string `json:"outcome"`
	ErrorCode    string `json:"errorCode,omitempty"`
	HTTPStatus   int    `json:"httpStatus,omitempty"`
	ProviderCode int    `json:"providerCode,omitempty"`
	RequestID    string `json:"requestId,omitempty"`
	StartedTs    int64  `json:"startedTs"`
	FinishedTs   int64  `json:"finishedTs"`
}

// GraphUsage separates known charges, conservative estimates and unsettled calls.
type GraphUsage struct {
	Total     int64
	Known     int64
	Estimated int64
	InFlight  int64
	Unknown   int64
}

// GraphProgress partitions eligible sources; excluded records are counted separately.
type GraphProgress struct {
	Total     int `json:"total"`
	Ready     int `json:"ready"`
	Preparing int `json:"preparing"`
	Quota     int `json:"quota"`
	Attention int `json:"attention"`
	Excluded  int `json:"excluded"`
}

// GraphRuntime persists an account connection's circuit breaker across restarts.
type GraphRuntime struct {
	Key      string `json:"-"`
	Failures int    `json:"failures"`
	Trips    int    `json:"trips"`
	Until    int64  `json:"until"`
	Code     string `json:"code"`
}

// GraphRetryTarget captures one version of work, so a delayed retry cannot rewind newer work.
type GraphRetryTarget struct {
	MemoID                  int32
	Revision, StatusVersion int64
}

// GraphRetry is a durable idempotent manual retry receipt.
type GraphRetry struct {
	OwnerID   int32              `json:"-"`
	ID        string             `json:"requestId"`
	InputHash string             `json:"-"`
	Epoch     int64              `json:"-"`
	Targets   []GraphRetryTarget `json:"-"`
	Accepted  int                `json:"accepted"`
	Skipped   int                `json:"skipped"`
	More      bool               `json:"more"`
	Now       int64              `json:"createdTs"`
}

// SaveGraphProgress checkpoints validated work while retaining the current lease.
func (s *Store) SaveGraphProgress(ctx context.Context, source *GraphSource) error {
	if len(source.Representation) > 4<<20 {
		return errors.New("graph checkpoint too large")
	}
	return s.driver.SaveGraphProgress(ctx, source)
}

// BeginGraphCall atomically creates a call and reserves its conservative upper bound.
func (s *Store) BeginGraphCall(ctx context.Context, call *GraphCall, limit int64) (bool, error) {
	if call.ID == "" || call.OwnerID <= 0 || call.MemoID <= 0 || len(call.Account) != 64 || len(call.Day) != 10 || call.Reserved <= 0 || limit <= 0 || limit > 9000*GraphNeuronUnits {
		return false, errors.New("invalid graph call reservation")
	}
	return s.driver.BeginGraphCall(ctx, call, limit)
}

// SettleGraphCall applies one final charge exactly once, even after a validation failure.
func (s *Store) SettleGraphCall(ctx context.Context, call *GraphCall) error {
	if call.Charged < 0 || call.InputTokens < 0 || call.OutputTokens < 0 || call.Outcome == "pending" {
		return errors.New("invalid graph settlement")
	}
	return s.driver.SettleGraphCall(ctx, call)
}

// ReadGraphUsage includes conservative reservations whose response was lost.
func (s *Store) ReadGraphUsage(ctx context.Context, account, day string, now int64) (GraphUsage, error) {
	return s.driver.ReadGraphUsage(ctx, account, day, now)
}

// GraphCallCursor orders attempt history without dropping calls sharing a timestamp.
type GraphCallCursor struct {
	Time int64  `json:"time"`
	ID   string `json:"id"`
}

// ListGraphCalls reads a bounded metadata-only attempt history for the owner.
func (s *Store) ListGraphCalls(ctx context.Context, owner, memo int32, before GraphCallCursor, limit int) ([]*GraphCall, error) {
	if owner <= 0 || memo <= 0 || limit < 1 || limit > 50 {
		return nil, errors.New("invalid graph history query")
	}
	return s.driver.ListGraphCalls(ctx, owner, memo, before, limit)
}

// CountGraphProgress uses the same eligibility filter as the jobs list.
func (s *Store) CountGraphProgress(ctx context.Context, find *FindGraphSource) (GraphProgress, error) {
	return s.driver.CountGraphProgress(ctx, find)
}

// GetGraphRuntime reads a connection circuit without exposing credentials.
func (s *Store) GetGraphRuntime(ctx context.Context, key string) (GraphRuntime, error) {
	return s.driver.GetGraphRuntime(ctx, key)
}

// PutGraphRuntime saves a safe connection failure category and its next probe time.
func (s *Store) PutGraphRuntime(ctx context.Context, value GraphRuntime) error {
	return s.driver.PutGraphRuntime(ctx, value)
}

// ClaimGraphProbe allows a single bounded half-open request across worker instances.
func (s *Store) ClaimGraphProbe(ctx context.Context, key string, now int64) (bool, error) {
	return s.driver.ClaimGraphProbe(ctx, key, now)
}

// GetGraphRetry returns the original receipt after a lost client response.
func (s *Store) GetGraphRetry(ctx context.Context, owner int32, id string) (*GraphRetry, error) {
	return s.driver.GetGraphRetry(ctx, owner, id)
}

// RetryGraphSources requeues captured revisions and stores the receipt in one transaction.
func (s *Store) RetryGraphSources(ctx context.Context, retry *GraphRetry) (*GraphRetry, error) {
	if retry.OwnerID <= 0 || len(retry.ID) < 8 || len(retry.ID) > 64 || len(retry.Targets) > 256 {
		return nil, errors.New("invalid graph retry")
	}
	return s.driver.RetryGraphSources(ctx, retry)
}
