---
name: release
description: >
  Release the Kairos private journal through a semantic version tag: verify the candidate,
  push an authorized tag, watch Kairos Image, and verify the deployed
  source commit and image digest. Use for an explicitly requested Kairos release
  or release candidate; changing release configuration is not itself a release.
metadata:
  owner: "EgoSay"
  version: "2.3.0"
  last-reviewed: "2026-10-10"
---

# Kairos release

Pushing a `MAJOR.MINOR.PATCH[-rc.N]` tag triggers `.github/workflows/journal-image.yml`.
Kairos starts at `1.0.0`; tags have no `v` prefix. Set `internal/version/VERSION`
to the intended stable version; the release tag base must match it. Development
builds use `VERSION-dev.<12-character commit>`. Database schema numbering remains
independent and must not be reset.

The workflow validates the version, runs frontend/backend checks, builds and
smoke-tests the complete image, publishes to `ghcr.io/egosay/kairos`,
verifies the pre-upgrade snapshot/R2 backup, and asks the restricted server gate
to update the existing Dokploy Raw Compose and invoke its deployment API. It confirms the public
source identity and server image health before completing the deployment.

The upstream Canary, Release, Render demo and stale-item workflows are retired.
Do not invoke `release.yml`, publish to `neosmemo/memos` or
`ghcr.io/usememos/memos`, or claim Kairos builds upstream binary archives.
The journal workflow does not create a GitHub Release page.
Before the first Kairos release, verify that Dokploy uses `EgoSay/kairos`
and the deployed `journal_release_gate.py` expects the Kairos registry.
Keep the existing composeId, appName, environment, volumes, and data paths.
Use Raw Compose with autodeploy disabled; retained repository metadata points
to `EgoSay/kairos` / `main`. The API key stays in root-only server configuration.
Before release, install the reviewed gate/adapter changes and Compose template
when they changed. The template SHA-256 must match the tagged source; the gate
checks this and API access before it pauses writes.
New GHCR packages default to private. This deployment uses public images:
after the first package push, confirm its visibility is Public. The workflow
checks anonymous manifest access before freezing writes. If that check fails,
configure the package visibility and rerun only after confirming preparation
never started; publishing credentials do not prove Dokploy pull access.
Historical tags remain release records; do not rerun their retired branch-based
workflows after this migration. New requests include repository, commit, digest
and template SHA-256. Both approved image repositories remain recovery targets.
Preserve only `main` as a long-lived branch. Remove temporary branches after
merge and verification; published tags and stored production history remain.

The published transition tags `26.10.1` and `26.10.2` remain historical records.
Previous-release resolution prefers independent semantic releases over those
numerically larger tags. The first `1.0.0` image must pass the actual `26.10.2`
upgrade smoke test; separate upgrade CI retains the original database baseline.

## Candidate and authorization

- Inspect the actual remote refs and existing tags. Default to a reviewed
  `origin/main` commit. The tagged commit must be reachable from `origin/main`;
  merge reviewed changes before publishing a release tag.
- The candidate must contain the current tag-triggered journal workflow and
  the removal of upstream release workflows. An old commit may still contain
  old branch/tag triggers, so do not treat its configuration as current.
- Use an explicit pushed commit SHA, never uncommitted working-tree contents.
  Do not stash, rebase or discard user changes to prepare a release.
- Apply the user's existing authorization. A request to adjust the workflow
  does not authorize publishing a version tag or deploying the application.
  If release authorization is missing, prepare the candidate, tag and checks
  before requesting it. Do not ask again if the release is already authorized.
- Both stable and `-rc.N` tags use the production pipeline. An RC is not a
  preview environment or a dry run.
- Never delete, move or force-push an existing version tag without explicit
  authorization for that tag. Prefer a new version after a source correction.

## Validate and publish a tag

1. Fetch the relevant remote refs and inspect tags. Validate the chosen version
   with `bash scripts/release_version.sh version <tag>`; use the existing
   `MAJOR.MINOR.PATCH[-rc.N]` convention, such as `1.0.0` or `1.1.0-rc.1`.
2. Confirm the tag is unused and points to the intended reviewed commit.
   Inspect available CI results for that exact commit; run relevant checks
   when missing. Upgrade checks can be run through `upgrade-smoke.yml` on the
   candidate ref. There is no manual dispatch for the production workflow.
3. Check the current Dokploy declaration, installed gate/template and required
   credentials without displaying secret values. Missing CI credentials fail
   the workflow. API credentials or template mismatch fail before writes stop.
   Never equate an image publication with a confirmed deployment.
4. With release authorization, create a lightweight or annotated tag on the
   explicit commit and push only that tag. The workflow resolves the checked-out
   commit for both tag types and embeds the tag as the application version.

```bash
git tag -a VERSION REVIEWED_COMMIT -m "Kairos VERSION"
git push origin refs/tags/VERSION
```

## Observe and verify

Find the `journal-image.yml` push run matching the tag. Verify the tag, resolved
commit, image version and digest agree. Confirm the production declaration,
public profile and server deployment receipt identify that commit and digest,
and that backup scheduling resumed. The workflow publishes version, commit and
`production` image tags; deployment uses the immutable digest.

Do not equate an image publication, HTTP response, or green build with verified
production deployment. Distinguish the workflow configuration check, actual
release execution, server confirmation, and user product acceptance.

## Failure and recovery

Read the failed step and private receipts before deciding the next action.
Rerun a transiently failed job only when the release state makes it safe; do not
blindly retry backup/prepare steps while a pending release exists. For a source
change, use a newly reviewed commit and a new version tag.

Follow `scripts/README.md` for rollback. The pending-release gate protects new
writes and schema changes. It waits for the matching Dokploy job to finish and
restores both the previous declaration and image after the data check passes.
Unknown queue outcomes or configuration drift require inspection, not blind
retry. The independent watchdog uses this same server-side path. Confirmed-release
recovery requires a separate compatibility/data assessment. Known rollback
edge cases are tracked in [issues #2](https://github.com/EgoSay/kairos/issues/2)
and [#4](https://github.com/EgoSay/kairos/issues/4) until resolved. Historical
issue and PR links are listed in `docs/history.md`.

Report the version tag, source commit, run URL, image digest, deployment and
backup verification, and any remaining limits. Creating or editing GitHub
Release notes is separate work unless the user requested it.
