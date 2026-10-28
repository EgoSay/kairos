package recordgraph

import (
	"context"
	"math/rand/v2"
	"time"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

type failure struct {
	kind, code string
	retryAfter time.Duration
}

func classify(err error) failure {
	if err == nil {
		return failure{}
	}
	if errors.Is(err, errQuota) {
		return failure{kind: "quota", code: "daily-budget"}
	}
	if errors.Is(err, store.ErrGraphConflict) {
		return failure{kind: "changed", code: "source-changed"}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return failure{kind: "cancelled", code: "cancelled"}
	}
	var result *association.ResultError
	if errors.As(err, &result) {
		return failure{kind: "result", code: result.Code}
	}
	var remote *association.ServiceError
	if errors.As(err, &remote) {
		if remote.Code == 3036 {
			return failure{kind: "provider-quota", code: "cloudflare-daily-quota"}
		}
		if remote.Kind == "connection" || remote.Status == 0 || remote.Status == 408 || remote.Status == 429 || remote.Status >= 500 {
			return failure{kind: "connection", code: "connection", retryAfter: remote.RetryAfter}
		}
		return failure{kind: "configuration", code: "configuration"}
	}
	return failure{kind: "internal", code: "internal"}
}

func (s *Service) deferFailure(source *store.GraphSource, err error) {
	f := classify(err)
	now := s.now()
	source.UpdatedTs = now.Unix()
	source.State = "retrying"
	source.ErrorCode = f.code
	switch f.kind {
	case "quota", "provider-quota":
		source.State = "quota-paused"
		source.NextAttemptTs = nextDay(now)
		return
	case "changed", "cancelled":
		source.NextAttemptTs = now.Add(5 * time.Second).Unix()
		return
	case "configuration":
		source.State = "failed"
		source.NextAttemptTs = 253402300799
		return
	}
	// Connection outages must not consume the bounded result-validation retries
	// when a provider eventually responds at this same processing stage.
	failureGroup := source.Stage + ":" + f.kind
	if source.FailureStage != failureGroup {
		source.Attempts = 0
		source.FailureStage = failureGroup
	}
	source.Attempts++
	if f.kind == "connection" {
		delay := []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 6 * time.Hour}[min(source.Attempts-1, 3)]
		delay += time.Duration(rand.Int64N(int64(delay/10) + 1))
		delay = max(delay, min(f.retryAfter, 24*time.Hour))
		source.NextAttemptTs = now.Add(delay).Unix()
		return
	}
	if source.Attempts >= 3 {
		source.State = "failed"
		source.NextAttemptTs = 253402300799
		return
	}
	delay := time.Minute
	if source.Attempts == 2 {
		delay = 10 * time.Minute
	}
	source.NextAttemptTs = now.Add(delay).Unix()
}

func (s *Service) checkpoint(ctx context.Context, source *store.GraphSource, r representation, stage string) error {
	if source.Stage != stage {
		source.Attempts = 0
		source.FailureStage = ""
	}
	source.Stage = stage
	source.UpdatedTs = s.now().Unix()
	source.LeaseUntil = s.now().Add(15 * time.Minute).Unix()
	var err error
	source.Representation, err = encodeRepresentation(r)
	if err != nil {
		return err
	}
	return s.Store.SaveGraphProgress(ctx, source)
}
