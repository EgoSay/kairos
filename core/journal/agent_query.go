package journal

import (
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// AgentQuery expresses journal reads without exposing the filter language.
type AgentQuery struct {
	Today                                     bool
	Date, From, To, Keyword, Tag, PartitionID string
	IncludeSubtags                            bool
	Pinned                                    *bool
}

// AgentFilter uses original record dates in the owner's configured timezone.
// To is inclusive; local calendar arithmetic preserves DST boundaries.
func AgentFilter(query AgentQuery, zone string, now time.Time) (filter, from, to string, err error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return "", "", "", errors.New("invalid journal timezone")
	}
	if query.Today && (query.Date != "" || query.From != "" || query.To != "") || query.Date != "" && (query.From != "" || query.To != "") {
		return "", "", "", errors.New("use today, date, or from/to, not a combination")
	}
	from, to = query.From, query.To
	if query.Today {
		query.Date = now.In(loc).Format(time.DateOnly)
	}
	if query.Date != "" {
		from, to = query.Date, query.Date
	}
	parts := []string{}
	var start, end time.Time
	if from != "" {
		start, err = time.ParseInLocation(time.DateOnly, from, loc)
		if err != nil {
			return "", "", "", errors.New("from/date must be YYYY-MM-DD")
		}
		parts = append(parts, "created_ts >= timestamp("+strconv.Quote(start.Format(time.RFC3339))+")")
	}
	if to != "" {
		end, err = time.ParseInLocation(time.DateOnly, to, loc)
		if err != nil {
			return "", "", "", errors.New("to/date must be YYYY-MM-DD")
		}
		if !start.IsZero() && end.Before(start) {
			return "", "", "", errors.New("to must not precede from")
		}
		parts = append(parts, "created_ts < timestamp("+strconv.Quote(end.AddDate(0, 0, 1).Format(time.RFC3339))+")")
	}
	if query.Keyword != "" {
		parts = append(parts, "content.contains("+strconv.Quote(query.Keyword)+")")
	}
	if query.Tag != "" {
		predicate := strconv.Quote(query.Tag) + " in tags"
		if query.IncludeSubtags {
			predicate = "(" + predicate + " || tags.exists(t, t.startsWith(" + strconv.Quote(query.Tag+"/") + ")))"
		}
		parts = append(parts, predicate)
	}
	if query.PartitionID != "" {
		parts = append(parts, "journal_partition == "+strconv.Quote(query.PartitionID))
	}
	if query.Pinned != nil {
		parts = append(parts, "pinned == "+strconv.FormatBool(*query.Pinned))
	}
	return strings.Join(parts, " && "), from, to, nil
}
