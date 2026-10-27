package recordgraph

import (
	"context"
	"encoding/json"
	"math"
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
		p, err := s.provider(ctx, c)
		if err != nil {
			continue
		}
		model, err := s.NewModel(p)
		if err != nil {
			continue
		}
		rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: doc.OwnerID, DueTs: time.Now().Unix(), Limit: 1})
		if err != nil {
			return changed, err
		}
		if len(rows) == 0 {
			continue
		}
		source := rows[0]
		source.LeaseToken = uuid.New().String()
		source.LeaseUntil = time.Now().Add(15 * time.Minute).Unix()
		ok, err := s.Store.ClaimGraphSource(ctx, source, time.Now().Unix())
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
		source.State = "retrying"
		source.ErrorCode = "temporary"
		source.NextAttemptTs = time.Now().Add(time.Duration(1<<min(source.Attempts, 7)) * time.Minute).Unix()
		var remote *association.ServiceError
		if errors.Is(err, errQuota) {
			source.State = "quota-paused"
			source.ErrorCode = "daily-budget"
			source.NextAttemptTs = nextDay(time.Now())
		} else if errors.Is(err, store.ErrGraphConflict) {
			source.NextAttemptTs = time.Now().Add(5 * time.Second).Unix()
			source.ErrorCode = "source-changed"
		} else if errors.As(err, &remote) {
			if remote.Code == 3036 {
				source.State = "quota-paused"
				used, _ := s.Store.ReadGraphBudget(ctx, digest(p.Endpoint), time.Now().UTC().Format("2006-01-02"))
				if used < c.DailyNeurons {
					_, _ = s.Store.ReserveGraphBudget(ctx, digest(p.Endpoint), time.Now().UTC().Format("2006-01-02"), c.DailyNeurons-used, c.DailyNeurons)
				}
				source.ErrorCode = "cloudflare-daily-quota"
				source.NextAttemptTs = nextDay(time.Now())
			} else if remote.Status >= 400 && remote.Status < 500 && remote.Status != 408 && remote.Status != 429 {
				source.State = "failed"
				source.ErrorCode = "configuration"
				source.NextAttemptTs = 253402300799
			} else if remote.RetryAfter > 0 {
				source.NextAttemptTs = time.Now().Add(min(remote.RetryAfter, 24*time.Hour)).Unix()
			}
		} else if source.Attempts >= 3 {
			source.State = "failed"
			source.ErrorCode = "invalid-result"
			source.NextAttemptTs = 253402300799
		}
		// A cancelled process releases its lease when possible; persisted attempts and budget survive a crash.
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		releaseErr := s.Store.DeferGraphSource(releaseCtx, source)
		cancel()
		if releaseErr != nil {
			return changed, releaseErr
		}
	}
	return changed, nil
}

func (s *Service) check(ctx context.Context, source *store.GraphSource, epoch int64, c Config, expected map[int32]string) error {
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

// billed reserves a conservative byte-based upper bound before any network action.
func (s *Service) billed(ctx context.Context, p ai.ProviderConfig, c Config, inputBytes int, chat bool, call func() (association.Usage, error)) error {
	rate := 1075.0
	output := 0.0
	if chat {
		rate = 4625
		output = 2400 * 30475.0 / 1e6
	}
	reserved := int64(math.Ceil(float64(2*inputBytes+8192)*rate/1e6+output)) + 1
	account, day := digest(p.Endpoint), time.Now().UTC().Format("2006-01-02")
	ok, err := s.Store.ReserveGraphBudget(ctx, account, day, reserved, c.DailyNeurons)
	if err != nil {
		return err
	}
	if !ok {
		return errQuota
	}
	usage, err := call()
	if err != nil {
		return err
	}
	// Unknown accounting is retained conservatively; no second automatic retry here.
	if usage.Input > 0 && (!chat || usage.Output > 0) {
		actual := int64(math.Ceil(float64(usage.Input) * rate / 1e6))
		if chat {
			actual = int64(math.Ceil(float64(usage.Input)*rate/1e6 + float64(usage.Output)*30475/1e6))
		}
		if actual < reserved {
			return s.Store.RefundGraphBudget(ctx, account, day, reserved-actual)
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
		return s.Store.PublishGraphSource(ctx, &store.GraphPublication{Source: source, ExpectedEpoch: epoch, Now: time.Now().Unix()})
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
		var vectors [][]float32
		size := 0
		for _, v := range texts {
			size += len(v)
		}
		err = s.billed(ctx, p, c, size, false, func() (association.Usage, error) {
			var u association.Usage
			var e error
			vectors, u, e = model.Embed(ctx, texts)
			return u, e
		})
		if err != nil {
			return err
		}
		if len(vectors) != len(indices) {
			return errors.New("invalid embedding count")
		}
		for j, index := range indices {
			if !validVector(vectors[j]) {
				return errors.New("invalid embedding")
			}
			r.Chunks[index].Vector = vectors[j]
		}
	}
	if len(r.Chunks) > 0 && !r.ConcernsReady {
		text := excerpts(memo.Content, r.Chunks, []int{0, len(r.Chunks) / 2, len(r.Chunks) - 1})
		if err = s.check(ctx, source, epoch, c, expected); err != nil {
			return err
		}
		var facets []association.Facet
		err = s.billed(ctx, p, c, len(text), true, func() (association.Usage, error) {
			var u association.Usage
			var e error
			facets, u, e = model.Facets(ctx, association.Source{Name: "memos/" + memo.UID, Text: text})
			return u, e
		})
		if err != nil {
			return err
		}
		if len(facets) > 3 {
			return errors.New("too many concerns")
		}
		for _, f := range facets {
			quote, ok := quoteSpan(memo.Content, f.Quote)
			if !ok {
				return errors.New("concern quote is not original")
			}
			r.Concerns = append(r.Concerns, concern{span: quote, Question: f.Question})
		}
		r.ConcernsReady = true
	}
	for i := range r.Concerns {
		if len(r.Concerns[i].Vector) > 0 {
			continue
		}
		text := "Instruct: Find original personal records about this concrete concern.\nQuery: " + r.Concerns[i].Question
		if err = s.check(ctx, source, epoch, c, expected); err != nil {
			return err
		}
		var vectors [][]float32
		err = s.billed(ctx, p, c, len(text), false, func() (association.Usage, error) {
			var u association.Usage
			var e error
			vectors, u, e = model.Embed(ctx, []string{text})
			return u, e
		})
		if err != nil {
			return err
		}
		if len(vectors) != 1 || !validVector(vectors[0]) {
			return errors.New("invalid concern vector")
		}
		r.Concerns[i].Vector = vectors[0]
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
		var relations []association.Relation
		err = s.billed(ctx, p, c, size, true, func() (association.Usage, error) {
			var u association.Usage
			var e error
			relations, u, e = model.Relate(ctx, association.Source{Name: "memos/" + memo.UID, Text: text}, candidates)
			return u, e
		})
		if err != nil {
			return err
		}
		for _, rel := range relations {
			target := byName[rel.Target]
			if target == nil {
				return errors.New("unknown relationship source")
			}
			a, okA := quoteSpan(memo.Content, rel.SourceQuote)
			b, okB := quoteSpan(target.Content, rel.TargetQuote)
			if !okA || !okB {
				return errors.New("relationship quote is not original")
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
	}
	if err = s.check(ctx, source, epoch, c, expected); err != nil {
		return err
	}
	source.Representation, _ = json.Marshal(r)
	source.State = "ready"
	oldCount := 0
	if old, ok := idx.Records[source.MemoID]; ok {
		oldCount = len(old.Representation.Chunks)
	}
	if idx.Vectors-oldCount+len(r.Chunks) > 24576 {
		return errors.New("semantic index memory budget reached")
	}
	if err = s.Store.PublishGraphSource(ctx, &store.GraphPublication{Source: source, ExpectedEpoch: epoch, Edges: edges, Now: time.Now().Unix()}); err != nil {
		return err
	}
	return idx.put(source.MemoID, source.Revision, r)
}

func pairKey(a, b int32) string {
	if a > b {
		a, b = b, a
	}
	return strconv.Itoa(int(a)) + ":" + strconv.Itoa(int(b))
}
