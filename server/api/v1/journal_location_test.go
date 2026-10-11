package v1

import (
	"context"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/store"
)

func TestJournalLocationOwnerBoundaryAndCoordinates(t *testing.T) {
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, svc, "location-owner", store.RoleAdmin)
	other := createSpaceTestUser(context.Background(), t, svc, "location-other", store.RoleUser)
	e := echo.New()
	svc.registerJournalLocationRoutes(e.Group("/api/v1/journal"))
	ctx := userCtx(context.Background(), owner.ID)
	require.Equal(t, 401, journalHTTP(context.Background(), t, e, "GET", "/api/v1/journal/locations", nil).Code)
	response := journalHTTP(ctx, t, e, "PUT", "/api/v1/journal/locations", map[string]any{"version": 0, "places": []map[string]any{{"id": "home", "name": "家", "latitude": 31, "longitude": 121}}})
	require.Equal(t, 200, response.Code, response.Body.String())
	require.Contains(t, journalHTTP(ctx, t, e, "GET", "/api/v1/journal/locations", nil).Body.String(), "家")
	require.NotContains(t, journalHTTP(userCtx(context.Background(), other.ID), t, e, "GET", "/api/v1/journal/locations", nil).Body.String(), "家")
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/locations/reverse", map[string]any{"latitude": 91, "longitude": 1})
	require.Equal(t, 400, response.Code)
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/locations/reverse", map[string]any{})
	require.Equal(t, 400, response.Code, "missing coordinates must not silently become 0,0")
	response = journalHTTP(ctx, t, e, "POST", "/api/v1/journal/locations/search", map[string]any{"query": "x"})
	require.Equal(t, 400, response.Code)
}
