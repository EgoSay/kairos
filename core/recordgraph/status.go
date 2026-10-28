package recordgraph

import (
	"context"

	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

// Status keeps legacy reading fields while exposing disjoint work counts and honest accounting.
type Status struct {
	State                 string              `json:"state"`
	Counts                store.GraphCounts   `json:"counts"`
	Progress              store.GraphProgress `json:"progress"`
	Epoch                 int64               `json:"epoch"`
	Profile               string              `json:"profile"`
	ReservedNeurons       float64             `json:"reservedNeurons"`
	DailyNeurons          int64               `json:"dailyNeurons"`
	CloudflareFreeNeurons int64               `json:"cloudflareFreeNeurons"`
	ResetAt               int64               `json:"resetAt"`
	UpdatedTs             int64               `json:"updatedTs"`
	Usage                 UsageSummary        `json:"usage"`
	Blockers              []Blocker           `json:"blockers"`
	Error                 string              `json:"error,omitempty"`
	Baseline              *ComparisonBaseline `json:"baseline,omitempty"`
}

// Status reads metadata only and never acquires the inference worker's mutex.
func (s *Service) Status(ctx context.Context, owner int32) (Status, error) {
	now := s.now()
	result := Status{State: "unconfigured", ResetAt: nextDay(now), UpdatedTs: now.Unix(), DailyNeurons: 8000, CloudflareFreeNeurons: 10000, Blockers: []Blocker{}, Usage: UsageSummary{Day: now.UTC().Format("2006-01-02"), Scope: "application-account"}}
	c, err := s.GetConfig(ctx, owner)
	if err != nil {
		return result, err
	}
	result.DailyNeurons = c.DailyNeurons
	maintenance, err := s.maintenance(ctx, owner)
	if err != nil {
		return result, err
	}
	result.Baseline = maintenance.Baseline
	result.Epoch, err = s.Store.GraphEpoch(ctx, owner)
	if err != nil {
		return result, err
	}
	p, configErr := s.provider(ctx, c)
	if configErr == nil {
		result.Profile = modelProfile(c, p)
		_, configErr = association.New(p)
	}
	result.Counts, err = s.Store.CountGraphSources(ctx, owner, result.Profile)
	if err != nil {
		return result, err
	}
	f, err := s.workFilter(ctx, owner, result.Profile)
	if err != nil {
		return result, err
	}
	result.Progress, err = s.Store.CountGraphProgress(ctx, f)
	if err != nil {
		return result, err
	}
	if c.ProviderID == "" {
		return result, nil
	}
	if configErr != nil {
		result.State = "configuration-error"
		result.Error = "Cloudflare 服务配置不可用"
		return result, nil //nolint:nilerr // Configuration is a readable state.
	}
	u, err := s.Store.ReadGraphUsage(ctx, digest(p.Endpoint), result.Usage.Day, now.Unix())
	if err != nil {
		return result, err
	}
	neurons := func(units int64) float64 { return float64(units) / float64(store.GraphNeuronUnits) }
	result.ReservedNeurons = neurons(u.Total)
	result.Usage.Known = neurons(u.Known)
	result.Usage.Estimated = neurons(u.Estimated)
	result.Usage.InFlight = neurons(u.InFlight)
	result.Usage.Unknown = neurons(u.Unknown)
	result.State = "ready"
	if result.Progress.Preparing > 0 {
		result.State = "preparing"
	}
	if result.Progress.Attention > 0 {
		result.State = "delayed"
	}
	if result.Progress.Quota > 0 || u.Total >= c.DailyNeurons*store.GraphNeuronUnits {
		result.Blockers = append(result.Blockers, Blocker{Code: "daily-budget", Until: result.ResetAt})
		if result.Progress.Preparing == 0 || u.Total >= c.DailyNeurons*store.GraphNeuronUnits {
			result.State = "quota-paused"
		}
	}
	runtime, err := s.Store.GetGraphRuntime(ctx, connectionKey(p))
	if err != nil {
		return result, err
	}
	if runtime.Until > now.Unix() {
		result.Blockers = append(result.Blockers, Blocker{Code: runtime.Code, Until: runtime.Until})
		switch runtime.Code {
		case "configuration":
			result.State = "configuration-error"
		case "cloudflare-daily-quota":
			result.State = "quota-paused"
		default:
			result.State = "connection-wait"
		}
	}
	quota, err := s.Store.GetGraphRuntime(ctx, quotaKey(p))
	if err != nil {
		return result, err
	}
	if quota.Until > now.Unix() {
		result.State = "quota-paused"
		result.Blockers = append(result.Blockers, Blocker{Code: quota.Code, Until: quota.Until})
	}
	if !c.Enabled || !c.FreePlanConfirmed || maintenance.Paused {
		result.State = "paused"
	}
	return result, nil
}
