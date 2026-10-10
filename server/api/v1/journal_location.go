package v1

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"

	"github.com/EgoSay/kairos/core/journal"
	"github.com/EgoSay/kairos/provider/geocoding"
)

func (s *APIV1Service) registerJournalLocationRoutes(g *echo.Group) {
	g.GET("/locations", s.journalLocations)
	g.PUT("/locations", s.journalSaveLocations)
	g.POST("/locations/search", s.journalSearchLocations)
	g.POST("/locations/reverse", s.journalReverseLocation)
}

func (s *APIV1Service) journalLocations(c *echo.Context) error {
	owner, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	places, err := journal.GetNamedPlaces(c.Request().Context(), s.Store, owner.ID)
	if err != nil {
		return journalError(c, err)
	}
	recent, err := journal.RecentPlaces(c.Request().Context(), s.Store, owner.ID)
	if err != nil {
		return journalError(c, err)
	}
	return c.JSON(http.StatusOK, struct {
		journal.NamedPlaces
		Recent []journal.NamedPlace `json:"recent"`
	}{places, recent})
}

func (s *APIV1Service) journalSaveLocations(c *echo.Context) error {
	owner, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	var places journal.NamedPlaces
	if err := journalBind(c, &places); err != nil {
		return journalError(c, err)
	}
	result, err := journal.SaveNamedPlaces(c.Request().Context(), s.Store, owner.ID, places)
	if err != nil {
		return journalError(c, err)
	}
	return c.JSON(http.StatusOK, result)
}

func (s *APIV1Service) journalSearchLocations(c *echo.Context) error {
	if _, err := s.journalOwner(c); err != nil {
		return journalError(c, err)
	}
	var input struct {
		Query string `json:"query"`
	}
	if err := journalBind(c, &input); err != nil {
		return journalError(c, err)
	}
	input.Query = strings.TrimSpace(input.Query)
	if len([]rune(input.Query)) < 2 || len([]rune(input.Query)) > 200 {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "请输入 2–200 字的公开地点名称"})
	}
	places, err := s.geocoder.Search(c.Request().Context(), input.Query)
	if err != nil {
		return c.JSON(http.StatusBadGateway, map[string]string{"message": "地点搜索暂不可用，请稍后重试，或在地图选点并手动命名"})
	}
	return c.JSON(http.StatusOK, map[string]any{"places": places, "source": "OpenStreetMap / Nominatim"})
}

func (s *APIV1Service) journalReverseLocation(c *echo.Context) error {
	if _, err := s.journalOwner(c); err != nil {
		return journalError(c, err)
	}
	var input struct {
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
	}
	if err := journalBind(c, &input); err != nil {
		return journalError(c, err)
	}
	if input.Latitude == nil || input.Longitude == nil || !geocoding.ValidCoordinates(*input.Latitude, *input.Longitude) {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "坐标超出有效范围"})
	}
	place, err := s.geocoder.Reverse(c.Request().Context(), *input.Latitude, *input.Longitude)
	if err != nil {
		return c.JSON(http.StatusBadGateway, map[string]string{"message": "未能识别地点名称，已选坐标仍可保存；你也可以手动填写名称"})
	}
	// Bind the result to the exact request, not the closest object's coordinates.
	return c.JSON(http.StatusOK, map[string]any{"name": place.Name, "latitude": input.Latitude, "longitude": input.Longitude,
		"key": strconv.FormatFloat(*input.Latitude, 'f', 6, 64) + "," + strconv.FormatFloat(*input.Longitude, 'f', 6, 64)})
}
