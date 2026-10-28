package recordgraph

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/provider/ai"
	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

func workSource(t *testing.T, s *Service, owner, id int32) *store.GraphSource {
	t.Helper()
	rows, err := s.Store.ListGraphSources(context.Background(), &store.FindGraphSource{OwnerID: owner, MemoIDs: []int32{id}, Limit: 1})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	return rows[0]
}

func TestBillingSettlesFailedResponsesZeroAndFractionalUsage(t *testing.T) {
	ctx := context.Background()
	s, _, owner := fixture(t)
	memo := add(t, s, owner, "accounting-fixture", "fictional")
	c, err := s.GetConfig(ctx, owner)
	require.NoError(t, err)
	p, err := s.provider(ctx, c)
	require.NoError(t, err)
	source := workSource(t, s, owner, memo.ID)
	source.Stage = "facets"
	resultErr := association.InvalidResult("quote-mismatch")
	err = s.billed(ctx, source, p, c, 1000, 1, true, func() (association.Usage, error) {
		return association.Usage{Input: 100, Output: 10, InputKnown: true, OutputKnown: true}, resultErr
	})
	require.ErrorIs(t, err, resultErr)
	day := s.now().UTC().Format("2006-01-02")
	u, err := s.Store.ReadGraphUsage(ctx, digest(p.Endpoint), day, s.now().Unix())
	require.NoError(t, err)
	require.EqualValues(t, 767250, u.Total)
	require.Equal(t, u.Total, u.Known)
	require.Zero(t, u.Unknown)
	before := u.Total
	require.NoError(t, s.billed(ctx, source, p, c, 100, 1, true, func() (association.Usage, error) { return association.Usage{InputKnown: true, OutputKnown: true}, nil }))
	u, err = s.Store.ReadGraphUsage(ctx, digest(p.Endpoint), day, s.now().Unix())
	require.NoError(t, err)
	require.Equal(t, before, u.Total, "explicit zero usage must release the reservation")
	for range 100 {
		require.NoError(t, s.billed(ctx, source, p, c, 100, 1, false, func() (association.Usage, error) { return association.Usage{Input: 100, InputKnown: true}, nil }))
	}
	u, err = s.Store.ReadGraphUsage(ctx, digest(p.Endpoint), day, s.now().Unix())
	require.NoError(t, err)
	require.EqualValues(t, 10_750_000, u.Total-before, "100 small calls cost 10.75 Neurons, not 100")
	before = u.Total
	require.NoError(t, s.billed(ctx, source, p, c, 100, 1, false, func() (association.Usage, error) { return association.Usage{}, nil }))
	u, err = s.Store.ReadGraphUsage(ctx, digest(p.Endpoint), day, s.now().Unix())
	require.NoError(t, err)
	require.EqualValues(t, reservation(100, 1, false), u.Estimated)
	require.Greater(t, u.Total, before, "absent usage is not zero")
	page, err := s.Attempts(ctx, owner, "memos/"+memo.UID, "")
	require.NoError(t, err)
	require.Len(t, page.Attempts, 20)
	require.NotEmpty(t, page.NextCursor)
	seen := map[string]bool{}
	for {
		for _, a := range page.Attempts {
			require.False(t, seen[a.ID])
			seen[a.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		page, err = s.Attempts(ctx, owner, "memos/"+memo.UID, page.NextCursor)
		require.NoError(t, err)
	}
	require.Len(t, seen, 103, "same-millisecond receipts must not disappear between pages")
}

func TestQuotaWaitDoesNotSpendFailureAttemptsAndReportsInsufficientRemainder(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	memo := add(t, s, owner, "quota-fixture", "虚构短记录")
	c, _ := s.GetConfig(ctx, owner)
	p, _ := s.provider(ctx, c)
	ok, err := s.Store.ReserveGraphBudget(ctx, digest(p.Endpoint), s.now().UTC().Format("2006-01-02"), 8000*store.GraphNeuronUnits-1, 8000*store.GraphNeuronUnits)
	require.NoError(t, err)
	require.True(t, ok)
	_, err = s.RunOnce(ctx)
	require.NoError(t, err)
	require.Zero(t, m.calls)
	row := workSource(t, s, owner, memo.ID)
	require.Equal(t, "quota-paused", row.State)
	require.Zero(t, row.Attempts)
	state, err := s.Status(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, "quota-paused", state.State)
	require.Less(t, state.ReservedNeurons, float64(state.DailyNeurons))
	require.Equal(t, 1, state.Progress.Quota)
}

func TestInvalidResultsStopAfterThreeStageFailuresAndRetryIsIdempotent(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	memo := add(t, s, owner, "bad-schema", "虚构待处理记录")
	now := time.Date(2026, 10, 28, 1, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	m.facetError = association.InvalidResult("result-schema")
	for attempt := 1; attempt <= 3; attempt++ {
		_, err := s.RunOnce(ctx)
		require.NoError(t, err)
		row := workSource(t, s, owner, memo.ID)
		require.Equal(t, attempt, row.Attempts)
		require.Equal(t, "facets", row.Stage)
		if attempt < 3 {
			require.Equal(t, "retrying", row.State)
			now = time.Unix(row.NextAttemptTs+1, 0)
		} else {
			require.Equal(t, "failed", row.State)
		}
	}
	require.Equal(t, 4, m.calls, "reuse the completed embedding for both retries")
	jobs, err := s.Jobs(ctx, owner, "attention", 0)
	require.NoError(t, err)
	require.Len(t, jobs.Jobs, 1)
	job := jobs.Jobs[0]
	input := RetryRequest{RequestID: "request-retry-123", Name: job.Name, Revision: job.Revision, StatusVersion: job.StatusVersion}
	configBefore, err := s.GetConfig(ctx, owner)
	require.NoError(t, err)
	receipt, err := s.Retry(ctx, owner, input)
	require.NoError(t, err)
	require.Equal(t, 1, receipt.Accepted)
	duplicate, err := s.Retry(ctx, owner, input)
	require.NoError(t, err)
	require.Equal(t, receipt.Accepted, duplicate.Accepted)
	configAfter, err := s.GetConfig(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, configBefore, configAfter)
	m.facetError = nil
	run(t, s)
	require.Equal(t, 5, m.calls)
	input.RequestID = "different-request"
	_, err = s.Retry(ctx, owner, input)
	require.ErrorIs(t, err, store.ErrGraphConflict, "late clicks cannot rewind newer ready work")
}

func TestConnectionCircuitSurvivesRestartAndNeverCreatesInvalidResultFailures(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	for _, id := range []string{"one", "two", "three", "four"} {
		add(t, s, owner, id, "虚构记录")
	}
	now := time.Date(2026, 10, 28, 1, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	m.embedError = &association.ServiceError{Kind: "connection"}
	for range 3 {
		_, err := s.RunOnce(ctx)
		require.NoError(t, err)
	}
	require.Equal(t, 3, m.calls)
	fresh := New(s.Store)
	fresh.NewModel = s.NewModel
	fresh.Now = s.Now
	_, err := fresh.RunOnce(ctx)
	require.NoError(t, err)
	require.Equal(t, 3, m.calls)
	status, err := fresh.Status(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, "connection-wait", status.State)
	require.Zero(t, status.Progress.Attention)
	now = time.Unix(status.Blockers[0].Until+1, 0)
	m.embedError = nil
	run(t, fresh)
	status, err = fresh.Status(ctx, owner)
	require.NoError(t, err)
	require.NotEqual(t, "connection-wait", status.State)
}

func TestConnectionFailuresDoNotConsumeResultValidationRetries(t *testing.T) {
	ctx := context.Background()
	s, model, owner := fixture(t)
	memo := add(t, s, owner, "connection-then-result", "虚构记录")
	now := time.Date(2026, 10, 28, 1, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	model.embedError = &association.ServiceError{Kind: "connection"}
	for range 2 {
		_, err := s.RunOnce(ctx)
		require.NoError(t, err)
		now = time.Unix(workSource(t, s, owner, memo.ID).NextAttemptTs+1, 0)
	}
	model.embedError = association.InvalidResult("embedding-dimensions")
	_, err := s.RunOnce(ctx)
	require.NoError(t, err)
	row := workSource(t, s, owner, memo.ID)
	require.Equal(t, "retrying", row.State)
	require.Equal(t, 1, row.Attempts, "the first actual invalid result still has two validation retries left")
}

func TestProgressReadsDoNotWaitForInferenceAndRespectExclusions(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	memo := add(t, s, owner, "shown", "可读的虚构记录")
	add(t, s, owner, "excluded", "不可出现在明细")
	_, err := s.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "preferences", Key: "main", Payload: json.RawMessage(`{"excludedMemoNames":["memos/excluded"]}`)}, 0)
	require.NoError(t, err)
	s.mu.Lock()
	defer s.mu.Unlock()
	bounded, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	status, err := s.Status(bounded, owner)
	require.NoError(t, err)
	require.Equal(t, 1, status.Progress.Total)
	require.Equal(t, 1, status.Progress.Excluded)
	require.Equal(t, status.Progress.Total, status.Progress.Ready+status.Progress.Preparing+status.Progress.Quota+status.Progress.Attention)
	jobs, err := s.Jobs(bounded, owner, "preparing", 0)
	require.NoError(t, err)
	require.Len(t, jobs.Jobs, 1)
	require.Equal(t, "memos/"+memo.UID, jobs.Jobs[0].Name)
	require.Zero(t, m.calls)
	require.Nil(t, s.index)
	history, err := s.Attempts(bounded, owner, "memos/excluded", "")
	require.NoError(t, err)
	require.Empty(t, history.Attempts)
}

func TestUnknownAndCancellationFailuresAreNotResultErrors(t *testing.T) {
	require.Equal(t, "internal", classify(errors.New("PRIVATE_INTERNAL_DETAIL")).code)
	require.Equal(t, "cancelled", classify(context.Canceled).kind)
	s, _, owner := fixture(t)
	row := &store.GraphSource{OwnerID: owner, Stage: "relations", Attempts: 2, FailureStage: "relations"}
	s.deferFailure(row, context.Canceled)
	require.Equal(t, 2, row.Attempts)
	require.NotEqual(t, "failed", row.State)
	require.False(t, strings.Contains(classify(errors.New("PRIVATE_INTERNAL_DETAIL")).code, "PRIVATE"))
}

func TestMaintenancePausePreservesGraphAndPreventsNewAccounting(t *testing.T) {
	ctx := context.Background()
	s, m, owner := fixture(t)
	add(t, s, owner, "pause-fixture", "虚构的维护测试")
	epoch, err := s.Store.GraphEpoch(ctx, owner)
	require.NoError(t, err)
	_, err = s.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "wander-maintenance", Key: "main", Payload: json.RawMessage(`{"paused":true,"baseline":{"resetAt":12345}}`)}, 0)
	require.NoError(t, err)
	current, err := s.Store.GraphEpoch(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, epoch, current, "operational pause must not invalidate prepared notes")
	changed, err := s.RunOnce(ctx)
	require.NoError(t, err)
	require.False(t, changed)
	require.Zero(t, m.calls)
	state, err := s.Status(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, "paused", state.State)
	require.EqualValues(t, 12345, state.Baseline.ResetAt)
	require.Zero(t, state.ReservedNeurons)
}

func TestPublicationFailureReusesValidatedRelations(t *testing.T) {
	ctx := context.Background()
	s, model, owner := fixture(t)
	add(t, s, owner, "publication-one", "虚构的陪伴记录")
	memo := add(t, s, owner, "publication-two", "另一段虚构的陪伴记录")
	run(t, s)
	db := s.Store.GetDriver().GetDB()
	_, err := db.ExecContext(ctx, `CREATE TRIGGER reject_test_publication BEFORE UPDATE ON record_graph_source WHEN NEW.dirty=0 BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END`)
	require.NoError(t, err)
	_, err = s.RunOnce(ctx)
	require.NoError(t, err)
	row := workSource(t, s, owner, memo.ID)
	require.Equal(t, "retrying", row.State)
	require.Equal(t, "publish", row.Stage)
	representation, err := decodeRepresentation(row.Representation)
	require.NoError(t, err)
	require.NotNil(t, representation.Publication)
	require.Len(t, representation.Publication.Edges, 1)
	calls := model.calls
	_, err = db.ExecContext(ctx, "DROP TRIGGER reject_test_publication")
	require.NoError(t, err)
	s.Now = func() time.Time { return time.Unix(row.NextAttemptTs+1, 0) }
	run(t, s)
	require.Equal(t, calls, model.calls, "a storage retry must not call the model or charge again")
	neighborhood, err := s.Neighborhood(ctx, owner, memo.ID)
	require.NoError(t, err)
	require.Len(t, neighborhood.Directions, 1)
}

func TestVendorDailyQuotaIsSharedAcrossCredentialsWithoutInventingUsage(t *testing.T) {
	ctx := context.Background()
	s, model, owner := fixture(t)
	add(t, s, owner, "provider-quota", "虚构记录")
	c, err := s.GetConfig(ctx, owner)
	require.NoError(t, err)
	p, err := s.provider(ctx, c)
	require.NoError(t, err)
	anotherCredential := ai.ProviderConfig{Endpoint: p.Endpoint, APIKey: "another-synthetic-token"}
	require.NotEqual(t, connectionKey(p), connectionKey(anotherCredential))
	require.Equal(t, quotaKey(p), quotaKey(anotherCredential))
	require.NoError(t, s.updateCircuit(ctx, anotherCredential, failure{kind: "provider-quota"}))
	_, err = s.RunOnce(ctx)
	require.NoError(t, err)
	require.Zero(t, model.calls)
	state, err := s.Status(ctx, owner)
	require.NoError(t, err)
	require.Equal(t, "quota-paused", state.State)
	require.Zero(t, state.ReservedNeurons, "a vendor quota response is not an 8000-Neuron application charge")
}
