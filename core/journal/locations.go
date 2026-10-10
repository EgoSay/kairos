package journal

import (
	"context"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/pkg/errors"

	"github.com/EgoSay/kairos/provider/geocoding"
	"github.com/EgoSay/kairos/store"
)

// NamedPlace is an owner's reusable location; renaming it never rewrites memos.
type NamedPlace struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// NamedPlaces is one compare-and-swap collection of at most fifty private places.
type NamedPlaces struct {
	Places  []NamedPlace `json:"places"`
	Version int64        `json:"version"`
}

// GetNamedPlaces reads only the given owner's location collection.
func GetNamedPlaces(ctx context.Context, s *store.Store, owner int32) (NamedPlaces, error) {
	result := NamedPlaces{Places: []NamedPlace{}}
	doc, err := s.GetJournalDocument(ctx, owner, "named-locations", "main")
	if err != nil || doc == nil {
		return result, err
	}
	if err := json.Unmarshal(doc.Payload, &result.Places); err != nil {
		return result, err
	}
	result.Version = doc.Version
	return result, nil
}

// SaveNamedPlaces validates coordinates and preserves concurrent edits through CAS.
func SaveNamedPlaces(ctx context.Context, s *store.Store, owner int32, places NamedPlaces) (NamedPlaces, error) {
	if len(places.Places) > 50 || places.Version < 0 {
		return places, errors.New("常用地点最多 50 个，请刷新后重试")
	}
	ids := map[string]bool{}
	validID := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	for i := range places.Places {
		place := &places.Places[i]
		place.Name = strings.TrimSpace(place.Name)
		if !validID.MatchString(place.ID) || ids[place.ID] || place.Name == "" || len([]rune(place.Name)) > 200 ||
			!geocoding.ValidCoordinates(place.Latitude, place.Longitude) {
			return places, errors.New("地点名称、标识或坐标无效")
		}
		ids[place.ID] = true
	}
	if places.Places == nil {
		places.Places = []NamedPlace{}
	}
	payload, err := json.Marshal(places.Places)
	if err != nil {
		return places, err
	}
	doc, err := s.PutJournalDocument(ctx, &store.JournalDocument{OwnerID: owner, Kind: "named-locations", Key: "main", Payload: payload}, places.Version)
	if err != nil {
		return places, err
	}
	places.Version = doc.Version
	return places, nil
}

// RecentPlaces returns twelve distinct locations from readable, live originals.
func RecentPlaces(ctx context.Context, s *store.Store, owner int32) ([]NamedPlace, error) {
	memos, err := MemoNames(ctx, s, owner, false)
	if err != nil {
		return nil, err
	}
	slices.SortStableFunc(memos, func(a, b *store.Memo) int {
		if a.UpdatedTs > b.UpdatedTs {
			return -1
		}
		if a.UpdatedTs < b.UpdatedTs {
			return 1
		}
		return 0
	})
	seen := map[string]bool{}
	result := []NamedPlace{}
	for _, memo := range memos {
		location := memo.Payload.GetLocation()
		if location == nil || !geocoding.ValidCoordinates(location.Latitude, location.Longitude) {
			continue
		}
		key := strconv.FormatFloat(location.Latitude, 'f', 5, 64) + "," + strconv.FormatFloat(location.Longitude, 'f', 5, 64)
		if seen[key] {
			continue
		}
		seen[key] = true
		name := location.Placeholder
		if name == "" {
			name = key
		}
		result = append(result, NamedPlace{ID: memo.UID, Name: name, Latitude: location.Latitude, Longitude: location.Longitude})
		if len(result) == 12 {
			break
		}
	}
	return result, nil
}
