from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import journal_backup_agent as agent
import journal_snapshot as snapshot


class BackupAgentTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve(); self.work = self.root / 'work'; self.work.mkdir()
        release_lock = patch.object(agent, 'RELEASE_LOCK', self.root / 'release' / 'lock')
        release_lock.start(); self.addCleanup(release_lock.stop)
        self.source = self.root / 'source'; self.source.mkdir()
        self.password = self.root / 'password'; self.password.write_text('existing independent recovery password')
        self.config_path = self.root / 'config.json'
        self.config = {'source': str(self.source), 'logicalRoot': '/var/opt/memos', 'workDir': str(self.work),
                       'repository': 's3:https://storage.example.com/private/restic', 'passwordFile': str(self.password),
                       'credentials': {'AWS_ACCESS_KEY_ID': 'PRIVATE_ACCESS', 'AWS_SECRET_ACCESS_KEY': 'PRIVATE_SECRET', 'AWS_DEFAULT_REGION': 'auto'},
                       'reportUrl': 'https://monitor.example.com/private', 'reportToken': 'PRIVATE_MONITOR'}
        agent.atomic_json(self.config_path, self.config)
        self.control = self.root / 'control'; self.schedule = self.root / 'timer.d/kairos.conf'
        self.service = agent.Agent(self.config_path, self.control, self.schedule)
        self.payload = {'endpoint': 'https://storage.example.com', 'region': 'auto', 'bucket': 'private', 'prefix': 'restic',
                        'intervalSeconds': 300, 'retention': {'daily': 30, 'monthly': 12, 'yearly': 100}}
        with closing(sqlite3.connect(self.source / snapshot.DATABASE)) as db, db:
            db.executescript((SCRIPTS.parent / 'store/migration/sqlite/LATEST.sql').read_text())
            db.execute("INSERT INTO user(username,password_hash) VALUES('owner','hash')")
            db.execute("INSERT INTO memo(uid,creator_id,content,visibility) VALUES('record',1,'unchanged original','PUBLIC')")

    def successful_draft(self):
        token, path, draft = self.service.build_draft(self.payload)
        draft['tested'] = True
        draft['trial'] = {'status': 'success', 'snapshotId': 'a' * 64, 'sourceTs': int(time.time()),
                          'repositoryId': agent.repository_id(draft['config']), 'mediaComplete': True}
        agent.atomic_json(path / 'draft.json', draft)
        return token, path, draft

    @staticmethod
    def schedule_active(*args):
        return 'active' if '--property=ActiveState' in args else 'next run'

    def test_status_redacts_all_credentials_and_marks_old_receipt_stale(self):
        agent.atomic_json(self.work / 'last-success.json', {'status': 'success', 'sourceTs': 1})
        with patch.object(agent, 'command', side_effect=self.schedule_active):
            value = self.service.status()
        self.assertEqual(value['state'], 'stale')
        self.assertFalse(value['coverage']['browserDraftsIncluded'])
        for secret in ('PRIVATE_ACCESS', 'PRIVATE_SECRET', 'PRIVATE_MONITOR', self.password.read_text()):
            self.assertNotIn(secret, json.dumps(value))
        self.assertEqual(value['independentReplica']['status'], 'unknown')

    def test_failed_attempt_does_not_hide_behind_recent_success(self):
        now = int(time.time())
        agent.atomic_json(self.work / 'last-success.json', {'status': 'success', 'sourceTs': now, 'completedTs': now})
        agent.atomic_json(self.work / 'last-attempt.json', {'status': 'failed', 'attemptTs': now})
        with patch.object(agent, 'command', side_effect=self.schedule_active):
            self.assertEqual(self.service.status()['state'], 'failed')

    def test_next_run_supports_monotonic_schedule_and_unknown_reply(self):
        with patch.object(agent, 'command', side_effect=['', 't 400000000']), \
             patch.object(agent.time, 'time', return_value=1000), patch.object(agent.time, 'clock_gettime', return_value=100):
            self.assertEqual(agent.next_run_time(), '1970-01-01 00:21:40 UTC')
        with patch.object(agent, 'command', side_effect=['', 't 0']):
            self.assertEqual(agent.next_run_time(), '')

    def test_connection_failure_preserves_original_configuration_and_secrets(self):
        before = self.config_path.read_bytes()
        with patch.object(agent.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, 'PRIVATE_ERROR', 'PRIVATE_ERROR')):
            with self.assertRaisesRegex(ValueError, '活动配置未更改'):
                self.service.test(self.payload)
        self.assertEqual(self.config_path.read_bytes(), before)

    def test_changed_endpoint_cannot_reuse_existing_credential(self):
        with self.assertRaisesRegex(ValueError, '新的 endpoint'):
            self.service.build_draft({**self.payload, 'endpoint': 'https://another.example.com'})

    def test_connection_requires_real_read_write_cleanup_and_never_initializes_on_access_failure(self):
        process = subprocess.CompletedProcess([], 0, json.dumps({'readWriteVerified': True, 'temporaryObjectRemoved': True}), '')
        with patch.object(agent.subprocess, 'run', return_value=process), patch.object(agent, 'restic', side_effect=RuntimeError('denied')) as restic:
            with self.assertRaises(RuntimeError):
                self.service.test(self.payload)
        self.assertEqual(restic.call_args.args[1], 'snapshots')
        self.assertEqual(restic.call_count, 1)

    def test_trial_failure_and_overlap_never_enable_configuration(self):
        token, _, _ = self.successful_draft()
        before = self.config_path.read_bytes()
        with patch.object(agent, 'run', return_value={'status': 'skipped'}):
            with self.assertRaisesRegex(ValueError, '试备份未完成'):
                self.service.trial({'draftToken': token})
        self.assertEqual(self.config_path.read_bytes(), before)

    def test_activation_requires_complete_trial_and_unchanged_active_config(self):
        token, path, draft = self.successful_draft()
        draft['trial'] = None; agent.atomic_json(path / 'draft.json', draft)
        with self.assertRaisesRegex(ValueError, '完整试备份'):
            self.service.activate({'draftToken': token})
        draft['trial'] = {'status': 'success'}; agent.atomic_json(path / 'draft.json', draft)
        self.config_path.write_text(json.dumps({**self.config, 'instanceVersion': 'new release'}))
        with self.assertRaisesRegex(ValueError, '活动配置已变化'):
            self.service.activate({'draftToken': token})

    def test_timer_failure_rolls_back_config_and_original_schedule(self):
        token, _, _ = self.successful_draft()
        before = self.config_path.read_bytes()
        self.schedule.parent.mkdir(); self.schedule.write_text('original timer')
        with patch.object(self.service, 'schedule_config', side_effect=RuntimeError('timer failure')), patch.object(agent, 'command'):
            with self.assertRaises(RuntimeError):
                self.service.activate({'draftToken': token})
        self.assertEqual(self.config_path.read_bytes(), before)
        self.assertEqual(self.schedule.read_text(), 'original timer')
        self.assertFalse((self.control / 'activation.json').exists())

    def test_interrupted_activation_recovers_previous_config_and_timer(self):
        agent.atomic_json(self.control / 'activation.json', {'config': self.config, 'schedule': None})
        agent.atomic_json(self.config_path, {**self.config, 'repository': 's3:https://wrong.invalid/bucket'})
        with patch.object(agent, 'command') as command:
            agent.Agent(self.config_path, self.control, self.schedule)
        self.assertEqual(json.loads(self.config_path.read_text()), self.config)
        command.assert_any_call('systemctl', 'restart', 'memos-backup.timer')

    def test_successful_activation_keeps_server_paths_monitoring_and_single_scheduler(self):
        token, _, _ = self.successful_draft()
        with patch.object(agent, 'command') as command:
            result = self.service.activate({'draftToken': token})
        current = json.loads(self.config_path.read_text())
        self.assertEqual(current['workDir'], self.config['workDir'])
        self.assertEqual(current['reportToken'], 'PRIVATE_MONITOR')
        self.assertEqual(result['status'], 'enabled')
        self.assertTrue(all('memos-backup.timer' in call.args or call.args == ('systemctl', 'daemon-reload') for call in command.call_args_list))
        self.assertNotIn('PRIVATE_SECRET', json.dumps(result))

    def test_receipt_failure_after_timer_change_restores_config_and_previous_receipts(self):
        token, _, _ = self.successful_draft()
        old = {'status': 'success', 'snapshotId': 'b' * 64, 'sourceTs': 123}
        agent.atomic_json(self.work / 'last-success.json', old)
        agent.atomic_json(self.work / 'last-attempt.json', old)
        before = self.config_path.read_bytes()
        write = agent.atomic_json
        def fail_new_receipt(path, value):
            if path == self.work / 'last-attempt.json' and value.get('snapshotId') == 'a' * 64:
                raise OSError('receipt disk failure')
            return write(path, value)
        with patch.object(agent, 'command'), patch.object(agent, 'atomic_json', side_effect=fail_new_receipt):
            with self.assertRaisesRegex(OSError, 'receipt disk'):
                self.service.activate({'draftToken': token})
        self.assertEqual(self.config_path.read_bytes(), before)
        for name in ('last-success.json', 'last-attempt.json'):
            self.assertEqual(agent.read_json(self.work / name), old)
        self.assertFalse((self.control / 'activation.json').exists())

    def test_other_destination_receipt_does_not_claim_current_backup_health(self):
        agent.atomic_json(self.work / 'last-success.json', {'status': 'success', 'sourceTs': int(time.time()), 'repositoryId': 'other'})
        with patch.object(agent, 'command', side_effect=self.schedule_active):
            self.assertEqual(self.service.status()['state'], 'unknown')

    def test_release_pending_blocks_timer_or_configuration_changes(self):
        agent.RELEASE_LOCK.parent.mkdir()
        (agent.RELEASE_LOCK.parent / 'pending.json').write_text('{}')
        before = self.config_path.read_bytes()
        with patch.object(agent, 'command') as command:
            for operation in (lambda: self.service.set_enabled(False), self.service.manual_run):
                with self.assertRaises(BlockingIOError):
                    operation()
            command.assert_not_called()
        self.assertEqual(self.config_path.read_bytes(), before)

    def test_pause_failure_restores_configuration_instead_of_claiming_paused(self):
        before = json.loads(self.config_path.read_text())
        with patch.object(self.service, 'schedule_config', side_effect=RuntimeError('timer failure')), patch.object(agent, 'command'):
            with self.assertRaises(RuntimeError):
                self.service.set_enabled(False)
        self.assertEqual(json.loads(self.config_path.read_text()), before)

    def test_rejects_paths_commands_and_unsupported_operations(self):
        for field in ('source', 'workDir', 'passwordFile', 'restic', 'storageHelper', 'command'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.service.build_draft({**self.payload, field: '/arbitrary'})
        with self.assertRaises(ValueError):
            self.service.submit('shell', {})
        with self.assertRaises(ValueError):
            self.service.submit('restore', {'snapshotId': 'a' * 64, 'destination': '/live'})

    def test_restore_requires_success_receipt_and_only_writes_isolated_directory(self):
        identifier = 'a' * 64
        with self.assertRaisesRegex(ValueError, '成功回执'):
            self.service.restore({'snapshotId': identifier})
        stage = self.root / 'remote-snapshot'; snapshot.snapshot(self.source, stage, Path('/var/opt/memos'))
        original = (self.source / snapshot.DATABASE).read_bytes()
        agent.atomic_json(self.work / 'last-success.json', {'status': 'success', 'snapshotId': identifier})
        def remote(config, *args):
            self.assertEqual(args[:2], ('restore', identifier))
            target = Path(args[3]); self.assertTrue(target.is_relative_to(self.work / 'restores'))
            self.assertFalse(target.exists()); shutil.copytree(stage, target)
            return ''
        with patch.object(agent, 'restic', side_effect=remote):
            result = self.service.restore({'snapshotId': identifier})
        self.assertTrue(result['manifestVerified']); self.assertFalse(result['applicationVerified'])
        self.assertTrue(result['sessionsAndAccessTokensRevoked']); self.assertTrue(result['externalSendingPaused'])
        self.assertEqual((self.source / snapshot.DATABASE).read_bytes(), original)
        restored = self.work / 'restores' / result['isolationId'] / 'data' / snapshot.DATABASE
        with closing(sqlite3.connect(restored)) as db:
            self.assertEqual(db.execute('SELECT content,visibility FROM memo').fetchone(), ('unchanged original', 'PRIVATE'))

    def test_restore_s3_uses_verified_local_bytes_and_preserves_media_metadata_without_old_authorizations(self):
        media = {'width': 1200, 'height': 800}
        storage = {'endpoint': 'https://storage.example.com', 'bucket': 'private', 'region': 'auto',
                   'accessKeyId': 'SYNTHETIC_KEY', 'accessKeySecret': 'SYNTHETIC_SECRET'}
        registry = {'defaultStorageId': 'production', 'storageType': 'S3', 's3Config': storage,
                    'filepathTemplate': '/production-data/{filename}', 'uploadSizeLimitMb': '128',
                    'storages': [{'id': 'production', 'type': 'STORAGE_TYPE_S3', 's3Config': storage}]}
        with closing(sqlite3.connect(self.source / snapshot.DATABASE)) as db, db:
            db.execute("INSERT INTO system_setting(name,value) VALUES('STORAGE',?)", (json.dumps(registry),))
            db.execute("INSERT INTO attachment(uid,creator_id,memo_id,storage_type,payload) VALUES('photo',1,1,'S3',?)",
                       (json.dumps({'mediaMetadata': media, 's3Object': {'key': 'photo', 's3Config': storage}}),))
            db.execute("INSERT INTO memo_share(uid,memo_id,creator_id) VALUES('old-link',1,1)")
            db.execute("INSERT INTO user_setting VALUES(1,'PERSONAL_ACCESS_TOKENS','{}')")
            db.execute("INSERT INTO journal_document VALUES(1,'partition-delivery','old-job',?,1,0)",
                       (json.dumps({'status': 'pending', 'nextAttemptTs': 123, 'leaseUntilTs': 456}),))
            db.execute("INSERT INTO journal_document VALUES(1,'revision','historical',?,1,0)",
                       (json.dumps({'memo': {'attachments': [{'name': 'attachments/historical'}]}}),))
        (self.source / 'originals').mkdir()
        (self.source / 'originals/photo').write_bytes(b'original photo')
        (self.source / 'originals/historical').write_bytes(b'historical original')
        def fetch(args, *, input, stdout, **kwargs):
            stdout.write(b'independent served S3 bytes')
            return subprocess.CompletedProcess(args, 0)
        stage = self.root / 'remote-s3-snapshot'
        with patch.object(snapshot.subprocess, 'run', side_effect=fetch):
            snapshot.snapshot(self.source, stage, Path('/var/opt/memos'), '/fixed/helper')
        before = (self.source / snapshot.DATABASE).read_bytes()
        identifier = 'c' * 64
        agent.atomic_json(self.work / 'last-success.json', {'status': 'success', 'snapshotId': identifier})
        def remote(config, *args):
            self.assertEqual(args[:2], ('restore', identifier))
            shutil.copytree(stage, Path(args[3]))
            return ''
        with patch.object(agent, 'restic', side_effect=remote):
            result = self.service.restore({'snapshotId': identifier})
        root = self.work / 'restores' / result['isolationId'] / 'data'
        self.assertEqual((root / 'managed-s3/photo').read_bytes(), b'independent served S3 bytes')
        self.assertEqual((root / 'originals/photo').read_bytes(), b'original photo')
        self.assertEqual((root / 'originals/historical').read_bytes(), b'historical original')
        with closing(sqlite3.connect(root / snapshot.DATABASE)) as db:
            attachment = db.execute('SELECT storage_type,reference,payload FROM attachment').fetchone()
            self.assertEqual(attachment[:2], ('LOCAL', '/var/opt/memos/managed-s3/photo'))
            self.assertEqual(json.loads(attachment[2]), {'mediaMetadata': media})
            restored_storage = json.loads(db.execute("SELECT value FROM system_setting WHERE name='STORAGE'").fetchone()[0])
            self.assertEqual(restored_storage['defaultStorageId'], 'local')
            self.assertEqual(restored_storage['storages'], [{'id': 'local', 'type': 'STORAGE_TYPE_LOCAL'}])
            self.assertEqual(restored_storage['storageType'], 'LOCAL')
            self.assertEqual(restored_storage['uploadSizeLimitMb'], '128')
            self.assertEqual(restored_storage['filepathTemplate'], 'assets/{timestamp}_{uuid}_{filename}')
            self.assertNotIn('s3Config', restored_storage)
            self.assertNotIn('SYNTHETIC_SECRET', json.dumps(restored_storage))
            self.assertEqual(db.execute('SELECT count(*) FROM memo_share').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM user_setting').fetchone()[0], 0)
            delivery = json.loads(db.execute("SELECT payload FROM journal_document WHERE kind='partition-delivery'").fetchone()[0])
            self.assertEqual((delivery['status'], delivery['nextAttemptTs'], delivery['leaseUntilTs']), ('cancelled', 0, 0))
        self.assertEqual((self.source / snapshot.DATABASE).read_bytes(), before)
        self.assertFalse(result['applicationVerified'])


if __name__ == '__main__':
    unittest.main()
