package fileserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/EgoSay/kairos/internal/random"
	apiv1 "github.com/EgoSay/kairos/proto/gen/api/v1"
	storepb "github.com/EgoSay/kairos/proto/gen/store"
	"github.com/EgoSay/kairos/server/auth"
	"github.com/EgoSay/kairos/store"
)

func TestAgentCredentialCannotReadFilesOutsideJournalScope(t *testing.T) {
	ctx := context.Background()
	svc, fs, stores, cleanup := newShareAttachmentTestServices(ctx, t)
	defer cleanup()
	setInstanceAccessMode(ctx, t, stores, storepb.InstanceAccessMode_INSTANCE_ACCESS_MODE_PRIVATE)
	owner, err := stores.CreateUser(ctx, &store.User{Username: "restricted-agent-owner", Role: store.RoleUser})
	require.NoError(t, err)
	other, err := stores.CreateUser(ctx, &store.User{Username: "restricted-agent-other", Role: store.RoleUser})
	require.NoError(t, err)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	token, err := svc.CreatePersonalAccessToken(ownerCtx, &apiv1.CreatePersonalAccessTokenRequest{Parent: "users/" + owner.Username, Description: "Scope review", ReadOnly: true, ExpiresInDays: 1})
	require.NoError(t, err)
	router := echo.New()
	fs.RegisterRoutes(router)
	for _, scenario := range []struct {
		name  string
		user  *store.User
		trash bool
	}{
		{"other owner's protected attachment", other, false},
		{"own trash explicitly requested", owner, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			creatorCtx := context.WithValue(ctx, auth.UserIDContextKey, scenario.user.ID)
			file, err := svc.CreateAttachment(creatorCtx, &apiv1.CreateAttachmentRequest{Attachment: &apiv1.Attachment{Filename: "scope.txt", Type: "text/plain", Content: []byte("outside journal credential scope")}})
			require.NoError(t, err)
			memo, err := svc.CreateMemo(creatorCtx, &apiv1.CreateMemoRequest{Memo: &apiv1.Memo{Content: "scope fixture", Visibility: apiv1.Visibility_PROTECTED, Attachments: []*apiv1.Attachment{{Name: file.Name}}}})
			require.NoError(t, err)
			path := "/file/" + file.Name
			if scenario.trash {
				_, err = stores.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "trash", Key: strings.TrimPrefix(memo.Name, "memos/"), Payload: []byte(`{"deletedTs":1}`)}, 0)
				require.NoError(t, err)
				path += "?trash=true"
			}
			request := httptest.NewRequest(http.MethodGet, path, nil)
			request.Header.Set("Authorization", "Bearer "+token.Token)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			require.Equal(t, http.StatusForbidden, response.Code, "owner-only Agent reads must not become a full-account fileserver authorization")
			require.NotContains(t, response.Body.String(), "outside journal credential scope")
		})
	}
}

func TestAgentFileCredentialDoesNotFallBackToCookieShareOrPublic(t *testing.T) {
	ctx := context.Background()
	svc, fs, stores, cleanup := newShareAttachmentTestServices(ctx, t)
	defer cleanup()
	owner, err := stores.CreateUser(ctx, &store.User{Username: "agent-file-owner", Role: store.RoleUser, AvatarURL: makePNGDataURI(t)})
	require.NoError(t, err)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	mint := func(readOnly bool) *apiv1.CreatePersonalAccessTokenResponse {
		t.Helper()
		token, err := svc.CreatePersonalAccessToken(ownerCtx, &apiv1.CreatePersonalAccessTokenRequest{Parent: "users/" + owner.Username, Description: "File scope", ReadOnly: readOnly, ExpiresInDays: 1})
		require.NoError(t, err)
		return token
	}
	valid, revoked, legacy := mint(true), mint(true), mint(false)
	_, err = svc.DeletePersonalAccessToken(ownerCtx, &apiv1.DeletePersonalAccessTokenRequest{Name: revoked.PersonalAccessToken.Name})
	require.NoError(t, err)
	expired := auth.GenerateAgentAccessToken()
	require.NoError(t, stores.AddUserPersonalAccessToken(ctx, owner.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{
		TokenId: random.UUID(), TokenHash: auth.HashPersonalAccessToken(expired), ReadOnly: true, ExpiresAt: timestamppb.New(time.Now().Add(-time.Hour)),
	}))
	refreshID := random.UUID()
	require.NoError(t, stores.AddUserRefreshToken(ctx, owner.ID, &storepb.RefreshTokensUserSetting_RefreshToken{
		TokenId: refreshID, ExpiresAt: timestamppb.New(time.Now().Add(auth.RefreshTokenDuration)), CreatedAt: timestamppb.Now(),
	}))
	refreshToken, _, err := auth.GenerateRefreshToken(owner.ID, refreshID, []byte(svc.Secret))
	require.NoError(t, err)
	file, err := svc.CreateAttachment(ownerCtx, &apiv1.CreateAttachmentRequest{Attachment: &apiv1.Attachment{Filename: "file.txt", Type: "text/plain", Content: []byte("raw file bytes")}})
	require.NoError(t, err)
	memo, err := svc.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{Memo: &apiv1.Memo{Content: "public fixture", Visibility: apiv1.Visibility_PUBLIC, Attachments: []*apiv1.Attachment{{Name: file.Name}}}})
	require.NoError(t, err)
	share, err := svc.CreateMemoShare(ownerCtx, &apiv1.CreateMemoShareRequest{Parent: memo.Name, MemoShare: &apiv1.MemoShare{}})
	require.NoError(t, err)
	shareToken := share.Name[strings.LastIndex(share.Name, "/")+1:]
	router := echo.New()
	fs.RegisterRoutes(router)
	request := func(path, token string, cookie bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "bEaReR "+token)
		}
		if cookie {
			req.AddCookie(&http.Cookie{Name: auth.RefreshTokenCookieName, Value: refreshToken})
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	filePath, avatarPath := "/file/"+file.Name, "/file/users/"+owner.Username+"/avatar"
	for _, mode := range []storepb.InstanceAccessMode{storepb.InstanceAccessMode_INSTANCE_ACCESS_MODE_PRIVATE, storepb.InstanceAccessMode_INSTANCE_ACCESS_MODE_PUBLIC} {
		setInstanceAccessMode(ctx, t, stores, mode)
		for _, token := range []struct{ name, value string }{{"valid", valid.Token}, {"revoked", revoked.Token}, {"expired", expired}, {"invalid", auth.AgentAccessTokenPrefix + "invalid"}} {
			t.Run(mode.String()+"/"+token.name, func(t *testing.T) {
				for _, path := range []string{filePath, filePath + "/file.txt?thumbnail=true", filePath + "?motion=true", filePath + "?share_token=" + shareToken, avatarPath} {
					for _, cookie := range []bool{false, true} {
						res := request(path, token.value, cookie)
						require.Equal(t, http.StatusForbidden, res.Code, "%s cookie=%t", path, cookie)
						require.Equal(t, privateAttachmentCacheControl, res.Header().Get(echo.HeaderCacheControl))
						require.NotContains(t, res.Body.String(), "raw file bytes")
					}
				}
			})
		}
		for _, path := range []string{filePath, avatarPath} {
			require.Equal(t, http.StatusOK, request(path, legacy.Token, false).Code, "ordinary PAT compatibility")
			require.Equal(t, http.StatusOK, request(path, "", true).Code, "ordinary browser compatibility")
		}
		require.Equal(t, http.StatusOK, request(filePath+"?share_token="+shareToken, "", false).Code, "ordinary sharing compatibility")
		if mode == storepb.InstanceAccessMode_INSTANCE_ACCESS_MODE_PUBLIC {
			require.Equal(t, http.StatusOK, request(filePath, "", false).Code, "ordinary anonymous compatibility")
		}
	}
}
