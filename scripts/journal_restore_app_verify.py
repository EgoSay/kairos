#!/usr/bin/env python3
"""Verify a restored journal through a loopback-only, isolated application.

Preparation copies an already-sanitized agent restore into a new data directory.
Only that copy receives one-hour synthetic PATs. The live volume and original
restore are never changed. Private expectations/credentials remain mode 0600.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
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


def table_hashes(db):
    result = {}
    for table in PROTECTED_TABLES:
        rows = [[{'bytesSha256': sha(value)} if isinstance(value, bytes) else value for value in row]
                for row in db.execute('SELECT * FROM "' + table + '"')]
        result[table] = sha(canonical(sorted(rows, key=canonical)))
    return result


def assert_paused(db):
    require(db.execute("SELECT count(*) FROM user_setting WHERE key IN ('PERSONAL_ACCESS_TOKENS','REFRESH_TOKENS','WEBHOOKS')").fetchone()[0] == 0,
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


def prepare(restore, work, uid=10001, gid=10001):
    restore, work = Path(restore).resolve(), Path(work).resolve()
    require(restore.parent.name == 'restores', 'only an agent-generated isolated restore is accepted')
    report = json.loads((restore / 'restore-report.json').read_text())
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
    for path in [data, *data.rglob('*')]:
        path.chmod(0o700 if path.is_dir() else 0o600)
        if os.geteuid() == 0:
            os.chown(path, uid, gid)
    require(file_hash(source / DATABASE) == source_hash, 'source restore changed during preparation')
    atomic_json(work / 'credentials.json', {'tokens': tokens, 'syntheticAdmin': synthetic_id, 'expiresAt': expires,
                                          'syntheticOutsider': outsider_id, 'unregisteredToken': 'memos_pat_' + secrets.token_hex(32)})
    atomic_json(work / 'expected.json', expected)
    result = {'format': 'kairos-isolated-app-verification-v1', 'restore': str(restore), 'sourceDatabaseSha256': source_hash,
              'snapshotId': report['snapshotId'], 'data': str(data), 'logicalRoot': str(LOGICAL_ROOT),
              'expiresAt': expires, 'preparedTs': int(time.time()), 'memosToVerify': len(expected['memos']),
              'attachmentsToVerify': len(expected['attachments']), 'applicationVerified': False}
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


class API:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path, token=None, *, digest=False):
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        request = urllib.request.Request(self.base + path, headers=headers)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            error.close()
            return error.code, None
        with response:
            if digest:
                value = hashlib.sha256()
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    value.update(chunk)
                return response.status, value.hexdigest()
            raw = response.read(16 * 1024 * 1024 + 1)
            require(len(raw) <= 16 * 1024 * 1024, 'API response exceeded the verification limit')
            return response.status, json.loads(raw)


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


class DockerAPI:
    """Read-only HTTP via container loopback; credentials travel only over stdin."""

    def __init__(self, container):
        self.container = container
        self.process = None

    def close(self):
        if self.process is not None:
            self.process.kill()
            self.process.communicate()
            self.process = None

    def get(self, path, token=None, *, digest=False):
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
                return status, result
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


def verify_application(work, container, base_url=None):
    work = Path(work).resolve()
    prepared = json.loads((work / 'prepare-report.json').read_text())
    atomic_json(work / 'application-report.json', {'snapshotId': prepared['snapshotId'], 'checkedTs': int(time.time()),
                                                 'status': 'running', 'applicationVerified': False})
    expected = json.loads((work / 'expected.json').read_text())
    credentials = json.loads((work / 'credentials.json').read_text())
    require(epoch(credentials['expiresAt']) > int(time.time()), 'verification credentials expired; prepare a new copy')
    isolation = inspect_isolation(container, work / 'data', base_url)
    api = API(base_url) if base_url else DockerAPI(container)
    try:
        return verify_api(work, prepared, expected, credentials, isolation, api)
    finally:
        if isinstance(api, DockerAPI):
            api.close()


def verify_api(work, prepared, expected, credentials, isolation, api):
    evidence = {'format': prepared['format'], 'snapshotId': prepared['snapshotId'], 'checkedTs': int(time.time()), **isolation,
                'memosVerified': 0, 'trashedMemosExcluded': 0, 'servedFilesVerified': 0, 'originalsVerified': 0,
                'previewsVerified': 0, 'negativeAccessChecks': 0, 'applicationVerified': False,
                'adminReadsVerified': 0, 'trashedFilesExcluded': 0,
                'memosExcludedArchivedOwner': expected['totalMemos'] - len(expected['memos']),
                'attachmentsExcludedArchivedOwner': expected['totalAttachments'] - len(expected['attachments']),
                'credentialEvidence': 'original credential rows absent before preparation; newly generated unregistered token rejected'}
    status, profile = api.get('/api/v1/instance/profile')
    require(status == 200, 'restored application profile unavailable')
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
    with closing(sqlite3.connect((work / 'data' / DATABASE).as_uri() + '?mode=ro', uri=True)) as db:
        require(table_hashes(db) == expected['tableHashes'], 'read verification changed restored records, relations or journal state')
    for name, digest in expected['fileHashes'].items():
        require(file_hash(work / 'data' / name) == digest, 'retained media or historical original changed')
    require(file_hash(Path(prepared['restore']) / 'data' / DATABASE) == prepared['sourceDatabaseSha256'], 'original restore was changed')
    evidence.update(applicationVerified=True, status='success', dataHashes=expected['tableHashes'],
                    retainedFilesVerified=len(expected['fileHashes']), evidenceScope='isolated app copy; no live instance writes; not personal acceptance')
    atomic_json(work / 'application-report.json', evidence)
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
    check = commands.add_parser('verify')
    check.add_argument('--work', required=True, type=Path)
    check.add_argument('--container', required=True)
    check.add_argument('--base-url', help='Optional host loopback transport; default is docker exec with network none')
    args = parser.parse_args()
    try:
        result = prepare(args.restore, args.work, args.uid, args.gid) if args.action == 'prepare' else verify_application(args.work, args.container, args.base_url)
    except (OSError, ValueError, KeyError, sqlite3.Error, urllib.error.URLError, subprocess.TimeoutExpired) as error:
        # Avoid printing response bodies, private paths, credentials or content.
        failure = {'status': 'failed', 'applicationVerified': False,
                   'message': str(error) if isinstance(error, VerificationFailure) else 'isolated application verification failed; inspect the controlled local fixture and checks'}
        if args.action == 'verify' and (args.work / 'prepare-report.json').is_file():
            atomic_json(args.work / 'application-report.json', failure)
        print(json.dumps(failure))
        raise SystemExit(1) from None
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
