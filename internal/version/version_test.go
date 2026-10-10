package version

import (
	"runtime/debug"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveBuild(t *testing.T) {
	const revision = "abcdef1234567890abcdef1234567890abcdef12"
	base := strings.TrimSpace(developmentBaseVersion)
	require.True(t, releaseVersion.MatchString(base), "VERSION must contain a stable semantic version")
	require.NotContains(t, base, "-")
	for _, tc := range []struct {
		name, version, commit, timestamp, wantVersion, wantCommit string
	}{
		{"development", "", "unknown", "2026-09-27T14:58:52Z", base + "-dev.abcdef123456", revision},
		{"UTC month boundary", "", "unknown", "2026-10-01T00:30:00+08:00", base + "-dev.abcdef123456", revision},
		{"release override", "1.0.0", "release-sha", "2026-09-27T14:58:52Z", "1.0.0", "release-sha"},
		{"RC override", "1.1.0-rc.1", "", "2026-09-27T14:58:52Z", "1.1.0-rc.1", revision},
		{"timestamp irrelevant", "", "unknown", "invalid", base + "-dev.abcdef123456", revision},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := []debug.BuildSetting{
				{Key: "vcs.time", Value: tc.timestamp},
				{Key: "vcs.revision", Value: revision},
				{Key: "vcs.modified", Value: "true"},
			}
			version, commit := resolveBuild(tc.version, tc.commit, settings)
			require.Equal(t, tc.wantVersion, version)
			require.Equal(t, tc.wantCommit, commit)
		})
	}

	version, commit := resolveBuild("", "unknown", nil)
	require.Empty(t, version)
	require.Equal(t, "unknown", commit)
	version, commit = resolveBuild("1.0.0", "release-sha", nil)
	require.Equal(t, "1.0.0", version)
	require.Equal(t, "release-sha", commit)
}

func TestValidate(t *testing.T) {
	original := Version
	t.Cleanup(func() { Version = original })
	for _, value := range []string{"1.0.0", "1.0.1", "1.10.0", "2.0.0", "1.1.0-rc.1", "1.0.0-dev.abcdef123456"} {
		Version = value
		require.NoError(t, Validate(), value)
	}
	for _, value := range []string{"dev", "manual-abc123", "v1.0.0", "26.10", "1.0", "01.0.0", "1.00.0", "1.0.01", "1.0.0-rc.0", "1.0.0-rc.01", "1.0.0-dev.abc123", "1.0.0-dev.abcdefghijkl", "1.0.0+build"} {
		Version = value
		require.ErrorContains(t, Validate(), "invalid build version", value)
	}
	Version = ""
	require.ErrorContains(t, Validate(), "-buildvcs=true")
}
