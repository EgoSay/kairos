package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/internal/profile"
)

func TestJournalMCPProtocolReadCatalogAndAuthorization(t *testing.T) {
	router := echo.New()
	router.GET("/api/v1/journal/agent/context", func(c *echo.Context) error {
		if c.Request().Header.Get("Authorization") != "Bearer readonly" {
			return c.JSON(401, map[string]string{"message": "authentication required"})
		}
		return c.JSON(200, map[string]any{"readOnlyCredential": true, "timezone": "Asia/Shanghai", "today": "2026-10-11"})
	})
	router.GET("/api/v1/journal/agent/records", func(c *echo.Context) error {
		require.Equal(t, "Bearer readonly", c.Request().Header.Get("Authorization"))
		require.Equal(t, "2020-01-01", c.QueryParam("date"))
		require.Equal(t, "1", c.QueryParam("pageSize"))
		return c.JSON(200, map[string]any{"records": []map[string]string{{"content": "完整原文，保留 Markdown **文字**", "sourceUrl": "https://journal.test/memos/example"}}, "nextPageToken": "next", "coverage": map[string]bool{"hasMore": true, "completeInThisResponse": false}})
	})
	service, err := NewMCPService(&profile.Profile{Version: "test"}, router)
	require.NoError(t, err)
	service.RegisterRoutes(router)
	call := func(token, method string, params map[string]any) map[string]any {
		data, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
		require.NoError(t, err)
		r := httptest.NewRequest(http.MethodPost, "/mcp/journal", bytes.NewReader(data))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("MCP-Protocol-Version", "2025-06-18")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, r)
		require.Equal(t, 200, rec.Code, rec.Body.String())
		var result map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
		return result
	}
	catalogResult, ok := call("readonly", "tools/list", map[string]any{})["result"].(map[string]any)
	require.True(t, ok)
	catalog, ok := catalogResult["tools"].([]any)
	require.True(t, ok)
	require.Len(t, catalog, 3)
	names := []string{}
	for _, item := range catalog {
		tool, ok := item.(map[string]any)
		require.True(t, ok)
		name, ok := tool["name"].(string)
		require.True(t, ok)
		names = append(names, name)
		annotations, ok := tool["annotations"].(map[string]any)
		require.True(t, ok)
		require.Equal(t, true, annotations["readOnlyHint"])
	}
	require.ElementsMatch(t, []string{"journal_get_context", "journal_query_records", "journal_get_record"}, names)
	context := call("readonly", "tools/call", map[string]any{"name": "journal_get_context", "arguments": map[string]any{}})
	contextResult, ok := context["result"].(map[string]any)
	require.True(t, ok)
	contextContent, ok := contextResult["structuredContent"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, true, contextContent["readOnlyCredential"])
	unauthenticated := call("invalid", "tools/call", map[string]any{"name": "journal_get_context", "arguments": map[string]any{}})
	unauthenticatedResult, ok := unauthenticated["result"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, true, unauthenticatedResult["isError"])
	page := call("readonly", "tools/call", map[string]any{"name": "journal_query_records", "arguments": map[string]any{"date": "2020-01-01", "pageSize": 1}})
	raw, err := json.Marshal(page)
	require.NoError(t, err)
	require.Contains(t, string(raw), "完整原文")
	require.Contains(t, string(raw), `"completeInThisResponse":false`)
	unknown := call("readonly", "tools/call", map[string]any{"name": "memo_create_memo", "arguments": map[string]any{}})
	require.NotNil(t, unknown["error"])
}
