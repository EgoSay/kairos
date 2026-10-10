#!/usr/bin/env python3
"""Restricted SSH gate: a stopped, verified pre-upgrade snapshot and timed rollback.

Only prepare, deploy, confirm and rollback are accepted; this key cannot run a
shell or read journal contents. Restore refuses to replace new content. Dokploy
deploys a fixed digest through its API; no deployment branch is involved.
"""
import fcntl, hashlib, json, os, pathlib, re, shutil, sqlite3, subprocess, sys, time, signal
from contextlib import closing
from journal_snapshot import snapshot, verify
from journal_cloud_backup import atomic_json, run as backup
from journal_dokploy import Dokploy
ROOT = pathlib.Path('/var/lib/memos-release')
CONFIG = pathlib.Path('/etc/memos-backup/config.json')
CONTAINER = 'memos-journal-ci55cj-memos-1'
IMAGE_REPOSITORY = 'ghcr.io/egosay/kairos'
LEGACY_IMAGE_REPOSITORY = 'ghcr.io/egosay/memos-journal'
# Keep existing snapshots and previously deployed image identities usable for recovery.
PREVIOUS_REPOSITORIES = (IMAGE_REPOSITORY, LEGACY_IMAGE_REPOSITORY)

class RollbackBlocked(RuntimeError):
    """Recovery needs inspection because automatic replacement is unsafe."""

def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60).stdout

def resume_backup_schedule(pending):
    # Release downtime must not silently undo an administrator's R08 pause.
    # Receipts from before configurable scheduling used an always-on timer.
    command('systemctl', 'start' if pending.get('backupEnabled', True) else 'stop', 'memos-backup.timer')

def fingerprint(database):
    digest = hashlib.sha256()
    # Include account/settings changes too; a rollback must not erase any new state.
    # Stream the logical database instead of loading years of journal rows at once.
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
        for statement in db.iterdump():
            digest.update(statement.encode())
            digest.update(b'\n')
    return digest.hexdigest()

def validate(release):
    required = {'commit', 'digest'}
    optional = {'repository', 'composeSha256'}
    if (not required <= set(release) or set(release) - required - optional
            or release.get('repository', LEGACY_IMAGE_REPOSITORY) not in PREVIOUS_REPOSITORIES
            or not re.fullmatch('[a-f0-9]{40}', release['commit'])
            or not re.fullmatch('sha256:[a-f0-9]{64}', release['digest'])
            or ('composeSha256' in release and not re.fullmatch('[a-f0-9]{64}', release['composeSha256']))):
        raise ValueError('invalid release')
    return release

def save_pending(pending):
    path = ROOT / 'pending.tmp'
    path.write_text(json.dumps(pending))
    path.replace(ROOT / 'pending.json')

def wait_for_backup():
    deadline = time.monotonic() + 180
    while command('systemctl', 'show', '--property=ActiveState', '--value', 'memos-backup.service').strip() not in ('inactive', 'failed'):
        if time.monotonic() > deadline:
            raise TimeoutError('backup still running')
        time.sleep(2)

def prepare(release):
    validate(release)
    release = {**release, 'repository': release.get('repository', LEGACY_IMAGE_REPOSITORY)}
    config = json.loads(CONFIG.read_text())
    source = pathlib.Path(config['source'])
    previous = json.loads(command('docker', 'inspect', CONTAINER))[0]
    digests = json.loads(command('docker', 'image', 'inspect', previous['Image']))[0]['RepoDigests']
    image = next((d for d in digests if any(d.startswith(r + '@sha256:') for r in PREVIOUS_REPOSITORIES)), None)
    if image is None:
        raise ValueError('unexpected previous image')
    if (ROOT / 'pending.json').exists():
        raise RuntimeError('another release awaits confirmation')
    # API access, application identity and template match are checked before downtime.
    client = Dokploy()
    dokploy = client.prepare(release, image)
    client.prepare_rollback(dokploy, previous, image, ROOT / 'rollback.yaml')
    stage = ROOT / ('before-' + release['commit'] + '-' + str(int(time.time())))
    pending = {**release, 'status': 'preparing', 'previousImage': image, 'source': str(source), 'stage': str(stage), 'preparedTs': int(time.time()), 'dokploy': dokploy, 'previousVersion': config['instanceVersion'], 'backupEnabled': config.get('enabled', True)}
    save_pending(pending)
    command('systemd-run', '--collect', '--unit=memos-release-rollback', '--on-active=8m', '/usr/bin/python3', '/opt/memos-backup/journal_release_gate.py', 'rollback')

    def interrupted(*_):
        raise TimeoutError('preparation deadline exceeded')
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(360)
    command('systemctl', 'stop', 'memos-backup.timer')
    try:
        wait_for_backup()
        command('docker', 'stop', '-t', '30', CONTAINER)
        report = snapshot(source, stage, pathlib.Path(config['logicalRoot']), config.get('storageHelper'))
        receipt = backup(config)
        if receipt.get('status') != 'success':
            raise RuntimeError('pre-upgrade backup not completed: ' + receipt.get('status', 'unknown'))
        pending = {**pending, 'status': 'prepared', 'fingerprint': fingerprint(stage / 'data/memos_prod.db'), 'snapshotId': receipt['snapshotId'], 'preparedTs': int(time.time())}
        save_pending(pending)
        # Give deployment its full recovery window after a potentially slow backup.
        command('systemctl', 'restart', 'memos-release-rollback.timer')
        return {'status': 'prepared', 'commit': release['commit'], 'snapshotId': receipt['snapshotId']}
    except Exception:
        command('docker', 'start', CONTAINER)
        resume_backup_schedule(pending)
        command('systemctl', 'stop', 'memos-release-rollback.timer')
        (ROOT / 'pending.json').unlink(missing_ok=True)
        raise
    finally:
        signal.alarm(0)

def deploy():
    pending = json.loads((ROOT / 'pending.json').read_text())
    if pending['status'] != 'prepared' or 'dokploy' not in pending:
        raise RuntimeError('a verified, prepared release is required')
    client = Dokploy()
    state = pending['dokploy']
    client.update(state, state['previousCompose'], state['candidateCompose'])
    pending['status'] = 'deploying'
    pending['deploymentTitle'] = 'Kairos ' + pending['commit'][:12] + ' ' + pathlib.Path(pending['stage']).name
    # Persist before POST: an interrupted response may have enqueued the deployment.
    save_pending(pending)
    client.deploy(pending['deploymentTitle'])
    return {'status': 'queued', 'commit': pending['commit']}

def wait_for_release(pending):
    # HTTP can be ready before Docker's first scheduled health check completes.
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            d = json.loads(command('docker', 'inspect', CONTAINER))[0]
            digests = json.loads(command('docker', 'image', 'inspect', d['Image']))[0]['RepoDigests']
            if pending.get('repository', LEGACY_IMAGE_REPOSITORY) + '@' + pending['digest'] in digests and d['State'].get('Health', {}).get('Status') == 'healthy':
                return d
        except subprocess.CalledProcessError:
            pass  # Compose may briefly remove/recreate the named container.
        time.sleep(2)
    raise RuntimeError('wrong or unhealthy release after readiness deadline')

def confirm():
    pending = json.loads((ROOT / 'pending.json').read_text())
    if 'dokploy' in pending:
        client = Dokploy()
        result = client.wait_terminal(pending['deploymentTitle'])
        if result['status'] != 'done':
            raise RuntimeError('Dokploy deployment failed')
        client.check(pending['dokploy'], pending['dokploy']['candidateCompose'])
    d = wait_for_release(pending)
    address = next(iter(d['NetworkSettings']['Networks'].values()))['IPAddress']
    profile = json.loads(command('curl', '--fail', '--silent', 'http://' + address + ':5230/api/v1/instance/profile'))
    if profile.get('commit') != pending['commit'] or profile.get('needsSetup') or profile.get('accessMode') != 'INSTANCE_ACCESS_MODE_PRIVATE':
        raise RuntimeError('release identity or private mode mismatch')
    # A failed schedule restart must leave both pending state and the watchdog
    # intact. CI can retry confirmation or use the release-bound rollback.
    resume_backup_schedule(pending)
    config = json.loads(CONFIG.read_text())
    config['instanceVersion'] = pending['commit']
    atomic_json(CONFIG, config)
    atomic_json(ROOT / 'last-deployment.json', {**pending, 'status': 'confirmed', 'confirmedTs': int(time.time())})
    command('systemctl', 'stop', 'memos-release-rollback.timer')
    (ROOT / 'pending.json').unlink()
    for old in sorted(ROOT.glob('before-*'), key=lambda p: p.stat().st_mtime, reverse=True)[3:]:
        if old.is_dir():
            shutil.rmtree(old)
    return {'status': 'confirmed', 'commit': pending['commit'], 'preUpgradeSnapshot': pending['snapshotId']}

def container_exists():
    # A successful, empty list means absence. Daemon/permission failures must
    # propagate; matching human-readable Docker error strings is not reliable.
    return bool(command('docker', 'container', 'ls', '--all', '--filter',
                        'name=^/' + CONTAINER + '$', '--format', '{{.ID}}').strip())

def stop_for_rollback():
    if not container_exists():
        return False
    try:
        command('docker', 'stop', '-t', '30', CONTAINER)
    except subprocess.CalledProcessError:
        # Compose can remove the container between the query and stop. Only a
        # second successful query proving absence permits recovery to continue.
        if container_exists():
            raise
        return False
    return True

def matches_release(actual, expected):
    return (all(actual.get(key) == expected.get(key) for key in ('commit', 'digest'))
            and actual.get('repository', LEGACY_IMAGE_REPOSITORY) == expected.get('repository', LEGACY_IMAGE_REPOSITORY)
            and ('composeSha256' not in expected or actual.get('composeSha256') == expected['composeSha256']))

def completed_rollback(release):
    receipt_file = ROOT / 'last-rollback.json'
    if not receipt_file.exists():
        raise RuntimeError('no rollback receipt for requested release')
    receipt = json.loads(receipt_file.read_text())
    if receipt.get('status') != 'rolled-back' or not matches_release(receipt, release):
        raise RuntimeError('no matching rollback receipt for requested release')
    # A matching historical receipt is not proof of the current declaration or
    # running service. Never consume it after a different release or manual edit.
    if 'dokploy' not in receipt:
        raise RuntimeError('rollback receipt has no verified Dokploy declaration')
    Dokploy().check(receipt['dokploy'], receipt['dokploy']['previousCompose'])
    repository, digest = receipt['previousImage'].split('@')
    wait_for_release({'repository': repository, 'digest': digest})
    return {'status': 'already-rolled-back', 'commit': receipt['commit'],
            'image': receipt['previousImage'], 'completedTs': receipt['completedTs']}

def rollback(release=None):
    if release is not None:
        validate(release)
    file = ROOT / 'pending.json'
    if not file.exists():
        return completed_rollback(release) if release is not None else {'status': 'no pending release'}
    pending = json.loads(file.read_text())
    if release is not None and not matches_release(pending, release):
        raise RuntimeError('rollback release identity differs from pending release')
    try:
        return rollback_pending(pending)
    except Exception as error:
        # Resuming the online backup timer does not waive its own consistency
        # checks. Try even if Docker, the API or health verification failed,
        # without allowing a secondary timer error to hide the original cause.
        backup_error = None
        try:
            resume_backup_schedule(pending)
        except Exception as timer_error:
            backup_error = type(timer_error).__name__ + ': ' + str(timer_error)
        (ROOT / 'last-rollback-attempt.json').write_text(json.dumps({
            'commit': pending.get('commit'), 'digest': pending.get('digest'),
            'status': 'blocked' if isinstance(error, RollbackBlocked) else 'failed',
            'requiresIntervention': True, 'errorType': type(error).__name__,
            'message': str(error), 'backupResumeError': backup_error, 'attemptTs': int(time.time()),
        }))
        raise

def rollback_pending(pending):
    file = ROOT / 'pending.json'
    if pending.get('status') == 'preparing':
        command('docker', 'start', CONTAINER)
        resume_backup_schedule(pending)
        command('systemctl', 'stop', 'memos-release-rollback.timer')
        file.unlink()
        return {'status': 'preparation-aborted', 'previousImage': pending['previousImage']}
    source = pathlib.Path(pending['source'])
    stage = pathlib.Path(pending['stage'])
    verify(stage)
    if pending.get('deploymentTitle'):
        Dokploy().wait_terminal(pending['deploymentTitle'])
    stopped = stop_for_rollback()
    # A missing or incompatible table must preserve data and restore availability too.
    try:
        unchanged = fingerprint(source / 'memos_prod.db') == pending['fingerprint']
    except Exception:
        if stopped:
            command('docker', 'start', CONTAINER)
        raise RollbackBlocked('rollback blocked: unreadable data shape preserved; inspect before manual recovery')
    # Preserve writes or transformations accepted by the new version.
    if not unchanged:
        if stopped:
            command('docker', 'start', CONTAINER)
        raise RollbackBlocked('rollback blocked: new content or changed data shape preserved; inspect before manual recovery')
    if 'dokploy' in pending:
        try:
            Dokploy().restore(pending['dokploy'])
        except Exception:
            if stopped:
                command('docker', 'start', CONTAINER)
            raise
    # The logical fingerprint has already proved that the live SQLite database
    # exactly matches the pre-release state. Keep that database and its WAL in
    # place: replacing identical data creates an unnecessary failure window and
    # can make an otherwise retryable rollback lose its only live database.
    command('docker', 'compose', '-p', 'memos-journal-ci55cj', '-f', str(ROOT / 'rollback.yaml'), 'up', '-d', '--no-deps', 'memos')
    repository, digest = pending['previousImage'].split('@')
    wait_for_release({'repository': repository, 'digest': digest})
    if 'dokploy' in pending:
        config = json.loads(CONFIG.read_text())
        config['instanceVersion'] = pending['previousVersion']
        atomic_json(CONFIG, config)
    resume_backup_schedule(pending)
    command('systemctl', 'stop', 'memos-release-rollback.timer')
    receipt = ROOT / 'last-rollback.tmp'
    receipt.write_text(json.dumps({**pending, 'status': 'rolled-back', 'completedTs': int(time.time())}))
    receipt.replace(ROOT / 'last-rollback.json')
    file.unlink()
    return {'status': 'rolled-back', 'commit': pending.get('commit'), 'image': pending['previousImage']}

def main():
    os.umask(63)
    ROOT.mkdir(mode=448, parents=True, exist_ok=True)
    action = os.environ.get('SSH_ORIGINAL_COMMAND') or (sys.argv[1] if len(sys.argv) > 1 else '')
    if action not in ('prepare', 'deploy', 'confirm', 'rollback'):
        raise ValueError('command not allowed')
    with (ROOT / 'lock').open('a') as lock:
        # A watchdog firing during confirmation must wait, not lose its one shot.
        watchdog = action == 'rollback' and not os.environ.get('SSH_ORIGINAL_COMMAND')
        fcntl.flock(lock, fcntl.LOCK_EX | (0 if watchdog else fcntl.LOCK_NB))
        if action == 'rollback':
            # Restricted SSH callers identify the release they own. The local
            # watchdog has no stdin and recovers the currently pending release.
            release = None if watchdog else json.loads(sys.stdin.read(1025))
            result = rollback(release)
        else:
            result = prepare(json.loads(sys.stdin.read(1025))) if action == 'prepare' else deploy() if action == 'deploy' else confirm()
        print(json.dumps(result))
if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        if ROOT.exists():
            (ROOT / 'last-error.json').write_text(json.dumps({'action': os.environ.get('SSH_ORIGINAL_COMMAND', ''), 'errorType': type(e).__name__, 'message': str(e), 'attemptTs': int(time.time())}))
        print(type(e).__name__ + ': release gate failed; inspect private deployment receipts', file=sys.stderr)
        sys.exit(1)
