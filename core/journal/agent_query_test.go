package journal

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAgentFilterUsesLocalOriginalDatesAndCalendarDST(t *testing.T) {
	for _, tc := range []struct{ date, start, end string }{
		{"2026-03-08", "2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00"},
		{"2026-11-01", "2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00"},
	} {
		filter, from, to, err := AgentFilter(AgentQuery{Date: tc.date}, "America/New_York", time.Now())
		require.NoError(t, err)
		require.Equal(t, tc.date, from)
		require.Equal(t, from, to)
		require.Contains(t, filter, `created_ts >= timestamp("`+tc.start+`")`)
		require.Contains(t, filter, `created_ts < timestamp("`+tc.end+`")`)
	}
	now, err := time.Parse(time.RFC3339, "2026-10-10T18:00:00Z")
	require.NoError(t, err)
	_, from, to, err := AgentFilter(AgentQuery{Today: true}, "Asia/Shanghai", now)
	require.NoError(t, err)
	require.Equal(t, "2026-10-11", from)
	require.Equal(t, from, to)
}

func TestAgentFilterRejectsAmbiguityAndPreservesLiterals(t *testing.T) {
	for _, q := range []AgentQuery{{Today: true, Date: "2026-10-10"}, {Date: "2026-02-30"}, {From: "2026-10-11", To: "2026-10-10"}, {Date: "2026-1-1"}} {
		_, _, _, err := AgentFilter(q, "Asia/Shanghai", time.Now())
		require.Error(t, err)
	}
	pinned := false
	filter, _, _, err := AgentFilter(AgentQuery{Keyword: "中文 \"特殊\"\n", Tag: "人生修行", IncludeSubtags: true, PartitionID: "partition", Pinned: &pinned}, "Asia/Shanghai", time.Now())
	require.NoError(t, err)
	require.Contains(t, filter, `content.contains("中文 \"特殊\"\n")`)
	require.Contains(t, filter, `("人生修行" in tags || tags.exists(t, t.startsWith("人生修行/")))`)
	require.Contains(t, filter, `journal_partition == "partition"`)
	require.Contains(t, filter, `pinned == false`)
}

func TestAgentExactTagUsesAuthoredIndex(t *testing.T) {
	filter, _, _, err := AgentFilter(AgentQuery{Tag: "人生修行", IncludeSubtags: false}, "Asia/Shanghai", time.Now())
	require.NoError(t, err)
	require.Equal(t, `"人生修行" in explicit_tags`, filter)
}
