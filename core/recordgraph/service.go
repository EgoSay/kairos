// Package recordgraph prepares evidence-bound associations for immediate original reading.
package recordgraph

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/provider/ai"
	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

const profileVersion = "qwen3-1024:chunks-v1:concerns-v1:evidence-v1"

// Config authorizes automatic processing once, outside the everyday reading flow.
type Config struct {
	ProviderID        string `json:"providerId"`
	Enabled           bool   `json:"enabled"`
	FreePlanConfirmed bool   `json:"freePlanConfirmed"`
	DailyNeurons      int64  `json:"dailyNeurons"`
	Version           int64  `json:"version"`
}

// Model is the only external semantic service used by background work.
type Model interface {
	Embed(context.Context, []string) ([][]float32, association.Usage, error)
	Facets(context.Context, association.Source) ([]association.Facet, association.Usage, error)
	Relate(context.Context, association.Source, []association.Source) ([]association.Relation, association.Usage, error)
}

// Service owns bounded index memory and persistence rules; readers never use Model.
type Service struct {
	Store    *store.Store
	NewModel func(ai.ProviderConfig) (Model, error)
	mu       sync.Mutex
	index    *semanticIndex
}

// New creates a graph service with a strict Cloudflare adapter.
func New(s *store.Store) *Service {
	return &Service{Store: s, NewModel: func(p ai.ProviderConfig) (Model, error) { return association.New(p) }}
}

// GetConfig reads owner intent without assuming a model has already been configured.
func (s *Service) GetConfig(ctx context.Context, owner int32) (Config, error) {
	c := Config{DailyNeurons: 8000}
	doc, err := s.Store.GetJournalDocument(ctx, owner, "wander-config", "main")
	if err != nil {
		return c, err
	}
	if doc != nil {
		if err = json.Unmarshal(doc.Payload, &c); err != nil {
			return c, err
		}
		c.Version = doc.Version
	}
	return c, nil
}

// Configure validates the service and records explicit background-processing intent.
func (s *Service) Configure(ctx context.Context, owner int32, c Config) (Config, error) {
	if c.DailyNeurons < 100 || c.DailyNeurons > 9000 {
		return c, errors.New("每日应用预算需要在 100 至 9000 Neurons 之间")
	}
	if c.Enabled {
		if !c.FreePlanConfirmed {
			return c, errors.New("请先确认 Cloudflare Workers Free 计划；付费账户超额可能计费")
		}
		provider, err := s.provider(ctx, c)
		if err != nil {
			return c, err
		}
		if _, err = s.NewModel(provider); err != nil {
			return c, err
		}
	}
	data, err := json.Marshal(c)
	if err != nil {
		return c, err
	}
	doc, err := s.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "wander-config", Key: "main", Payload: data}, c.Version)
	if err == nil {
		c.Version = doc.Version
	}
	return c, err
}

func (s *Service) provider(ctx context.Context, c Config) (ai.ProviderConfig, error) {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return ai.ProviderConfig{}, err
	}
	for _, p := range setting.GetProviders() {
		if p.GetId() == c.ProviderID {
			return ai.ProviderConfig{ID: p.GetId(), Endpoint: p.GetEndpoint(), APIKey: p.GetApiKey(), Type: ai.ProviderOpenAI}, nil
		}
	}
	return ai.ProviderConfig{}, errors.New("请先配置 Cloudflare Workers AI 服务")
}

func modelProfile(c Config, p ai.ProviderConfig) string {
	return digest(profileVersion + "|" + c.ProviderID + "|" + p.Endpoint)
}
func digest(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// Status describes preparation independently from the ability to read existing originals.
type Status struct {
	State           string            `json:"state"`
	Counts          store.GraphCounts `json:"counts"`
	Epoch           int64             `json:"epoch"`
	Profile         string            `json:"profile"`
	ReservedNeurons int64             `json:"reservedNeurons"`
	DailyNeurons    int64             `json:"dailyNeurons"`
	ResetAt         int64             `json:"resetAt"`
	Error           string            `json:"error,omitempty"`
}

// Status reads preparation metadata without invoking a model.
func (s *Service) Status(ctx context.Context, owner int32) (Status, error) {
	result := Status{State: "unconfigured", ResetAt: nextDay(time.Now()), DailyNeurons: 8000}
	c, err := s.GetConfig(ctx, owner)
	if err != nil {
		return result, err
	}
	result.DailyNeurons = c.DailyNeurons
	result.Epoch, err = s.Store.GraphEpoch(ctx, owner)
	if err != nil {
		return result, err
	}
	p, configErr := s.provider(ctx, c)
	if configErr == nil {
		result.Profile = modelProfile(c, p)
	}
	result.Counts, err = s.Store.CountGraphSources(ctx, owner, result.Profile)
	if err != nil {
		return result, err
	}
	if c.ProviderID == "" {
		return result, nil
	}
	if !c.Enabled {
		result.State = "paused"
		return result, nil
	}
	if configErr != nil {
		result.State = "configuration-error"
		result.Error = "Cloudflare 服务配置不可用"
		return result, nil //nolint:nilerr // Configuration failure is reading status, not a failure to read that status.
	}
	result.ReservedNeurons, err = s.Store.ReadGraphBudget(ctx, digest(p.Endpoint), time.Now().UTC().Format("2006-01-02"))
	if err != nil {
		return result, err
	}
	result.State = "ready"
	if result.Counts.Pending > 0 {
		result.State = "preparing"
	}
	if result.Counts.Failed > 0 {
		result.State = "delayed"
	}
	if result.ReservedNeurons >= c.DailyNeurons {
		result.State = "quota-paused"
	}
	return result, nil
}

func nextDay(now time.Time) int64 {
	u := now.UTC()
	return time.Date(u.Year(), u.Month(), u.Day()+1, 0, 0, 0, 0, time.UTC).Unix()
}

func (s *Service) readable(ctx context.Context, owner int32, ids []int32) (map[int32]*store.Memo, error) {
	result := map[int32]*store.Memo{}
	if len(ids) == 0 {
		return result, nil
	}
	if len(ids) > 64 {
		return nil, errors.New("too many graph sources")
	}
	u, err := s.Store.GetUser(ctx, &store.FindUser{ID: &owner})
	if err != nil {
		return nil, err
	}
	if u == nil || u.RowStatus != store.Normal {
		return result, nil
	}
	p, err := journal.GetPreferences(ctx, s.Store, owner)
	if err != nil {
		return nil, err
	}
	excluded := map[string]bool{}
	for _, name := range p.ExcludedMemoNames {
		excluded[name] = true
	}
	normal := store.Normal
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{IDList: ids, CreatorID: &owner, RowStatus: &normal, ExcludeComments: true, ExcludeTrashed: true, Access: &store.MemoAccessScope{UserID: &owner, AllowPublic: true, AllowProtected: true}})
	if err != nil {
		return nil, err
	}
	for _, m := range memos {
		if !excluded["memos/"+m.UID] {
			result[m.ID] = m
		}
	}
	return result, nil
}

func excludedUIDs(p journal.Preferences) []string {
	out := make([]string, 0, len(p.ExcludedMemoNames))
	for _, name := range p.ExcludedMemoNames {
		out = append(out, strings.TrimPrefix(name, "memos/"))
	}
	return out
}
