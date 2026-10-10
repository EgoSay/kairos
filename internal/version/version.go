package version

import (
	_ "embed"
	"regexp"
	"runtime/debug"
	"strings"

	"github.com/pkg/errors"
)

//go:embed VERSION
var developmentBaseVersion string

// Version is injected by release builds or derived from VERSION and the embedded commit.
var Version string

// Commit is injected by CI or read from build metadata, falling back to unknown.
var Commit = "unknown"

// Release tags omit the v prefix. Development builds carry their source identity.
var releaseVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.[1-9][0-9]*)?$`)
var developmentVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-dev\.[a-f0-9]{12}$`)

func init() {
	if info, ok := debug.ReadBuildInfo(); ok {
		Version, Commit = resolveBuild(Version, Commit, info.Settings)
	}
}

func resolveBuild(version, commit string, settings []debug.BuildSetting) (string, string) {
	for _, setting := range settings {
		if setting.Key == "vcs.revision" && (commit == "" || commit == "unknown") {
			commit = setting.Value
		}
	}
	if version == "" && len(commit) == 40 {
		version = strings.TrimSpace(developmentBaseVersion) + "-dev." + commit[:12]
	}
	return version, commit
}

// Validate checks that the build has a Kairos version before it is exposed.
func Validate() error {
	if Version == "" {
		return errors.New("missing build version: use go run -buildvcs=true ./cmd/memos or inject internal/version.Version with -ldflags")
	}
	if !releaseVersion.MatchString(Version) && !developmentVersion.MatchString(Version) {
		return errors.Errorf("invalid build version %q: expected MAJOR.MINOR.PATCH[-rc.N] or MAJOR.MINOR.PATCH-dev.<12-char commit>", Version)
	}
	return nil
}

// GetCurrentVersion returns the application version.
func GetCurrentVersion() string {
	return Version
}
