package recordgraph

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/store"
)

// UsageSummary is application accounting, deliberately separate from Cloudflare's bill.
type UsageSummary struct {
	Known     float64 `json:"knownNeurons"`
	Estimated float64 `json:"estimatedNeurons"`
	InFlight  float64 `json:"inFlightNeurons"`
	Unknown   float64 `json:"unknownNeurons"`
	Day       string  `json:"day"`
	Scope     string  `json:"scope"`
}

// Blocker explains an independent background constraint without hiding other counts.
type Blocker struct {
	Code  string `json:"code"`
	Until int64  `json:"until"`
}

func (s *Service) workFilter(ctx context.Context, owner int32, profile string) (*store.FindGraphSource, error) {
	p, err := journal.GetPreferences(ctx, s.Store, owner)
	if err != nil {
		return nil, err
	}
	return &store.FindGraphSource{OwnerID: owner, ReadableOnly: true, ExcludedUIDs: excludedUIDs(p), ExcludeRepresentation: true, CurrentProfile: profile, Now: s.now().Unix(), Limit: 21}, nil
}

// Job exposes the current original's first line and safe background metadata to its owner.
type Job struct {
	Name          string   `json:"name"`
	Preview       string   `json:"preview"`
	Tags          []string `json:"tags"`
	CreatedTs     int64    `json:"createdTs"`
	Revision      int64    `json:"revision"`
	StatusVersion int64    `json:"statusVersion"`
	State         string   `json:"state"`
	Stage         string   `json:"stage"`
	ErrorCode     string   `json:"errorCode,omitempty"`
	Attempts      int      `json:"attempts"`
	LastAttemptTs int64    `json:"lastAttemptTs"`
	NextAttemptTs int64    `json:"nextAttemptTs"`
	CanRetry      bool     `json:"canRetry"`
}

// JobsPage is bounded independently of the semantic index or inference worker.
type JobsPage struct {
	Jobs      []Job `json:"jobs"`
	NextAfter int32 `json:"nextAfter"`
}

func jobState(row *store.GraphSource, profile string, now int64) string {
	if !row.Dirty && row.State == "ready" && row.ProcessedRevision == row.Revision && row.Profile == profile {
		return "ready"
	}
	if row.Dirty && row.LeaseUntil > now {
		return "processing"
	}
	if row.Dirty && row.NextAttemptTs > now {
		switch row.State {
		case "quota-paused":
			return "quota"
		case "failed":
			return "attention"
		case "retrying":
			return "retry-wait"
		}
	}
	return "queued"
}

// Jobs reads a bounded page without warming the vector index, acquiring the worker lock or calling a model.
func (s *Service) Jobs(ctx context.Context, owner int32, state string, after int32) (JobsPage, error) {
	result := JobsPage{Jobs: []Job{}}
	if after < 0 {
		return result, errors.New("invalid job cursor")
	}
	switch state {
	case "", "ready", "preparing", "quota", "attention":
	default:
		return result, errors.New("invalid job filter")
	}
	c, err := s.GetConfig(ctx, owner)
	if err != nil {
		return result, err
	}
	p, providerErr := s.provider(ctx, c)
	profile := ""
	if providerErr == nil {
		profile = modelProfile(c, p)
	}
	f, err := s.workFilter(ctx, owner, profile)
	if err != nil {
		return result, err
	}
	f.WorkState = state
	f.AfterID = after
	rows, err := s.Store.ListGraphSources(ctx, f)
	if err != nil {
		return result, err
	}
	if len(rows) > 20 {
		rows = rows[:20]
		result.NextAfter = rows[19].MemoID
	}
	ids := []int32{}
	for _, row := range rows {
		ids = append(ids, row.MemoID)
	}
	memos, err := s.readable(ctx, owner, ids)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		memo := memos[row.MemoID]
		if memo == nil {
			continue
		}
		preview := []rune(strings.TrimSpace(strings.SplitN(memo.Content, "\n", 2)[0]))
		if len(preview) > 160 {
			preview = append(preview[:160], '…')
		}
		work := jobState(row, profile, f.Now)
		job := Job{Name: "memos/" + memo.UID, Preview: string(preview), Tags: memo.Payload.GetTags(), CreatedTs: memo.CreatedTs, Revision: row.Revision, StatusVersion: row.StatusVersion, State: work, Stage: row.Stage, ErrorCode: row.ErrorCode, Attempts: row.Attempts, LastAttemptTs: row.LastAttemptTs, NextAttemptTs: row.NextAttemptTs}
		job.CanRetry = (work == "attention" || work == "retry-wait") && row.ErrorCode != "configuration"
		if work == "queued" && row.NextAttemptTs == 0 && row.ErrorCode != "legacy-unknown" {
			job.ErrorCode = ""
		}
		if job.NextAttemptTs == 253402300799 {
			job.NextAttemptTs = 0
		}
		result.Jobs = append(result.Jobs, job)
	}
	return result, nil
}

func (s *Service) workMemo(ctx context.Context, owner int32, name string) (*store.Memo, error) {
	if !strings.HasPrefix(name, "memos/") || len(name) > 128 {
		return nil, errors.New("invalid record name")
	}
	uid := strings.TrimPrefix(name, "memos/")
	m, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, CreatorID: &owner})
	if err != nil || m == nil {
		return nil, err
	}
	readable, err := s.readable(ctx, owner, []int32{m.ID})
	return readable[m.ID], err
}

// AttemptsPage contains no prompts, vectors, raw model text or credentials.
type AttemptsPage struct {
	Attempts   []*store.GraphCall `json:"attempts"`
	NextCursor string             `json:"nextCursor"`
}

// Attempts checks current readability before returning any diagnostic history.
func (s *Service) Attempts(ctx context.Context, owner int32, name, cursor string) (AttemptsPage, error) {
	result := AttemptsPage{Attempts: []*store.GraphCall{}}
	memo, err := s.workMemo(ctx, owner, name)
	if err != nil || memo == nil {
		return result, err
	}
	var before store.GraphCallCursor
	if cursor != "" {
		b, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil || len(b) > 256 || json.Unmarshal(b, &before) != nil || before.Time <= 0 || len(before.ID) > 64 {
			return result, errors.New("invalid attempt cursor")
		}
	}
	rows, err := s.Store.ListGraphCalls(ctx, owner, memo.ID, before, 21)
	if err != nil {
		return result, err
	}
	if len(rows) > 20 {
		rows = rows[:20]
		last := rows[19]
		b, _ := json.Marshal(store.GraphCallCursor{Time: last.StartedTs, ID: last.ID})
		result.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	result.Attempts = rows
	return result, nil
}

// RetryRequest selects one captured job or a bounded snapshot of attention jobs.
type RetryRequest struct {
	RequestID     string `json:"requestId"`
	Name          string `json:"name"`
	Revision      int64  `json:"revision"`
	StatusVersion int64  `json:"statusVersion"`
}

// Retry never rebuilds the whole graph or changes processing consent and budgets.
func (s *Service) Retry(ctx context.Context, owner int32, input RetryRequest) (*store.GraphRetry, error) {
	if len(input.RequestID) < 8 || len(input.RequestID) > 64 {
		return nil, errors.New("invalid retry request identifier")
	}
	body, _ := json.Marshal(input)
	hash := digest(string(body))
	previous, err := s.Store.GetGraphRetry(ctx, owner, input.RequestID)
	if err != nil {
		return nil, err
	}
	if previous != nil {
		if previous.InputHash != hash {
			return nil, store.ErrGraphConflict
		}
		return previous, nil
	}
	epoch, err := s.Store.GraphEpoch(ctx, owner)
	if err != nil {
		return nil, err
	}
	f, err := s.workFilter(ctx, owner, "")
	if err != nil {
		return nil, err
	}
	f.Limit = 256
	f.WorkState = "attention"
	if input.Name != "" {
		m, e := s.workMemo(ctx, owner, input.Name)
		if e != nil {
			return nil, e
		}
		if m == nil {
			return nil, store.ErrGraphConflict
		}
		f.WorkState = ""
		f.MemoIDs = []int32{m.ID}
		f.Limit = 1
	}
	rows, err := s.Store.ListGraphSources(ctx, f)
	if err != nil {
		return nil, err
	}
	receipt := &store.GraphRetry{OwnerID: owner, ID: input.RequestID, InputHash: hash, Epoch: epoch, Now: s.now().Unix(), More: len(rows) == 256}
	if receipt.More {
		rows = rows[:255]
	}
	for _, row := range rows {
		if input.Name != "" && (row.Revision != input.Revision || row.StatusVersion != input.StatusVersion) {
			return nil, store.ErrGraphConflict
		}
		if row.ErrorCode == "configuration" {
			receipt.Skipped++
			continue
		}
		receipt.Targets = append(receipt.Targets, store.GraphRetryTarget{MemoID: row.MemoID, Revision: row.Revision, StatusVersion: row.StatusVersion})
	}
	return s.Store.RetryGraphSources(ctx, receipt)
}
