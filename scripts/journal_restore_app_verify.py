#!/usr/bin/env python3
"""Verify a restored journal through a loopback-only, isolated application.

Preparation copies an already-sanitized agent restore into a new data directory.
Only that copy receives one-hour synthetic PATs. The live volume and restored
data are never changed; the matching restore report receives a bound summary.
Private expectations/credentials remain mode 0600.
"""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import stat
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from journal_cloud_backup import atomic_json
from journal_snapshot import DATABASE

LOGICAL_ROOT = Path('/var/opt/memos')
PROTECTED_TABLES = ('memo', 'attachment', 'memo_relation', 'journal_document')
AUTHORIZATION_TABLES = ('user', 'user_setting', 'system_setting', 'memo_share', 'space', 'space_member', 'idp', 'user_identity')


class VerificationFailure(ValueError):
    """A controlled diagnostic that never contains restored content or secrets."""


def require(condition, message):
    if not condition:
        raise VerificationFailure(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def private_json(path):
    """Trust operator-owned metadata, never files writable by the tested app."""
    metadata = path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o077,
            'verification metadata must be private and owned by the operator')
    parent = path.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid() and not parent.st_mode & 0o022,
            'verification metadata directory must not be writable by others')
    return json.loads(path.read_text())


def bound_restore(prepared):
    restore = Path(prepared['restore'])
    require(restore.is_absolute() and restore == restore.resolve() and restore.parent.name == 'restores'
            and restore.name == prepared.get('isolationId'), 'verification restore identity is invalid')
    report = private_json(restore / 'restore-report.json')
    require(all(report.get(key) and report[key] == prepared.get(key) for key in ('snapshotId', 'repositoryId', 'isolationId')),
            'verification snapshot, repository or restore identity changed')
    require(report.get('manifestVerified') is True and report.get('storageIsolated') is True
            and report.get('sessionsAndAccessTokensRevoked') is True, 'restore isolation evidence is incomplete')
    return restore, report


@contextmanager
def restore_report_lock(prepared):
    restore, _ = bound_restore(prepared)
    descriptor = os.open(restore / '.application-verification.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        metadata = os.fstat(lock.fileno())
        require(metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o077, 'verification lock is not operator-private')
        fcntl.flock(lock, fcntl.LOCK_EX)
        # Re-read after locking: another verifier may have replaced the report.
        restore, report = bound_restore(prepared)
        yield restore, report


def verification_summary(prepared, result):
    """Only these aggregate fields may enter the application's status response."""
    names = ('checkId', 'status', 'startedTs', 'completedTs', 'applicationVerified', 'reportSha256',
             'memosVerified', 'trashedMemosExcluded', 'servedFilesVerified', 'originalsVerified',
             'previewsVerified', 'negativeAccessChecks', 'adminReadsVerified', 'retainedFilesVerified',
             'rateLimitRetries', 'rateLimitWaitSeconds', 'memosExcludedArchivedOwner', 'attachmentsExcludedArchivedOwner',
             'sourceIndexMigration', 'authorizationVerified', 'authorizationHashes', 'authorizationAllowedChanges',
             'message', 'imageId', 'configuredImage')
    summary = {key: result[key] for key in names if key in result}
    summary.update({key: prepared[key] for key in ('snapshotId', 'repositoryId', 'isolationId', 'sourceDatabaseSha256')})
    profile = result.get('profile', {})
    summary.update(testedVersion=profile.get('version'), testedCommit=profile.get('commit'))
    return summary


def begin_application_check(prepared, result):
    with restore_report_lock(prepared) as (restore, report):
        previous = report.get('applicationVerification', {})
        if previous.get('applicationVerified') is True and previous.get('status') == 'success':
            history = report.get('applicationVerificationHistory', [])
            if not any(item.get('checkId') == previous.get('checkId') for item in history):
                report['applicationVerificationHistory'] = [previous, *history][:10]
        report.update(applicationVerified=False, applicationVerification=verification_summary(prepared, result))
        atomic_json(restore / 'restore-report.json', report)


def finish_application_check(prepared, result):
    with restore_report_lock(prepared) as (restore, report):
        if report.get('applicationVerification', {}).get('checkId') != result['checkId']:
            return False  # A newer run owns the displayed outcome.
        if result.get('applicationVerified') is True:
            require(result.get('status') == 'success' and result.get('authorizationVerified') is True and result.get('profile', {}).get('commit')
                    and result.get('imageId') and result.get('reportSha256'), 'verified application identity is incomplete')
            require(file_hash(restore / 'data' / DATABASE) == prepared['sourceDatabaseSha256'], 'original restore changed during verification')
        report.update(applicationVerified=result.get('applicationVerified') is True,
                      applicationVerification=verification_summary(prepared, result))
        atomic_json(restore / 'restore-report.json', report)
        return True


def table_hashes(db):
    result = {}
    for table in PROTECTED_TABLES:
        rows = [[{'bytesSha256': sha(value)} if isinstance(value, bytes) else value for value in row]
                for row in db.execute('SELECT * FROM "' + table + '"')]
        result[table] = sha(canonical(sorted(rows, key=canonical)))
    return result


def memo_index_hash(db, manifest, target=False):
    """Normalize only the two declared derived fields on source-eligible rows."""
    entries = {row['id']: row for row in manifest['records']}
    require(len(entries) == len(manifest['records']), 'tag migration manifest repeats records')
    cursor = db.execute('SELECT * FROM memo')
    columns = [column[0] for column in cursor.description]
    rows, seen, migrated = [], set(), 0
    for values in cursor:
        row = dict(zip(columns, values))
        entry = entries.get(row['id'])
        require(entry is not None and entry['contentSha256'] == sha(row['content'].encode()), 'tag migration source record differs')
        seen.add(row['id'])
        if entry['migrate']:
            payload = json.loads(row['payload'])
            payload = {} if payload is None else payload
            require(isinstance(payload, dict), 'tag migration payload is not an object')
            if target:
                require(type(payload.get('explicitTagsVersion')) is int and payload['explicitTagsVersion'] == 1
                        and canonical(payload.get('explicitTags')) == canonical(entry['expectedExactTags']),
                        'tag migration derived fields differ from source parser')
                migrated += 1
            payload.pop('explicitTags', None)
            payload.pop('explicitTagsVersion', None)
            row['payload'] = canonical(payload).decode()
        rows.append([row[column] for column in columns])
    require(seen == set(entries), 'tag migration record set differs')
    return sha(canonical(sorted(rows, key=canonical))), migrated


def prepare_index_manifest(db, helper, snapshot_id, source_hash):
    helper = Path(helper).resolve()
    metadata = helper.stat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o022,
            'tag parser helper must be operator-owned and not writable by others')
    parent = helper.parent.stat()
    require(parent.st_uid == os.geteuid() and not parent.st_mode & 0o022, 'tag parser helper directory must be operator-controlled')
    rows = list(db.execute('SELECT id,content,payload FROM memo ORDER BY id'))
    request = {'action': 'derive-tags', 'snapshotId': snapshot_id, 'sourceDatabaseSha256': source_hash,
               'records': [{'id': row[0], 'content': row[1]} for row in rows]}
    result = subprocess.run([str(helper)], input=canonical(request), capture_output=True, timeout=120)
    require(result.returncode == 0, 'source tag parser failed; use the reviewed helper from the candidate commit')
    manifest = json.loads(result.stdout)
    require(manifest.get('format') == 'kairos-explicit-tag-index-v1' and manifest.get('snapshotId') == snapshot_id
            and manifest.get('sourceDatabaseSha256') == source_hash and re.fullmatch(r'[a-f0-9]{40}', manifest.get('parserCommit', '')),
            'source tag parser returned an invalid identity')
    records = manifest['records']
    require(len(records) == len(rows), 'source tag parser returned an incomplete record set')
    for expected, row in zip(records, rows):
        require(expected.get('id') == row[0] and expected.get('contentSha256') == sha(row[1].encode())
                and isinstance(expected.get('expectedExactTags'), list)
                and all(isinstance(tag, str) for tag in expected['expectedExactTags']), 'source tag parser record differs')
        payload = json.loads(row[2])
        payload = {} if payload is None else payload
        require(isinstance(payload, dict), 'source tag migration payload is not an object')
        expected['migrate'] = not (type(payload.get('explicitTagsVersion')) is int and payload['explicitTagsVersion'] == 1)
    manifest['sourceNormalizedMemoSha256'], _ = memo_index_hash(db, manifest)
    return manifest


def verified_data_hashes(work, prepared, expected, profile, allow_index_migration):
    with closing(sqlite3.connect((work / 'data' / DATABASE).as_uri() + '?mode=ro', uri=True)) as db:
        actual = table_hashes(db)
        if not allow_index_migration:
            require(actual == expected['tableHashes'], 'read verification changed restored records, relations or journal state')
            return {'dataHashes': actual}
        manifest_path = work / 'explicit-tag-index.json'
        manifest = private_json(manifest_path)
        require(file_hash(manifest_path) == prepared.get('explicitTagIndexManifestSha256')
                and manifest.get('snapshotId') == prepared['snapshotId']
                and manifest.get('sourceDatabaseSha256') == prepared['sourceDatabaseSha256'], 'tag migration manifest belongs to another source')
        require(manifest.get('parserCommit') == profile.get('commit'), 'tag migration parser commit differs from tested image')
        normalized, migrated = memo_index_hash(db, manifest, target=True)
        require(normalized == manifest['sourceNormalizedMemoSha256'], 'tag migration changed non-index memo fields')
        require(all(actual[table] == expected['tableHashes'][table] for table in PROTECTED_TABLES if table != 'memo'),
                'tag migration changed attachments, relations or journal state')
        return {'dataHashes': actual, 'sourceDataHashes': expected['tableHashes'], 'sourceIndexMigration': {
            'rule': 'explicit-tags-v1-only', 'manifestSha256': prepared['explicitTagIndexManifestSha256'],
            'parserCommit': manifest['parserCommit'], 'parserVersion': manifest.get('parserVersion'),
            'testedCommit': profile.get('commit'), 'migratedRows': migrated,
            'sourceMemoSha256': expected['tableHashes']['memo'], 'actualMemoSha256': actual['memo'],
            'sourceNormalizedMemoSha256': manifest['sourceNormalizedMemoSha256'], 'actualNormalizedMemoSha256': normalized}}


def authorization_hashes(db, usage_since=None):
    """Only usage timestamps on the prepared synthetic PATs may change."""
    result = {}
    for table in AUTHORIZATION_TABLES:
        cursor = db.execute('SELECT * FROM "' + table + '"')
        columns = [column[0] for column in cursor.description]
        rows = []
        for values in cursor:
            row = dict(zip(columns, values))
            if table == 'user_setting' and row['key'] == 'PERSONAL_ACCESS_TOKENS':
                value = json.loads(row['value'])
                for token in value['tokens']:
                    if 'lastUsedAt' in token:
                        used = epoch(token.pop('lastUsedAt'))
                        require(usage_since is not None and usage_since <= used <= int(time.time()) + 5
                                and used < epoch(token['expiresAt']), 'synthetic credential usage timestamp is invalid')
                row['value'] = canonical(value).decode()
            rows.append([row[column] for column in columns])
        result[table] = sha(canonical({'columns': columns, 'rows': sorted(rows, key=canonical)}))
    return result


def verify_authorization_state(work, expected):
    with closing(sqlite3.connect((work / 'data' / DATABASE).as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        assert_paused(db, allow_synthetic_pats=True)
        hashes = authorization_hashes(db, expected.get('authorizationBaselineTs'))
    require(hashes == expected.get('authorizationHashes'), 'restored users, permissions, credentials or service configuration changed')
    return {'authorizationVerified': True, 'authorizationHashes': hashes,
            'authorizationAllowedChanges': ['prepared synthetic PAT lastUsedAt within the verification lifetime']}


def assert_paused(db, allow_synthetic_pats=False):
    revoked = ('REFRESH_TOKENS', 'WEBHOOKS') if allow_synthetic_pats else ('PERSONAL_ACCESS_TOKENS', 'REFRESH_TOKENS', 'WEBHOOKS')
    require(db.execute('SELECT count(*) FROM user_setting WHERE key IN (' + ','.join('?' for _ in revoked) + ')', revoked).fetchone()[0] == 0,
            'restored credentials or webhooks were not revoked')
    require(db.execute('SELECT count(*) FROM memo_share').fetchone()[0] == 0, 'restored share links remain active')
    settings = dict(db.execute('SELECT name,value FROM system_setting'))
    access = json.loads(settings.get('ACCESS', '{}'))
    require(access.get('accessMode') == 'INSTANCE_ACCESS_MODE_PRIVATE', 'restore is not private')
    storage = json.loads(settings.get('STORAGE', '{}'))
    require(storage.get('defaultStorageId') == 'local' and storage.get('storageType') == 'LOCAL'
            and all(item.get('type') == 'STORAGE_TYPE_LOCAL' for item in storage.get('storages', []))
            and not storage.get('s3Config'), 'restore still has a remote upload destination')
    require(all(not item.get('apiKey') for item in json.loads(settings.get('AI', '{}')).get('providers', [])),
            'restore still has AI credentials')
    for kind, raw in db.execute('SELECT kind,payload FROM journal_document'):
        value = json.loads(raw)
        if kind == 'share':
            require(value.get('paused') is True, 'restored journal share is not paused')
        elif kind == 'partition-target':
            require(not value.get('enabled') and not value.get('url') and not value.get('signingSecret'), 'restored delivery target remains enabled')
        elif kind == 'partition-mapping':
            require(value.get('suspended') is True, 'restored delivery authorization remains enabled')
        elif kind == 'partition-delivery':
            require(value.get('status') in ('published', 'delivered', 'retracted', 'cancelled')
                    and not value.get('nextAttemptTs') and not value.get('leaseUntilTs'), 'restored delivery can still run')


def media_path(data, reference):
    path = Path(reference)
    if path.is_absolute():
        path = path.relative_to(LOGICAL_ROOT)
    candidate = (data / path).resolve()
    require(candidate.is_relative_to(data.resolve()) and candidate.is_file(), 'restored media path is missing or unsafe')
    return candidate


def prepare(restore, work, uid=10001, gid=10001, explicit_tag_helper=None):
    restore, work = Path(restore).resolve(), Path(work).resolve()
    require(restore.parent.name == 'restores', 'only an agent-generated isolated restore is accepted')
    report = private_json(restore / 'restore-report.json')
    require(report.get('isolationId') == restore.name and report.get('manifestVerified') is True
            and report.get('storageIsolated') is True and report.get('sessionsAndAccessTokensRevoked') is True,
            'restore has not passed manifest and authorization isolation')
    require(not work.exists() and not work.is_relative_to(restore) and not restore.is_relative_to(work),
            'verification must use a new directory outside the original restore')
    source = restore / 'data'
    require(not source.is_symlink() and all(not path.is_symlink() for path in source.rglob('*')), 'restore must not contain symlinks')
    source_hash = file_hash(source / DATABASE)
    with closing(sqlite3.connect((source / DATABASE).as_uri() + '?mode=ro', uri=True)) as db:
        assert_paused(db)
    work.mkdir(mode=0o700, parents=True)
    data = work / 'data'
    shutil.copytree(source, data)
    expires = datetime.fromtimestamp(int(time.time()) + 3600, timezone.utc).isoformat().replace('+00:00', 'Z')
    tokens = {}
    with closing(sqlite3.connect(data / DATABASE)) as db, db:
        db.row_factory = sqlite3.Row
        expected = {'tableHashes': table_hashes(db), 'memos': [], 'attachments': [], 'snapshotId': report['snapshotId'],
                    'fileHashes': {path.relative_to(data).as_posix(): file_hash(path) for path in data.rglob('*')
                                   if path.is_file() and path.name not in (DATABASE, DATABASE + '-wal', DATABASE + '-shm')}}
        if explicit_tag_helper:
            atomic_json(work / 'explicit-tag-index.json', prepare_index_manifest(db, explicit_tag_helper, report['snapshotId'], source_hash))
        users = {row['id']: dict(row) for row in db.execute('SELECT id,username,row_status FROM user')}
        trash = {row[0] for row in db.execute("SELECT document_key FROM journal_document WHERE kind='trash'")}
        memos = {row['id']: dict(row) for row in db.execute('SELECT * FROM memo')}
        expected['totalMemos'] = len(memos)
        expected['totalAttachments'] = db.execute('SELECT count(*) FROM attachment').fetchone()[0]
        relations = list(db.execute('SELECT memo_id,related_memo_id,type FROM memo_relation'))
        for row in memos.values():
            if users.get(row['creator_id'], {}).get('row_status') != 'NORMAL':
                continue
            pairs = []
            for origin, target, kind in relations:
                if row['id'] not in (origin, target):
                    continue
                left, right = memos.get(origin), memos.get(target)
                if left and right and left['creator_id'] == right['creator_id'] == row['creator_id'] and left['uid'] not in trash and right['uid'] not in trash:
                    pairs.append([left['uid'], right['uid'], kind])
            expected['memos'].append({'uid': row['uid'], 'owner': row['creator_id'], 'contentHash': sha(row['content'].encode()),
                                      'createdTs': row['created_ts'], 'updatedTs': row['updated_ts'], 'state': row['row_status'],
                                      'location': json.loads(row['payload']).get('location'), 'trashed': row['uid'] in trash,
                                      'relations': sorted(pairs), 'attachments': sorted(item[0] for item in db.execute('SELECT uid FROM attachment WHERE memo_id=?', (row['id'],)))})
        for row in db.execute('SELECT * FROM attachment'):
            if users.get(row['creator_id'], {}).get('row_status') != 'NORMAL':
                continue
            require(row['storage_type'] in ('LOCAL', 'DATABASE', ''), 'restore still contains remote media')
            served_hash = file_hash(media_path(data, row['reference'])) if row['storage_type'] == 'LOCAL' else sha(row['blob'] or b'')
            original = data / 'originals' / row['uid']
            require(original.is_file(), 'restored attachment original is missing')
            expected['attachments'].append({'uid': row['uid'], 'owner': row['creator_id'], 'type': row['type'],
                                            'trashed': memos.get(row['memo_id'], {}).get('uid') in trash,
                                            'servedHash': served_hash, 'originalHash': file_hash(original)})
        require(users, 'restore has no user to verify')
        synthetic_name = 'restore-check-' + secrets.token_hex(6)
        synthetic_id = db.execute("INSERT INTO user(username,role,password_hash) VALUES(?, 'ADMIN', 'login-disabled-restore-verifier')", (synthetic_name,)).lastrowid
        outsider_id = db.execute("INSERT INTO user(username,role,password_hash) VALUES(?, 'USER', 'login-disabled-restore-verifier')", (synthetic_name + '-outsider',)).lastrowid
        for owner in [owner for owner, row in users.items() if row['row_status'] == 'NORMAL'] + [synthetic_id, outsider_id]:
            token = 'memos_pat_' + secrets.token_hex(32)
            tokens[str(owner)] = token
            value = {'tokens': [{'tokenId': secrets.token_hex(12), 'tokenHash': sha(token.encode()),
                                 'description': 'isolated restore verification only', 'expiresAt': expires}]}
            db.execute("INSERT INTO user_setting(user_id,key,value) VALUES(?, 'PERSONAL_ACCESS_TOKENS', ?)", (owner, json.dumps(value)))
        expected['authorizationBaselineTs'] = int(time.time())
        expected['authorizationHashes'] = authorization_hashes(db)
    for path in [data, *data.rglob('*')]:
        path.chmod(0o700 if path.is_dir() else 0o600)
        if os.geteuid() == 0:
            os.chown(path, uid, gid)
    require(file_hash(source / DATABASE) == source_hash, 'source restore changed during preparation')
    atomic_json(work / 'credentials.json', {'tokens': tokens, 'syntheticAdmin': synthetic_id, 'expiresAt': expires,
                                          'syntheticOutsider': outsider_id, 'unregisteredToken': 'memos_pat_' + secrets.token_hex(32)})
    atomic_json(work / 'expected.json', expected)
    result = {'format': 'kairos-isolated-app-verification-v1', 'restore': str(restore), 'sourceDatabaseSha256': source_hash,
              'snapshotId': report['snapshotId'], 'repositoryId': report['repositoryId'], 'isolationId': report['isolationId'],
              'data': str(data), 'logicalRoot': str(LOGICAL_ROOT),
              'expiresAt': expires, 'preparedTs': int(time.time()), 'memosToVerify': len(expected['memos']),
              'attachmentsToVerify': len(expected['attachments']), 'applicationVerified': False}
    if explicit_tag_helper:
        result['explicitTagIndexManifestSha256'] = file_hash(work / 'explicit-tag-index.json')
    atomic_json(work / 'prepare-report.json', result)
    return {key: result[key] for key in ('format', 'snapshotId', 'expiresAt', 'memosToVerify', 'attachmentsToVerify', 'applicationVerified')}


def docker_json(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=30)
    require(result.returncode == 0, 'cannot inspect verification container isolation')
    return json.loads(result.stdout)


def inspect_isolation(container, data, base_url=None):
    parsed = urllib.parse.urlsplit(base_url) if base_url else None
    if parsed:
        require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port and not parsed.username
                and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ('', '/'), 'verification endpoint must be explicit loopback HTTP')
    item = docker_json('inspect', container)[0]
    require(item['State']['Running'], 'verification container is not running')
    mounts = item.get('Mounts', [])
    require(len(mounts) == 1 and mounts[0]['Destination'] == str(LOGICAL_ROOT)
            and Path(mounts[0]['Source']).resolve() == data.resolve(), 'container must mount only the verification copy')
    forbidden = ('MEMOS_BACKUP_SOCKET=', 'TUNNEL_TOKEN=', 'MEMOS_TUNNEL_TOKEN=')
    require(not any(value.startswith(forbidden) for value in item['Config'].get('Env', [])), 'verification container has a production control connection')
    networks = list(item['NetworkSettings'].get('Networks', {}))
    bindings = item['HostConfig'].get('PortBindings') or {}
    if parsed:
        require(item['HostConfig']['NetworkMode'] not in ('host', 'none') and networks
                and all(docker_json('network', 'inspect', name)[0].get('Internal') for name in networks), 'container network allows external delivery')
        require(set(bindings) == {'5230/tcp'} and bindings['5230/tcp']
                and all(value.get('HostIp') == '127.0.0.1' and value.get('HostPort') == str(parsed.port) for value in bindings['5230/tcp']),
                'container port mapping is not restricted to the requested loopback endpoint')
    else:
        require(item['HostConfig']['NetworkMode'] == 'none' and set(networks) == {'none'} and not bindings,
                'exec verification requires network none with no published ports')
    return {'imageId': item['Image'], 'configuredImage': item['Config']['Image'], 'containerId': item['Id'],
            'transport': 'host-loopback' if parsed else 'docker-exec-loopback', 'networkMode': item['HostConfig']['NetworkMode']}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def retry_after_seconds(value):
    """Honor an HTTP Retry-After without allowing an unbounded operator wait."""
    if value is None:
        return 60  # A conservative fallback for older gateways omitting metadata.
    value = value.strip()
    if value.isascii() and value.isdigit():
        seconds = int(value)
    else:
        try:
            deadline = parsedate_to_datetime(value)
            require(deadline.tzinfo is not None, 'rate limit Retry-After must have a timezone')
            seconds = math.ceil(deadline.timestamp() - time.time())
        except (TypeError, ValueError, OverflowError):
            raise VerificationFailure('rate limit Retry-After is invalid') from None
    require(seconds <= 120, 'rate limit Retry-After exceeds the 120 second wait limit')
    return max(1, seconds)


class RateLimitedAPI:
    def __init__(self):
        self.rate_limit_retries = 0
        self.rate_limit_wait_seconds = 0

    def close(self):
        pass

    def get(self, path, token=None, *, digest=False):
        for attempt in range(4):
            status, value, retry_after = self.get_once(path, token, digest=digest)
            if status != 429:
                return status, value
            # nc has an idle timeout. Do not leave its stream open throughout a
            # Retry-After sleep, or the next request will use a dead connection.
            self.close()
            require(attempt < 3, 'rate limit retry budget exhausted; verification incomplete')
            seconds = retry_after_seconds(retry_after)
            require(self.rate_limit_wait_seconds + seconds <= 600, 'total rate limit wait budget exhausted; verification incomplete')
            self.rate_limit_retries += 1
            self.rate_limit_wait_seconds += seconds
            time.sleep(seconds)


class API(RateLimitedAPI):
    def __init__(self, base):
        super().__init__()
        self.base = base.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get_once(self, path, token=None, *, digest=False):
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        request = urllib.request.Request(self.base + path, headers=headers)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            retry_after = error.headers.get('Retry-After')
            error.close()
            return error.code, None, retry_after
        with response:
            if digest:
                value = hashlib.sha256()
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    value.update(chunk)
                return response.status, value.hexdigest(), response.headers.get('Retry-After')
            raw = response.read(16 * 1024 * 1024 + 1)
            require(len(raw) <= 16 * 1024 * 1024, 'API response exceeded the verification limit')
            return response.status, json.loads(raw), response.headers.get('Retry-After')


class PipeSocket:
    """Let HTTPResponse parse a persistent subprocess stream without owning it."""

    def __init__(self, stream):
        self.stream = stream

    def makefile(self, *_):
        return self

    def read(self, *args):
        return self.stream.read(*args)

    def readline(self, *args):
        return self.stream.readline(*args)

    def close(self):
        pass


class DockerAPI(RateLimitedAPI):
    """Read-only HTTP via container loopback; credentials travel only over stdin."""

    def __init__(self, container):
        super().__init__()
        self.container = container
        self.process = None

    def close(self):
        if self.process is not None:
            self.process.kill()
            self.process.communicate()
            self.process = None

    def get_once(self, path, token=None, *, digest=False):
        require(path.startswith('/') and '\r' not in path and '\n' not in path
                and (not token or ('\r' not in token and '\n' not in token)), 'invalid verification HTTP request')
        if self.process is None:
            self.process = subprocess.Popen(['docker', 'exec', '-i', self.container, '/bin/busybox', 'nc', '-w', '30', '127.0.0.1', '5230'],
                                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        timer = threading.Timer(45, self.process.kill)
        timer.daemon = True
        timer.start()
        try:
            headers = f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:5230\r\nConnection: keep-alive\r\n'
            if token:
                headers += 'Authorization: Bearer ' + token + '\r\n'
            self.process.stdin.write((headers + '\r\n').encode('ascii'))
            self.process.stdin.flush()
            response = http.client.HTTPResponse(PipeSocket(self.process.stdout))
            response.begin()
            with response:
                status = response.status
                if digest and status == 200:
                    value = hashlib.sha256()
                    for block in iter(lambda: response.read(1024 * 1024), b''):
                        value.update(block)
                    result = value.hexdigest()
                else:
                    raw = response.read(16 * 1024 * 1024 + 1)
                    require(len(raw) <= 16 * 1024 * 1024, 'API response exceeded the verification limit')
                    result = json.loads(raw) if status == 200 else None
                if response.will_close:
                    self.close()
                return status, result, response.getheader('Retry-After')
        except (OSError, http.client.HTTPException):
            self.close()
            raise VerificationFailure('isolated container HTTP connection failed') from None
        finally:
            timer.cancel()


def epoch(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())


def normalized_location(value):
    if value is None:
        return None
    return [value.get('latitude', 0), value.get('longitude', 0), value.get('placeholder', '')]


def verify_application(work, container, base_url=None, allow_index_migration=False):
    work = Path(work).resolve()
    # Distinct prepared copies may run concurrently; one copy cannot have two
    # writers replacing its private evidence file while a digest is published.
    private_json(work / 'prepare-report.json')
    descriptor = os.open(work / '.verification.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        metadata = os.fstat(lock.fileno())
        require(metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o077, 'verification lock is not operator-private')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return verify_application_locked(work, container, base_url, allow_index_migration)


def verify_application_locked(work, container, base_url, allow_index_migration):
    prepared = private_json(work / 'prepare-report.json')
    started = {'snapshotId': prepared['snapshotId'], 'repositoryId': prepared['repositoryId'], 'isolationId': prepared['isolationId'],
               'sourceDatabaseSha256': prepared['sourceDatabaseSha256'], 'checkId': secrets.token_hex(16), 'startedTs': int(time.time()),
               'status': 'running', 'applicationVerified': False}
    atomic_json(work / 'application-report.json', started)
    api = None
    try:
        begin_application_check(prepared, started)
        require(file_hash(Path(prepared['restore']) / 'data' / DATABASE) == prepared['sourceDatabaseSha256'],
                'original restore changed before verification')
        expected = private_json(work / 'expected.json')
        credentials = private_json(work / 'credentials.json')
        require(expected['snapshotId'] == prepared['snapshotId'], 'expected data belongs to another snapshot')
        verify_authorization_state(work, expected)
        require(epoch(credentials['expiresAt']) > int(time.time()), 'verification credentials expired; prepare a new copy')
        isolation = inspect_isolation(container, work / 'data', base_url)
        api = API(base_url) if base_url else DockerAPI(container)
        result = {**started, **verify_api(work, prepared, expected, credentials, isolation, api, allow_index_migration), 'completedTs': int(time.time())}
        atomic_json(work / 'application-report.json', result)
        result['reportSha256'] = file_hash(work / 'application-report.json')
        require(finish_application_check(prepared, result), 'verification was superseded by a newer check')
        return result
    except Exception as error:
        failure = {**started, 'status': 'failed', 'applicationVerified': False, 'completedTs': int(time.time()),
                   'message': str(error) if isinstance(error, VerificationFailure) else 'isolated application verification failed'}
        atomic_json(work / 'application-report.json', failure)
        try:
            finish_application_check(prepared, failure)
        except (OSError, ValueError, KeyError):
            pass  # Never overwrite a changed identity, or mask the original error.
        raise
    finally:
        if isinstance(api, DockerAPI):
            api.close()


def verify_api(work, prepared, expected, credentials, isolation, api, allow_index_migration=False):
    evidence = {'format': prepared['format'], 'snapshotId': prepared['snapshotId'], 'checkedTs': int(time.time()), **isolation,
                'memosVerified': 0, 'trashedMemosExcluded': 0, 'servedFilesVerified': 0, 'originalsVerified': 0,
                'previewsVerified': 0, 'negativeAccessChecks': 0, 'applicationVerified': False,
                'adminReadsVerified': 0, 'trashedFilesExcluded': 0,
                'memosExcludedArchivedOwner': expected['totalMemos'] - len(expected['memos']),
                'attachmentsExcludedArchivedOwner': expected['totalAttachments'] - len(expected['attachments']),
                'credentialEvidence': 'original credential rows absent before preparation; newly generated unregistered token rejected'}
    status, profile = api.get('/api/v1/instance/profile')
    require(status == 200, 'restored application profile unavailable')
    require(profile.get('accessMode') == 'INSTANCE_ACCESS_MODE_PRIVATE', 'restored application profile is not private')
    evidence['profile'] = {key: profile.get(key) for key in ('version', 'commit', 'accessMode')}
    tokens = credentials['tokens']
    for index, memo in enumerate(expected['memos']):
        path = '/api/v1/memos/' + urllib.parse.quote(memo['uid'], safe='')
        status, actual = api.get(path, tokens[str(memo['owner'])])
        if memo['trashed']:
            require(status == 404, f'trashed record was exposed at item {index}')
            evidence['trashedMemosExcluded'] += 1
            continue
        require(status == 200, f'record cannot be read at item {index}')
        require(actual.get('name') == 'memos/' + memo['uid'] and sha(actual.get('content', '').encode()) == memo['contentHash']
                and epoch(actual['createTime']) == memo['createdTs'] and epoch(actual['updateTime']) == memo['updatedTs']
                and actual.get('state') == memo['state'] and actual.get('visibility') == 'PRIVATE'
                and normalized_location(actual.get('location')) == normalized_location(memo['location']), f'record fields differ at item {index}')
        require(sorted(value['name'].removeprefix('attachments/') for value in actual.get('attachments', [])) == memo['attachments'],
                f'attachment membership differs at item {index}')
        relations = sorted([value['memo']['name'].removeprefix('memos/'), value['relatedMemo']['name'].removeprefix('memos/'), value['type']]
                           for value in actual.get('relations', []))
        require(relations == memo['relations'], f'record relationships differ at item {index}')
        for token in (None, credentials['unregisteredToken'], tokens[str(credentials['syntheticOutsider'])]):
            require(api.get(path, token)[0] in (401, 403, 404), f'private record permission failed at item {index}')
            evidence['negativeAccessChecks'] += 1
        # Existing Kairos policy allows instance ADMIN to read a named private
        # record. Validate that policy separately from ordinary-user isolation.
        require(api.get(path, tokens[str(credentials['syntheticAdmin'])])[0] == 200, f'administrator record access failed at item {index}')
        evidence['adminReadsVerified'] += 1
        evidence['memosVerified'] += 1
    for index, attachment in enumerate(expected['attachments']):
        token = tokens[str(attachment['owner'])]
        uid = urllib.parse.quote(attachment['uid'], safe='')
        file_path = '/file/attachments/' + uid
        if attachment['trashed']:
            require(api.get(file_path, token)[0] == 404, f'trashed attachment ordinary URL remains readable at item {index}')
            evidence['trashedFilesExcluded'] += 1
            file_path += '?trash=true'
        for path, digest, field in ((file_path, attachment['servedHash'], 'servedFilesVerified'),
                                    ('/api/v1/journal/attachments/' + uid + '/original', attachment['originalHash'], 'originalsVerified')):
            status, actual_hash = api.get(path, token, digest=True)
            require(status == 200 and actual_hash == digest, f'attachment bytes differ at item {index}')
            for denied_token in (None, credentials['unregisteredToken'], tokens[str(credentials['syntheticOutsider'])]):
                require(api.get(path, denied_token)[0] in (401, 403, 404), f'attachment permission failed at item {index}')
                evidence['negativeAccessChecks'] += 1
            evidence[field] += 1
        if attachment['type'].startswith('image/'):
            status, preview_hash = api.get(file_path + ('&' if '?' in file_path else '?') + 'thumbnail=true', token, digest=True)
            require(status == 200 and preview_hash != sha(b''), f'image preview failed at item {index}')
            evidence['previewsVerified'] += 1
    evidence.update(verified_data_hashes(work, prepared, expected, evidence['profile'], allow_index_migration))
    evidence.update(verify_authorization_state(work, expected))
    for name, digest in expected['fileHashes'].items():
        require(file_hash(work / 'data' / name) == digest, 'retained media or historical original changed')
    require(file_hash(Path(prepared['restore']) / 'data' / DATABASE) == prepared['sourceDatabaseSha256'], 'original restore was changed')
    evidence.update(applicationVerified=True, status='success',
                    retainedFilesVerified=len(expected['fileHashes']), evidenceScope='isolated app copy; no live instance writes; not personal acceptance',
                    rateLimitRetries=api.rate_limit_retries, rateLimitWaitSeconds=api.rate_limit_wait_seconds)
    return evidence


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    setup = commands.add_parser('prepare')
    setup.add_argument('--restore', required=True, type=Path)
    setup.add_argument('--work', required=True, type=Path)
    setup.add_argument('--uid', type=int, default=10001)
    setup.add_argument('--gid', type=int, default=10001)
    setup.add_argument('--explicit-tag-helper', type=Path, help='Generate a private source index manifest using the candidate helper')
    check = commands.add_parser('verify')
    check.add_argument('--work', required=True, type=Path)
    check.add_argument('--container', required=True)
    check.add_argument('--base-url', help='Optional host loopback transport; default is docker exec with network none')
    check.add_argument('--allow-explicit-tag-index-migration', action='store_true', help='Permit only the prepared exact explicit-tag index migration')
    args = parser.parse_args()
    try:
        result = (prepare(args.restore, args.work, args.uid, args.gid, args.explicit_tag_helper) if args.action == 'prepare'
                  else verify_application(args.work, args.container, args.base_url, args.allow_explicit_tag_index_migration))
    except (OSError, ValueError, KeyError, sqlite3.Error, urllib.error.URLError, subprocess.TimeoutExpired) as error:
        # Avoid printing response bodies, private paths, credentials or content.
        failure = {'status': 'failed', 'applicationVerified': False,
                   'message': str(error) if isinstance(error, VerificationFailure) else 'isolated application verification failed; inspect the controlled local fixture and checks'}
        print(json.dumps(failure))
        raise SystemExit(1) from None
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
