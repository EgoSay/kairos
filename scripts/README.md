# Kairos deployment and recovery tools

`Dockerfile` supports local builds and upgrade smoke checks that build the frontend
before building the Go image. `Dockerfile.dokploy` builds both from a clean Git
checkout. Its separate context allowlist excludes local data, secrets,
node_modules and previously generated frontend files.

## Personal journal deployment

`journal-image.yml` runs only when a release tag is pushed. Kairos starts at
`1.0.0` and uses `MAJOR.MINOR.PATCH[-rc.N]`, for example `1.0.1`, `1.1.0` or
`1.1.0-rc.1`, without a `v` prefix. The tagged commit must be reachable from `origin/main` and contain this workflow. Branch
pushes, PR merges, tag deletions and GitHub Release description edits do not
deploy. There is no manual workflow-dispatch entry point; rerun a failed tag run
when appropriate. Release-candidate tags also use this production pipeline.

Set `internal/version/VERSION` to the target stable version before releasing;
the tag's base must match that file. Development builds use that base followed by
`-dev.<12-character commit>`, including shallow clones. Application versions are
independent of database schema versions: starting at `1.0.0` does not reset,
renumber or downgrade an existing database.

Upgrade smoke tests resolve the previous stable ancestor. Independent semantic
releases take precedence over the retained transition tags `26.10.1` and `26.10.2`;
the first `1.0.0` release therefore tests an upgrade from `26.10.2`. Separate
upgrade CI still verifies the original `neosmemo/memos:0.31.0` database baseline.

The workflow validates the tag before starting the frontend and backend CI,
builds the image on GitHub, runs the existing fresh-install, frontend,
restart-persistence and upgrade smoke tests, and publishes the release version,
source commit and `production` image tags to `ghcr.io/egosay/kairos`.
The application version comes from the release tag; the source identity always
uses the checked-out commit, including for annotated tags. This avoids compiling on the
application server. After the backup gate succeeds, the server-side restricted
SSH gate updates the existing Dokploy Compose with the verified image digest and
calls `compose.deploy`. The API key never enters GitHub Actions.

`main` is the only long-lived branch. Dokploy uses **Raw Compose** with
`autoDeploy=false`, `composePath=./docker-compose.yml`, and no custom command;
retained repository metadata points to `EgoSay/kairos` / `main`. The raw path is
required so Dokploy writes the private `.env` beside the actual Compose file.
Raw mode ensures a release uses its verified Compose template, even if `main`
advances during the build. Branch pushes and merges cannot start deployment.
Keep the existing composeId, appName, environment, Tunnel and data volume.
The gate changes only `composeFile` during releases; it does not write secrets or
create an application. The public `production` image alias is never the deployment
identity: the actual Compose always uses `ghcr.io/egosay/kairos@sha256:...`.

Keep these values in Dokploy's private environment:

```dotenv
MEMOS_INSTANCE_URL=https://journal.example.com
MEMOS_TUNNEL_TOKEN=<dedicated remotely managed Cloudflare Tunnel token>
```

The source template is `scripts/compose.dokploy.yaml`; install the reviewed copy
at `/opt/memos-backup/compose.dokploy.yaml`. CI submits its SHA-256. A mismatch,
expired API key, unexpected application identity or enabled autodeploy fails
before writes are paused. When changing the template, update this server copy
from the reviewed release commit first. Ordinary product changes need no such step.

For an explicitly authorized release, tag the reviewed source commit and push
that one tag (replace the example version and commit before running):

```bash
bash scripts/release_version.sh version 1.0.0
git tag -a 1.0.0 REVIEWED_COMMIT -m "Kairos 1.0.0"
git push origin refs/tags/1.0.0
```

Pushing the tag starts a real production deployment, including for `-rc.N` tags;
it is not a dry run. Tags must include the current workflow configuration. Do
not move a published tag or tag an old commit that still contains the retired
upstream release workflows. This pipeline publishes our image and deploys the
site; it does not create upstream binary packages or a GitHub Release page.

The inherited upstream Canary image, Release, Render demo and stale-item workflows
have been removed. Keep frontend, backend, Proto and upgrade checks. In GitHub
Actions settings, keep the legacy `Build Canary Image` workflow disabled so its
historical workflow versions cannot publish. No workflow automatically closes
inactive issues or PRs.

Keep the tunnel token in Dokploy's environment, never in Git. Configure the
tunnel origin as `http://memos:5230` only after owner initialization. It shares
the Compose network and needs no published server port.

The current CI image targets `linux/amd64`; confirm server architecture before
deployment. The registry must permit the server to pull the image. The Compose
file does not publish a host port or create a public route. Initialize or
restore the private owner account before enabling ingress. Keep one replica
because SQLite and uploaded media share the `memos-data` named volume. Never
use `docker compose down --volumes` for an update. Runtime limits are 384 MiB
and half a CPU; adjust only from measured usage.

For a local build (Docker required):

```bash
docker build -f scripts/Dockerfile.dokploy \
  --build-arg VERSION="$(bash scripts/release_version.sh development-version)" \
  --build-arg COMMIT="$(git rev-parse HEAD)" -t kairos:verify .
bash scripts/release_smoke_test.sh \
  --candidate-image kairos:verify --previous-image neosmemo/memos:0.31.0
```

For a failed pending release, use the restricted rollback gate described below.
It waits for the matching Dokploy deployment to finish before touching data.
Only after the unchanged-data check succeeds does it restore the previous
Dokploy Compose and exact running image. An unknown queue result, configuration
drift or new data blocks destructive rollback and retains private receipts.
The watchdog uses the same path; recovery does not depend on a CI runner or
another Git push. Do not manually redeploy an old digest over new writes.

A rollback after an already confirmed release needs a separate compatibility and
data-recovery assessment; the pending-release gate is not a general restore tool.
Restore to a new volume when schema compatibility or preservation requires it.

## Backups

`journal_backup.py` creates and verifies private instance archives, including
SQLite, attachments and retained originals. It currently requires a stopped
instance. Restoration must target a new directory and disables restored public
shares, authentication tokens and outgoing delivery credentials.

A persistent Docker volume protects data during redeployment; it is not an
off-server backup. Creating an R2 bucket alone does not enable automatic backups.
Do not claim cloud recovery is ready until a scheduled backup has succeeded and
the resulting archive has been restored and checked in an isolated instance.

### Online encrypted snapshots

`journal_snapshot.py` uses SQLite's online backup API, validates the database,
and pins the immutable local files referenced by attachments and revisions.
It includes retained originals and creates a SHA-256 manifest. Concurrent media
deletion, missing originals, unsafe paths and unsupported external/S3 media fail
the attempt instead of producing a supposedly complete snapshot. A subsequent
attempt starts from a new database snapshot. Avatars embedded in the database are
covered; arbitrary remote images linked in text still depend on their remote host.
Unreferenced files and regenerable caches are excluded.

`journal_cloud_backup.py` serializes snapshot creation, encrypted restic upload,
remote snapshot confirmation and local manifest verification. A partial restic
backup (including exit 3) never advances `last-success.json`. Optional monitoring
delivery has a separate `last-report.json`: a delivery failure does not invalidate
a completed backup. Raw subprocess output and credentials are not logged.

Store configuration outside Git with directory mode 0700 and file mode 0600:

```json
{
  "source": "/actual/docker-volume/_data",
  "logicalRoot": "/var/opt/memos",
  "workDir": "/var/lib/memos-backup",
  "repository": "s3:https://ACCOUNT.r2.cloudflarestorage.com/PRIVATE_BUCKET/restic",
  "passwordFile": "/etc/memos-backup/restic-password",
  "host": "memos-production",
  "instanceVersion": "DEPLOYED_COMMIT",
  "credentials": {
    "AWS_ACCESS_KEY_ID": "BUCKET_SCOPED_KEY",
    "AWS_SECRET_ACCESS_KEY": "BUCKET_SCOPED_SECRET",
    "AWS_DEFAULT_REGION": "auto"
  }
}
```

Use a cryptographically random repository password and retain an independent
recovery copy. Keep the staging directory outside the live volume. Its disk must
fit the SQLite snapshot and, when hard links cannot be used, the referenced media.
Install a checksum-verified restic binary (tested with 0.19.1) and Python 3.9+.
Initialize once; never automatically initialize a new repository after an access
failure:

```bash
umask 077
python3 scripts/journal_cloud_backup.py init --config /etc/memos-backup/config.json
python3 scripts/journal_cloud_backup.py backup --config /etc/memos-backup/config.json
python3 scripts/journal_cloud_backup.py check --config /etc/memos-backup/config.json
python3 scripts/journal_cloud_backup.py retain --config /etc/memos-backup/config.json
```

`check` reads all remote repository data. `retain` keeps all snapshots from the
latest two days, 30 daily, 12 monthly and up to 100 yearly snapshots for the
configured host. Never apply object-age lifecycle deletion to restic data packs.
These scripts alone do not schedule jobs: provision and verify the backup timer,
retention/check jobs and independent monitoring before claiming automatic backup.

Restore the explicit snapshot ID from a verified success receipt with restic into
a new, isolated directory; do not assume the newest snapshot is complete, because
restic can retain snapshots from failed partial uploads. Then run
`journal_snapshot.py verify --destination RESTORED_DIRECTORY`. Verify account and
media behavior in an isolated app as well. Before starting a restored copy, use
the existing `journal_backup.pause_restored_permissions` routine to revoke old
sessions/shares and pause outgoing delivery, and map absolute attachment paths
to the restored data root. Do not replace a running database or start two writable
production instances. Repository passwords and raw restored data stay private.

Run backup consistency and failure-path tests with:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v
```

### Verified production upgrades

Configure GitHub Actions secrets `MEMOS_PREDEPLOY_SSH_KEY`,
`MEMOS_DEPLOY_KNOWN_HOSTS` and `MEMOS_DEPLOY_HOST`.
The SSH public key must use `restrict` with the forced command
`/usr/bin/python3 /opt/memos-backup/journal_release_gate.py`; it permits only
`prepare`, `deploy`, `confirm` and `rollback`, never a shell or arbitrary target.
Install `journal_release_gate.py` and `journal_dokploy.py` beside the backup
modules on the approved Kairos server. Store the API settings in
`/etc/memos-backup/dokploy.json`, owned by root with mode `0600`:

```json
{"url":"http://127.0.0.1:3000","composeId":"EXISTING_COMPOSE_ID","apiKey":"PRIVATE_API_KEY"}
```

Use the existing application ID, never a new installation's ID. The URL is the
server's own Dokploy API; validate its reachable address for that installation.
Manage the key's expiry and rotation in Dokploy; do not commit it or print it in
CI. Dokploy account/organization permissions determine its actual API scope;
the gate restricts its use to this existing Compose. Missing GitHub deployment
credentials fail the workflow instead of reporting an image-only release as success.

Prepare requests include the commit, repository, digest and template SHA-256.
Historical tags remain release records, but their branch-based workflows must
not be rerun after migration. Use a new main-based tag for a new deployment.
Previous Kairos and legacy personal-journal images remain valid recovery targets.

After all CI and image smoke checks pass, the gate verifies API access and
configuration, stops only Kairos writes, retains a verified local snapshot and
completes encrypted R2 backup. `deploy` updates the pinned Raw Compose and calls
the authenticated Dokploy API. The private receipt records the exact deployment
title before the POST so a lost response cannot authorize a blind retry.
Confirmation requires the matching Dokploy job to finish successfully, the public
and internal source identities to agree, private access mode, the running digest,
and Docker health. An eight minute watchdog handles interrupted releases;
preparation has a six minute deadline. No whole-host restart is used.

Rollback restores the previous snapshot and exact image only while the logical
database and its shape are unchanged. If the new version accepted content,
changed account/settings state or transformed tables, it preserves current data and reports a blocked
rollback instead of erasing changes or guessing schema compatibility. Inspect
private release receipts in `/var/lib/memos-release` in that case. The latest
three local preparation snapshots are retained; R2 follows its separate policy.
The rollback logic must be exercised and the full pipeline must succeed in the
actual environment before declaring automated releases ready.
