package mcp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/internal/profile"
	apiv1 "github.com/EgoSay/kairos/proto/gen/api/v1"
	v1service "github.com/EgoSay/kairos/server/api/v1"
	"github.com/EgoSay/kairos/server/auth"
	"github.com/EgoSay/kairos/server/mcp"
	"github.com/EgoSay/kairos/store"
	teststore "github.com/EgoSay/kairos/store/test"
)

func TestAgentCredentialLegacyMCPUsesRealAPIAuthorization(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	st := teststore.NewTestingStore(ctx, t)
	defer st.Close()
	p := &profile.Profile{Demo: true, Data: t.TempDir(), Driver: "sqlite", DSN: ":memory:", Version: "test"}
	svc := v1service.NewAPIV1Service("test-secret", p, st)
	owner, err := st.CreateUser(ctx, &store.User{Username: "mcp-scope-owner", Role: store.RoleAdmin})
	require.NoError(t, err)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	token, err := svc.CreatePersonalAccessToken(ownerCtx, &apiv1.CreatePersonalAccessTokenRequest{Parent: "users/" + owner.Username, Description: "MCP isolation", ReadOnly: true, ExpiresInDays: 1})
	require.NoError(t, err)
	router := echo.New()
	require.NoError(t, svc.RegisterGateway(ctx, router))
	service, err := mcp.NewMCPService(p, router)
	require.NoError(t, err)
	service.RegisterRoutes(router)
	call := func(path, tool string, arguments map[string]any) map[string]any {
		t.Helper()
		data, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": tool, "arguments": arguments}})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("Authorization", "Bearer "+token.Token)
		req.Header.Set("MCP-Protocol-Version", "2025-06-18")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		require.Equal(t, http.StatusOK, res.Code, res.Body.String())
		var response struct {
			Result map[string]any `json:"result"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
		require.NotNil(t, response.Result, res.Body.String())
		return response.Result
	}
	contextResult := call("/mcp/journal", "journal_get_context", map[string]any{})
	require.NotEqual(t, true, contextResult["isError"])
	content, ok := contextResult["structuredContent"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, true, content["readOnlyCredential"])
	require.Equal(t, "users/"+owner.Username, content["owner"])
	legacyWrite := call("/mcp", "memo_create_memo", map[string]any{"body": map[string]any{"content": "must never be created"}})
	require.Equal(t, true, legacyWrite["isError"])
	encoded, err := json.Marshal(legacyWrite)
	require.NoError(t, err)
	require.Contains(t, string(encoded), "Agent credential permits owner-only journal reads", "assert actual authorization failure, not malformed arguments or missing tool")
	require.NotContains(t, legacyWrite, "structuredContent", "errors must not look like successful empty record results")
	memos, err := st.ListMemos(ctx, &store.FindMemo{CreatorID: &owner.ID})
	require.NoError(t, err)
	require.Empty(t, memos)
	_, err = svc.DeletePersonalAccessToken(ownerCtx, &apiv1.DeletePersonalAccessTokenRequest{Name: token.PersonalAccessToken.Name})
	require.NoError(t, err)
	revoked := call("/mcp/journal", "journal_get_context", map[string]any{})
	require.Equal(t, true, revoked["isError"])
	require.NotContains(t, revoked, "structuredContent")
}
