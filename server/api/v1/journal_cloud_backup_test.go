package v1

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestCloudBackupAdminBoundaryAndFixedAgentActions(t *testing.T) {
	svc := newIntegrationService(t)
	admin := createSpaceTestUser(context.Background(), t, svc, "backup-admin", store.RoleAdmin)
	member := createSpaceTestUser(context.Background(), t, svc, "backup-member", store.RoleUser)
	current := member.ID
	// Unix socket paths have a short OS limit; use the system temporary root.
	directory, err := os.MkdirTemp("/tmp", "kb-")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	socketPath := filepath.Join(directory, "backup.sock")
	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)
	var calls atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		require.Equal(t, "/v1/status", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"state":"stale","updatedTs":1}`)
	})}
	t.Cleanup(func() { _ = server.Close() })
	go func() { _ = server.Serve(listener) }()
	t.Setenv("MEMOS_BACKUP_SOCKET", socketPath)
	e := echo.New()
	group := e.Group("/api/v1/journal")
	group.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.SetRequest(c.Request().WithContext(userCtx(c.Request().Context(), current)))
			return next(c)
		}
	})
	svc.registerJournalCloudBackupRoutes(group)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/v1/journal/cloud-backup/"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		e.ServeHTTP(w, r)
		return w
	}
	require.Equal(t, http.StatusForbidden, request("GET", "status", "").Code)
	require.Zero(t, calls.Load(), "a member must not reach the root backup agent")
	current = admin.ID
	result := request("GET", "status", "")
	require.Equal(t, http.StatusOK, result.Code)
	require.Contains(t, result.Body.String(), `"stale"`)
	require.Equal(t, http.StatusNotFound, request("POST", "shell", `{"command":"anything"}`).Code)
	require.Equal(t, http.StatusBadRequest, request("POST", "test", `{} {}`).Code)
	require.Equal(t, int32(1), calls.Load())
	t.Setenv("MEMOS_BACKUP_SOCKET", "")
	require.Equal(t, http.StatusServiceUnavailable, request("GET", "status", "").Code)
}
