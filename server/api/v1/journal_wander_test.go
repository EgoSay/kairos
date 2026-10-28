package v1

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/core/recordgraph"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

func TestWanderHTTPBoundsAndOwnerIsolation(t *testing.T) {
	s, ctx := newUploadTestService(t)
	workerCtx, cancel := context.WithCancel(context.Background())
	cancel()
	e := echo.New()
	s.registerJournalWanderRoutes(workerCtx, e.Group("/api/v1/journal"))
	own, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "我的原文", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	other := createSpaceTestUser(context.Background(), t, s, "wander-other", store.RoleUser)
	foreign, err := s.CreateMemo(userCtx(context.Background(), other.ID), &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "FOREIGN_PRIVATE_SOURCE", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	start := journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/start", map[string]any{"seen": []string{}})
	require.Equal(t, 200, start.Code, start.Body.String())
	require.Contains(t, start.Body.String(), own.Content)
	require.NotContains(t, start.Body.String(), foreign.Content)
	read := journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/neighborhoods", map[string]any{"names": []string{foreign.Name}})
	require.Equal(t, 200, read.Code)
	require.NotContains(t, read.Body.String(), foreign.Content)
	require.Contains(t, read.Body.String(), `"root":null`)
	oversized := journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/neighborhoods", map[string]any{"names": strings.Split(strings.Repeat(own.Name+",", 5), ",")})
	require.Equal(t, 400, oversized.Code)
	config := journalHTTP(ctx, t, e, "GET", "/api/v1/journal/wander/config", nil)
	require.Equal(t, 200, config.Code)
	require.NotContains(t, config.Body.String(), "apiKey")
	denied := journalHTTP(ctx, t, e, "PUT", "/api/v1/journal/wander/config", map[string]any{"enabled": true, "providerId": "missing", "dailyNeurons": 8000})
	require.Equal(t, 400, denied.Code)
}

func TestWanderProgressAndRetryStayOwnerScoped(t *testing.T) {
	s, ctx := newUploadTestService(t)
	workerCtx, cancel := context.WithCancel(context.Background())
	cancel()
	e := echo.New()
	s.registerJournalWanderRoutes(workerCtx, e.Group("/api/v1/journal"))
	own, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "OWN_RETRY_ORIGINAL", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	other := createSpaceTestUser(context.Background(), t, s, "retry-other", store.RoleUser)
	foreign, err := s.CreateMemo(userCtx(context.Background(), other.ID), &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "FOREIGN_RETRY_ORIGINAL", Visibility: v1pb.Visibility_PRIVATE}})
	require.NoError(t, err)
	_, err = s.Store.GetDriver().GetDB().ExecContext(context.Background(), "UPDATE record_graph_source SET state='failed',error_code='result-schema',next_attempt_ts=253402300799")
	require.NoError(t, err)
	response := journalHTTP(ctx, t, e, "GET", "/api/v1/journal/wander/jobs?state=attention", nil)
	require.Equal(t, 200, response.Code)
	require.Contains(t, response.Body.String(), own.Content)
	require.NotContains(t, response.Body.String(), foreign.Content)
	var page recordgraph.JobsPage
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
	require.Len(t, page.Jobs, 1)
	job := page.Jobs[0]
	input := recordgraph.RetryRequest{RequestID: "retry-http-fixture", Name: job.Name, Revision: job.Revision, StatusVersion: job.StatusVersion}
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/retry", input)
	require.Equal(t, 200, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), `"accepted":1`)
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/retry", input)
	require.Equal(t, 200, response.Code)
	require.Contains(t, response.Body.String(), `"accepted":1`)
	input.RequestID = "different-click"
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/retry", input)
	require.Equal(t, 409, response.Code)
	input.Name = foreign.Name
	input.RequestID = "foreign-click"
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/wander/retry", input)
	require.Equal(t, 409, response.Code)
	response = journalHTTP(ctx, t, e, "GET", "/api/v1/journal/wander/jobs/"+strings.TrimPrefix(foreign.Name, "memos/")+"/attempts", nil)
	require.Equal(t, 200, response.Code)
	require.JSONEq(t, `{"attempts":[],"nextCursor":""}`, response.Body.String())
	response = journalHTTP(ctx, t, e, "GET", "/api/v1/journal/wander/jobs?state=unknown", nil)
	require.Equal(t, 400, response.Code)
	response = journalHTTP(ctx, t, e, "GET", "/api/v1/journal/wander/jobs?after=-1", nil)
	require.Equal(t, 400, response.Code)
}
