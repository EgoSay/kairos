package markdown

import (
	"bytes"
	"cmp"
	"net/url"
	"slices"
	"strings"

	"github.com/pkg/errors"

	"github.com/yuin/goldmark"
	gast "github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"

	"github.com/EgoSay/kairos/internal/identifier"
	mast "github.com/EgoSay/kairos/markdown/ast"
	"github.com/EgoSay/kairos/markdown/extensions"
	mparser "github.com/EgoSay/kairos/markdown/parser"
	"github.com/EgoSay/kairos/markdown/renderer"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
)

// ManagedAttachmentReference is an attachment URL embedded using Markdown image syntax.
type ManagedAttachmentReference struct {
	UID string
}

// ExtractedData contains all metadata extracted from markdown in a single pass.
type ExtractedData struct {
	Tags                               []string
	ExplicitTags                       []string
	Mentions                           []string
	ImageDestinations                  []string
	LinkDestinations                   []string
	ManagedAttachmentReferences        []ManagedAttachmentReference
	InvalidManagedAttachmentReferences []string
	Property                           *storepb.MemoPayload_Property
}

// Service handles markdown metadata extraction.
// It uses goldmark to parse markdown and extract tags, properties, and snippets.
type Service interface {
	// ExtractAll extracts tags, properties, and references in a single parse (most efficient)
	ExtractAll(content []byte) (*ExtractedData, error)

	// ExtractTags returns all #tags found in content
	ExtractTags(content []byte) ([]string, error)

	// ExtractProperties computes boolean properties
	ExtractProperties(content []byte) (*storepb.MemoPayload_Property, error)

	// RenderMarkdown renders goldmark AST back to markdown text
	RenderMarkdown(content []byte) (string, error)

	// GenerateSnippet creates plain text summary
	GenerateSnippet(content []byte, maxLength int) (string, error)

	// ValidateContent checks for syntax errors
	ValidateContent(content []byte) error

	// RenameTag renames all occurrences of oldTag to newTag in content
	RenameTag(content []byte, oldTag, newTag string) (string, error)

	// RenameTagTree renames oldTag and every descendant path (oldTag/...)
	// to the matching newTag-prefixed path in content
	RenameTagTree(content []byte, oldTag, newTag string) (string, error)

	// RemoveTags deletes authored tokens for the given tags from content.
	// When includeDescendants is true, tags nested under a listed tag are
	// removed as well. Whitespace and lines left empty by removals are
	// collapsed.
	RemoveTags(content []byte, tags []string, includeDescendants bool) (string, error)

	// AppendTags appends formatted tag tokens on a new line at the end of
	// content and verifies they re-extract as authored tags
	AppendTags(content []byte, tags []string) (string, error)
}

// service implements the Service interface.
type service struct {
	md goldmark.Markdown
}

// Option configures the markdown service.
type Option func(*config)

type config struct {
	enableTags     bool
	enableMentions bool
}

// WithTagExtension enables #tag parsing.
func WithTagExtension() Option {
	return func(c *config) {
		c.enableTags = true
	}
}

// WithMentionExtension enables @mention parsing.
func WithMentionExtension() Option {
	return func(c *config) {
		c.enableMentions = true
	}
}

// NewService creates a new markdown service with the given options.
func NewService(opts ...Option) Service {
	cfg := &config{}
	for _, opt := range opts {
		opt(cfg)
	}

	exts := []goldmark.Extender{
		extension.Table,
		extension.Strikethrough,
		extension.TaskList,
		extensions.NewGFMLinkify(),
	}

	// Add custom extensions based on config
	if cfg.enableTags {
		exts = append(exts, extensions.TagExtension)
	}
	if cfg.enableMentions {
		exts = append(exts, extensions.MentionExtension)
	}

	md := goldmark.New(
		goldmark.WithExtensions(exts...),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(), // Generate heading IDs
		),
	)

	return &service{
		md: md,
	}
}

// parse is an internal helper to parse content into AST.
func (s *service) parse(content []byte) (gast.Node, error) {
	reader := text.NewReader(content)
	doc := s.md.Parser().Parse(reader)
	if masked := maskInvalidLinkReferenceDefinitions(doc, content); masked != nil {
		doc = s.md.Parser().Parse(text.NewReader(masked))
	}
	return doc, nil
}

func isTagNodeInLinkOrImage(n gast.Node) bool {
	for parent := n.Parent(); parent != nil; parent = parent.Parent() {
		switch parent.Kind() {
		case gast.KindLink, gast.KindImage:
			return true
		default:
			// Keep walking ancestors.
		}
	}
	return false
}

func asMemoTagNode(n gast.Node) (*mast.TagNode, bool) {
	tagNode, ok := n.(*mast.TagNode)
	if !ok || isTagNodeInLinkOrImage(n) {
		return nil, false
	}
	return tagNode, true
}

func appendTagHierarchy(tags []string, value string) []string {
	for offset := 0; ; {
		separator := strings.IndexByte(value[offset:], '/')
		if separator < 0 {
			return append(tags, value)
		}
		offset += separator + 1
		tags = append(tags, value[:offset-1])
	}
}

// ExtractTags returns all #tags found in content.
func (s *service) ExtractTags(content []byte) ([]string, error) {
	root, err := s.parse(content)
	if err != nil {
		return nil, err
	}

	var tags []string
	// Walk the AST to find tag nodes
	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering {
			return gast.WalkContinue, nil
		}

		if tagNode, ok := asMemoTagNode(n); ok {
			tags = appendTagHierarchy(tags, string(tagNode.Tag))
		}

		return gast.WalkContinue, nil
	})

	if err != nil {
		return nil, err
	}

	// Deduplicate tags while preserving original case
	return uniquePreserveCase(tags), nil
}

// extractHeadingText extracts plain text content from a heading node.
func extractHeadingText(n gast.Node, source []byte) string {
	var buf strings.Builder
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		extractTextFromNode(child, source, &buf)
	}
	return buf.String()
}

// extractTextFromNode recursively extracts plain text from a node and its children.
func extractTextFromNode(n gast.Node, source []byte, buf *strings.Builder) {
	if textNode, ok := n.(*gast.Text); ok {
		buf.Write(textNode.Segment.Value(source))
		return
	}
	if mathNode, ok := n.(*mast.InlineMathNode); ok {
		buf.Write(mathNode.Source)
		return
	}
	if emailNode, ok := n.(*mast.GFMEmailNode); ok {
		buf.Write(emailNode.Address)
		return
	}
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		extractTextFromNode(child, source, buf)
	}
}

// ExtractProperties computes boolean properties about the content.
func (s *service) ExtractProperties(content []byte) (*storepb.MemoPayload_Property, error) {
	root, err := s.parse(content)
	if err != nil {
		return nil, err
	}

	prop := &storepb.MemoPayload_Property{}
	firstBlockChecked := false

	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering {
			return gast.WalkContinue, nil
		}

		// Check if the first block-level child of the document is an H1 heading.
		if !firstBlockChecked && n.Parent() != nil && n.Parent().Kind() == gast.KindDocument {
			firstBlockChecked = true
			if heading, ok := n.(*gast.Heading); ok && heading.Level == 1 {
				prop.Title = extractHeadingText(n, content)
			}
		}

		switch n.Kind() {
		case gast.KindLink, gast.KindAutoLink, mast.KindGFMEmail:
			prop.HasLink = true

		case gast.KindCodeBlock, gast.KindFencedCodeBlock, gast.KindCodeSpan:
			prop.HasCode = true

		case east.KindTaskCheckBox:
			prop.HasTaskList = true
			if checkBox, ok := n.(*east.TaskCheckBox); ok {
				if !checkBox.IsChecked {
					prop.HasIncompleteTasks = true
				}
			}
		default:
			// No special handling for other node types
		}

		return gast.WalkContinue, nil
	})

	if err != nil {
		return nil, err
	}

	return prop, nil
}

// RenderMarkdown renders goldmark AST back to markdown text.
func (s *service) RenderMarkdown(content []byte) (string, error) {
	root, err := s.parse(content)
	if err != nil {
		return "", err
	}

	mdRenderer := renderer.NewMarkdownRenderer()
	return mdRenderer.Render(root, content), nil
}

// GenerateSnippet creates a plain text summary from markdown content.
func (s *service) GenerateSnippet(content []byte, maxLength int) (string, error) {
	root, err := s.parse(content)
	if err != nil {
		return "", err
	}

	var buf strings.Builder
	var lastNodeWasBlock bool

	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if entering {
			// Skip code blocks entirely (but keep inline code spans for snippet text)
			switch n.Kind() {
			case gast.KindCodeBlock, gast.KindFencedCodeBlock:
				return gast.WalkSkipChildren, nil
			default:
				// Continue walking for other node types
			}

			// Add space before block elements (except first)
			switch n.Kind() {
			case gast.KindParagraph, gast.KindHeading, gast.KindListItem, east.KindTableCell, east.KindTableRow, east.KindTableHeader:
				if buf.Len() > 0 && lastNodeWasBlock {
					buf.WriteByte(' ')
				}
			default:
				// No space needed for other node types
			}
		}

		if !entering {
			// Mark that we just exited a block element
			switch n.Kind() {
			case gast.KindParagraph, gast.KindHeading, gast.KindListItem, east.KindTableCell, east.KindTableRow, east.KindTableHeader:
				lastNodeWasBlock = true
			default:
				// Not a block element
			}
			return gast.WalkContinue, nil
		}

		lastNodeWasBlock = false

		// Extract text from various node types
		switch node := n.(type) {
		case *gast.Text:
			segment := node.Segment
			buf.Write(segment.Value(content))
			if node.SoftLineBreak() {
				buf.WriteByte(' ')
			}
		case *gast.AutoLink:
			buf.Write(node.URL(content))
			return gast.WalkSkipChildren, nil
		case *mast.TagNode:
			if len(node.Source) > 0 {
				buf.Write(node.Source)
			} else {
				buf.WriteByte('#')
				buf.Write(node.Tag)
			}
		case *mast.GFMEmailNode:
			buf.Write(node.Address)
		case *mast.InlineMathNode:
			buf.Write(node.Source)
		case *mast.BlockMathNode:
			buf.Write(node.Source)
			return gast.WalkSkipChildren, nil
		default:
			// Ignore other node types.
		}

		// Stop walking if we've exceeded double the max length
		// (we'll truncate precisely later)
		if buf.Len() > maxLength*2 {
			return gast.WalkStop, nil
		}

		return gast.WalkContinue, nil
	})

	if err != nil {
		return "", err
	}

	snippet := buf.String()

	// Truncate at word boundary if needed
	if len(snippet) > maxLength {
		snippet = truncateAtWord(snippet, maxLength)
	}

	return strings.TrimSpace(snippet), nil
}

// ValidateContent checks if the markdown content is valid.
func (s *service) ValidateContent(content []byte) error {
	// Try to parse the content
	_, err := s.parse(content)
	return err
}

// ExtractAll extracts tags, properties, and references in a single parse for efficiency.
func (s *service) ExtractAll(content []byte) (*ExtractedData, error) {
	root, err := s.parse(content)
	if err != nil {
		return nil, err
	}

	data := &ExtractedData{
		Tags:                        []string{},
		ExplicitTags:                []string{},
		Mentions:                    []string{},
		ImageDestinations:           []string{},
		ManagedAttachmentReferences: []ManagedAttachmentReference{},
		Property:                    &storepb.MemoPayload_Property{},
	}

	firstBlockChecked := false
	// Single walk to collect all data
	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering {
			return gast.WalkContinue, nil
		}

		if tagNode, ok := asMemoTagNode(n); ok {
			data.Tags = appendTagHierarchy(data.Tags, string(tagNode.Tag))
			data.ExplicitTags = append(data.ExplicitTags, string(tagNode.Tag))
		}
		if mentionNode, ok := n.(*mast.MentionNode); ok {
			data.Mentions = append(data.Mentions, string(mentionNode.Username))
		}
		switch link := n.(type) {
		case *gast.Link:
			data.LinkDestinations = append(data.LinkDestinations, string(link.Destination))
		case *gast.AutoLink:
			data.LinkDestinations = append(data.LinkDestinations, string(link.URL(content)))
		default:
			// Other nodes do not contribute Markdown link destinations.
		}
		if imageNode, ok := n.(*gast.Image); ok {
			destination := string(imageNode.Destination)
			data.ImageDestinations = append(data.ImageDestinations, destination)
			uid, managed, valid := ParseManagedAttachmentImageURL(destination)
			if managed && !valid {
				data.InvalidManagedAttachmentReferences = append(data.InvalidManagedAttachmentReferences, string(imageNode.Destination))
			} else if managed {
				data.ManagedAttachmentReferences = append(data.ManagedAttachmentReferences, ManagedAttachmentReference{UID: uid})
			}
		}
		if raw, ok := extractRawHTML(n, content); ok {
			if strings.Contains(raw, "/file/attachments/") {
				// Managed attachment URLs are deliberately supported only through
				// Markdown image nodes. Raw HTML would require a second, security-
				// sensitive HTML parser to enforce equivalent URL rules.
				data.InvalidManagedAttachmentReferences = append(data.InvalidManagedAttachmentReferences, raw)
			}
		}

		// Check if the first block-level child of the document is an H1 heading.
		if !firstBlockChecked && n.Parent() != nil && n.Parent().Kind() == gast.KindDocument {
			firstBlockChecked = true
			if heading, ok := n.(*gast.Heading); ok && heading.Level == 1 {
				data.Property.Title = extractHeadingText(n, content)
			}
		}

		// Extract properties based on node kind
		switch n.Kind() {
		case gast.KindLink, gast.KindAutoLink, mast.KindGFMEmail:
			data.Property.HasLink = true

		case gast.KindCodeBlock, gast.KindFencedCodeBlock, gast.KindCodeSpan:
			data.Property.HasCode = true

		case east.KindTaskCheckBox:
			data.Property.HasTaskList = true
			if checkBox, ok := n.(*east.TaskCheckBox); ok {
				if !checkBox.IsChecked {
					data.Property.HasIncompleteTasks = true
				}
			}
		default:
			// No special handling for other node types
		}

		return gast.WalkContinue, nil
	})

	if err != nil {
		return nil, err
	}

	// Deduplicate tags while preserving original case
	data.Tags = uniquePreserveCase(data.Tags)
	data.ExplicitTags = uniquePreserveCase(data.ExplicitTags)
	data.Mentions = uniquePreserveCase(data.Mentions)
	data.ManagedAttachmentReferences = uniqueManagedAttachmentReferences(data.ManagedAttachmentReferences)
	data.InvalidManagedAttachmentReferences = uniquePreserveCase(data.InvalidManagedAttachmentReferences)

	return data, nil
}

func extractRawHTML(node gast.Node, source []byte) (string, bool) {
	switch node := node.(type) {
	case *gast.RawHTML:
		return string(node.Segments.Value(source)), true
	case *gast.HTMLBlock:
		raw := append([]byte(nil), node.Lines().Value(source)...)
		if node.HasClosure() {
			raw = append(raw, node.ClosureLine.Value(source)...)
		}
		return string(raw), true
	default:
		return "", false
	}
}

// ParseManagedAttachmentImageURL parses a same-origin relative managed image URL.
// Absolute URL origin matching is intentionally left to callers that know the
// configured instance URL.
func ParseManagedAttachmentImageURL(raw string) (uid string, managed, valid bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.IsAbs() || parsed.Host != "" {
		return "", false, false
	}
	if !strings.HasPrefix(parsed.Path, "/file/attachments/") {
		return "", false, false
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.RawPath != "" || strings.Contains(parsed.EscapedPath(), "%") {
		return "", true, false
	}

	parts := strings.Split(strings.TrimPrefix(parsed.Path, "/file/attachments/"), "/")
	if (len(parts) != 1 && len(parts) != 2) || !identifier.UIDMatcher.MatchString(parts[0]) {
		return "", true, false
	}
	if len(parts) == 2 && parts[1] == "" {
		return "", true, false
	}
	return parts[0], true, true
}

func uniqueManagedAttachmentReferences(references []ManagedAttachmentReference) []ManagedAttachmentReference {
	seen := make(map[string]struct{}, len(references))
	result := make([]ManagedAttachmentReference, 0, len(references))
	for _, reference := range references {
		if _, ok := seen[reference.UID]; ok {
			continue
		}
		seen[reference.UID] = struct{}{}
		result = append(result, reference)
	}
	return result
}

// RenameTag renames all occurrences of oldTag to newTag in content.
func (s *service) RenameTag(content []byte, oldTag, newTag string) (string, error) {
	return s.rewriteTagTokens(content, func(tag string) (string, bool) {
		return newTag, tag == oldTag
	})
}

// RenameTagTree renames oldTag and every descendant path to the matching
// newTag-prefixed path in content.
func (s *service) RenameTagTree(content []byte, oldTag, newTag string) (string, error) {
	return s.rewriteTagTokens(content, func(tag string) (string, bool) {
		if tag == oldTag {
			return newTag, true
		}
		if suffix, ok := strings.CutPrefix(tag, oldTag+"/"); ok {
			return newTag + "/" + suffix, true
		}
		return "", false
	})
}

// rewriteTagTokens replaces the source spelling of every authored tag token
// for which replacement returns ok, preserving all other bytes.
func (s *service) rewriteTagTokens(content []byte, replacement func(tag string) (string, bool)) (string, error) {
	root, err := s.parse(content)
	if err != nil {
		return "", err
	}

	type sourceRange struct {
		start int
		end   int
		tag   string
	}
	var ranges []sourceRange
	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering {
			return gast.WalkContinue, nil
		}

		if tagNode, ok := asMemoTagNode(n); ok {
			if tag, ok := replacement(string(tagNode.Tag)); ok && len(tagNode.Source) > 0 {
				ranges = append(ranges, sourceRange{start: tagNode.Pos(), end: tagNode.Pos() + len(tagNode.Source), tag: tag})
			}
		}

		return gast.WalkContinue, nil
	})

	if err != nil {
		return "", err
	}

	slices.SortFunc(ranges, func(left, right sourceRange) int { return cmp.Compare(left.start, right.start) })
	var output bytes.Buffer
	output.Grow(len(content))
	cursor := 0
	for _, sourceRange := range ranges {
		output.Write(content[cursor:sourceRange.start])
		if spelling, ok := mparser.FormatTag(sourceRange.tag); ok {
			output.WriteString(spelling)
		} else {
			output.WriteByte('#')
			output.WriteString(sourceRange.tag)
		}
		cursor = sourceRange.end
	}
	output.Write(content[cursor:])
	return output.String(), nil
}

type sourceRange struct {
	start int
	end   int
}

// RemoveTags deletes authored tokens for the given tags from content.
func (s *service) RemoveTags(content []byte, tags []string, includeDescendants bool) (string, error) {
	root, err := s.parse(content)
	if err != nil {
		return "", err
	}

	wanted := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		wanted[tag] = struct{}{}
	}
	matches := func(tag string) bool {
		if _, ok := wanted[tag]; ok {
			return true
		}
		if includeDescendants {
			for parent := range wanted {
				if strings.HasPrefix(tag, parent+"/") {
					return true
				}
			}
		}
		return false
	}

	var tokens []sourceRange
	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering {
			return gast.WalkContinue, nil
		}
		if tagNode, ok := asMemoTagNode(n); ok && matches(string(tagNode.Tag)) && len(tagNode.Source) > 0 {
			tokens = append(tokens, sourceRange{start: tagNode.Pos(), end: tagNode.Pos() + len(tagNode.Source)})
		}
		return gast.WalkContinue, nil
	})
	if err != nil {
		return "", err
	}
	if len(tokens) == 0 {
		return string(content), nil
	}

	slices.SortFunc(tokens, func(left, right sourceRange) int { return cmp.Compare(left.start, right.start) })

	// A removal that empties its line takes the whole line (and its newline)
	// with it; a removal inside surviving text absorbs one adjacent run of
	// horizontal whitespace so no double gaps remain.
	var spans []sourceRange
	for _, token := range tokens {
		lineStart, lineEnd := tagLineSpan(content, token.start)
		if removalEmptiesLine(content, lineStart, lineEnd, tokens) {
			if lineEnd < len(content) {
				spans = append(spans, sourceRange{start: lineStart, end: lineEnd + 1})
			} else if lineStart > 0 {
				spans = append(spans, sourceRange{start: lineStart - 1, end: lineEnd})
			} else {
				spans = append(spans, sourceRange{start: lineStart, end: lineEnd})
			}
			continue
		}
		spans = append(spans, absorbTagWhitespace(content, lineStart, lineEnd, token))
	}

	return applySourceSpans(content, mergeSourceSpans(spans)), nil
}

// tagLineSpan returns the bounds of the line containing pos, excluding the
// trailing newline.
func tagLineSpan(content []byte, pos int) (int, int) {
	start := bytes.LastIndexByte(content[:pos], '\n') + 1
	end := len(content)
	if idx := bytes.IndexByte(content[pos:], '\n'); idx >= 0 {
		end = pos + idx
	}
	return start, end
}

func isTagWhitespace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\r'
}

// removalEmptiesLine reports whether every non-whitespace byte on the line is
// covered by one of the removal token ranges.
func removalEmptiesLine(content []byte, lineStart, lineEnd int, tokens []sourceRange) bool {
	for pos := lineStart; pos < lineEnd; {
		covered := false
		for _, token := range tokens {
			if pos >= token.start && pos < token.end {
				pos = token.end
				covered = true
				break
			}
		}
		if covered {
			continue
		}
		if !isTagWhitespace(content[pos]) {
			return false
		}
		pos++
	}
	return true
}

// absorbTagWhitespace expands a token removal to consume the whitespace gap
// on one side, preferring the trailing gap when more content follows.
func absorbTagWhitespace(content []byte, lineStart, lineEnd int, token sourceRange) sourceRange {
	right := token.end
	for right < lineEnd && isTagWhitespace(content[right]) {
		right++
	}
	if right < lineEnd {
		return sourceRange{start: token.start, end: right}
	}
	left := token.start
	for left > lineStart && isTagWhitespace(content[left-1]) {
		left--
	}
	return sourceRange{start: left, end: token.end}
}

// mergeSourceSpans sorts spans and merges overlapping or adjacent ranges.
func mergeSourceSpans(spans []sourceRange) []sourceRange {
	slices.SortFunc(spans, func(left, right sourceRange) int { return cmp.Compare(left.start, right.start) })
	var merged []sourceRange
	for _, span := range spans {
		if len(merged) > 0 && span.start <= merged[len(merged)-1].end {
			if span.end > merged[len(merged)-1].end {
				merged[len(merged)-1].end = span.end
			}
			continue
		}
		merged = append(merged, span)
	}
	return merged
}

// applySourceSpans returns content with every span removed.
func applySourceSpans(content []byte, spans []sourceRange) string {
	var output bytes.Buffer
	output.Grow(len(content))
	cursor := 0
	for _, span := range spans {
		output.Write(content[cursor:span.start])
		cursor = span.end
	}
	output.Write(content[cursor:])
	return output.String()
}

// AppendTags appends formatted tag tokens on a new line at the end of content
// and verifies they re-extract as authored tags.
func (s *service) AppendTags(content []byte, tags []string) (string, error) {
	formatted := make([]string, 0, len(tags))
	for _, tag := range tags {
		spelling, ok := mparser.FormatTag(tag)
		if !ok {
			return "", errors.Errorf("invalid tag name %q", tag)
		}
		formatted = append(formatted, spelling)
	}
	if len(formatted) == 0 {
		return string(content), nil
	}

	tagLine := strings.Join(formatted, " ")
	text := strings.TrimRight(string(content), " \t")
	switch {
	case text == "":
		text = tagLine
	case strings.HasSuffix(text, "\n"):
		text += tagLine
	default:
		text += "\n" + tagLine
	}

	// An unclosed fence or HTML block would silently swallow the appended
	// line; re-extracting proves the tags became real authored tokens.
	extracted, err := s.ExtractAll([]byte(text))
	if err != nil {
		return "", err
	}
	have := make(map[string]struct{}, len(extracted.ExplicitTags))
	for _, tag := range extracted.ExplicitTags {
		have[tag] = struct{}{}
	}
	for _, tag := range tags {
		if _, ok := have[tag]; !ok {
			return "", errors.Errorf("tag %q cannot be appended to this content", tag)
		}
	}
	return text, nil
}

// uniquePreserveCase returns unique strings from input while preserving case.
func uniquePreserveCase(strs []string) []string {
	seen := make(map[string]struct{})
	var result []string

	for _, s := range strs {
		if _, exists := seen[s]; !exists {
			seen[s] = struct{}{}
			result = append(result, s)
		}
	}

	return result
}

// truncateAtWord truncates a string at the last word boundary before maxLength.
// maxLength is treated as a rune (character) count to properly handle UTF-8 multi-byte characters.
func truncateAtWord(s string, maxLength int) string {
	// Convert to runes to properly handle multi-byte UTF-8 characters
	runes := []rune(s)
	if len(runes) <= maxLength {
		return s
	}

	// Truncate to max length (by character count, not byte count)
	truncated := string(runes[:maxLength])

	// Find last space to avoid cutting in the middle of a word
	lastSpace := strings.LastIndexAny(truncated, " \t\n\r")
	if lastSpace > 0 {
		truncated = truncated[:lastSpace]
	}

	return truncated + " ..."
}
