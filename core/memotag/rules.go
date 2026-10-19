package memotag

import (
	"regexp"
	"strings"
)

// RuleKeyReferenced reports whether a tag display-rule key references the
// tag: literally, via a descendant literal when subtree is set, or as an
// anchored regular expression that matches the tag.
func RuleKeyReferenced(key, tag string, subtree bool) bool {
	if IsTagValue(key, tag, subtree) {
		return true
	}
	pattern, err := regexp.Compile("^(?:" + key + ")$")
	return err == nil && pattern.MatchString(tag)
}

// RenameRuleKey moves a literal display-rule key to its renamed value.
// Regular-expression keys are not rewritten; the caller reports them as
// references instead, because a pattern may intentionally cover sibling tags.
func RenameRuleKey(key, tag, renamed string, subtree bool) (string, bool) {
	if key == tag {
		return renamed, true
	}
	if subtree && strings.HasPrefix(key, tag+"/") {
		return renamed + key[len(tag):], true
	}
	return key, false
}
