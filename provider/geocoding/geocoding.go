// Package geocoding provides explicitly requested public-place lookups through
// a replaceable Nominatim endpoint, with one shared rate limit and bounded cache.
package geocoding

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// Place is a WGS84 search candidate; a reverse result must not replace the
// user's coordinates with the nearby OSM object's coordinates.
type Place struct {
	Name      string  `json:"name"`
	Address   string  `json:"address"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type entry struct {
	places []Place
	until  time.Time
}

// Client serializes all users' requests, retaining successful results for a day.
type Client struct {
	endpoint string
	http     *http.Client
	gate     chan struct{}
	cache    map[string]entry
	last     time.Time
	interval time.Duration
}

// NewClient accepts the administrator's endpoint, never a user-supplied URL.
func NewClient(endpoint string) *Client {
	if endpoint == "" {
		endpoint = "https://nominatim.openstreetmap.org"
	}
	return &Client{endpoint: strings.TrimRight(endpoint, "/"),
		http: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }},
		gate: make(chan struct{}, 1), cache: map[string]entry{}, interval: 1100 * time.Millisecond}
}

// ValidCoordinates excludes NaN, infinities and out-of-range points, while
// keeping zero coordinates valid.
func ValidCoordinates(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsNaN(longitude) && !math.IsInf(latitude, 0) && !math.IsInf(longitude, 0) &&
		latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

// Search runs only after explicit user submission, never autocomplete.
func (c *Client) Search(ctx context.Context, query string) ([]Place, error) {
	query = strings.TrimSpace(query)
	if len([]rune(query)) < 2 || len([]rune(query)) > 200 {
		return nil, errors.New("place query must contain 2–200 characters")
	}
	return c.lookup(ctx, "search", url.Values{"q": {query}, "limit": {"8"}})
}

// Reverse looks up a candidate name without changing the requested point.
func (c *Client) Reverse(ctx context.Context, latitude, longitude float64) (Place, error) {
	if !ValidCoordinates(latitude, longitude) {
		return Place{}, errors.New("invalid coordinates")
	}
	places, err := c.lookup(ctx, "reverse", url.Values{
		"lat": {strconv.FormatFloat(latitude, 'f', 6, 64)}, "lon": {strconv.FormatFloat(longitude, 'f', 6, 64)}, "zoom": {"18"},
	})
	if err != nil {
		return Place{}, err
	}
	if len(places) == 0 {
		return Place{}, errors.New("no name found for this point")
	}
	return places[0], nil
}

func (c *Client) lookup(ctx context.Context, operation string, values url.Values) ([]Place, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	select {
	case c.gate <- struct{}{}:
		defer func() { <-c.gate }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	values.Set("format", "jsonv2")
	values.Set("accept-language", "zh-CN,zh,en")
	values.Set("addressdetails", "0")
	key := operation + "?" + values.Encode()
	if cached, ok := c.cache[key]; ok && time.Now().Before(cached.until) {
		return append([]Place{}, cached.places...), nil
	}
	u, err := url.Parse(c.endpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("geocoding endpoint requires HTTPS")
	}
	if delay := time.Until(c.last.Add(c.interval)); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/" + operation
	u.RawQuery = values.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, errors.Wrap(err, "create geocoding request")
	}
	request.Header.Set("User-Agent", "Kairos/1.0 (https://github.com/EgoSay/kairos)")
	request.Header.Set("Accept", "application/json")
	// Space requests after completion as well: a slow TLS handshake must not
	// turn two client start times into closely spaced upstream requests.
	defer func() { c.last = time.Now() }()
	response, err := c.http.Do(request)
	if err != nil {
		return nil, errors.New("place service is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("place service did not accept the request")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 512*1024+1))
	if err != nil || len(body) > 512*1024 {
		return nil, errors.New("invalid place service response")
	}
	type result struct {
		Name      string `json:"name"`
		Address   string `json:"display_name"`
		Latitude  string `json:"lat"`
		Longitude string `json:"lon"`
	}
	var rows []result
	if operation == "reverse" {
		var row result
		err = json.Unmarshal(body, &row)
		rows = []result{row}
	} else {
		err = json.Unmarshal(body, &rows)
	}
	if err != nil || len(rows) > 40 {
		return nil, errors.New("invalid place service response")
	}
	places := []Place{}
	for _, row := range rows {
		lat, latErr := strconv.ParseFloat(row.Latitude, 64)
		lng, lngErr := strconv.ParseFloat(row.Longitude, 64)
		if latErr != nil || lngErr != nil || !ValidCoordinates(lat, lng) || row.Address == "" {
			continue
		}
		name := strings.TrimSpace(row.Name)
		if name == "" {
			name = row.Address
		}
		if len([]rune(name)) > 200 {
			name = string([]rune(name)[:200])
		}
		address := row.Address
		if len([]rune(address)) > 500 {
			address = string([]rune(address)[:500])
		}
		places = append(places, Place{Name: name, Address: address, Latitude: lat, Longitude: lng})
	}
	if len(c.cache) >= 256 {
		c.cache = map[string]entry{}
	}
	c.cache[key] = entry{places: places, until: time.Now().Add(24 * time.Hour)}
	return append([]Place{}, places...), nil
}
