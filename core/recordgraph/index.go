package recordgraph

import (
	"context"
	"slices"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/store"
)

type indexedRecord struct {
	Revision       int64
	Representation representation
}
type semanticIndex struct {
	Owner   int32
	Profile string
	Records map[int32]indexedRecord
	Vectors int
}
type hit struct {
	ID          int32
	Score       float32
	SourceChunk int
	TargetChunk int
}

func (s *Service) loadIndex(ctx context.Context, owner int32, profile string) (*semanticIndex, error) {
	p, err := journal.GetPreferences(ctx, s.Store, owner)
	if err != nil {
		return nil, err
	}
	idx := s.index
	if idx == nil || idx.Owner != owner || idx.Profile != profile {
		idx = &semanticIndex{Owner: owner, Profile: profile, Records: map[int32]indexedRecord{}}
	}
	// Reconcile small source metadata before ranking. Otherwise withdrawn sources
	// can consume all candidate slots and retain their vectors indefinitely. Reuse
	// unchanged vectors; only missing revisions need representation reads/decoding.
	current := map[int32]int64{}
	missing := []int32{}
	var after int32
	for {
		rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner, Profile: profile, AfterID: after, Limit: 256, ExcludeRepresentation: true, ReadableOnly: true, ExcludedUIDs: excludedUIDs(p)})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			after = row.MemoID
			if row.ProcessedRevision != row.Revision || row.State != "ready" {
				continue
			}
			current[row.MemoID] = row.Revision
			if cached, ok := idx.Records[row.MemoID]; !ok || cached.Revision != row.Revision {
				missing = append(missing, row.MemoID)
			}
		}
		if len(rows) < 256 {
			break
		}
	}
	for id, cached := range idx.Records {
		if revision, ok := current[id]; !ok || revision != cached.Revision {
			idx.Vectors -= len(cached.Representation.Chunks)
			delete(idx.Records, id)
		}
	}
	for ids := range slices.Chunk(missing, 64) {
		rows, err := s.Store.ListGraphSources(ctx, &store.FindGraphSource{OwnerID: owner, Profile: profile, MemoIDs: ids, Limit: 64})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			if row.Revision != current[row.MemoID] || row.ProcessedRevision != row.Revision || row.State != "ready" {
				continue
			}
			r, err := decodeRepresentation(row.Representation)
			if err != nil {
				continue
			}
			if err = idx.put(row.MemoID, row.Revision, r); err != nil {
				return nil, err
			}
		}
	}
	s.index = idx
	return idx, nil
}

func (i *semanticIndex) put(id int32, revision int64, r representation) error {
	count := len(r.Chunks)
	if old, ok := i.Records[id]; ok {
		count -= len(old.Representation.Chunks)
	}
	if i.Vectors+count > 24576 {
		return errors.New("semantic index memory budget reached")
	}
	// Only original vectors are needed for candidate targets; concern vectors belong to the active query.
	r.Concerns = nil
	i.Vectors += count
	i.Records[id] = indexedRecord{Revision: revision, Representation: r}
	return nil
}

func dot(a, b []float32) float32 {
	if len(a) != len(b) {
		return -1
	}
	var sum float32
	for k, v := range a {
		sum += v * b[k]
	}
	return sum
}

// retrieve fuses independent rankings rather than treating raw similarity as evidence.
func (i *semanticIndex) retrieve(id int32, r representation) []hit {
	raw, questions, lexical := []hit{}, []hit{}, []hit{}
	for other, record := range i.Records {
		if other == id {
			continue
		}
		candidate := record.Representation
		best := hit{ID: other, Score: -2}
		qbest := hit{ID: other, Score: -2}
		for a, query := range r.Chunks {
			for b, target := range candidate.Chunks {
				if score := dot(query.Vector, target.Vector); score > best.Score {
					best = hit{ID: other, Score: score, SourceChunk: a, TargetChunk: b}
				}
			}
		}
		for _, query := range r.Concerns {
			for b, target := range candidate.Chunks {
				if score := dot(query.Vector, target.Vector); score > qbest.Score {
					qbest = hit{ID: other, Score: score, SourceChunk: best.SourceChunk, TargetChunk: b}
				}
			}
		}
		if best.Score > 0.1 {
			raw = append(raw, best)
		}
		if qbest.Score > 0.1 {
			questions = append(questions, qbest)
		}
		common := 0
		for a, b := 0, 0; a < len(r.Terms) && b < len(candidate.Terms); {
			if r.Terms[a] == candidate.Terms[b] {
				common++
				a++
				b++
			} else if r.Terms[a] < candidate.Terms[b] {
				a++
			} else {
				b++
			}
		}
		if common > 0 {
			lexical = append(lexical, hit{ID: other, Score: float32(common) / float32(max(1, len(r.Terms)+len(candidate.Terms)-common)), SourceChunk: best.SourceChunk, TargetChunk: best.TargetChunk})
		}
	}
	scores := map[int32]hit{}
	for route, list := range [][]hit{raw, questions, lexical} {
		slices.SortFunc(list, func(a, b hit) int {
			if a.Score > b.Score {
				return -1
			}
			if a.Score < b.Score {
				return 1
			}
			return int(a.ID - b.ID)
		})
		limit := 40
		if route > 0 {
			limit = 20
		}
		for rank, h := range list[:min(limit, len(list))] {
			current := scores[h.ID]
			if current.ID == 0 {
				current = h
				current.Score = 0
			}
			current.Score += 1 / float32(60+rank)
			scores[h.ID] = current
		}
	}
	result := make([]hit, 0, len(scores))
	for _, h := range scores {
		result = append(result, h)
	}
	slices.SortFunc(result, func(a, b hit) int {
		if a.Score > b.Score {
			return -1
		}
		if a.Score < b.Score {
			return 1
		}
		return int(a.ID - b.ID)
	})
	// Prefer distinct originals in the first screen without deleting repeated thoughts.
	unique, repeats := []hit{}, []hit{}
	seen := map[string]bool{r.Hash: true}
	for _, h := range result {
		hash := i.Records[h.ID].Representation.Hash
		if seen[hash] {
			repeats = append(repeats, h)
		} else {
			unique = append(unique, h)
			seen[hash] = true
		}
	}
	unique = append(unique, repeats...)
	return unique[:min(12, len(unique))]
}
