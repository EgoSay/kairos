package v1

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/core/recordgraph"
	"github.com/EgoSay/kairos/store"
)

func (s *APIV1Service) registerJournalWanderRoutes(ctx context.Context, group *echo.Group) {
	s.RecordGraph = recordgraph.New(s.Store)
	group.GET("/wander/config", s.journalWanderConfig)
	group.PUT("/wander/config", s.journalWanderConfigure)
	group.GET("/wander/status", s.journalWanderStatus)
	group.GET("/wander/jobs", s.journalWanderJobs)
	group.GET("/wander/jobs/:uid/attempts", s.journalWanderAttempts)
	group.POST("/wander/retry", s.journalWanderRetry)
	group.POST("/wander/start", s.journalWanderStart)
	group.POST("/wander/neighborhoods", s.journalWanderRead)
	group.POST("/wander/feedback", s.journalWanderFeedback)
	go s.runRecordGraph(ctx)
}
func (s *APIV1Service) runRecordGraph(ctx context.Context) {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			changed, err := s.RecordGraph.RunOnce(ctx)
			if err != nil && ctx.Err() == nil {
				slog.Warn("Record association worker deferred", "error", err)
			}
			if changed && s.SSEHub != nil {
				s.SSEHub.publish([]byte("data: {\"type\":\"graph.changed\"}\n\n"))
			}
			timer.Reset(5 * time.Second)
		}
	}
}
func wanderError(c *echo.Context, err error) error {
	if errors.Is(err, store.ErrGraphConflict) {
		return c.JSON(http.StatusConflict, map[string]string{"message": "记录已更新，请重新打开"})
	}
	return journalError(c, err)
}
func (s *APIV1Service) journalWanderConfig(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	config, err := s.RecordGraph.GetConfig(c.Request().Context(), u.ID)
	if err != nil {
		return wanderError(c, err)
	}
	// Provider selection contains no credentials. Its account connection is configured in instance settings.
	setting, err := s.Store.GetInstanceAISetting(c.Request().Context())
	if err != nil {
		return wanderError(c, err)
	}
	providers := []map[string]string{}
	for _, p := range setting.GetProviders() {
		providers = append(providers, map[string]string{"id": p.GetId(), "title": p.GetTitle()})
	}
	return c.JSON(http.StatusOK, map[string]any{"config": config, "providers": providers})
}
func (s *APIV1Service) journalWanderConfigure(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	var input recordgraph.Config
	if err = wanderBind(c, &input); err != nil {
		return journalError(c, err)
	}
	value, err := s.RecordGraph.Configure(c.Request().Context(), u.ID, input)
	if err != nil {
		return wanderError(c, err)
	}
	if s.SSEHub != nil {
		s.SSEHub.publishMemoChanged()
	}
	return c.JSON(http.StatusOK, value)
}
func (s *APIV1Service) journalWanderStatus(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	value, err := s.RecordGraph.Status(c.Request().Context(), u.ID)
	if err != nil {
		return wanderError(c, err)
	}
	return c.JSON(http.StatusOK, value)
}
func (s *APIV1Service) journalWanderStart(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	var input struct {
		Seen []string `json:"seen"`
	}
	if err = wanderBind(c, &input); err != nil {
		return journalError(c, err)
	}
	value, err := s.RecordGraph.Bootstrap(c.Request().Context(), u.ID, input.Seen)
	if err != nil {
		return wanderError(c, err)
	}
	return c.JSON(http.StatusOK, value)
}
func (s *APIV1Service) journalWanderRead(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	var input struct {
		Names []string `json:"names"`
	}
	if err = wanderBind(c, &input); err != nil {
		return journalError(c, err)
	}
	if len(input.Names) < 1 || len(input.Names) > 4 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "每次读取一至四个邻域"})
	}
	values := []recordgraph.Neighborhood{}
	for _, name := range input.Names {
		value, err := s.RecordGraph.ByName(c.Request().Context(), u.ID, name)
		if err != nil {
			return wanderError(c, err)
		}
		values = append(values, value)
	}
	return c.JSON(http.StatusOK, map[string]any{"neighborhoods": values})
}
func (s *APIV1Service) journalWanderFeedback(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	var input struct {
		Source  string `json:"source"`
		Target  string `json:"target"`
		Dismiss bool   `json:"dismiss"`
	}
	if err = wanderBind(c, &input); err != nil {
		return journalError(c, err)
	}
	if err = s.RecordGraph.Feedback(c.Request().Context(), u.ID, input.Source, input.Target, input.Dismiss); err != nil {
		return wanderError(c, err)
	}
	if s.SSEHub != nil {
		s.SSEHub.publishMemoChanged()
	}
	return c.NoContent(http.StatusNoContent)
}

func wanderBind(c *echo.Context, value any) error {
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 8192)
	return journalBind(c, value)
}
