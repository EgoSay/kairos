package memoexport

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVersionTwoDistinguishesNameOnlyFromRealOrigin(t *testing.T) {
	fixture := newGoldenFixture()
	fixture.memos[0].Location = &Location{Placeholder: "家", NameOnly: true}
	fixture.memos[1].Location = &Location{Placeholder: "真实原点", Latitude: 0, Longitude: 0}
	// The manifest arrives before records. Callers cannot accidentally opt a
	// name-only record into the legacy parser's default-zero interpretation.
	fixture.manifest.FormatVersion = "1.0"
	data := writeFixture(t, fixture)
	archive := readArchive(t, data)
	require.Equal(t, "2.0", archive.Manifest.FormatVersion)
	fixture.manifest.FormatVersion = "2.0"
	requireFixtureRoundTrip(t, fixture, archive)

	container, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	for _, file := range container.File {
		if file.Name != RecordPath(fixture.memos[0].UID) && file.Name != RecordPath(fixture.memos[1].UID) {
			continue
		}
		reader, err := file.Open()
		require.NoError(t, err)
		raw, err := io.ReadAll(reader)
		require.NoError(t, err)
		require.NoError(t, reader.Close())
		var record struct {
			Location map[string]json.RawMessage `json:"location"`
		}
		require.NoError(t, json.Unmarshal(raw, &record))
		if file.Name == RecordPath(fixture.memos[0].UID) {
			require.JSONEq(t, `true`, string(record.Location["nameOnly"]))
			require.NotContains(t, record.Location, "latitude")
			require.NotContains(t, record.Location, "longitude")
		} else {
			require.JSONEq(t, `0`, string(record.Location["latitude"]))
			require.JSONEq(t, `0`, string(record.Location["longitude"]))
			require.NotContains(t, record.Location, "nameOnly")
		}
	}
}

func TestReaderVersionBoundaryPreservesLegacyMinorCompatibility(t *testing.T) {
	manifest := newGoldenFixture().manifest
	for _, version := range []string{"1.0", "1.9", "2.0", "2.1"} {
		manifest.FormatVersion = version
		require.NoError(t, validateManifest(&manifest), version)
	}
	for _, version := range []string{"0.9", "3.0", "-1.0", "2", "2.bad"} {
		manifest.FormatVersion = version
		require.Error(t, validateManifest(&manifest), version)
	}
}
