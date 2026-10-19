// Package memotag plans tag organization rewrites: which memos match a tag
// operation, which add/remove sets actually change one memo, and how saved
// filters and display-rule keys follow a rename or delete.
//
// Tags are authored Markdown tokens, not stored entities, so every decision
// here stays pure text and set logic; the Markdown service performs the
// content rewrite itself.
package memotag

import (
	"strconv"
	"strings"

	mparser "github.com/EgoSay/kairos/markdown/parser"
)

// ValidateTag reports whether value can round-trip as an authored #tag token.
// Values the grammar cannot spell back exactly (control characters, syntax
// delimiters, empty or malformed paths) are rejected up front.
func ValidateTag(value string) bool {
	_, ok := mparser.FormatTag(value)
	return ok
}

// MatchFilter returns a CEL expression matching memos whose explicit_tags
// contain tag, or any path under tag when descendants is set. It feeds
// store.FindMemo.Filters directly.
func MatchFilter(tag string, descendants bool) string {
	quoted := strconv.Quote(tag)
	if !descendants {
		return quoted + " in explicit_tags"
	}
	return "(" + quoted + " in explicit_tags || explicit_tags.exists(t, t.startsWith(" + strconv.Quote(tag+"/") + ")))"
}

// PlanBatch computes the effective add/remove sets for one memo. Adds already
// authored are skipped, removes absent are skipped; both keep request order.
// A memo whose sets are both empty is an idempotent no-op.
func PlanBatch(explicitTags, add, remove []string) (toAdd, toRemove []string, changed bool) {
	have := make(map[string]struct{}, len(explicitTags))
	for _, tag := range explicitTags {
		have[tag] = struct{}{}
	}
	for _, tag := range remove {
		if _, ok := have[tag]; ok {
			toRemove = append(toRemove, tag)
		}
	}
	for _, tag := range add {
		if _, ok := have[tag]; !ok {
			toAdd = append(toAdd, tag)
		}
	}
	return toAdd, toRemove, len(toAdd) > 0 || len(toRemove) > 0
}

// ConflictingTags returns values present in both add and remove; a request
// with any is rejected rather than guessing an order.
func ConflictingTags(add, remove []string) []string {
	removing := make(map[string]struct{}, len(remove))
	for _, tag := range remove {
		removing[tag] = struct{}{}
	}
	var conflicts []string
	for _, tag := range add {
		if _, ok := removing[tag]; ok {
			conflicts = append(conflicts, tag)
		}
	}
	return conflicts
}

// IsTagValue reports whether value names a tag (a descendant path when
// subtree is set), used to match display-rule keys and preview scopes.
func IsTagValue(value, tag string, subtree bool) bool {
	if value == tag {
		return true
	}
	return subtree && strings.HasPrefix(value, tag+"/")
}
