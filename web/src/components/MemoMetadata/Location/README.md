# Location metadata

`LocationDialog` is an anchored picker beside the editor. Favorites and recent
places filter locally while typing; selecting a candidate returns a draft
location in one action through `onSelect`. The editor owns persistence and
restores the caret after the picker closes. Favorite management never rewrites
historical memo locations.

Personal names use the additive proto `nameOnly` flag and carry no geographic
meaning. A false/absent flag preserves legacy coordinates, including `(0, 0)`.
The map model excludes names without coordinates, and display components never
mount a map or show numeric coordinates for them. Invalid partial coordinate
edits cannot silently turn into a name-only location.

Opening the picker performs only an authenticated request for the owner's own
places. No map tiles, device geolocation, public place search or reverse lookup
run automatically. Maps mount only after the user enters the map layer; public
Nominatim search remains an explicit submit, never autocomplete. Device results
remain candidates until confirmed, and the location hook rejects late results
after manual choices, cancellation and reopening.
