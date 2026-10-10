from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import format_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import journal_restore_app_verify as verifier


class RestoreApplicationVerificationTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.restore = self.root / 'restores' / 'isolated-fixture'
        self.data = self.restore / 'data'
        self.data.mkdir(parents=True)
        self.work = self.root / 'app-check'
        self.report = {'snapshotId': 'a' * 64, 'isolationId': self.restore.name, 'manifestVerified': True,
                       'storageIsolated': True, 'sessionsAndAccessTokensRevoked': True, 'repositoryId': 'b' * 16}
        verifier.atomic_json(self.restore / 'restore-report.json', self.report)
        with closing(sqlite3.connect(self.data / verifier.DATABASE)) as db, db:
            db.executescript((SCRIPTS.parent / 'store/migration/sqlite/LATEST.sql').read_text())
            db.execute("INSERT INTO user(username,password_hash) VALUES('owner','disabled')")
            db.execute("INSERT INTO memo(uid,creator_id,content,created_ts,updated_ts) VALUES('record',1,'PRIVATE TEST CONTENT',10,20)")
            db.execute("INSERT INTO system_setting(name,value) VALUES('ACCESS',?)", (json.dumps({'accessMode': 'INSTANCE_ACCESS_MODE_PRIVATE'}),))
            db.execute("INSERT INTO system_setting(name,value) VALUES('STORAGE',?)", (json.dumps({'storageType': 'LOCAL', 'defaultStorageId': 'local', 'storages': [{'type': 'STORAGE_TYPE_LOCAL'}]}),))

    def prepare(self):
        return verifier.prepare(self.restore, self.work)

    def test_preparation_preserves_source_and_creates_private_expiring_credentials(self):
        before = verifier.file_hash(self.data / verifier.DATABASE)
        result = self.prepare()
        self.assertFalse(result['applicationVerified'])
        self.assertEqual(before, verifier.file_hash(self.data / verifier.DATABASE))
        credentials = json.loads((self.work / 'credentials.json').read_text())
        self.assertEqual(0o600, (self.work / 'credentials.json').stat().st_mode & 0o777)
        self.assertNotIn('memos_pat_', json.dumps(result))
        with closing(sqlite3.connect(self.work / 'data' / verifier.DATABASE)) as db:
            rows = list(db.execute("SELECT value FROM user_setting WHERE key='PERSONAL_ACCESS_TOKENS'"))
        self.assertEqual(3, len(rows))
        for raw, in rows:
            token = json.loads(raw)['tokens'][0]
            self.assertTrue(token['expiresAt'])
            self.assertNotIn('memos_pat_', raw)
        self.assertNotIn(credentials['unregisteredToken'], json.dumps(rows))

    def test_prepare_refuses_unsanitized_or_live_data_and_never_overwrites(self):
        with closing(sqlite3.connect(self.data / verifier.DATABASE)) as db, db:
            db.execute("INSERT INTO user_setting(user_id,key,value) VALUES(1,'REFRESH_TOKENS','{}')")
        with self.assertRaisesRegex(ValueError, 'not revoked'):
            self.prepare()
        self.assertFalse(self.work.exists())
        with self.assertRaisesRegex(ValueError, 'agent-generated'):
            verifier.prepare(self.root, self.work)
        self.work.mkdir()
        with self.assertRaisesRegex(ValueError, 'new directory'):
            self.prepare()

    def test_prepare_rejects_symlinks(self):
        (self.data / 'linked').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.prepare()

    def test_report_binding_rejects_other_identity_changed_source_and_nonprivate_metadata(self):
        self.prepare()
        prepared = json.loads((self.work / 'prepare-report.json').read_text())
        before = (self.restore / 'restore-report.json').read_bytes()
        started = {'checkId': 'first', 'status': 'running', 'applicationVerified': False, 'startedTs': 1}
        for field in ('snapshotId', 'repositoryId', 'isolationId'):
            with self.subTest(field=field), self.assertRaises(verifier.VerificationFailure):
                verifier.begin_application_check({**prepared, field: 'wrong'}, started)
            self.assertEqual(before, (self.restore / 'restore-report.json').read_bytes())
        with closing(sqlite3.connect(self.data / verifier.DATABASE)) as db, db:
            db.execute("UPDATE memo SET content='changed source'")
        with self.assertRaisesRegex(verifier.VerificationFailure, 'original restore changed'):
            verifier.verify_application(self.work, 'fixture')
        changed = json.loads((self.restore / 'restore-report.json').read_text())
        self.assertFalse(changed['applicationVerified'])
        self.assertEqual('failed', changed['applicationVerification']['status'])
        before = (self.restore / 'restore-report.json').read_bytes()
        (self.work / 'prepare-report.json').chmod(0o644)
        with self.assertRaisesRegex(verifier.VerificationFailure, 'private'):
            verifier.verify_application(self.work, 'fixture')
        self.assertEqual(before, (self.restore / 'restore-report.json').read_bytes())

    def test_same_work_directory_cannot_replace_a_running_checks_evidence(self):
        self.prepare()
        with (self.work / '.verification.lock').open('w') as lock:
            (self.work / '.verification.lock').chmod(0o600)
            verifier.fcntl.flock(lock, verifier.fcntl.LOCK_EX)
            with self.assertRaises(BlockingIOError):
                verifier.verify_application(self.work, 'fixture')
        self.assertFalse((self.work / 'application-report.json').exists())
        self.assertFalse(json.loads((self.restore / 'restore-report.json').read_text()).get('applicationVerified', False))

    def index_migration_fixture(self):
        with closing(sqlite3.connect(self.data / verifier.DATABASE)) as db, db:
            db.execute('UPDATE memo SET payload=?', (json.dumps({'tags': ['legacy'], 'future': {'order': [2, 1]}}),))
            db.execute("INSERT INTO memo(uid,creator_id,content,payload) VALUES('indexed',1,'existing',?)",
                       (json.dumps({'explicitTagsVersion': 1, 'explicitTags': ['preserved'], 'future': [2, 1]}),))
        helper = self.root / 'helper'
        helper.write_text('private fixture')
        helper.chmod(0o700)
        def derive(_command, **kwargs):
            request = json.loads(kwargs['input'])
            result = {'format': 'kairos-explicit-tag-index-v1', 'snapshotId': request['snapshotId'],
                      'sourceDatabaseSha256': request['sourceDatabaseSha256'], 'parserCommit': 'c' * 40, 'parserVersion': 'fixture',
                      'records': [{'id': row['id'], 'contentSha256': verifier.sha(row['content'].encode()), 'expectedExactTags': []}
                                  for row in request['records']]}
            return Mock(returncode=0, stdout=json.dumps(result).encode())
        with patch.object(verifier.subprocess, 'run', side_effect=derive):
            verifier.prepare(self.restore, self.work, explicit_tag_helper=helper)
        return (json.loads((self.work / 'prepare-report.json').read_text()),
                json.loads((self.work / 'expected.json').read_text()), {'commit': 'c' * 40})

    def test_explicit_index_migration_requires_exact_derived_fields_and_preserves_unknown_metadata(self):
        prepared, expected, profile = self.index_migration_fixture()
        with closing(sqlite3.connect(self.work / 'data' / verifier.DATABASE)) as db, db:
            source = json.loads(db.execute('SELECT payload FROM memo WHERE id=1').fetchone()[0])
            migrated = {**source, 'explicitTagsVersion': 1, 'explicitTags': []}
            db.execute('UPDATE memo SET payload=? WHERE id=1', (json.dumps(migrated),))
        with self.assertRaisesRegex(verifier.VerificationFailure, 'changed restored'):
            verifier.verified_data_hashes(self.work, prepared, expected, profile, False)
        result = verifier.verified_data_hashes(self.work, prepared, expected, profile, True)
        migration = result['sourceIndexMigration']
        self.assertEqual(1, migration['migratedRows'])
        self.assertNotEqual(migration['sourceMemoSha256'], migration['actualMemoSha256'])
        self.assertEqual(migration['sourceNormalizedMemoSha256'], migration['actualNormalizedMemoSha256'])
        for changed in ({**migrated, 'explicitTags': ['invented']}, {**migrated, 'explicitTags': None},
                        {**migrated, 'explicitTagsVersion': True}, {**migrated, 'future': {'order': [1, 2]}},
                        {key: value for key, value in migrated.items() if key != 'future'}):
            with closing(sqlite3.connect(self.work / 'data' / verifier.DATABASE)) as db, db:
                db.execute('UPDATE memo SET payload=? WHERE id=1', (json.dumps(changed),))
            with self.subTest(changed=changed), self.assertRaises(verifier.VerificationFailure):
                verifier.verified_data_hashes(self.work, prepared, expected, profile, True)
        with closing(sqlite3.connect(self.work / 'data' / verifier.DATABASE)) as db, db:
            db.execute('UPDATE memo SET payload=? WHERE id=1', (json.dumps(migrated),))
            db.execute("UPDATE memo SET payload='{}' WHERE id=2")
        with self.assertRaisesRegex(verifier.VerificationFailure, 'non-index'):
            verifier.verified_data_hashes(self.work, prepared, expected, profile, True)

    def test_explicit_index_migration_rejects_wrong_source_manifest_and_parser_commit(self):
        prepared, expected, profile = self.index_migration_fixture()
        with self.assertRaisesRegex(verifier.VerificationFailure, 'parser commit'):
            verifier.verified_data_hashes(self.work, prepared, expected, {'commit': 'd' * 40}, True)
        path = self.work / 'explicit-tag-index.json'
        manifest = json.loads(path.read_text())
        for field in ('snapshotId', 'sourceDatabaseSha256'):
            with self.subTest(field=field):
                verifier.atomic_json(path, {**manifest, field: 'd' * 64})
                with self.assertRaisesRegex(verifier.VerificationFailure, 'another source'):
                    verifier.verified_data_hashes(self.work, prepared, expected, profile, True)
                altered = {**prepared, 'explicitTagIndexManifestSha256': verifier.file_hash(path)}
                with self.assertRaisesRegex(verifier.VerificationFailure, 'another source'):
                    verifier.verified_data_hashes(self.work, altered, expected, profile, True)
        verifier.atomic_json(path, manifest)
        with self.assertRaisesRegex(verifier.VerificationFailure, 'derived fields'):
            verifier.verified_data_hashes(self.work, prepared, expected, profile, True)

    def test_concurrent_checks_use_per_restore_lock_and_cannot_publish_old_success(self):
        self.prepare()
        prepared = json.loads((self.work / 'prepare-report.json').read_text())
        barrier = threading.Barrier(2)
        def begin(check_id):
            barrier.wait()
            verifier.begin_application_check(prepared, {'checkId': check_id, 'status': 'running', 'applicationVerified': False, 'startedTs': 1})
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(begin, ['one', 'two']))
        report = json.loads((self.restore / 'restore-report.json').read_text())
        current = report['applicationVerification']['checkId']
        old = 'two' if current == 'one' else 'one'
        self.assertFalse(verifier.finish_application_check(prepared, {'checkId': old, 'status': 'success', 'applicationVerified': True}))
        self.assertTrue(verifier.finish_application_check(prepared, {'checkId': current, 'status': 'failed', 'applicationVerified': False, 'message': 'controlled failure'}))
        report = json.loads((self.restore / 'restore-report.json').read_text())
        self.assertFalse(report['applicationVerified'])
        self.assertEqual('failed', report['applicationVerification']['status'])

    def test_private_success_file_cannot_mark_a_restore_without_running_the_verifier(self):
        self.prepare()
        verifier.atomic_json(self.work / 'application-report.json', {'applicationVerified': True, 'status': 'success', 'profile': {'commit': 'fake'}})
        self.assertFalse(json.loads((self.restore / 'restore-report.json').read_text()).get('applicationVerified', False))
        with patch.object(verifier, 'inspect_isolation', side_effect=verifier.VerificationFailure('isolation failed')):
            with self.assertRaisesRegex(verifier.VerificationFailure, 'isolation failed'):
                verifier.verify_application(self.work, 'fixture')
        self.assertFalse(json.loads((self.restore / 'restore-report.json').read_text())['applicationVerified'])
        self.assertEqual('failed', json.loads((self.work / 'application-report.json').read_text())['status'])

    def test_authorization_baseline_only_permits_synthetic_pat_usage_timestamps(self):
        self.prepare()
        expected = json.loads((self.work / 'expected.json').read_text())
        database = self.work / 'data' / verifier.DATABASE
        baseline = database.read_bytes()
        result = verifier.verify_authorization_state(self.work, expected)
        self.assertTrue(result['authorizationVerified'])
        with closing(sqlite3.connect(database)) as db, db:
            value = json.loads(db.execute("SELECT value FROM user_setting WHERE user_id=1 AND key='PERSONAL_ACCESS_TOKENS'").fetchone()[0])
            value['tokens'][0]['lastUsedAt'] = datetime.fromtimestamp(expected['authorizationBaselineTs'], timezone.utc).isoformat().replace('+00:00', 'Z')
            db.execute("UPDATE user_setting SET value=? WHERE user_id=1 AND key='PERSONAL_ACCESS_TOKENS'", (json.dumps(value, sort_keys=True),))
        self.assertEqual(result['authorizationHashes'], verifier.verify_authorization_state(self.work, expected)['authorizationHashes'])
        changes = [
            ("UPDATE user SET role='ADMIN' WHERE id=1", ()),
            ("UPDATE user SET password_hash='reactivated' WHERE id=1", ()),
            ("INSERT INTO user(username,password_hash) VALUES('unexpected','reactivated')", ()),
            ("INSERT INTO user_setting(user_id,key,value) VALUES(1,'REFRESH_TOKENS','{}')", ()),
            ("INSERT INTO user_setting(user_id,key,value) VALUES(1,'WEBHOOKS','{}')", ()),
            ("UPDATE user_setting SET value=? WHERE user_id=1 AND key='PERSONAL_ACCESS_TOKENS'", (json.dumps({'tokens': [{'tokenId': 'old-real-token', 'tokenHash': 'old-hash'}]}),)),
            ("INSERT INTO memo_share(uid,memo_id,creator_id) VALUES('revived',1,1)", ()),
            ("INSERT INTO idp(uid,name,type) VALUES('revived','provider','OIDC')", ()),
            ("INSERT INTO user_identity(user_id,provider,extern_uid) VALUES(1,'revived','external-user')", ()),
            ("INSERT INTO space(uid,title) VALUES('revived','space')", ()),
            ("INSERT INTO space_member(space_id,user_id,status,role) VALUES(1,1,'NORMAL','ADMIN')", ()),
            ("UPDATE system_setting SET value=? WHERE name='ACCESS'", (json.dumps({'accessMode': 'INSTANCE_ACCESS_MODE_PUBLIC'}),)),
            ("UPDATE system_setting SET value=? WHERE name='STORAGE'", (json.dumps({'storageType': 'S3'}),)),
            ("INSERT INTO system_setting(name,value) VALUES('AI',?)", (json.dumps({'providers': [{'apiKey': 'revived'}]}),)),
            ("INSERT INTO journal_document VALUES(1,'partition-target','revived',?,1,1)", (json.dumps({'enabled': True, 'url': 'https://example.invalid'}),)),
        ]
        for query, args in changes:
            with self.subTest(change=query):
                database.write_bytes(baseline)
                with closing(sqlite3.connect(database)) as db, db:
                    db.execute(query, args)
                with self.assertRaises(verifier.VerificationFailure):
                    verifier.verify_authorization_state(self.work, expected)
        database.write_bytes(baseline)
        with closing(sqlite3.connect(database)) as db, db:
            value = json.loads(db.execute("SELECT value FROM user_setting WHERE user_id=1 AND key='PERSONAL_ACCESS_TOKENS'").fetchone()[0])
            value['tokens'][0]['lastUsedAt'] = '1970-01-01T00:00:01Z'
            db.execute("UPDATE user_setting SET value=? WHERE user_id=1 AND key='PERSONAL_ACCESS_TOKENS'", (json.dumps(value),))
        with self.assertRaisesRegex(verifier.VerificationFailure, 'usage timestamp'):
            verifier.verify_authorization_state(self.work, expected)

    def test_application_verification_rejects_public_profile_and_permission_changes_during_requests(self):
        self.prepare()
        credentials = json.loads((self.work / 'credentials.json').read_text())
        response = {'name': 'memos/record', 'content': 'PRIVATE TEST CONTENT', 'createTime': '1970-01-01T00:00:10Z',
                    'updateTime': '1970-01-01T00:00:20Z', 'state': 'NORMAL', 'visibility': 'PRIVATE'}
        database = self.work / 'data' / verifier.DATABASE
        baseline = database.read_bytes()
        for change in ('public-profile', 'webhook-after-preflight', 'user-role-after-preflight'):
            with self.subTest(change=change):
                database.write_bytes(baseline)
                def get(_api, path, token=None, **_):
                    if path == '/api/v1/instance/profile':
                        with closing(sqlite3.connect(database)) as db, db:
                            if change == 'webhook-after-preflight':
                                db.execute("INSERT INTO user_setting(user_id,key,value) VALUES(1,'WEBHOOKS','{}')")
                            elif change == 'user-role-after-preflight':
                                db.execute("UPDATE user SET role='ADMIN' WHERE id=1")
                        return 200, {'version': 'fixture', 'commit': 'c' * 40,
                                     'accessMode': 'INSTANCE_ACCESS_MODE_PUBLIC' if change == 'public-profile' else 'INSTANCE_ACCESS_MODE_PRIVATE'}
                    return (200, response) if token in (credentials['tokens']['1'], credentials['tokens'][str(credentials['syntheticAdmin'])]) else (401, None)
                with patch.object(verifier, 'inspect_isolation', return_value={'imageId': 'fixture'}), patch.object(verifier.API, 'get', get):
                    with self.assertRaises(verifier.VerificationFailure):
                        verifier.verify_application(self.work, 'fixture', 'http://127.0.0.1:5231')
                linked = json.loads((self.restore / 'restore-report.json').read_text())
                self.assertFalse(linked['applicationVerified'])
                self.assertEqual('failed', linked['applicationVerification']['status'])

    def test_container_isolation_rejects_network_and_mount_escape(self):
        item = {'State': {'Running': True}, 'HostConfig': {'NetworkMode': 'internal', 'PortBindings': {'5230/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '5231'}]}},
                'Mounts': [{'Source': str(self.work / 'data'), 'Destination': '/var/opt/memos'}],
                'Config': {'Env': [], 'Image': 'sha256:fixture'}, 'NetworkSettings': {'Networks': {'internal': {}}}, 'Image': 'sha256:fixture', 'Id': 'fixture'}
        def inspect(*args):
            return [{'Internal': True}] if args[0] == 'network' else [item]
        with patch.object(verifier, 'docker_json', side_effect=inspect):
            verifier.inspect_isolation('fixture', self.work / 'data', 'http://127.0.0.1:5231')
            with self.assertRaisesRegex(ValueError, 'network none'):
                verifier.inspect_isolation('fixture', self.work / 'data')
            item['HostConfig'] = {'NetworkMode': 'none', 'PortBindings': {}}
            item['NetworkSettings']['Networks'] = {'none': {}}
            self.assertEqual('docker-exec-loopback', verifier.inspect_isolation('fixture', self.work / 'data')['transport'])
            item['Mounts'].append({'Source': '/run/kairos-backup', 'Destination': '/run/kairos-backup'})
            with self.assertRaisesRegex(ValueError, 'only the verification copy'):
                verifier.inspect_isolation('fixture', self.work / 'data', 'http://127.0.0.1:5231')
        with self.assertRaisesRegex(ValueError, 'loopback'):
            verifier.inspect_isolation('fixture', self.work / 'data', 'http://production.example.com:5230')

    def test_exec_transport_keeps_credentials_out_of_arguments_and_parses_streaming_http(self):
        responses = (b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'
                     b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n'
                     b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
        process = Mock(stdin=io.BytesIO(), stdout=io.BytesIO(responses))
        with patch.object(verifier.subprocess, 'Popen', return_value=process) as start:
            api = verifier.DockerAPI('isolated-fixture')
            self.assertEqual((200, {}), api.get('/api/v1/instance/profile', 'synthetic-secret'))
            self.assertEqual((200, verifier.sha(b'abcde')), api.get('/file/attachments/photo', 'synthetic-secret', digest=True))
            self.assertEqual((403, None), api.get('/file/attachments/photo'))
            self.assertNotIn('synthetic-secret', repr(start.call_args))
            self.assertIn(b'Authorization: Bearer synthetic-secret', process.stdin.getvalue())
            self.assertEqual(1, start.call_count)
            api.close()
            process.kill.assert_called_once()

    def response_server(self, replies):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append((self.path, self.headers.get('Authorization')))
                status, headers, body = replies.pop(0)
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return verifier.API('http://127.0.0.1:' + str(server.server_port)), calls

    def test_host_transport_retries_real_429_then_checks_success_and_permissions(self):
        api, calls = self.response_server([(429, {'Retry-After': '7'}, b'limited'), (200, {}, b'{}'),
                                          (429, {'Retry-After': '2'}, b'limited'), (403, {}, b'forbidden')])
        with patch.object(verifier.time, 'sleep') as sleep:
            self.assertEqual((200, {}), api.get('/record', 'synthetic-token'))
            self.assertEqual((403, None), api.get('/record', 'outsider-token'))
        self.assertEqual([7, 2], [call.args[0] for call in sleep.call_args_list])
        self.assertEqual(2, api.rate_limit_retries)
        self.assertEqual(9, api.rate_limit_wait_seconds)
        self.assertEqual([('/record', 'Bearer synthetic-token')] * 2 + [('/record', 'Bearer outsider-token')] * 2, calls)

    def test_host_transport_accepts_http_date_and_retries_binary_request(self):
        now = 1791648000
        retry_date = format_datetime(datetime.fromtimestamp(now + 9, timezone.utc), usegmt=True)
        api, _ = self.response_server([(429, {'Retry-After': retry_date}, b'limited'), (200, {}, b'original bytes')])
        with patch.object(verifier.time, 'time', return_value=now), patch.object(verifier.time, 'sleep') as sleep:
            self.assertEqual((200, verifier.sha(b'original bytes')), api.get('/file', 'synthetic-token', digest=True))
        sleep.assert_called_once_with(9)

    def test_host_transport_limits_retries_and_does_not_accept_rate_limit_as_denial(self):
        api, calls = self.response_server([(429, {'Retry-After': '1'}, b'limited')] * 4)
        with patch.object(verifier.time, 'sleep') as sleep, self.assertRaisesRegex(verifier.VerificationFailure, 'rate limit retry budget'):
            api.get('/private', 'outsider-token')
        self.assertEqual(4, len(calls))
        self.assertEqual(3, sleep.call_count)
        for retry_after in ('121', 'not a date'):
            with self.subTest(retry_after=retry_after):
                api, calls = self.response_server([(429, {'Retry-After': retry_after}, b'limited')])
                with patch.object(verifier.time, 'sleep') as sleep, self.assertRaises(verifier.VerificationFailure):
                    api.get('/private')
                sleep.assert_not_called()
                self.assertEqual(1, len(calls))
        api, _ = self.response_server([(429, {}, b'limited'), (403, {}, b'forbidden')])
        with patch.object(verifier.time, 'sleep') as sleep:
            self.assertEqual((403, None), api.get('/private'))
        sleep.assert_called_once_with(60)

    def test_exec_transport_closes_idle_connection_before_retry_and_bounds_total_wait(self):
        first = Mock(stdin=io.BytesIO(), stdout=io.BytesIO(b'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nContent-Length: 0\r\n\r\n'))
        second = Mock(stdin=io.BytesIO(), stdout=io.BytesIO(b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n'))
        api = verifier.DockerAPI('isolated-fixture')
        def wait(seconds):
            self.assertEqual(60, seconds)
            first.kill.assert_called_once()
            self.assertIsNone(api.process)
        with patch.object(verifier.subprocess, 'Popen', side_effect=[first, second]) as start, patch.object(verifier.time, 'sleep', side_effect=wait):
            self.assertEqual((200, verifier.sha(b'abc')), api.get('/file', 'synthetic-token', digest=True))
            self.assertEqual(2, start.call_count)
            self.assertEqual(first.stdin.getvalue(), second.stdin.getvalue())
            api.close()
        third = Mock(stdin=io.BytesIO(), stdout=io.BytesIO(b'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nContent-Length: 0\r\n\r\n'))
        api.rate_limit_wait_seconds = 599
        with patch.object(verifier.subprocess, 'Popen', return_value=third), patch.object(verifier.time, 'sleep') as sleep:
            with self.assertRaisesRegex(verifier.VerificationFailure, 'total rate limit wait budget'):
                api.get('/private')
            sleep.assert_not_called()
            self.assertIsNone(api.process)

    def test_verification_checks_real_fields_and_refuses_content_or_permission_mismatch(self):
        self.prepare()
        credentials = json.loads((self.work / 'credentials.json').read_text())
        response = {'name': 'memos/record', 'content': 'PRIVATE TEST CONTENT', 'createTime': '1970-01-01T00:00:10Z',
                    'updateTime': '1970-01-01T00:00:20Z', 'state': 'NORMAL', 'visibility': 'PRIVATE'}
        def get(_api, path, token=None, **_):
            if path == '/api/v1/instance/profile':
                return 200, {'version': 'fixture', 'commit': 'c' * 40, 'accessMode': 'INSTANCE_ACCESS_MODE_PRIVATE'}
            return (200, response) if token in (credentials['tokens']['1'], credentials['tokens'][str(credentials['syntheticAdmin'])]) else (401, None)
        with patch.object(verifier, 'inspect_isolation', return_value={'imageId': 'fixture'}), patch.object(verifier.API, 'get', get):
            report = verifier.verify_application(self.work, 'fixture', 'http://127.0.0.1:5231')
            self.assertTrue(report['applicationVerified'])
            self.assertEqual(1, report['memosVerified'])
            self.assertEqual(3, report['negativeAccessChecks'])
            self.assertEqual(1, report['adminReadsVerified'])
            self.assertNotIn('PRIVATE TEST CONTENT', json.dumps(report))
            linked = json.loads((self.restore / 'restore-report.json').read_text())
            self.assertTrue(linked['applicationVerified'])
            self.assertEqual('c' * 40, linked['applicationVerification']['testedCommit'])
            self.assertEqual('b' * 16, linked['applicationVerification']['repositoryId'])
            self.assertEqual(self.restore.name, linked['applicationVerification']['isolationId'])
            self.assertEqual(verifier.file_hash(self.work / 'application-report.json'), linked['applicationVerification']['reportSha256'])
            self.assertNotIn(str(self.work), json.dumps(linked))
            self.assertNotIn('memos_pat_', json.dumps(linked))
            response['content'] = 'different content'
            with self.assertRaisesRegex(ValueError, 'fields differ'):
                verifier.verify_application(self.work, 'fixture', 'http://127.0.0.1:5231')
            self.assertFalse(json.loads((self.work / 'application-report.json').read_text())['applicationVerified'])
            linked = json.loads((self.restore / 'restore-report.json').read_text())
            self.assertFalse(linked['applicationVerified'])
            self.assertEqual('failed', linked['applicationVerification']['status'])
            self.assertEqual(1, len(linked['applicationVerificationHistory']))
        def leaking_get(_api, path, token=None, **_):
            return get(_api, path, token, **_) if path == '/api/v1/instance/profile' else (200, response)
        with patch.object(verifier, 'inspect_isolation', return_value={}), patch.object(verifier.API, 'get', leaking_get):
            response['content'] = 'PRIVATE TEST CONTENT'
            with self.assertRaisesRegex(ValueError, 'permission failed'):
                verifier.verify_application(self.work, 'fixture', 'http://127.0.0.1:5231')

    def test_trashed_attachment_requires_explicit_owner_recovery_and_verifies_bytes(self):
        (self.data / 'originals').mkdir()
        (self.data / 'originals' / 'photo').write_bytes(b'fixture image')
        with closing(sqlite3.connect(self.data / verifier.DATABASE)) as db, db:
            db.execute("INSERT INTO journal_document(owner_id,kind,document_key,payload,version,updated_ts) VALUES(1,'trash','record','{}',1,1)")
            db.execute("INSERT INTO attachment(uid,creator_id,memo_id,filename,type,storage_type,blob,size) VALUES('photo',1,1,'fixture.png','image/png','DATABASE',?,13)", (b'fixture image',))
        self.prepare()
        credentials = json.loads((self.work / 'credentials.json').read_text())
        wrong_file = [False]
        def get(_api, path, token=None, **_):
            if path == '/api/v1/instance/profile':
                return 200, {'version': 'fixture', 'commit': 'c' * 40, 'accessMode': 'INSTANCE_ACCESS_MODE_PRIVATE'}
            if token == credentials['tokens']['1'] and path in ('/file/attachments/photo?trash=true', '/file/attachments/photo?trash=true&thumbnail=true', '/api/v1/journal/attachments/photo/original'):
                return 200, verifier.sha(b'wrong' if wrong_file[0] else b'fixture image')
            return 404, None
        with patch.object(verifier, 'inspect_isolation', return_value={'imageId': 'fixture'}), patch.object(verifier.API, 'get', get):
            report = verifier.verify_application(self.work, 'fixture', 'http://127.0.0.1:5231')
            self.assertEqual(1, report['trashedMemosExcluded'])
            self.assertEqual(1, report['trashedFilesExcluded'])
            self.assertEqual(1, report['servedFilesVerified'])
            self.assertEqual(1, report['originalsVerified'])
            self.assertEqual(1, report['previewsVerified'])
            self.assertEqual(6, report['negativeAccessChecks'])
            wrong_file[0] = True
            with self.assertRaisesRegex(ValueError, 'attachment bytes differ'):
                verifier.verify_application(self.work, 'fixture', 'http://127.0.0.1:5231')


if __name__ == '__main__':
    unittest.main()
