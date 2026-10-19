package memotag

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateTag(t *testing.T) {
	for _, valid := range []string{"a", "a/b", "中文", "a(b)", "a、b", "项目/子任务"} {
		assert.True(t, ValidateTag(valid), "expected %q valid", valid)
	}
	for _, invalid := range []string{"", "a/", "/a", "a//b", "a b", "a#b", "a\\b"} {
		assert.False(t, ValidateTag(invalid), "expected %q invalid", invalid)
	}
}

func TestMatchFilter(t *testing.T) {
	assert.Equal(t, `"a" in explicit_tags`, MatchFilter("a", false))
	assert.Equal(t, `("a" in explicit_tags || explicit_tags.exists(t, t.startsWith("a/")))`, MatchFilter("a", true))
	assert.Equal(t, `"人生修行/阅读" in explicit_tags`, MatchFilter("人生修行/阅读", false))
}

func TestPlanBatch(t *testing.T) {
	toAdd, toRemove, changed := PlanBatch([]string{"a", "b"}, []string{"a", "c"}, []string{"b", "zzz"})
	assert.Equal(t, []string{"c"}, toAdd)
	assert.Equal(t, []string{"b"}, toRemove)
	assert.True(t, changed)

	_, _, changed = PlanBatch([]string{"a"}, []string{"a"}, []string{"zzz"})
	assert.False(t, changed)

	_, _, changed = PlanBatch(nil, nil, nil)
	assert.False(t, changed)
}

func TestConflictingTags(t *testing.T) {
	assert.Equal(t, []string{"a"}, ConflictingTags([]string{"a", "c"}, []string{"a", "b"}))
	assert.Empty(t, ConflictingTags([]string{"a"}, []string{"b"}))
}

func TestRewriteViewFilterRename(t *testing.T) {
	tests := []struct {
		name             string
		filter           string
		subtree          bool
		descendantsExist bool
		expected         string
		changed          bool
	}{
		{name: "explicit membership", filter: `"a" in explicit_tags`, expected: `"b" in explicit_tags`, changed: true},
		{name: "explicit delete", filter: `"a" in explicit_tags`, expected: `"b" in explicit_tags`, changed: true},
		{name: "hierarchy with descendants", filter: `"a" in tags`, descendantsExist: true, expected: `"a" in tags`, changed: false},
		{name: "hierarchy without descendants", filter: `"a" in tags`, descendantsExist: false, expected: `"b" in tags`, changed: true},
		{name: "hierarchy subtree rename", filter: `"a" in tags`, subtree: true, descendantsExist: true, expected: `"b" in tags`, changed: true},
		{
			name:     "subtree exists rewrite",
			filter:   `explicit_tags.exists(t, t.startsWith("a/"))`,
			subtree:  true,
			expected: `explicit_tags.exists(t, t.startsWith("b/"))`,
			changed:  true,
		},
		{
			name:     "subtree not applied without flag",
			filter:   `explicit_tags.exists(t, t.startsWith("a/"))`,
			subtree:  false,
			expected: `explicit_tags.exists(t, t.startsWith("a/"))`,
			changed:  false,
		},
		{
			name:             "branch pattern subtree",
			filter:           `("a" in tags || tags.exists(t, t.startsWith("a/")))`,
			subtree:          true,
			descendantsExist: true,
			expected:         `("b" in tags || tags.exists(t, t.startsWith("b/")))`,
			changed:          true,
		},
		{name: "content untouched", filter: `content.contains("a")`, expected: `content.contains("a")`, changed: false},
		{name: "other collection untouched", filter: `"a" in something`, expected: `"a" in something`, changed: false},
		{name: "mixed filter", filter: `"a" in explicit_tags && content.contains("a")`, expected: `"b" in explicit_tags && content.contains("a")`, changed: true},
		{name: "negated clause", filter: `!("a" in explicit_tags)`, expected: `!("b" in explicit_tags)`, changed: true},
		{name: "single quotes", filter: `'a' in explicit_tags`, expected: `"b" in explicit_tags`, changed: true},
		{name: "exact element in exists", filter: `explicit_tags.exists(t, t == "a")`, expected: `explicit_tags.exists(t, t == "b")`, changed: true},
		{name: "bare prefix kept", filter: `explicit_tags.exists(t, t.startsWith("a"))`, subtree: true, expected: `explicit_tags.exists(t, t.startsWith("a"))`, changed: false},
		{
			name:             "prefixed literal subtree",
			filter:           `"a/x" in explicit_tags`,
			subtree:          true,
			descendantsExist: true,
			expected:         `"b/x" in explicit_tags`,
			changed:          true,
		},
		{
			name:     "prefixed literal without subtree",
			filter:   `"a/x" in explicit_tags`,
			subtree:  false,
			expected: `"a/x" in explicit_tags`,
			changed:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rewritten, changed := RewriteViewFilter(tt.filter, "a", "b", tt.subtree, tt.descendantsExist)
			assert.Equal(t, tt.expected, rewritten)
			assert.Equal(t, tt.changed, changed)
		})
	}
}

func TestRewriteViewFilterDelete(t *testing.T) {
	tests := []struct {
		name             string
		filter           string
		subtree          bool
		descendantsExist bool
		expected         string
		changed          bool
	}{
		{name: "explicit membership", filter: `"a" in explicit_tags`, expected: `"/" in explicit_tags`, changed: true},
		{name: "hierarchy with descendants", filter: `"a" in tags`, descendantsExist: true, expected: `"a" in tags`, changed: false},
		{name: "hierarchy without descendants", filter: `"a" in tags`, expected: `"/" in tags`, changed: true},
		{
			name:     "prefix subtree",
			filter:   `tags.exists(t, t.startsWith("a/"))`,
			subtree:  true,
			expected: `tags.exists(t, t.startsWith("/"))`,
			changed:  true,
		},
		{name: "prefix without subtree", filter: `tags.exists(t, t.startsWith("a/"))`, expected: `tags.exists(t, t.startsWith("a/"))`, changed: false},
		{name: "negated clause", filter: `!("a" in explicit_tags)`, expected: `!("/" in explicit_tags)`, changed: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rewritten, changed := RewriteViewFilter(tt.filter, "a", "", tt.subtree, tt.descendantsExist)
			assert.Equal(t, tt.expected, rewritten)
			assert.Equal(t, tt.changed, changed)
		})
	}
}

func TestRuleKeyReferenced(t *testing.T) {
	assert.True(t, RuleKeyReferenced("a", "a", false))
	assert.True(t, RuleKeyReferenced("a/b", "a", true))
	assert.False(t, RuleKeyReferenced("a/b", "a", false))
	assert.True(t, RuleKeyReferenced("a.*", "a", false))
	assert.True(t, RuleKeyReferenced("a/.*", "a/b", false))
	assert.False(t, RuleKeyReferenced("b", "a", false))
}

func TestRenameRuleKey(t *testing.T) {
	renamed, ok := RenameRuleKey("a", "a", "b", false)
	assert.True(t, ok)
	assert.Equal(t, "b", renamed)

	renamed, ok = RenameRuleKey("a/x", "a", "b", true)
	assert.True(t, ok)
	assert.Equal(t, "b/x", renamed)

	_, ok = RenameRuleKey("a/x", "a", "b", false)
	assert.False(t, ok)

	_, ok = RenameRuleKey("a.*", "a", "b", false)
	assert.False(t, ok)
}
