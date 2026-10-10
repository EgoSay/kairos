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

Remote `rollback` requests must receive the same release JSON on stdin as
`prepare` (repository, commit, digest and Compose SHA-256). A request for another
pending release is rejected without changes. If the watchdog already completed
recovery, the gate accepts only a matching successful receipt and verifies that
the previous Dokploy declaration and healthy image are still current before
returning `already-rolled-back`; a missing or stale receipt is not success. The
local watchdog has no stdin and recovers the current pending release.

A missing application container does not prevent safe rollback: a successful
Docker query must prove absence before the gate proceeds through the unchanged
data check and rebuilds the old service. Docker daemon and permission failures
still fail. New data, an unreadable database or unknown deployment outcome retain
the pending state; the gate attempts to resume backup scheduling and records a
private `last-rollback-attempt.json` for inspection. Health or backup-resumption
failure never records a successful rollback. Install the updated server gate
before a workflow that sends release identities to rollback.

The unchanged-data fingerprint covers the full logical SQLite database. When it
matches, rollback keeps that database and its WAL in place; it restores the
declaration and image without deleting and recopying identical data. Confirmation
retains the pending receipt and watchdog until backup scheduling has recovered.
The release receipt preserves an administrator's paused backup schedule, so a
successful release or rollback does not silently enable it.

Before stopping writes, the gate resolves the verified previous Dokploy Compose
with its private environment and freezes the `memos` service for rollback. It
retains that service's settings and the running container's complete environment,
mounts and network identities, including the backup-agent socket. Existing named
volumes and networks are pinned as external so rollback cannot create an empty
replacement. The previous image stays pinned by digest and uses the locally
available image. Compose parsing is checked before downtime; environment secrets
remain in root-private files and never enter command arguments or public receipts.

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
deletion, missing originals, unsafe paths and uncovered external media fail
the attempt instead of producing a supposedly complete snapshot. A subsequent
attempt starts from a new database snapshot. Avatars embedded in the database are
covered; managed S3 objects are copied through the host storage helper described
below. Arbitrary remote images linked in text still depend on their remote host.
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
restic can retain snapshots from failed partial uploads. This script backs up
relative `data` and `manifest.json` paths: the snapshot tree restores directly
under the target even though `snapshots --json` lists absolute input paths.
Inspect `restic ls SNAPSHOT_ID` when recovering archives from another producer.
Then run
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

Rollback verifies the previous snapshot and restores the exact image only while
the logical database and its shape are unchanged, retaining the live DB/WAL.
If the new version accepted content,
changed account/settings state or transformed tables, it preserves current data and reports a blocked
rollback instead of erasing changes or guessing schema compatibility. Inspect
private release receipts in `/var/lib/memos-release` in that case. The latest
three local preparation snapshots are retained; R2 follows its separate policy.
The rollback logic must be exercised and the full pipeline must succeed in the
actual environment before declaring automated releases ready.

### Product backup configuration and status (R08)

`journal_backup_agent.py` is a root-owned, local Unix-socket control plane for
**the existing** `memos-backup.service` and `memos-backup.timer`. It does not create
another scheduler. Its application API is restricted to `status`, connection
`test`, complete `trial`, `activate`, `pause`, `enable`, `run`, `check`, and
isolated `restore`. Neither the browser nor the application supplies a source
path, executable, systemd unit, shell command or restore directory. Only active
application administrators can use `/api/v1/journal/cloud-backup/*`; deployers
must enforce scoped-token permissions there as on other management routes.

Build the helper from the reviewed commit for the host architecture:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o kairos-backup-storage ./cmd/kairos-backup-storage
```

Install this binary and the reviewed Python scripts under `/opt/memos-backup/`,
owned by root and not writable by the application. Add
`"storageHelper": "/opt/memos-backup/kairos-backup-storage"` to the existing
root-private backup configuration. Preserve the source, logical root, restic
password file, repository, host identity and independent monitoring fields.
Install `scripts/systemd/kairos-backup-agent.service` after matching its UID/GID
to the application's actual user. Create the writable timer drop-in directory
and `/run/kairos-backup` first; adapt its `ReadWritePaths` to the existing work
path if that differs. Start this service, and bind-mount `/run/kairos-backup`
read-only into the existing application with
`MEMOS_BACKUP_SOCKET=/run/kairos-backup/agent.sock`. The directory is root-owned
0750 and socket root/application-group 0660. No TCP listener, Docker socket,
root credentials or host configuration directories enter the application.

The `/journal/backup` page saves draft credentials only on the host with 0600
permissions. It does an actual temporary S3 write/read/checksum/delete, checks
repository access, then requires a complete trial backup before activation.
New repository initialization is an explicit checkbox, never a fallback after
an access failure. Blank credentials may reuse the active endpoint's values;
a changed endpoint needs new credentials. The repository recovery password is
never returned by the API. Store an independent recovery copy before enabling
new settings. Activation journals the previous configuration and timer drop-in;
an interrupted activation restores them at agent startup. Configuration tests
and trial runs do not replace production configuration or publish production
monitoring heartbeats. All uploads share the active backup lock.

`/journal/backup/status` separates connection, last successful protected time,
current task, history, full repository read checks, isolated restore reports,
monitor delivery and independent-replica freshness. It marks stale receipts and
failed refreshes explicitly. Browser drafts are counted locally and never
included in server backup coverage. `last-replica.json` is optional independent
copy evidence; without it the UI reports unknown rather than inferring success.
The configured external monitoring receiver continues receiving backup
heartbeats even with the application closed; this page is not that independent
monitor and does not configure a new notification channel.

Managed S3 attachments are streamed through the helper into `managed-s3/<uid>`
and included in the manifest alongside retained originals and historical
originals. The snapshot database remains exact, including its S3 metadata, so
release fingerprint checks still work. Missing objects or originals and arbitrary
external attachments fail the backup. Restore converts only the isolated copy's
S3 references to the verified local bytes while retaining media metadata.
It also resets the copy's default upload destination to local storage, removes
the production S3 registry and credentials, and uses a relative local upload
path template. New uploads during a restore drill cannot reuse the old bucket.
The helper uses the existing AWS SDK, verifies TLS, and does not echo SDK errors.
Legacy repositories containing only local/database files remain verifiable.

An isolated restore accepts only a successful receipt's explicit snapshot ID,
restores under the fixed `workDir/restores/<isolationId>` directory, verifies
manifest/checksums and database counts, revokes sessions/tokens/shares, pauses
outbound jobs, and makes the restored instance private. It never replaces the
live database. Its report initially sets `applicationVerified=false`: a human or
release operator must actually run the isolated application and verify records,
relationships, dates and media before recording application evidence in that
snapshot's `restore-report.json`. Mount its data at the original logical root,
keep networking restricted and backup control unmounted, and use the source
snapshot's compatible application image. Do not claim checksum verification is
an application restore test. Preserve the original encrypted snapshot unchanged.

### Isolated application restore verification

`journal_restore_app_verify.py` prepares a **new copy** of an agent-generated,
permission-paused restore. It refuses a live data path, an existing work directory,
or symlinks. Only the new copy receives one-hour synthetic owner, administrator,
and unrelated-user PATs; the credentials stay in a root-private 0600 file. The
tool never starts containers or changes the live application. Its `verify`
command checks Docker isolation before sending credentials to the
container's own loopback over a fixed `docker exec` HTTP stream. The default
transport sends credentials over stdin, never command arguments. The container
must use `--network none` without published ports, and the sole mount
must be the prepared copy at `/var/opt/memos`; no production socket or tunnel is
allowed.

As the release operator, substitute a real restore ID and its compatible pinned
image digest, choose an unused container name, and install the reviewed verifier beside
`journal_cloud_backup.py` and `journal_snapshot.py`:

```bash
restore_dir=/var/lib/memos-backup/restores/RESTORE_ID
verify_dir=/var/lib/memos-backup/app-checks/RESTORE_ID-baseline
verify_image=ghcr.io/egosay/kairos@sha256:COMPATIBLE_DIGEST
python3 /opt/memos-backup/journal_restore_app_verify.py prepare \
  --restore "$restore_dir" --work "$verify_dir" --uid 10001 --gid 10001
docker run -d --name kairos-restore-check --network none \
  --mount type=bind,source="$verify_dir/data",target=/var/opt/memos \
  -e MEMOS_DATA=/var/opt/memos -e MEMOS_PORT=5230 "$verify_image"
# Wait for the isolated application's health check, then run the full check.
python3 /opt/memos-backup/journal_restore_app_verify.py verify \
  --work "$verify_dir" --container kairos-restore-check
```

The existing Alpine image includes BusyBox `nc`; verification only requests HTTP
GETs at its own loopback port 5230. No external network, host HTTP listener or
extra sidecar is needed. See Docker's
[none network guidance](https://docs.docker.com/engine/network/drivers/none/).
An optional `--base-url http://127.0.0.1:PORT` transport exists for hosts with a
verified internal bridge and explicit loopback publication; it additionally
inspects every attached network and port binding. Docker Desktop configurations
can ignore port publication for internal networks, so use the default exec
transport. Match UID/GID to the chosen image rather than changing
the original volume's ownership. Pull the exact digest before creating the
restricted container if it is not cached.

Every readable record is checked by UID, original dates, content hash, location,
attachment membership and visible relationships. Every served attachment and
retained original is checked byte-for-byte, image previews are requested, and
anonymous, unrelated-user and unregistered-token access must fail. An instance
administrator's existing named-record privilege is checked separately. Recycled
records remain excluded and recycled files require the explicit owner recovery
URL. Protected database tables and all retained media, including history-only
originals, must remain unchanged. Archived-owner records stay in the table/hash
checks and are explicitly counted as excluded from authenticated API verification.

`application-report.json` is private and carries the snapshot ID, tested image
identity, profile version/commit, counts, hashes and scope. A failed rerun clears
prior success. Original credential rows are checked absent before preparation;
the negative token is synthetic and unregistered, **not** a recovered real token.
Only after reviewing successful evidence should the release operator copy its
application result into that snapshot's `restore-report.json`. This does not
claim personal acceptance or replace the final candidate image's regression.
Use a separately prepared copy for a candidate image so migration checks do not
overwrite baseline evidence. Stop/remove the named temporary container after
verification, preserve private reports, and retain or dispose of
the copied data under the existing recovery-data policy.
