#!/usr/bin/env bash

set -euo pipefail

# Kairos releases use MAJOR.MINOR.PATCH[-rc.N]. Database schemas remain separate.
parse_release_tag() {
  local tag="$1"
  if [[ ! "$tag" =~ ^((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))(-rc\.([1-9][0-9]*))?$ ]]; then
    return 1
  fi
  RELEASE_VERSION="$tag"
  RELEASE_SERIES="${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
  RELEASE_IS_PRERELEASE=false
  if [[ -n "${BASH_REMATCH[5]}" ]]; then
    RELEASE_IS_PRERELEASE=true
  fi
}

# Prefer independent Kairos releases over numerically larger transition tags.
stable_release_tags() {
  local repo="$1" tag
  while IFS= read -r tag; do
    case "$tag" in 26.10.1|26.10.2) continue ;; esac
    if parse_release_tag "$tag" && [[ "$RELEASE_IS_PRERELEASE" == false ]]; then
      printf '%s\n' "$tag"
    fi
  done < <(git -C "$repo" tag --list '[0-9]*' --sort=-version:refname)
  git -C "$repo" tag --list '26.10.1' '26.10.2' --sort=-version:refname
  git -C "$repo" tag --list 'v0.31.*' --sort=-version:refname
}

# previous_release_tag prints the newest stable release tag that is an ancestor
# of HEAD, excluding tags on HEAD itself. Keep the two published transition
# releases and upstream v0.31.x available as upgrade baselines.
previous_release_tag() {
  local repo="$1" head_sha tag tag_sha
  head_sha="$(git -C "$repo" rev-parse HEAD)"
  while IFS= read -r tag; do
    if parse_release_tag "$tag"; then
      [[ "$RELEASE_IS_PRERELEASE" == false ]] || continue
    elif [[ ! "$tag" =~ ^v0\.31\.(0|[1-9][0-9]*)$ ]]; then
      continue
    fi
    tag_sha="$(git -C "$repo" rev-list -n 1 "$tag")"
    [[ "$tag_sha" != "$head_sha" ]] || continue
    if git -C "$repo" merge-base --is-ancestor "$tag" HEAD; then
      printf '%s\n' "$tag"
      return
    fi
  done < <(stable_release_tags "$repo")
  echo 'No supported previous release found' >&2
  return 1
}

previous_release_image() {
  local tag
  if ! tag="$(previous_release_tag "$1")"; then
    echo 'Pass --previous-image' >&2
    return 1
  fi
  case "$tag" in
    v0.31.*) printf 'neosmemo/memos:%s\n' "${tag#v}" ;;
    26.10.1) printf 'ghcr.io/egosay/memos-journal:%s\n' "$tag" ;; # Pre-Kairos production release.
    *) printf 'ghcr.io/egosay/kairos:%s\n' "$tag" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    development-version)
      version="$(cat "$(dirname "${BASH_SOURCE[0]}")/../internal/version/VERSION")"
      if ! parse_release_tag "$version" || [[ "$RELEASE_IS_PRERELEASE" != false ]]; then
        echo "internal/version/VERSION must contain a stable semantic version" >&2
        exit 1
      fi
      commit="$(git -C "${2:-.}" rev-parse --verify HEAD)"
      printf '%s-dev.%.12s\n' "$version" "$commit"
      exit
      ;;
    previous-tag)
      previous_release_tag "${2:?repository required}"
      exit
      ;;
    previous-image)
      previous_release_image "${2:?repository required}"
      exit
      ;;
  esac
  tag="${2:?release tag required}"
  if ! parse_release_tag "$tag"; then
    echo "Unsupported release tag format: $tag" >&2
    exit 1
  fi
  case "${1:-}" in
    version)
      printf 'tag=%s\nversion=%s\nseries=%s\nis_prerelease=%s\n' \
        "$tag" "$RELEASE_VERSION" "$RELEASE_SERIES" "$RELEASE_IS_PRERELEASE"
      ;;
    image-tags)
      printf '%s\n' "$RELEASE_VERSION"
      if [[ "$RELEASE_IS_PRERELEASE" == false ]]; then
        if [[ "$RELEASE_SERIES" != "$RELEASE_VERSION" ]]; then
          printf '%s\n' "$RELEASE_SERIES"
        fi
        printf 'stable\n'
      fi
      ;;
    *) echo "Unknown release command: ${1:-}" >&2; exit 1 ;;
  esac
fi
