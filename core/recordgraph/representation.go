package recordgraph

import (
	"encoding/json"
	"hash/fnv"
	"math"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/provider/ai/association"
	"github.com/EgoSay/kairos/store"
)

type span struct {
	Start int `json:"start"`
	End   int `json:"end"`
}
type chunk struct {
	span
	Vector []float32 `json:"vector"`
}
type concern struct {
	span
	Question string    `json:"question"`
	Vector   []float32 `json:"vector"`
}
type representation struct {
	Hash          string                 `json:"hash"`
	Chunks        []chunk                `json:"chunks"`
	Concerns      []concern              `json:"concerns"`
	ConcernsReady bool                   `json:"concernsReady"`
	Terms         []uint64               `json:"terms"`
	Publication   *publicationCheckpoint `json:"publication,omitempty"`
}

func split(text string) ([]chunk, error) {
	if !utf8.ValidString(text) {
		return nil, errors.New("invalid original text")
	}
	chunks := []chunk{}
	for start := 0; start < len(text); {
		end := min(start+2800, len(text))
		for end < len(text) && !utf8.RuneStart(text[end]) {
			end--
		}
		if end < len(text) {
			if at := strings.LastIndex(text[start:end], "\n\n"); at > 1000 {
				end = start + at + 2
			}
		}
		if strings.TrimSpace(text[start:end]) != "" {
			chunks = append(chunks, chunk{span: span{Start: start, End: end}})
		}
		if len(chunks) > 64 {
			return nil, errors.New("original exceeds background analysis budget")
		}
		if end == len(text) {
			break
		}
		start = end - 120
		for !utf8.RuneStart(text[start]) {
			start++
		}
	}
	return chunks, nil
}

func terms(text string) []uint64 {
	runes := []rune(strings.ToLower(text))
	unique := map[uint64]bool{}
	for i := 0; i+1 < len(runes); i++ {
		if runes[i] < 33 || runes[i+1] < 33 {
			continue
		}
		h := fnv.New64a()
		_, _ = h.Write([]byte(string(runes[i : i+2])))
		unique[h.Sum64()] = true
	}
	result := make([]uint64, 0, min(len(unique), 2048))
	for term := range unique {
		result = append(result, term)
	}
	slices.Sort(result)
	if len(result) > 2048 {
		result = result[:2048]
	}
	return result
}

func decodeRepresentation(data []byte) (representation, error) {
	var r representation
	if err := json.Unmarshal(data, &r); err != nil {
		return r, err
	}
	if len(r.Chunks) > 64 || len(r.Concerns) > 3 {
		return r, errors.New("invalid stored representation")
	}
	for _, c := range r.Chunks {
		if len(c.Vector) > 0 && !validVector(c.Vector) {
			return r, errors.New("invalid stored vector")
		}
	}
	for _, c := range r.Concerns {
		if len(c.Vector) > 0 && !validVector(c.Vector) {
			return r, errors.New("invalid stored concern")
		}
	}
	return r, nil
}

func validVector(v []float32) bool {
	if len(v) != association.Dimensions {
		return false
	}
	norm := 0.0
	for _, x := range v {
		if math.IsInf(float64(x), 0) || math.IsNaN(float64(x)) {
			return false
		}
		norm += float64(x) * float64(x)
	}
	return norm > 0.99 && norm < 1.01
}
func quoteSpan(text, quote string) (span, bool) {
	i := strings.Index(text, quote)
	return span{Start: i, End: i + len(quote)}, i >= 0 && strings.TrimSpace(quote) != "" && len(quote) <= 1200
}
func (p span) text(body string) (string, bool) {
	if p.Start < 0 || p.End <= p.Start || p.End > len(body) {
		return "", false
	}
	text := body[p.Start:p.End]
	return text, utf8.ValidString(text)
}

func excerpts(text string, chunks []chunk, indices []int) string {
	parts := []string{}
	seen := map[int]bool{}
	for _, i := range indices {
		if i < 0 || i >= len(chunks) || seen[i] {
			continue
		}
		seen[i] = true
		if value, ok := chunks[i].text(text); ok {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, "\n\n[以下为同一记录的另一片段]\n\n")
}

type publicationCheckpoint struct {
	Epoch    int64              `json:"epoch"`
	Expected map[int32]string   `json:"expected"`
	Edges    []*store.GraphEdge `json:"edges"`
}

func encodeRepresentation(r representation) ([]byte, error) { return json.Marshal(r) }
