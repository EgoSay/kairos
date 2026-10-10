package mcp

import (
	"net/http"

	"github.com/labstack/echo/v5"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/EgoSay/kairos/internal/profile"
)

// newJournalMCPHandler exposes only the owner-scoped journal read contract.
// Credential restrictions are enforced again by the API, including when the
// same token is presented to the legacy MCP or any other transport.
func newJournalMCPHandler(p *profile.Profile, echoServer *echo.Echo) http.Handler {
	version := "dev"
	if p != nil && p.Version != "" {
		version = p.Version
	}
	server := sdkmcp.NewServer(&sdkmcp.Implementation{Name: "kairos-journal", Version: version}, &sdkmcp.ServerOptions{Capabilities: &sdkmcp.ServerCapabilities{Tools: &sdkmcp.ToolCapabilities{}}})
	server.AddReceivingMiddleware(catalogCacheMiddleware)
	adapter := newAPIAdapter(echoServer)
	for _, operation := range journalReadOperations() {
		tool, registered := buildToolFromOperation(operation)
		server.AddTool(tool, newMCPToolHandler(adapter, registered))
	}
	return sdkmcp.NewStreamableHTTPHandler(func(*http.Request) *sdkmcp.Server { return server }, &sdkmcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 1 << 20, DisableLocalhostProtection: true})
}

func journalReadOperations() []*openAPIOperation {
	stringParam := func(name, description string) openAPIParameter {
		return openAPIParameter{Name: name, In: "query", Description: description, Schema: jsonSchema{"type": "string"}}
	}
	query := []openAPIParameter{
		{Name: "today", In: "query", Description: "Read today's records in the owner's Kairos timezone. Cannot combine with date/from/to.", Schema: jsonSchema{"type": "boolean"}},
		stringParam("date", "One local date YYYY-MM-DD, using original record date, including imported records."),
		stringParam("from", "Inclusive local start date YYYY-MM-DD."), stringParam("to", "Inclusive local end date YYYY-MM-DD."),
		stringParam("keyword", "Literal text to find in full original content."), stringParam("tag", "Exact tag path, such as 人生修行/阅读."),
		{Name: "includeSubtags", In: "query", Description: "Include descendants of tag (default true), matching full path segments.", Schema: jsonSchema{"type": "boolean"}},
		stringParam("partitionId", "Private partition ID returned by journal_get_context."),
		{Name: "pinned", In: "query", Description: "Optional pinned state; omitted includes both.", Schema: jsonSchema{"type": "boolean"}},
		{Name: "pageSize", In: "query", Description: "Records per page (1–100; default 50).", Schema: jsonSchema{"type": "integer", "minimum": 1, "maximum": 100}},
		stringParam("pageToken", "Copy nextPageToken from the prior response without changing query parameters. Continue until hasMore is false."),
	}
	name := stringParam("name", "Record resource name memos/{uid}, returned by journal_query_records.")
	name.Required = true
	object := jsonSchema{"type": "object"}
	return []*openAPIOperation{
		{OperationID: "JournalService_GetContext", Method: http.MethodGet, Path: "/api/v1/journal/agent/context", ResponseSchema: object, Description: "Read the authenticated journal owner, configured timezone, today's local date, available partitions and reading guidance. Confirms credential authorization; no mutation."},
		{OperationID: "JournalService_QueryRecords", Method: http.MethodGet, Path: "/api/v1/journal/agent/records", Parameters: query, ResponseSchema: object, Description: "Read complete original journal text with combinable date, keyword, nested tag, partition and pinned filters. Includes the owner's normal and archived records; excludes trash. Always report coverage and follow all nextPageToken pages before claiming completeness. Cite sourceUrl; distinguish original facts from AI interpretations. Never infer from unread records."},
		{OperationID: "JournalService_GetRecord", Method: http.MethodGet, Path: "/api/v1/journal/agent/record", Parameters: []openAPIParameter{name}, ResponseSchema: object, Description: "Read one complete owner-only record and its original source link. Content is not truncated. Trash and other owners' records are unavailable."},
	}
}
