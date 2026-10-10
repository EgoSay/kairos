package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/EgoSay/kairos/store"
)

// registerJournalCloudBackupRoutes bridges administrators to the host's fixed
// backup action set. The application cannot read root credentials or supply a
// command, filesystem path, unit name, executable, or restore destination.
func (s *APIV1Service) registerJournalCloudBackupRoutes(g *echo.Group) {
	g.GET("/cloud-backup/status", s.journalCloudBackupStatus)
	g.POST("/cloud-backup/:action", s.journalCloudBackupAction)
}

func (s *APIV1Service) journalCloudBackupStatus(c *echo.Context) error {
	return s.journalCloudBackupProxy(c, "status", nil)
}

func (s *APIV1Service) journalCloudBackupAction(c *echo.Context) error {
	action := c.Param("action")
	switch action {
	case "test", "trial", "activate", "pause", "enable", "run", "check", "restore":
	default:
		return c.JSON(http.StatusNotFound, map[string]string{"message": "未知的备份操作"})
	}
	var payload map[string]json.RawMessage
	if err := journalBind(c, &payload); err != nil {
		return journalError(c, err)
	}
	raw, err := json.Marshal(payload)
	if err != nil || len(raw) > 16384 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "备份配置过大或无效"})
	}
	return s.journalCloudBackupProxy(c, action, raw)
}

func (s *APIV1Service) journalCloudBackupProxy(c *echo.Context, action string, raw []byte) error {
	c.Response().Header().Set("Cache-Control", "no-store")
	user, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	if user.Role != store.RoleAdmin {
		return c.JSON(http.StatusForbidden, map[string]string{"message": "只有管理员可以查看或配置整实例备份"})
	}
	path := os.Getenv("MEMOS_BACKUP_SOCKET")
	if path == "" {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": "尚未连接服务器备份代理；个人 ZIP 导出仍然可用"})
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", path)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	method := http.MethodGet
	if raw != nil {
		method = http.MethodPost
	}
	// This transport only dials the permission-protected Unix socket; no TCP request or secret crosses an unencrypted network.
	request, err := http.NewRequestWithContext(c.Request().Context(), method, "http://backup-agent/v1/"+action, bytes.NewReader(raw)) //nolint:revive // Unix HTTP transport has no TLS endpoint.
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"message": "无法创建备份请求"})
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": "服务器备份代理暂不可用，请检查代理服务和挂载；此状态不代表已备份"})
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 || !json.Valid(body) {
		return c.JSON(http.StatusBadGateway, map[string]string{"message": "备份代理返回无效状态，请检查服务器任务"})
	}
	return c.Blob(response.StatusCode, "application/json", body)
}
