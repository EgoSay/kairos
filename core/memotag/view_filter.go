package memotag

import (
	"strconv"
	"strings"
)

// neverMatchLiteral is the replacement literal used when a referenced tag is
// deleted. "/" can never be a tag value, so membership and startsWith checks
// against it are always false, and negated clauses become vacuously true.
const neverMatchLiteral = "/"

// filterLiteral is one quoted string literal inside a saved-view filter.
type filterLiteral struct {
	start int // byte offset of the opening quote
	end   int // byte offset one past the closing quote
	value string
}

// literalContext classifies how a string literal relates to the tag fields.
type literalContext int

const (
	// notTagLiteral marks literals the rewrite must never touch, such as
	// content.contains("...") arguments.
	notTagLiteral literalContext = iota
	// explicitLiteral compares against authored tags only: "x" in
	// explicit_tags, or a value inside an explicit_tags.exists lambda.
	explicitLiteral
	// hierarchyLiteral compares against tags plus implied ancestors: "x" in
	// tags, or a value inside a tags.exists lambda. It stays meaningful while
	// descendant tags survive.
	hierarchyLiteral
	// prefixLiteral is a tag-path prefix argument, e.g. t.startsWith("a/"),
	// inside a tag exists lambda.
	prefixLiteral
)

// scanFilterLiterals returns every single- or double-quoted string literal in
// the filter, in source order. Triple-quoted strings are not produced by the
// view editor and are ignored.
func scanFilterLiterals(filter string) []filterLiteral {
	var literals []filterLiteral
	for pos := 0; pos < len(filter); {
		quote := filter[pos]
		if quote != '"' && quote != '\'' {
			pos++
			continue
		}
		end := pos + 1
		for ; end < len(filter); end++ {
			if filter[end] == '\\' && end+1 < len(filter) {
				end++
				continue
			}
			if filter[end] == quote {
				break
			}
		}
		if end >= len(filter) {
			break
		}
		value, err := strconv.Unquote(filter[pos : end+1])
		if err != nil {
			pos = end + 1
			continue
		}
		literals = append(literals, filterLiteral{start: pos, end: end + 1, value: value})
		pos = end + 1
	}
	return literals
}

// existsBody is the byte span of a tags.exists(variable, body) lambda body.
type existsBody struct {
	collection string
	start      int
	end        int
}

func isFilterIdentChar(b byte) bool {
	return b == '_' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9'
}

// tagExistsBodies returns the lambda bodies of tags.exists(...) and
// explicit_tags.exists(...) calls in the filter.
func tagExistsBodies(filter string, literals []filterLiteral) []existsBody {
	literalStart := make(map[int]int, len(literals))
	for _, literal := range literals {
		literalStart[literal.start] = literal.end
	}
	var bodies []existsBody
	for pos := 0; pos < len(filter); pos++ {
		if end, ok := literalStart[pos]; ok {
			pos = end - 1
			continue
		}
		if !strings.HasPrefix(filter[pos:], ".exists(") {
			continue
		}
		// The receiver identifier sits directly before the dot.
		start := pos
		for start > 0 && isFilterIdentChar(filter[start-1]) {
			start--
		}
		collection := filter[start:pos]
		if collection != "tags" && collection != "explicit_tags" {
			continue
		}
		// Skip the lambda variable: exists( var , body )
		p := pos + len(".exists(")
		for p < len(filter) && (filter[p] == ' ' || filter[p] == '\t') {
			p++
		}
		for p < len(filter) && isFilterIdentChar(filter[p]) {
			p++
		}
		for p < len(filter) && (filter[p] == ' ' || filter[p] == '\t') {
			p++
		}
		if p >= len(filter) || filter[p] != ',' {
			continue
		}
		bodyStart := p + 1
		if bodyEnd := existsBodyEnd(filter, bodyStart, literalStart); bodyEnd > bodyStart {
			bodies = append(bodies, existsBody{collection: collection, start: bodyStart, end: bodyEnd})
		}
	}
	return bodies
}

// existsBodyEnd finds the closing paren of an exists call whose lambda body
// starts at bodyStart, skipping over string literals.
func existsBodyEnd(filter string, bodyStart int, literalStart map[int]int) int {
	depth := 1
	for i := bodyStart; i < len(filter); i++ {
		if end, ok := literalStart[i]; ok {
			i = end - 1
			continue
		}
		switch filter[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func skipFilterSpaces(text string) string {
	return strings.TrimLeft(text, " \t")
}

// classifyLiteral determines whether a literal sits in a tag position, and
// whether that position tests authored tags or the implied hierarchy.
func classifyLiteral(filter string, literal filterLiteral, bodies []existsBody) literalContext {
	// Membership form: "x" in tags / "x" in explicit_tags.
	after := skipFilterSpaces(filter[literal.end:])
	if strings.HasPrefix(after, "in") && (len(after) == 2 || !isFilterIdentChar(after[2])) {
		target := skipFilterSpaces(after[2:])
		end := 0
		for end < len(target) && isFilterIdentChar(target[end]) {
			end++
		}
		switch target[:end] {
		case "explicit_tags":
			return explicitLiteral
		case "tags":
			return hierarchyLiteral
		default:
			return notTagLiteral
		}
	}
	for _, body := range bodies {
		if literal.start > body.start && literal.end <= body.end {
			// Inside a tag lambda, a startsWith argument tests path prefixes;
			// every other literal is an element comparison.
			before := filter[:literal.start]
			for len(before) > 0 && (before[len(before)-1] == ' ' || before[len(before)-1] == '\t') {
				before = before[:len(before)-1]
			}
			if strings.HasSuffix(before, "startsWith(") {
				return prefixLiteral
			}
			if body.collection == "explicit_tags" {
				return explicitLiteral
			}
			return hierarchyLiteral
		}
	}
	return notTagLiteral
}

// rewrittenLiteral computes the replacement value for one literal, reporting
// whether it changes at all. renamed is empty when the tag is deleted; the
// literal then becomes a value that never matches.
func rewrittenLiteral(value string, context literalContext, tag, renamed string, subtree, descendantsExist bool) (string, bool) {
	if context == notTagLiteral {
		return "", false
	}
	replacement := renamed
	if replacement == "" {
		replacement = neverMatchLiteral
	}
	if value == tag {
		switch context {
		case explicitLiteral:
			return replacement, true
		case hierarchyLiteral:
			// While descendants survive, "tag" in tags still matches their
			// implied ancestor, so the literal remains faithful.
			if subtree || !descendantsExist {
				return replacement, true
			}
		}
		// A bare-prefix argument like t.startsWith("a") intentionally keeps
		// matching sibling names such as "ab"; it is not a tag reference.
		return "", false
	}
	if strings.HasPrefix(value, tag+"/") && subtree {
		if renamed == "" {
			return neverMatchLiteral, true
		}
		return renamed + value[len(tag):], true
	}
	return "", false
}

// RewriteViewFilter rewrites the tag references inside a saved-view filter.
// renamed is the new tag value, or empty when the tag is deleted. subtree
// follows the operation's descendant scope; descendantsExist reports whether
// tag/... values still exist in the caller's corpus.
//
// It returns the rewritten filter and whether anything changed. A filter that
// cannot be scanned safely is returned unchanged, because guessing at CEL is
// worse than leaving a stale reference for the user to fix.
func RewriteViewFilter(filter, tag, renamed string, subtree, descendantsExist bool) (string, bool) {
	literals := scanFilterLiterals(filter)
	if len(literals) == 0 {
		return filter, false
	}
	bodies := tagExistsBodies(filter, literals)

	var output strings.Builder
	output.Grow(len(filter))
	cursor := 0
	changed := false
	for _, literal := range literals {
		context := classifyLiteral(filter, literal, bodies)
		value, ok := rewrittenLiteral(literal.value, context, tag, renamed, subtree, descendantsExist)
		if !ok {
			continue
		}
		output.WriteString(filter[cursor:literal.start])
		output.WriteString(strconv.Quote(value))
		cursor = literal.end
		changed = true
	}
	if !changed {
		return filter, false
	}
	output.WriteString(filter[cursor:])
	return output.String(), true
}
