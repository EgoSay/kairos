package v1

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/core/journalbackup"
	"github.com/EgoSay/kairos/core/journalrecord"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/store"
)

type recoveryReadBarrierKey struct{}
type recoveryReadBarrierDriver struct {
	store.Driver
	beforeRead func()
}

func (*recoveryReadBarrierDriver) Close() error { return nil }
func (d *recoveryReadBarrierDriver) ListMemos(ctx context.Context, find *store.FindMemo) ([]*store.Memo, error) {
	if ctx.Value(recoveryReadBarrierKey{}) != nil {
		d.beforeRead()
	}
	return d.Driver.ListMemos(ctx, find)
}

func recoveryReviewMemo(ctx context.Context, t *testing.T, s *APIV1Service) (*v1pb.Memo, string) {
	t.Helper()
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "old private version"}})
	require.NoError(t, err)
	_, err = s.UpdateMemo(ctx, &v1pb.UpdateMemoRequest{Memo: &v1pb.Memo{Name: memo.Name, Content: "current approved version"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.NoError(t, err)
	var versions struct {
		Revisions []journalrecord.Revision `json:"revisions"`
	}
	uid := strings.TrimPrefix(memo.Name, "memos/")
	response := journalRecordRequest(ctx, s, http.MethodGet, "/memos/"+uid+"/revisions")
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &versions))
	require.Len(t, versions.Revisions, 1)
	return memo, "/memos/" + uid + "/revisions/" + versions.Revisions[0].ID + "/restore"
}

func TestLegacySharedReadRechecksRevokedGrantAfterRecovery(t *testing.T) {
	s, ctx := newUploadTestService(t)
	memo, path := recoveryReviewMemo(ctx, t, s)
	grant, err := s.CreateMemoShare(ctx, &v1pb.CreateMemoShareRequest{Parent: memo.Name})
	require.NoError(t, err)
	token := grant.Name[strings.LastIndexByte(grant.Name, '/')+1:]
	ready, resume := make(chan struct{}), make(chan struct{})
	var once sync.Once
	wrapped := store.New(&recoveryReadBarrierDriver{Driver: s.Store.GetDriver(), beforeRead: func() { once.Do(func() { close(ready); <-resume }) }}, s.Profile)
	s.Store = wrapped
	t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
	type result struct {
		memo *v1pb.Memo
		err  error
	}
	done := make(chan result, 1)
	go func() {
		value, readErr := s.GetSharedMemo(context.WithValue(context.Background(), recoveryReadBarrierKey{}, true), &v1pb.GetSharedMemoRequest{ShareToken: token})
		done <- result{value, readErr}
	}()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("shared read did not reach source lookup")
	}
	response := journalRecordRequest(ctx, s, http.MethodPost, path)
	close(resume)
	read := <-done
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, codes.NotFound, status.Code(read.err), "revoked token returned body: %v", read.memo)
	require.Nil(t, read.memo)
}

func TestAdminShareAndOwnerRecoveryUseSameAuthorizationGuard(t *testing.T) {
	s, ctx := newUploadTestService(t)
	memo, path := recoveryReviewMemo(ctx, t, s)
	admin := createSpaceTestUser(ctx, t, s, "sharing-admin", store.RoleAdmin)
	ready, resume := make(chan struct{}), make(chan struct{})
	wrapped := store.New(&recoveryShareBarrierDriver{Driver: s.Store.GetDriver(), beforeCreate: func() {}, beforeRestore: func() { close(ready); <-resume }}, s.Profile)
	s.Store = wrapped
	t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- journalRecordRequest(ctx, s, http.MethodPost, path) }()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("recovery did not reach post-withdrawal commit")
	}
	grant, err := s.CreateMemoShare(userCtx(context.Background(), admin.ID), &v1pb.CreateMemoShareRequest{Parent: memo.Name})
	close(resume)
	response := <-done
	require.NoError(t, err)
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	token := grant.Name[strings.LastIndexByte(grant.Name, '/')+1:]
	visible, err := s.GetSharedMemo(context.Background(), &v1pb.GetSharedMemoRequest{ShareToken: token})
	require.NoError(t, err)
	require.Equal(t, "current approved version", visible.Content)
}

func TestBackupPublicationPauseRejectsLateApproval(t *testing.T) {
	s, ctx := newUploadTestService(t)
	owner, err := s.fetchCurrentUser(ctx)
	require.NoError(t, err)
	memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "approved before restoring archive"}})
	require.NoError(t, err)
	e := echo.New()
	s.registerJournalShareRoutes(e.Group("/api/v1/journal"), e)
	approval := sharePreview(ctx, t, e, journalShareRequest{Mode: "dynamic", Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{memo.Name}}})
	ready, resume := make(chan struct{}), make(chan struct{})
	wrapped := store.New(&recoveryShareBarrierDriver{Driver: s.Store.GetDriver(), beforeCreate: func() { close(ready); <-resume }}, s.Profile)
	s.Store = wrapped
	t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", approval) }()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("publication did not reach commit")
	}
	pauseErr := s.pauseJournalPublication(ctx, owner.ID)
	close(resume)
	response := <-done
	require.NoError(t, pauseErr)
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
}

func TestBackupRestorePublicationBoundaryAndEmptyOwner(t *testing.T) {
	source, sourceCtx := newUploadTestService(t)
	sourceOwner, err := source.fetchCurrentUser(sourceCtx)
	require.NoError(t, err)
	sourceMemo, err := source.CreateMemo(sourceCtx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "archive bytes not yet imported"}})
	require.NoError(t, err)
	var archive bytes.Buffer
	require.NoError(t, source.writeJournalBackup(sourceCtx, sourceOwner, &archive, true))
	backup, err := journalbackup.Read(bytes.NewReader(archive.Bytes()), int64(archive.Len()))
	require.NoError(t, err)
	digestBytes := sha256.Sum256(archive.Bytes())
	digest := hex.EncodeToString(digestBytes[:])
	t.Run("empty owner imports without requiring a synthetic anchor", func(t *testing.T) {
		s, ctx := newUploadTestService(t)
		owner, err := s.fetchCurrentUser(ctx)
		require.NoError(t, err)
		report, err := s.restoreJournalBackup(ctx, owner, backup, digest)
		require.NoError(t, err)
		require.True(t, report.Complete)
		actual, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: sourceMemo.Name})
		require.NoError(t, err)
		require.Equal(t, sourceMemo.Content, actual.Content)
		require.Equal(t, v1pb.Visibility_PRIVATE, actual.Visibility)
	})
	t.Run("late grant prevents any import after withdrawal scan", func(t *testing.T) {
		s, ctx := newUploadTestService(t)
		owner, err := s.fetchCurrentUser(ctx)
		require.NoError(t, err)
		memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "current destination approved text"}})
		require.NoError(t, err)
		e := echo.New()
		s.registerJournalShareRoutes(e.Group("/api/v1/journal"), e)
		approval := sharePreview(ctx, t, e, journalShareRequest{Mode: "dynamic", Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{memo.Name}}})
		ready, resume := make(chan struct{}), make(chan struct{})
		wrapped := store.New(&recoveryShareBarrierDriver{Driver: s.Store.GetDriver(), beforeCreate: func() {}, beforePause: func() { close(ready); <-resume }}, s.Profile)
		s.Store = wrapped
		t.Cleanup(func() { require.NoError(t, wrapped.Close()) })
		type result struct {
			report *backupReport
			err    error
		}
		done := make(chan result, 1)
		go func() {
			report, restoreErr := s.restoreJournalBackup(ctx, owner, backup, digest)
			done <- result{report, restoreErr}
		}()
		select {
		case <-ready:
		case <-time.After(5 * time.Second):
			t.Fatal("backup did not reach pause transaction")
		}
		published := journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", approval)
		close(resume)
		restored := <-done
		require.Equal(t, http.StatusOK, published.Code, published.Body.String())
		require.ErrorIs(t, restored.err, store.ErrMemoMutationConflict)
		require.False(t, restored.report.Complete)
		require.Zero(t, restored.report.Memos)
		_, err = s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: sourceMemo.Name})
		require.Equal(t, codes.NotFound, status.Code(err))
		current, err := s.GetMemo(ctx, &v1pb.GetMemoRequest{Name: memo.Name})
		require.NoError(t, err)
		require.Equal(t, "current destination approved text", current.Content)
	})
}

func TestSharePreviewMustBeRenewedAfterIdenticalTrashRestore(t *testing.T) {
	for _, mode := range []string{"fixed", "dynamic"} {
		t.Run(mode, func(t *testing.T) {
			s, ctx := newUploadTestService(t)
			memo, err := s.CreateMemo(ctx, &v1pb.CreateMemoRequest{Memo: &v1pb.Memo{Content: "same bytes and recorded date after recovery"}})
			require.NoError(t, err)
			e := echo.New()
			s.registerJournalShareRoutes(e.Group("/api/v1/journal"), e)
			request := journalShareRequest{Mode: mode, Filter: journal.ShareFilter{Timezone: "UTC", MemoNames: []string{memo.Name}}}
			stale := sharePreview(ctx, t, e, request)
			uid := strings.TrimPrefix(memo.Name, "memos/")
			deleted := journalRecordRequest(ctx, s, http.MethodPost, "/memos/"+uid+"/trash")
			require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
			restored := journalRecordRequest(ctx, s, http.MethodPost, "/trash/"+uid+"/restore")
			require.Equal(t, http.StatusOK, restored.Code, restored.Body.String())
			rejected := journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", stale)
			require.Equal(t, http.StatusConflict, rejected.Code, rejected.Body.String())
			renewed := sharePreview(ctx, t, e, request)
			require.NotEqual(t, stale.PreviewDigest, renewed.PreviewDigest, "unchanged content must not reuse a revoked approval")
			granted := journalHTTP(ctx, t, e, http.MethodPost, "/api/v1/journal/shares", renewed)
			require.Equal(t, http.StatusOK, granted.Code, granted.Body.String())
		})
	}
}
