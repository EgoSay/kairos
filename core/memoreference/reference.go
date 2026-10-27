// Package memoreference identifies current-instance record links in Markdown.
package memoreference

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/EgoSay/kairos/markdown"
)

var recordPath = regexp.MustCompile(`^/memos/([A-Za-z0-9_-]+)/?$`)

// Targets returns distinct record UIDs from real Markdown links, never code or images.
// Absolute URLs must match the configured instance; root-relative links are portable.
func Targets(content, instanceURL string, parser markdown.Service) ([]string, error) {
	data, err := parser.ExtractAll([]byte(content))
	if err != nil {
		return nil, err
	}
	base, _ := url.Parse(instanceURL)
	seen := make(map[string]bool)
	var targets []string
	for _, destination := range data.LinkDestinations {
		link, err := url.Parse(destination)
		if err != nil || link.User != nil || strings.ContainsAny(destination, "\\\t\r\n ") {
			continue
		}
		if link.IsAbs() {
			if base == nil || (link.Scheme != "http" && link.Scheme != "https") || !strings.EqualFold(link.Scheme, base.Scheme) || !strings.EqualFold(link.Host, base.Host) {
				continue
			}
		} else if link.Host != "" || !strings.HasPrefix(destination, "/") {
			continue
		}
		match := recordPath.FindStringSubmatch(link.EscapedPath())
		if match != nil && !seen[match[1]] {
			seen[match[1]] = true
			targets = append(targets, match[1])
		}
	}
	return targets, nil
}
