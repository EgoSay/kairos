package v1

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v5"

	"github.com/EgoSay/kairos/core/recordgraph"
	"github.com/EgoSay/kairos/server/auth"
)

func (s *APIV1Service) journalWanderJobs(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	var after int64
	if raw := c.QueryParam("after"); raw != "" {
		after, err = strconv.ParseInt(raw, 10, 32)
		if err != nil || after < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "分页位置无效"})
		}
	}
	value, err := s.RecordGraph.Jobs(c.Request().Context(), u.ID, c.QueryParam("state"), int32(after))
	if err != nil {
		return wanderError(c, err)
	}
	return c.JSON(http.StatusOK, value)
}

func (s *APIV1Service) journalWanderAttempts(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	value, err := s.RecordGraph.Attempts(c.Request().Context(), u.ID, "memos/"+c.Param("uid"), c.QueryParam("cursor"))
	if err != nil {
		return wanderError(c, err)
	}
	return c.JSON(http.StatusOK, value)
}

func (s *APIV1Service) journalWanderRetry(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	if auth.IsReadOnly(c.Request().Context()) {
		return c.JSON(http.StatusForbidden, map[string]string{"message": ErrReadOnlyCredential.Error()})
	}
	var input recordgraph.RetryRequest
	if err = wanderBind(c, &input); err != nil {
		return journalError(c, err)
	}
	value, err := s.RecordGraph.Retry(c.Request().Context(), u.ID, input)
	if err != nil {
		return wanderError(c, err)
	}
	return c.JSON(http.StatusOK, value)
}
