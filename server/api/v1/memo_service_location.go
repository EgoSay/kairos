package v1

import (
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/provider/geocoding"
)

// validateMemoLocation keeps a personal place name distinct from a geographic
// point. Existing zero-coordinate locations retain their original meaning.
func validateMemoLocation(location *v1pb.Location) error {
	if location == nil {
		return nil
	}
	if location.NameOnly {
		if len([]rune(location.Placeholder)) > 200 {
			return status.Errorf(codes.InvalidArgument, "location name must be at most 200 characters")
		}
		if strings.TrimSpace(location.Placeholder) == "" || location.Latitude != 0 || location.Longitude != 0 {
			return status.Errorf(codes.InvalidArgument, "a name-only location requires a name and cannot include coordinates")
		}
		return nil
	}
	if !geocoding.ValidCoordinates(location.Latitude, location.Longitude) {
		return status.Errorf(codes.InvalidArgument, "location coordinates are invalid")
	}
	return nil
}
