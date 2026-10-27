package recordgraph

import (
	"context"
	"encoding/json"
	"math/rand/v2"
	"strings"
	"unicode/utf8"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/store"
)

// Original is a bounded original excerpt. Full text remains available through the ordinary memo page.
type Original struct {
	Name      string   `json:"name"`
	Content   string   `json:"content"`
	CreatedTs int64    `json:"createdTs"`
	Revision  int64    `json:"revision"`
	Tags      []string `json:"tags"`
	Truncated bool     `json:"truncated"`
}

// Direction contains a suggested connection and exact evidence from both originals.
type Direction struct {
	Original    Original `json:"original"`
	Kind        string   `json:"kind"`
	Hint        string   `json:"hint"`
	Context     string   `json:"context"`
	Topic       string   `json:"topic"`
	TopicID     string   `json:"topicId"`
	SourceQuote string   `json:"sourceQuote"`
	TargetQuote string   `json:"targetQuote"`
	Manual      bool     `json:"manual"`
}

// Neighborhood is a prepared reading unit; it contains neither vectors nor model calls.
type Neighborhood struct {
	Root       *Original   `json:"root"`
	Directions []Direction `json:"directions"`
	Epoch      int64       `json:"epoch"`
	Profile    string      `json:"profile"`
	State      string      `json:"state"`
}

func original(m *store.Memo, rev int64) Original {
	content := m.Content
	truncated := len(content) > 12000
	if truncated {
		content = content[:12000]
		for !utf8.ValidString(content) {
			content = content[:len(content)-1]
		}
	}
	return Original{Tags: m.Payload.GetTags(), Name: "memos/" + m.UID, Content: content, CreatedTs: m.CreatedTs, Revision: rev, Truncated: truncated}
}

// Bootstrap chooses an owner-only root using a bounded primary-key seek.
func (s *Service) Bootstrap(ctx context.Context, owner int32, seen []string) (Neighborhood, error) {
	if len(seen) > 32 {
		return Neighborhood{}, errors.New("too many recent roots")
	}
	p, err := journal.GetPreferences(ctx, s.Store, owner)
	if err != nil {
		return Neighborhood{}, err
	}
	counts, err := s.Store.CountGraphSources(ctx, owner, "")
	if err != nil {
		return Neighborhood{}, err
	}
	skip := append(excludedUIDs(p), seen...)
	for i := range skip {
		skip[i] = strings.TrimPrefix(skip[i], "memos/")
	}
	pivot := int32(0)
	if counts.MaxID > 0 {
		pivot = rand.Int32N(counts.MaxID)
	}
	initialPivot := pivot
	for attempt := 0; attempt < 4; attempt++ {
		rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner, AfterID: pivot, Limit: 4, ReadableOnly: true, ConnectedOnly: attempt < 2, ExcludedUIDs: skip, ExcludeRepresentation: true})
		if err != nil {
			return Neighborhood{}, err
		}
		for _, row := range rows {
			n, err := s.Neighborhood(ctx, owner, row.MemoID)
			if err != nil {
				return n, err
			}
			if n.Root != nil && (len(n.Directions) > 0 || attempt >= 2) {
				return n, nil
			}
		}
		if attempt%2 == 0 {
			pivot = 0
		} else {
			pivot = initialPivot
		}
	}
	if len(seen) > 0 {
		return s.Bootstrap(ctx, owner, nil)
	}
	return Neighborhood{Directions: []Direction{}, State: "empty"}, nil
}

// ByName resolves a root without trusting a client-supplied owner or graph identifier.
func (s *Service) ByName(ctx context.Context, owner int32, name string) (Neighborhood, error) {
	if !strings.HasPrefix(name, "memos/") || len(name) > 64 {
		return Neighborhood{}, errors.New("invalid original name")
	}
	uid := strings.TrimPrefix(name, "memos/")
	m, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, CreatorID: &owner})
	if err != nil {
		return Neighborhood{}, err
	}
	if m == nil {
		return Neighborhood{State: "unavailable", Directions: []Direction{}}, nil
	}
	return s.Neighborhood(ctx, owner, m.ID)
}

// Neighborhood rechecks current source versions, eligibility and evidence before exposing any derived text.
func (s *Service) Neighborhood(ctx context.Context, owner, id int32) (Neighborhood, error) {
	n := Neighborhood{Directions: []Direction{}, State: "preparing"}
	var err error
	n.Epoch, err = s.Store.GraphEpoch(ctx, owner)
	if err != nil {
		return n, err
	}
	c, err := s.GetConfig(ctx, owner)
	if err != nil {
		return n, err
	}
	p, configErr := s.provider(ctx, c)
	if configErr == nil {
		n.Profile = modelProfile(c, p)
	}
	if c.ProviderID == "" {
		n.State = "unconfigured"
	} else if !c.Enabled {
		n.State = "paused"
	}
	rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner, MemoIDs: []int32{id}, Limit: 1, ExcludeRepresentation: true})
	if err != nil {
		return n, err
	}
	if len(rows) == 0 {
		n.State = "unavailable"
		return n, nil
	}
	edges := []*store.GraphEdge{}
	if n.Profile != "" {
		edges, err = s.Store.ListGraphEdges(ctx, owner, id, n.Profile, 12)
		if err != nil {
			return n, err
		}
	}
	ids := []int32{id}
	for _, edge := range edges {
		other := edge.A
		if other == id {
			other = edge.B
		}
		ids = append(ids, other)
	}
	memos, err := s.readable(ctx, owner, ids)
	if err != nil {
		return n, err
	}
	root := memos[id]
	if root == nil {
		n.State = "unavailable"
		return n, nil
	}
	o := original(root, rows[0].Revision)
	n.Root = &o
	if rows[0].Profile == n.Profile && rows[0].ProcessedRevision == rows[0].Revision && n.State == "preparing" {
		n.State = "ready"
	}

	// Explicit links remain available even before any model is configured.
	manualType := store.MemoRelationReference
	manualLimit := 8
	manual, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{MemoIDList: []int32{id}, Type: &manualType, Limit: &manualLimit})
	if err != nil {
		return n, err
	}
	manualIDs := []int32{}
	for _, rel := range manual {
		other := rel.MemoID
		if other == id {
			other = rel.RelatedMemoID
		}
		manualIDs = append(manualIDs, other)
	}
	manualMemos, err := s.readable(ctx, owner, manualIDs)
	if err != nil {
		return n, err
	}
	seen := map[int32]bool{}
	for _, other := range manualIDs {
		target := manualMemos[other]
		if target == nil || seen[other] {
			continue
		}
		seen[other] = true
		n.Directions = append(n.Directions, Direction{Original: original(target, 0), Kind: "manual", Hint: "你曾在这两篇记录之间建立链接。", Topic: "你留下的连接", TopicID: "manual", Manual: true, SourceQuote: firstOriginalQuote(root.Content), TargetQuote: firstOriginalQuote(target.Content)})
		if len(n.Directions) == 4 {
			break
		}
	}
	for _, edge := range edges {
		if len(n.Directions) == 4 {
			break
		}
		var ev evidence
		if json.Unmarshal(edge.Payload, &ev) != nil {
			continue
		}
		other, rev, from, to := edge.B, edge.RevisionB, ev.A, ev.B
		if edge.B == id {
			other, rev, from, to = edge.A, edge.RevisionA, ev.B, ev.A
		}
		target := memos[other]
		if target == nil || seen[other] {
			continue
		}
		feedback, err := s.Store.GetJournalDocument(ctx, owner, "wander-feedback", pairKey(id, other))
		if err != nil {
			return n, err
		}
		if feedback != nil {
			continue
		}
		sourceQuote, okA := from.text(root.Content)
		targetQuote, okB := to.text(target.Content)
		if !okA || !okB {
			continue
		}
		n.Directions = append(n.Directions, Direction{Original: original(target, rev), Kind: ev.Kind, Hint: ev.Hint, Context: ev.Context, Topic: ev.Topic, TopicID: digest(ev.Topic)[:12], SourceQuote: sourceQuote, TargetQuote: targetQuote})
		if len(n.Directions) == 4 {
			break
		}
	}
	after, err := s.Store.GraphEpoch(ctx, owner)
	if err != nil {
		return n, err
	}
	if after != n.Epoch {
		return Neighborhood{}, store.ErrGraphConflict
	}
	return n, nil
}

// Feedback hides a suggestion without modifying the original or treating acceptance as truth.
func (s *Service) Feedback(ctx context.Context, owner int32, a, b string, dismiss bool) error {
	names := []string{a, b}
	ids := []int32{}
	for _, name := range names {
		uid := strings.TrimPrefix(name, "memos/")
		m, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid, CreatorID: &owner})
		if err != nil {
			return err
		}
		if m == nil {
			return errors.New("original unavailable")
		}
		ids = append(ids, m.ID)
	}
	memos, err := s.readable(ctx, owner, ids)
	if err != nil {
		return err
	}
	if len(memos) != 2 {
		return errors.New("original unavailable")
	}
	key := pairKey(ids[0], ids[1])
	doc, err := s.Store.GetJournalDocument(ctx, owner, "wander-feedback", key)
	if err != nil {
		return err
	}
	if !dismiss {
		if doc == nil {
			return nil
		}
		return s.Store.DeleteJournalDocument(ctx, owner, "wander-feedback", key, doc.Version)
	}
	if doc != nil {
		return nil
	}
	_, err = s.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "wander-feedback", Key: key, Payload: []byte(`{"dismissed":true}`)}, 0)
	return err
}

func firstOriginalQuote(text string) string {
	runes := []rune(text)
	return string(runes[:min(120, len(runes))])
}
