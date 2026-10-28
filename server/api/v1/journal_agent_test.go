package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/EgoSay/kairos/core/partition"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/server/auth"
	"github.com/EgoSay/kairos/store"
)

func agentHTTP(t *testing.T, router *echo.Echo, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Connect-Protocol-Version", "1")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestAgentCredentialReadOnlyAcrossTransportsAndLifecycle(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "agent-owner", store.RoleAdmin)
	ctx := userCtx(context.Background(), owner.ID)
	restricted, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: "Codex", ExpiresInDays: 30, ReadOnly: true})
	require.NoError(t, err)
	require.True(t, restricted.PersonalAccessToken.ReadOnly)
	require.True(t, strings.HasPrefix(restricted.Token, auth.AgentAccessTokenPrefix))
	require.False(t, strings.HasPrefix(restricted.Token, auth.PersonalAccessTokenPrefix), "older servers must not accept an Agent token as a full PAT")
	other, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: "Independent", ExpiresInDays: 30, ReadOnly: true})
	require.NoError(t, err)
	legacy, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: "Legacy"})
	require.NoError(t, err)
	router := echo.New()
	workerCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	require.NoError(t, svc.RegisterGateway(workerCtx, router))
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/api/v1/memos", `{"content":"forbidden"}`},
		{"POST", "/memos.api.v1.MemoService/CreateMemo", `{"memo":{"content":"forbidden"}}`},
		{"POST", "/memos.api.v1.UserService/CreatePersonalAccessToken", `{"parent":"users/agent-owner","description":"escalate"}`},
		{"GET", "/api/v1/journal/preferences", ""},
		{"GET", "/api/v1/sse", ""},
		{"PATCH", "/api/v1/journal/preferences", `{"timezone":"UTC"}`},
		{"POST", "/api/v1/journal/cloud-backup/run", "{}"},
		{"POST", "/api/v1/journal/wander/retry", `{"requestId":"readonly-must-not-retry"}`},
		{"GET", "/api/v1/journal/cloud-backup/status", ""},
		{"POST", "/api/v1/journal/agent/records", "{}"},
	} {
		t.Run(tc.path+tc.method, func(t *testing.T) {
			res := agentHTTP(t, router, tc.method, tc.path, restricted.Token, tc.body)
			require.Equal(t, http.StatusForbidden, res.Code, res.Body.String())
		})
	}
	res := agentHTTP(t, router, "GET", "/api/v1/journal/agent/context", restricted.Token, "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.Contains(t, res.Body.String(), `"readOnlyCredential":true`)
	require.Equal(t, http.StatusOK, agentHTTP(t, router, "GET", "/api/v1/journal/preferences", legacy.Token, "").Code, "legacy PAT retains prior scope")
	require.Eventually(t, func() bool {
		tokens, err := svc.ListPersonalAccessTokens(ctx, &v1pb.ListPersonalAccessTokensRequest{Parent: BuildUserName(owner.Username)})
		if err != nil {
			return false
		}
		for _, token := range tokens.PersonalAccessTokens {
			if token.Name == restricted.PersonalAccessToken.Name {
				return token.LastUsedAt != nil && token.ReadOnly
			}
		}
		return false
	}, time.Second, 10*time.Millisecond)
	_, err = svc.DeletePersonalAccessToken(ctx, &v1pb.DeletePersonalAccessTokenRequest{Name: restricted.PersonalAccessToken.Name})
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, agentHTTP(t, router, "GET", "/api/v1/journal/agent/context", restricted.Token, "").Code)
	require.Equal(t, http.StatusOK, agentHTTP(t, router, "GET", "/api/v1/journal/agent/context", other.Token, "").Code)
	expired := auth.GenerateAgentAccessToken()
	require.NoError(t, svc.Store.AddUserPersonalAccessToken(ctx, owner.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{TokenId: "expired-agent", TokenHash: auth.HashPersonalAccessToken(expired), ReadOnly: true, ExpiresAt: timestamppb.New(time.Now().Add(-time.Second))}))
	require.Equal(t, http.StatusUnauthorized, agentHTTP(t, router, "GET", "/api/v1/journal/agent/context", expired, "").Code)
	scopeLost := auth.GenerateAgentAccessToken()
	require.NoError(t, svc.Store.AddUserPersonalAccessToken(ctx, owner.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{TokenId: "lost-agent-scope", TokenHash: auth.HashPersonalAccessToken(scopeLost), ExpiresAt: timestamppb.New(time.Now().Add(time.Hour))}))
	require.Equal(t, http.StatusUnauthorized, agentHTTP(t, router, "GET", "/api/v1/journal/agent/context", scopeLost, "").Code)
	require.ErrorIs(t, NewAuthorizer(svc.Store, svc.Secret).CheckAccess(ctx, "/unknown/future", &auth.AuthResult{User: owner, ReadOnly: true}), ErrReadOnlyCredential)
}

func TestAgentQueryOwnArchiveTrashPagingAndOriginalDate(t *testing.T) {
	svc := newIntegrationService(t)
	svc.Profile.InstanceURL = "https://journal.example.test"
	owner := createSpaceTestUser(context.Background(), t, svc, "query-owner", store.RoleUser)
	other := createSpaceTestUser(context.Background(), t, svc, "query-other", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	_, err := svc.Store.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "preferences", Key: "main", Payload: json.RawMessage(`{"timezone":"Asia/Shanghai"}`)}, 0)
	require.NoError(t, err)
	create := func(user int32, content string, ts int64, archived bool) *v1pb.Memo {
		m, err := svc.CreateMemo(userCtx(context.Background(), user), &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: content, Visibility: v1pb.Visibility_PRIVATE}})
		require.NoError(t, err)
		uid := strings.TrimPrefix(m.Name, "memos/")
		row, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
		require.NoError(t, err)
		update := &store.UpdateMemo{ID: row.ID, CreatedTs: &ts}
		if archived {
			state := store.Archived
			update.RowStatus = &state
		}
		err = svc.Store.UpdateMemo(ctx, update)
		require.NoError(t, err)
		return m
	}
	start, err := time.Parse(time.RFC3339, "2020-01-01T00:00:00+08:00")
	require.NoError(t, err)
	a := create(owner.ID, "原始全文 #人生修行/阅读", start.Unix(), false)
	b := create(owner.ID, "归档全文 #人生修行", start.Add(time.Hour).Unix(), true)
	trash := create(owner.ID, "回收全文 #人生修行", start.Add(2*time.Hour).Unix(), false)
	uid := strings.TrimPrefix(trash.Name, "memos/")
	res := journalRecordRequest(ctx, svc, http.MethodPost, "/memos/"+uid+"/trash")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	foreign := create(other.ID, "不能泄露 #人生修行", start.Add(3*time.Hour).Unix(), false)
	comment, err := svc.CreateMemoComment(ctx, &v1pb.CreateMemoCommentRequest{Name: a.Name, Comment: &v1pb.Memo{Content: "Comment outside journal record scope"}})
	require.NoError(t, err)
	create(owner.ID, "日期之外 #人生修行", start.Add(-time.Second).Unix(), false)
	create(owner.ID, "路径边界 #人生修行者", start.Add(4*time.Hour).Unix(), false)

	svc.JournalPartitions = partition.New(svc.Store, svc.readPartitionMemo)
	selected, err := svc.JournalPartitions.SavePartition(ctx, owner.ID, &partition.Partition{Name: "人生"})
	require.NoError(t, err)
	_, err = svc.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: a.Name}, JournalPartition: &v1pb.JournalPartitionSelection{PartitionId: selected.ID}})
	require.NoError(t, err)
	aUID := strings.TrimPrefix(a.Name, "memos/")
	aRow, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &aUID})
	require.NoError(t, err)
	pinned := true
	require.NoError(t, svc.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: aRow.ID, Pinned: &pinned}))
	token, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: "Query", ExpiresInDays: 30, ReadOnly: true})
	require.NoError(t, err)
	router := echo.New()
	workerCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	require.NoError(t, svc.RegisterGateway(workerCtx, router))
	query := "/api/v1/journal/agent/records?date=2020-01-01&tag=" + url.QueryEscape("人生修行") + "&pageSize=1"
	type page struct {
		Records       []struct{ Name, Content, SourceURL string }
		NextPageToken string
		Coverage      struct{ HasMore, CompleteInThisResponse bool }
	}
	res = agentHTTP(t, router, "GET", query, token.Token, "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	var first page
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &first))
	require.Len(t, first.Records, 1)
	require.Equal(t, b.Name, first.Records[0].Name, res.Body.String())
	require.True(t, first.Coverage.HasMore)
	require.False(t, first.Coverage.CompleteInThisResponse)
	changed := agentHTTP(t, router, "GET", query+"&keyword=changed&pageToken="+url.QueryEscape(first.NextPageToken), token.Token, "")
	require.Equal(t, http.StatusBadRequest, changed.Code, "changing query criteria cannot silently reuse an offset")
	res = agentHTTP(t, router, "GET", query+"&pageToken="+url.QueryEscape(first.NextPageToken), token.Token, "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	var last page
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &last))
	require.Len(t, last.Records, 1)
	require.Equal(t, a.Name, last.Records[0].Name)
	require.Equal(t, "原始全文 #人生修行/阅读", last.Records[0].Content)
	require.Equal(t, "https://journal.example.test/"+a.Name, last.Records[0].SourceURL)
	require.False(t, last.Coverage.HasMore)
	require.False(t, last.Coverage.CompleteInThisResponse, "last page alone is not complete history")
	for _, name := range []string{foreign.Name, trash.Name, comment.Name} {
		res = agentHTTP(t, router, "GET", "/api/v1/journal/agent/record?name="+url.QueryEscape(name), token.Token, "")
		require.Equal(t, http.StatusNotFound, res.Code, res.Body.String())
	}

	exact := agentHTTP(t, router, "GET", query+"&includeSubtags=false", token.Token, "")
	require.Equal(t, http.StatusOK, exact.Code, exact.Body.String())
	var exactPage page
	require.NoError(t, json.Unmarshal(exact.Body.Bytes(), &exactPage))
	require.Len(t, exactPage.Records, 1)
	require.Equal(t, b.Name, exactPage.Records[0].Name, "implied parent from child-only Markdown is not an explicit tag")
	require.False(t, exactPage.Coverage.HasMore)

	combined := query + "&keyword=" + url.QueryEscape("原始全文") + "&pinned=true&partitionId=" + selected.ID
	res = agentHTTP(t, router, "GET", combined, token.Token, "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	var match page
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &match))
	require.Len(t, match.Records, 1)
	require.Equal(t, a.Name, match.Records[0].Name)
	require.True(t, match.Coverage.CompleteInThisResponse)
	res = agentHTTP(t, router, "GET", "/api/v1/journal/agent/record?name="+a.Name, token.Token, "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.Contains(t, res.Body.String(), "原始全文 #人生修行/阅读")
	res = agentHTTP(t, router, "GET", "/api/v1/journal/agent/records?date=1990-01-01", token.Token, "")
	require.Equal(t, http.StatusOK, res.Code)
	require.Contains(t, res.Body.String(), `"status":"no_records"`)
	res = agentHTTP(t, router, "GET", "/api/v1/journal/agent/records?date=invalid", token.Token, "")
	require.Equal(t, http.StatusBadRequest, res.Code)
}

func TestAgentCredentialRequiresNamedFiniteExpiry(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "finite-owner", store.RoleUser)
	ctx := userCtx(context.Background(), owner.ID)
	for _, days := range []int32{-1, 0, 366} {
		_, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: "Agent", ReadOnly: true, ExpiresInDays: days})
		require.Error(t, err)
	}
	_, err := svc.CreatePersonalAccessToken(ctx, &v1pb.CreatePersonalAccessTokenRequest{Parent: BuildUserName(owner.Username), Description: "  ", ReadOnly: true, ExpiresInDays: 30})
	require.Error(t, err)
}

func TestAgentCursorBindsOwnerQueryAndPageSize(t *testing.T) {
	svc := &APIV1Service{Secret: "test-secret"}
	digest := agentQueryDigest(1, "query", "Asia/Shanghai", 50)
	cursor := svc.encodeAgentCursor(digest, "offset")
	decoded, err := svc.decodeAgentCursor(cursor, digest)
	require.NoError(t, err)
	require.Equal(t, "offset", decoded)
	for _, changed := range []string{agentQueryDigest(2, "query", "Asia/Shanghai", 50), agentQueryDigest(1, "other", "Asia/Shanghai", 50), agentQueryDigest(1, "query", "UTC", 50), agentQueryDigest(1, "query", "Asia/Shanghai", 100)} {
		_, err = svc.decodeAgentCursor(cursor, changed)
		require.Error(t, err)
	}
	_, err = svc.decodeAgentCursor(cursor+"changed", digest)
	require.Error(t, err)
}
