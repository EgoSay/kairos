package recordgraph

import (
	"context"
	"encoding/json"
)

// ComparisonBaseline identifies an explicit operator reset; it is never Cloudflare usage telemetry.
type ComparisonBaseline struct {
	ResetAt             int64    `json:"resetAt"`
	ProviderNeurons     *float64 `json:"providerNeurons,omitempty"`
	ProviderObservedAt  int64    `json:"providerObservedAt,omitempty"`
	ProviderApproximate bool     `json:"providerApproximate,omitempty"`
}

type maintenance struct {
	Paused   bool                `json:"paused"`
	Baseline *ComparisonBaseline `json:"baseline,omitempty"`
}

// This operational document does not use wander-config, whose trigger invalidates the entire graph.
func (s *Service) maintenance(ctx context.Context, owner int32) (maintenance, error) {
	var value maintenance
	doc, err := s.Store.GetJournalDocument(ctx, owner, "wander-maintenance", "main")
	if err != nil || doc == nil {
		return value, err
	}
	err = json.Unmarshal(doc.Payload, &value)
	return value, err
}
