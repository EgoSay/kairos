package recordgraph

import (
	"context"
	"time"
	"uuid"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/provider/ai"
	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

// Model prices are Neurons per million tokens; in micro-Neurons each token costs this integer.
const embeddingRate int64 = 1075
const chatInputRate int64 = 4625
const chatOutputRate int64 = 30475

func reservation(inputBytes, batch int, chat bool) int64 {
	if chat {
		return int64(2*inputBytes+8192)*chatInputRate + 2400*chatOutputRate
	}
	// UTF-8 byte budget plus room for per-input model framing. This is an estimate,
	// never a reported tokenizer count. Chat's system prompt/output allowance is not used here.
	return int64(2*inputBytes+128*max(1, batch)) * embeddingRate
}

func connectionKey(p ai.ProviderConfig) string { return digest(p.Endpoint + "\x00" + p.APIKey) }

func quotaKey(p ai.ProviderConfig) string { return digest("account-quota|" + p.Endpoint) }

// billed persists an identity before calling, then settles usage regardless of result validity.
func (s *Service) billed(ctx context.Context, source *store.GraphSource, p ai.ProviderConfig, c Config, inputBytes, batch int, chat bool, call func() (association.Usage, error)) error {
	now := s.now()
	entry := &store.GraphCall{ID: uuid.New().String(), OwnerID: source.OwnerID, MemoID: source.MemoID, Revision: source.Revision, Stage: source.Stage, Account: digest(p.Endpoint), Day: now.UTC().Format("2006-01-02"), Reserved: reservation(inputBytes, batch, chat), StartedTs: now.UnixMilli()}
	ok, err := s.Store.BeginGraphCall(ctx, entry, c.DailyNeurons*store.GraphNeuronUnits)
	if err != nil {
		return err
	}
	if !ok {
		return errQuota
	}
	source.LastAttemptTs = now.Unix()
	usage, callErr := call()
	entry.Charged = entry.Reserved
	entry.UsageKind = "unknown"
	entry.Outcome = "succeeded"
	entry.InputTokens = usage.Input
	entry.OutputTokens = usage.Output
	entry.RequestID = usage.RequestID
	entry.HTTPStatus = usage.HTTPStatus
	entry.FinishedTs = s.now().UnixMilli()
	if usage.InputKnown && (!chat || usage.OutputKnown) {
		entry.UsageKind = "known"
		entry.Charged = usage.Input * embeddingRate
		if chat {
			entry.Charged = usage.Input*chatInputRate + usage.Output*chatOutputRate
		}
	} else if callErr == nil && !chat {
		// A completed embedding without token usage retains the conservative input estimate.
		entry.UsageKind = "estimated"
	}
	f := classify(callErr)
	if callErr != nil {
		entry.Outcome = "failed"
		entry.ErrorCode = f.code
	}
	var remote *association.ServiceError
	if errors.As(callErr, &remote) {
		entry.HTTPStatus = remote.Status
		entry.ProviderCode = remote.Code
		entry.RequestID = remote.RequestID
	}
	// A caller cancellation must not drop accounting evidence already received.
	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err = s.Store.SettleGraphCall(settleCtx, entry); err != nil {
		return errors.Wrap(err, "settle graph call")
	}
	if err = s.updateCircuit(settleCtx, p, f); err != nil {
		return err
	}
	return callErr
}

func (s *Service) updateCircuit(ctx context.Context, p ai.ProviderConfig, f failure) error {
	if f.kind == "provider-quota" {
		return s.Store.PutGraphRuntime(ctx, store.GraphRuntime{Key: quotaKey(p), Code: "cloudflare-daily-quota", Until: nextDay(s.now())})
	}
	key := connectionKey(p)
	v, err := s.Store.GetGraphRuntime(ctx, key)
	if err != nil {
		return err
	}
	switch f.kind {
	case "connection":
		v.Failures++
		if v.Failures >= 3 {
			delay := []time.Duration{30 * time.Minute, 2 * time.Hour, 6 * time.Hour}[min(v.Trips, 2)]
			v.Trips++
			v.Until = s.now().Add(delay).Unix()
			v.Code = "connection"
		}
	case "configuration":
		v.Code = "configuration"
		v.Until = 253402300799
	case "cancelled":
		return nil
	default:
		// A complete response, including a rejected model result, proves connectivity.
		v.Failures = 0
		v.Trips = 0
		v.Until = 0
		v.Code = ""
	}
	return s.Store.PutGraphRuntime(ctx, v)
}
