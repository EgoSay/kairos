package recordgraph

import (
	"context"
	"encoding/json"
	"strconv"
	"time"
	"uuid"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/provider/ai"
	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

var errQuota = errors.New("daily background budget reached")

type evidence struct {
	Kind    string `json:"kind"`
	Hint    string `json:"hint"`
	Context string `json:"context"`
	Topic   string `json:"topic"`
	A       span   `json:"a"`
	B       span   `json:"b"`
}

// RunOnce performs at most one leased record per configured owner. It is safe to restart.
func (s *Service) RunOnce(ctx context.Context) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	docs, err := s.Store.ListJournalDocuments(ctx, &store.FindJournalDocument{Kind: "wander-config"})
	if err != nil {
		return false, err
	}
	changed := false
	for _, doc := range docs {
		if ctx.Err() != nil {
			return changed, ctx.Err()
		}
		c, err := s.GetConfig(ctx, doc.OwnerID)
		if err != nil {
			return changed, err
		}
		if !c.Enabled || !c.FreePlanConfirmed {
			continue
		}
		maintenance, err := s.maintenance(ctx, doc.OwnerID)
		if err != nil {
			return changed, err
		}
		if maintenance.Paused {
			continue
		}
		p, err := s.provider(ctx, c)
		if err != nil {
			continue
		}
		quota, err := s.Store.GetGraphRuntime(ctx, quotaKey(p))
		if err != nil {
			return changed, err
		}
		if quota.Until > s.now().Unix() {
			continue
		}
		runtime, err := s.Store.GetGraphRuntime(ctx, connectionKey(p))
		if err != nil {
			return changed, err
		}
		if runtime.Until > s.now().Unix() {
			continue
		}
		model, err := s.NewModel(p)
		if err != nil {
			continue
		}
		rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: doc.OwnerID, DueTs: s.now().Unix(), Limit: 1})
		if err != nil {
			return changed, err
		}
		if len(rows) == 0 {
			continue
		}
		if runtime.Failures >= 3 {
			ok, probeErr := s.Store.ClaimGraphProbe(ctx, runtime.Key, s.now().Unix())
			if probeErr != nil {
				return changed, probeErr
			}
			if !ok {
				continue
			}
		}
		source := rows[0]
		source.LeaseToken = uuid.New().String()
		source.LeaseUntil = s.now().Add(15 * time.Minute).Unix()
		ok, err := s.Store.ClaimGraphSource(ctx, source, s.now().Unix())
		if err != nil {
			return changed, err
		}
		if !ok {
			continue
		}
		epoch, err := s.Store.GraphEpoch(ctx, source.OwnerID)
		if err == nil {
			err = s.process(ctx, source, epoch, c, p, model)
		}
		if err == nil {
			changed = true
			continue
		}
		s.deferFailure(source, err)
		// A cancelled process releases its lease when possible; persisted attempts and budget survive a crash.
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		releaseErr := s.Store.DeferGraphSource(releaseCtx, source)
		cancel()
		if releaseErr != nil && !errors.Is(releaseErr, store.ErrGraphConflict) {
			return changed, releaseErr
		}
	}
	return changed, nil
}

func (s *Service) check(ctx context.Context, source *store.GraphSource, epoch int64, c Config, expected map[int32]string) error {
	maintenance, err := s.maintenance(ctx, source.OwnerID)
	if err != nil {
		return err
	}
	if maintenance.Paused {
		return store.ErrGraphConflict
	}
	current, err := s.GetConfig(ctx, source.OwnerID)
	if err != nil {
		return err
	}
	if !current.Enabled || current.Version != c.Version {
		return store.ErrGraphConflict
	}
	now, err := s.Store.GraphEpoch(ctx, source.OwnerID)
	if err != nil {
		return err
	}
	if now != epoch {
		return store.ErrGraphConflict
	}
	ids := make([]int32, 0, len(expected))
	for id := range expected {
		ids = append(ids, id)
	}
	memos, err := s.readable(ctx, source.OwnerID, ids)
	if err != nil {
		return err
	}
	for id, hash := range expected {
		m := memos[id]
		if m == nil || digest(m.Content) != hash {
			return store.ErrGraphConflict
		}
	}
	return nil
}

func (s *Service) process(ctx context.Context, source *store.GraphSource, epoch int64, c Config, p ai.ProviderConfig, model Model) error {
	profile := modelProfile(c, p)
	memos, err := s.readable(ctx, source.OwnerID, []int32{source.MemoID})
	if err != nil {
		return err
	}
	memo := memos[source.MemoID]
	if memo == nil {
		source.Profile = profile
		source.Representation = []byte(`{}`)
		source.State = "excluded"
		return s.Store.PublishGraphSource(ctx, &store.GraphPublication{Source: source, ExpectedEpoch: epoch, Now: s.now().Unix()})
	}
	expected := map[int32]string{memo.ID: digest(memo.Content)}
	r, decodeErr := decodeRepresentation(source.Representation)
	if decodeErr != nil || r.Hash != expected[memo.ID] || source.Profile != profile {
		r = representation{Hash: expected[memo.ID], Terms: terms(memo.Content)}
		r.Chunks, err = split(memo.Content)
		if err != nil {
			return err
		}
	}
	source.Profile = profile
	// Preserve validated partial work on deferred jobs, without publishing it to readers.
	defer func() { source.Representation, _ = json.Marshal(r) }()
	if r.Publication != nil {
		if r.Publication.Epoch == epoch && s.check(ctx, source, epoch, c, r.Publication.Expected) == nil {
			idx, e := s.loadIndex(ctx, source.OwnerID, profile)
			if e != nil {
				return e
			}
			return s.publishPrepared(ctx, source, epoch, c, &r, idx)
		}
		r.Publication = nil
	}
	for i := 0; i < len(r.Chunks); {
		indices := []int{}
		texts := []string{}
		for ; i < len(r.Chunks) && len(texts) < 8; i++ {
			if len(r.Chunks[i].Vector) > 0 {
				continue
			}
			text, ok := r.Chunks[i].text(memo.Content)
			if !ok {
				return errors.New("invalid chunk")
			}
			indices = append(indices, i)
			texts = append(texts, text)
		}
		if len(texts) == 0 {
			continue
		}
		if err = s.check(ctx, source, epoch, c, expected); err != nil {
			return err
		}
		if err = s.checkpoint(ctx, source, r, "embedding"); err != nil {
			return err
		}
		var vectors [][]float32
		size := 0
		for _, v := range texts {
			size += len(v)
		}
		err = s.billed(ctx, source, p, c, size, len(texts), false, func() (association.Usage, error) {
			var u association.Usage
			var e error
			vectors, u, e = model.Embed(ctx, texts)
			if e == nil {
				if len(vectors) != len(indices) {
					e = association.InvalidResult("embedding-count")
				} else {
					for _, v := range vectors {
						if !validVector(v) {
							e = association.InvalidResult("embedding-dimensions")
							break
						}
					}
				}
			}
			return u, e
		})
		if err != nil {
			return err
		}
		if len(vectors) != len(indices) {
			return association.InvalidResult("embedding-count")
		}
		for j, index := range indices {
			if !validVector(vectors[j]) {
				return association.InvalidResult("embedding-dimensions")
			}
			r.Chunks[index].Vector = vectors[j]
		}
		if err = s.checkpoint(ctx, source, r, "embedding"); err != nil {
			return err
		}
	}
	if len(r.Chunks) > 0 && !r.ConcernsReady {
		text := excerpts(memo.Content, r.Chunks, []int{0, len(r.Chunks) / 2, len(r.Chunks) - 1})
		if err = s.check(ctx, source, epoch, c, expected); err != nil {
			return err
		}
		if err = s.checkpoint(ctx, source, r, "facets"); err != nil {
			return err
		}
		var facets []association.Facet
		err = s.billed(ctx, source, p, c, len(text), 1, true, func() (association.Usage, error) {
			var u association.Usage
			var e error
			facets, u, e = model.Facets(ctx, association.Source{Name: "memos/" + memo.UID, Text: text})
			if e == nil {
				if len(facets) > 3 {
					e = association.InvalidResult("result-schema")
				}
				for _, f := range facets {
					if _, ok := quoteSpan(memo.Content, f.Quote); !ok {
						e = association.InvalidResult("quote-mismatch")
						break
					}
				}
			}
			return u, e
		})
		if err != nil {
			return err
		}
		if len(facets) > 3 {
			return association.InvalidResult("result-schema")
		}
		for _, f := range facets {
			quote, ok := quoteSpan(memo.Content, f.Quote)
			if !ok {
				return association.InvalidResult("quote-mismatch")
			}
			r.Concerns = append(r.Concerns, concern{span: quote, Question: f.Question})
		}
		r.ConcernsReady = true
		if err = s.checkpoint(ctx, source, r, "facets"); err != nil {
			return err
		}
	}
	for i := range r.Concerns {
		if len(r.Concerns[i].Vector) > 0 {
			continue
		}
		text := "Instruct: Find original personal records about this concrete concern.\nQuery: " + r.Concerns[i].Question
		if err = s.check(ctx, source, epoch, c, expected); err != nil {
			return err
		}
		if err = s.checkpoint(ctx, source, r, "concern-embedding"); err != nil {
			return err
		}
		var vectors [][]float32
		err = s.billed(ctx, source, p, c, len(text), 1, false, func() (association.Usage, error) {
			var u association.Usage
			var e error
			vectors, u, e = model.Embed(ctx, []string{text})
			if e == nil && (len(vectors) != 1 || !validVector(vectors[0])) {
				e = association.InvalidResult("embedding-dimensions")
			}
			return u, e
		})
		if err != nil {
			return err
		}
		if len(vectors) != 1 || !validVector(vectors[0]) {
			return association.InvalidResult("embedding-dimensions")
		}
		r.Concerns[i].Vector = vectors[0]
		if err = s.checkpoint(ctx, source, r, "concern-embedding"); err != nil {
			return err
		}
	}
	idx, err := s.loadIndex(ctx, source.OwnerID, profile)
	if err != nil {
		return err
	}
	hits := idx.retrieve(memo.ID, r)
	ids := []int32{}
	for _, h := range hits {
		ids = append(ids, h.ID)
	}
	targets, err := s.readable(ctx, source.OwnerID, ids)
	if err != nil {
		return err
	}
	candidates := []association.Source{}
	byName := map[string]*store.Memo{}
	sourceIndices := []int{0}
	for _, h := range hits {
		target := targets[h.ID]
		ir := idx.Records[h.ID]
		if target == nil || digest(target.Content) != ir.Representation.Hash {
			continue
		}
		text := excerpts(target.Content, ir.Representation.Chunks, []int{h.TargetChunk})
		if text == "" {
			continue
		}
		name := "memos/" + target.UID
		candidates = append(candidates, association.Source{Name: name, Text: text})
		byName[name] = target
		expected[target.ID] = ir.Representation.Hash
		if len(sourceIndices) < 4 {
			sourceIndices = append(sourceIndices, h.SourceChunk)
		}
	}
	edges := []*store.GraphEdge{}
	if len(candidates) > 0 {
		text := excerpts(memo.Content, r.Chunks, sourceIndices)
		size := len(text)
		for _, target := range candidates {
			size += len(target.Text)
		}
		if err = s.check(ctx, source, epoch, c, expected); err != nil {
			return err
		}
		if err = s.checkpoint(ctx, source, r, "relations"); err != nil {
			return err
		}
		var relations []association.Relation
		err = s.billed(ctx, source, p, c, size, 1, true, func() (association.Usage, error) {
			var u association.Usage
			var e error
			relations, u, e = model.Relate(ctx, association.Source{Name: "memos/" + memo.UID, Text: text}, candidates)
			if e != nil {
				return u, e
			}
			for _, rel := range relations {
				target := byName[rel.Target]
				if target == nil {
					return u, association.InvalidResult("result-schema")
				}
				a, okA := quoteSpan(memo.Content, rel.SourceQuote)
				b, okB := quoteSpan(target.Content, rel.TargetQuote)
				if !okA || !okB {
					return u, association.InvalidResult("quote-mismatch")
				}
				edge := &store.GraphEdge{OwnerID: source.OwnerID, A: memo.ID, B: target.ID, RevisionA: source.Revision, RevisionB: idx.Records[target.ID].Revision, Profile: profile}
				ev := evidence{Kind: rel.Kind, Hint: rel.Hint, Topic: rel.Topic, Context: rel.Context, A: a, B: b}
				if edge.A > edge.B {
					edge.A, edge.B = edge.B, edge.A
					edge.RevisionA, edge.RevisionB = edge.RevisionB, edge.RevisionA
					ev.A, ev.B = ev.B, ev.A
				}
				edge.Payload, _ = json.Marshal(ev)
				edges = append(edges, edge)
			}
			return u, e
		})
		if err != nil {
			return err
		}
	}
	r.Publication = &publicationCheckpoint{Epoch: epoch, Expected: expected, Edges: edges}
	if err = s.checkpoint(ctx, source, r, "publish"); err != nil {
		return err
	}
	return s.publishPrepared(ctx, source, epoch, c, &r, idx)
}

func (s *Service) publishPrepared(ctx context.Context, source *store.GraphSource, epoch int64, c Config, r *representation, idx *semanticIndex) error {
	saved := r.Publication
	if err := s.check(ctx, source, epoch, c, saved.Expected); err != nil {
		return err
	}
	source.Stage = "publish"
	oldCount := 0
	if old, ok := idx.Records[source.MemoID]; ok {
		oldCount = len(old.Representation.Chunks)
	}
	if idx.Vectors-oldCount+len(r.Chunks) > 24576 {
		return errors.New("semantic index memory budget reached")
	}
	r.Publication = nil
	source.Representation, _ = json.Marshal(r)
	source.State = "ready"
	if err := s.Store.PublishGraphSource(ctx, &store.GraphPublication{Source: source, ExpectedEpoch: epoch, Edges: saved.Edges, Now: s.now().Unix()}); err != nil {
		r.Publication = saved
		return err
	}
	return idx.put(source.MemoID, source.Revision, *r)
}

func pairKey(a, b int32) string {
	if a > b {
		a, b = b, a
	}
	return strconv.Itoa(int(a)) + ":" + strconv.Itoa(int(b))
}
