# Geocoding

Explicit public-place search and name lookup through Nominatim. Coordinates are
WGS84, matching the editor's OSM/OpenFreeMap map; reverse lookup never replaces a
selected point with the nearest object's coordinates.

The existing public endpoint is used only for user-submitted queries. The shared
client serializes traffic to at most one request per 1.1 seconds, identifies
Kairos, and caches up to 256 results for 24 hours. There is no autocomplete, bulk
lookup or background geolocation. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).
The UI includes attribution and explains what leaves the instance; private
names can be typed without a lookup. The administrator can change the HTTPS
Nominatim-compatible service using `MEMOS_GEOCODING_ENDPOINT` and restart without
a software update. Larger/multi-replica deployments must use their own service
or a provider appropriate to their volume instead of multiplying the public
endpoint's per-application limit.
