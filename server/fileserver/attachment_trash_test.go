package fileserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	apiv1 "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/server/auth"
	"github.com/EgoSay/kairos/store"
)

func TestTrashAttachmentExplicitOwnerPreviewAndSpecialFilename(t *testing.T) {
	ctx := context.Background()
	svc, fs, stores, cleanup := newShareAttachmentTestServices(ctx, t)
	defer cleanup()
	owner, err := stores.CreateUser(ctx, &store.User{Username: "trash-file-owner", Role: store.RoleUser, Email: "trash-owner@example.test"})
	require.NoError(t, err)
	ownerCtx := context.WithValue(ctx, auth.UserIDContextKey, owner.ID)
	attachment, err := svc.CreateAttachment(ownerCtx, &apiv1.CreateAttachmentRequest{Attachment: &apiv1.Attachment{Filename: "声音 #1?.mp3", Type: "audio/mpeg", Content: []byte("audio bytes")}})
	require.NoError(t, err)
	memo, err := svc.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{Memo: &apiv1.Memo{Content: "media", Attachments: []*apiv1.Attachment{{Name: attachment.Name}}}})
	require.NoError(t, err)
	_, err = stores.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner.ID, Kind: "trash", Key: strings.TrimPrefix(memo.Name, "memos/"), Payload: []byte(`{"deletedTs":1}`)}, 0)
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(owner.ID, owner.Username, string(owner.Role), string(owner.RowStatus), []byte(svc.Secret))
	require.NoError(t, err)
	e := echo.New()
	fs.RegisterRoutes(e)
	path := "/file/" + attachment.Name + "/" + url.PathEscape(attachment.Filename)
	for _, tc := range []struct {
		name, query   string
		authenticated bool
		want          int
	}{
		{"ordinary owner", "", true, 404},
		{"anonymous recovery", "?trash=true", false, 404},
		{"share recovery", "?trash=true&share_token=old", true, 404},
		{"explicit owner recovery", "?trash=true", true, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path+tc.query, nil)
			if tc.authenticated {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, tc.want, rec.Code, rec.Body.String())
			require.Equal(t, privateAttachmentCacheControl, rec.Header().Get("Cache-Control"))
			if tc.want == 200 {
				require.Equal(t, "audio bytes", rec.Body.String())
			} else {
				require.NotContains(t, rec.Body.String(), "audio bytes")
			}
		})
	}
	require.NoError(t, stores.DeleteJournalDocument(ctx, owner.ID, "trash", strings.TrimPrefix(memo.Name, "memos/"), -1))
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}
