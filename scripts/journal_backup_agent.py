#!/usr/bin/env python3
"""Root-only backup control over a local Unix socket, with a fixed action set.

Only the existing systemd backup timer is scheduled. HTTP input cannot select a
command, service, file path, source volume, or executable. Credentials stay in
root-private configuration. All recovery writes target new isolated directories.
"""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import socketserver
import sqlite3
import struct
import subprocess
import threading
import time
import urllib.parse

from journal_cloud_backup import atomic_json, restic, run, remember
from journal_snapshot import verify, DATABASE
from journal_backup import pause_restored_permissions

CONFIG = Path('/etc/memos-backup/config.json')
CONTROL = Path('/etc/memos-backup/console')
SOCKET = Path('/run/kairos-backup/agent.sock')
SCHEDULE = Path('/etc/systemd/system/memos-backup.timer.d/kairos.conf')
RELEASE_LOCK = Path('/var/lib/memos-release/lock')
ACTIONS = {'test', 'trial', 'activate', 'pause', 'enable', 'run', 'check', 'restore'}
FIELDS = {'endpoint', 'region', 'bucket', 'prefix', 'accessKeyId', 'accessKeySecret',
          'recoveryPassword', 'intervalSeconds', 'retention', 'initialize'}


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def command(*args):
    value = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if value.returncode:
        raise RuntimeError('server scheduling unavailable; inspect the private systemd service')
    return value.stdout.strip()


def next_run_time():
    value = command('systemctl', 'show', 'memos-backup.timer', '--property=NextElapseUSecRealtime', '--value')
    if value not in ('', '0', 'n/a'):
        return value
    # OnUnitActiveSec uses the boot clock, whereas the existing OnCalendar
    # timer uses real time. D-Bus provides an integer without locale-dependent
    # duration parsing; both schedules must show their actual next execution.
    try:
        raw = command('busctl', 'get-property', 'org.freedesktop.systemd1',
                      '/org/freedesktop/systemd1/unit/memos_2dbackup_2etimer',
                      'org.freedesktop.systemd1.Timer', 'NextElapseUSecMonotonic')
        kind, micros = raw.split()
        micros = int(micros)
        if kind != 't' or micros <= 0 or micros >= 2**64 - 1:
            return ''
        timestamp = time.time() + micros / 1_000_000 - time.clock_gettime(time.CLOCK_MONOTONIC)
        return time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(timestamp))
    except (OSError, RuntimeError, ValueError, OverflowError):
        return ''


@contextmanager
def release_guard():
    """Do not alter the scheduler/configuration while release writes are frozen."""
    RELEASE_LOCK.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with RELEASE_LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (RELEASE_LOCK.parent / 'pending.json').exists():
            raise BlockingIOError('发布尚未确认；备份配置与调度暂时保持不变')
        yield


def repository_id(config):
    return hashlib.sha256(config['repository'].encode()).hexdigest()[:16]


def destination(config):
    repository = config.get('repository', '')
    if not repository.startswith('s3:'):
        return {'endpoint': '', 'bucket': '', 'prefix': '', 'region': '', 'supported': False}
    parsed = urllib.parse.urlsplit(repository[3:])
    parts = parsed.path.strip('/').split('/', 1)
    return {'endpoint': parsed.scheme + '://' + parsed.netloc, 'bucket': parts[0],
            'prefix': parts[1] if len(parts) > 1 else '',
            'region': config.get('credentials', {}).get('AWS_DEFAULT_REGION', 'auto'), 'supported': True}


def public_config(config):
    return {**destination(config), 'intervalSeconds': config.get('intervalSeconds', 300),
            'retention': config.get('retention', {'daily': 30, 'monthly': 12, 'yearly': 100}),
            'credentialsConfigured': bool(config.get('credentials', {}).get('AWS_SECRET_ACCESS_KEY')),
            'recoveryPasswordConfigured': Path(config['passwordFile']).is_file(),
            'repositoryId': repository_id(config)}


def public_job(job):
    if not job:
        return None
    return {key: value for key, value in job.items() if key in
            ('id', 'action', 'status', 'startedTs', 'completedTs', 'result', 'error')}


class Agent:
    def __init__(self, config_path=CONFIG, control=CONTROL, schedule=SCHEDULE):
        self.config_path, self.control, self.schedule = config_path, control, schedule
        control.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.mutex = threading.Lock()
        if (control / 'activation.json').exists():
            self.recover_activation()
        previous = read_json(control / 'job.json')
        if previous and previous.get('status') == 'running':
            previous.update(status='interrupted', completedTs=int(time.time()), error='服务重启中断任务；活动配置未因此更改，请重新检测状态。')
            atomic_json(control / 'job.json', previous)

    def config(self):
        return json.loads(self.config_path.read_text())

    def recover_activation(self):
        with release_guard():
            self.recover_activation_locked()

    def recover_activation_locked(self):
        transition = read_json(self.control / 'activation.json')
        if not transition:
            return
        original = transition['config']
        with (Path(original['workDir']) / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.restore_transition(transition)

    def restore_transition(self, transition):
        original = transition['config']
        atomic_json(self.config_path, original)
        previous_schedule = transition['schedule']
        if previous_schedule is None:
            self.schedule.unlink(missing_ok=True)
        else:
            self.schedule.write_text(previous_schedule)
        for name, receipt in transition.get('receipts', {}).items():
            target = Path(original['workDir']) / name
            if receipt is None:
                target.unlink(missing_ok=True)
            else:
                atomic_json(target, receipt)
        command('systemctl', 'daemon-reload')
        command('systemctl', 'restart' if original.get('enabled', True) else 'stop', 'memos-backup.timer')
        (self.control / 'activation.json').unlink()

    def status(self):
        now = int(time.time())
        config = self.config()
        work = Path(config['workDir'])
        success = read_json(work / 'last-success.json')
        attempt = read_json(work / 'last-attempt.json')
        task = read_json(work / 'current-task.json')
        timer = command('systemctl', 'show', 'memos-backup.timer', '--property=ActiveState', '--value')
        next_run = next_run_time()
        interval = config.get('intervalSeconds', 300)
        stale = not success or now - success.get('sourceTs', 0) > max(interval * 3, 900)
        if (self.control / 'activation.json').exists() or (success and success.get('repositoryId', repository_id(config)) != repository_id(config)):
            state = 'unknown'
        elif not config.get('enabled', True) or timer != 'active':
            state = 'paused' if not config.get('enabled', True) and timer != 'active' else 'unknown'
        elif task:
            state = 'running' if now - task.get('startedTs', 0) < 1800 else 'unknown'
        elif attempt and attempt.get('status') == 'failed' and (not success or attempt.get('attemptTs', 0) >= success.get('completedTs', 0)):
            state = 'failed'
        else:
            state = 'stale' if stale else 'success'
        history = [read_json(path) for path in sorted((work / 'history').glob('*.json'), reverse=True)[:100]]
        if success and not any(item and item.get('snapshotId') == success.get('snapshotId') for item in history):
            history.append(success)
        checks = read_json(work / 'last-check.json')
        recoveries = [read_json(path) for path in sorted((work / 'restores').glob('*/restore-report.json'), reverse=True)[:30]]
        delivery = read_json(work / 'last-report.json')
        delivery_stale = not delivery or now - delivery.get('completedTs', delivery.get('attemptTs', 0)) > max(interval * 3, 900)
        replica = read_json(work / 'last-replica.json', {'status': 'unknown', 'message': '独立副本尚无可核验回执'})
        replica['stale'] = not replica.get('sourceTs') or now - replica['sourceTs'] > config.get('replicaMaxAgeSeconds', 10800)
        replica['lagSeconds'] = max(0, (success or {}).get('sourceTs', now) - replica['sourceTs']) if replica.get('sourceTs') else None
        return {'state': state, 'updatedTs': now, 'source': 'host backup agent / existing memos-backup.timer',
                'config': public_config(config), 'enabled': config.get('enabled', True),
                'timerState': timer, 'nextRun': next_run, 'stale': stale,
                'lastSuccess': success, 'lastAttempt': attempt, 'currentTask': task,
                'history': history, 'integrity': checks, 'restores': recoveries,
                'monitor': {'configured': bool(config.get('reportUrl')), 'delivery': delivery, 'stale': delivery_stale},
                'independentReplica': replica,
                'job': public_job(read_json(self.control / 'job.json')),
                'coverage': {'browserDraftsIncluded': False, 'managedAttachmentsIncluded': True,
                             'externalLinksIncluded': False, 'database': 'SQLite 一致性快照'}}

    def draft(self, token):
        if not isinstance(token, str) or not re.fullmatch('[a-f0-9]{32}', token):
            raise ValueError('配置测试标识无效，请重新检测')
        path = self.control / ('draft-' + token)
        data = read_json(path / 'draft.json')
        if not data or int(time.time()) - data['createdTs'] > 86400:
            raise ValueError('配置测试已过期，请重新检测')
        return path, data

    def build_draft(self, payload):
        if not isinstance(payload, dict) or set(payload) - FIELDS:
            raise ValueError('不支持的备份配置字段')
        current = self.config()
        endpoint = payload.get('endpoint', '').rstrip('/')
        parsed = urllib.parse.urlsplit(endpoint)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path):
            raise ValueError('请输入不含账号、路径和查询参数的 HTTPS S3 endpoint')
        bucket, prefix = payload.get('bucket', ''), payload.get('prefix', '').strip('/')
        if not re.fullmatch('[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
            raise ValueError('S3 bucket 名称无效')
        if not re.fullmatch('[a-zA-Z0-9_./-]{0,200}', prefix) or '..' in prefix.split('/'):
            raise ValueError('备份前缀无效')
        interval = payload.get('intervalSeconds', 300)
        if isinstance(interval, bool) or not isinstance(interval, int) or not 300 <= interval <= 86400:
            raise ValueError('备份间隔需为 300–86400 秒')
        retention = payload.get('retention', {'daily': 30, 'monthly': 12, 'yearly': 100})
        if set(retention) != {'daily', 'monthly', 'yearly'} or any(isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= 3650 for n in retention.values()):
            raise ValueError('保留数量需为 1–3650，且不能删除全部恢复点')
        region = payload.get('region', 'auto')
        if not isinstance(region, str) or not re.fullmatch('[a-zA-Z0-9-]{1,40}', region):
            raise ValueError('S3 region 无效')
        active_destination = destination(current)
        same_endpoint = endpoint == active_destination['endpoint']
        access = payload.get('accessKeyId') or (current.get('credentials', {}).get('AWS_ACCESS_KEY_ID') if same_endpoint else '')
        secret = payload.get('accessKeySecret') or (current.get('credentials', {}).get('AWS_SECRET_ACCESS_KEY') if same_endpoint else '')
        if not access or not secret or len(access) > 512 or len(secret) > 2048:
            raise ValueError('新的 endpoint 必须提供有效的独立 S3 凭据')
        token = secrets.token_hex(16)
        path = self.control / ('draft-' + token)
        path.mkdir(mode=0o700)
        password = payload.get('recoveryPassword')
        if password:
            if not isinstance(password, str) or len(password) < 20 or len(password) > 4096:
                raise ValueError('恢复密码至少 20 字符，请独立保管')
            (path / 'password').write_text(password + '\n'); (path / 'password').chmod(0o600)
        else:
            shutil.copyfile(current['passwordFile'], path / 'password'); (path / 'password').chmod(0o600)
        repository = 's3:' + endpoint + '/' + bucket + ('/' + prefix if prefix else '')
        config = {**current, 'repository': repository, 'passwordFile': str(path / 'password'),
                  'workDir': str(path / 'work'), 'lockFile': str(Path(current['workDir']) / 'lock'),
                  'credentials': {'AWS_ACCESS_KEY_ID': access, 'AWS_SECRET_ACCESS_KEY': secret, 'AWS_DEFAULT_REGION': region},
                  'intervalSeconds': interval, 'retention': retention, 'enabled': True}
        config.pop('reportUrl', None); config.pop('reportToken', None)
        data = {'createdTs': int(time.time()), 'config': config, 'initialize': payload.get('initialize') is True,
                'baseDigest': hashlib.sha256(self.config_path.read_bytes()).hexdigest(), 'tested': False, 'trial': None}
        atomic_json(path / 'draft.json', data)
        return token, path, data

    def test(self, payload):
        token, path, data = self.build_draft(payload)
        config = data['config']
        dest = destination(config)
        credentials = config['credentials']
        helper_request = {'action': 'probe', 'prefix': dest['prefix'], 'config': {
            'endpoint': dest['endpoint'], 'region': dest['region'], 'bucket': dest['bucket'], 'usePathStyle': True,
            'accessKeyId': credentials['AWS_ACCESS_KEY_ID'], 'accessKeySecret': credentials['AWS_SECRET_ACCESS_KEY']}}
        helper = config.get('storageHelper', '/opt/memos-backup/kairos-backup-storage')
        result = subprocess.run([helper], input=json.dumps(helper_request), capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise ValueError('连接检测失败：检查 endpoint、region、凭据、对象读写删除权限和网络；活动配置未更改')
        probe = json.loads(result.stdout)
        if not probe.get('readWriteVerified') or not probe.get('temporaryObjectRemoved'):
            raise ValueError('连接检测未完成读写校验或清理')
        if data['initialize']:
            restic(config, 'init')  # Explicit new-repository action, never an access-error fallback.
        restic(config, 'snapshots', '--json')
        data.update(tested=True, testedTs=int(time.time()))
        atomic_json(path / 'draft.json', data)
        return {'draftToken': token, 'status': 'connected', 'testedTs': data['testedTs'], 'activeConfigChanged': False}

    def trial(self, payload):
        path, data = self.draft(payload.get('draftToken'))
        if not data['tested']:
            raise ValueError('请先完成连接检测')
        result = run(data['config'])
        if result.get('status') != 'success':
            raise ValueError('试备份未完成，可能已有任务运行；活动配置未更改')
        data['trial'] = result
        atomic_json(path / 'draft.json', data)
        return {'draftToken': payload['draftToken'], 'status': 'trial-success', 'backup': result, 'activeConfigChanged': False}

    def schedule_config(self, enabled, interval):
        self.schedule.parent.mkdir(parents=True, exist_ok=True)
        self.schedule.write_text('[Timer]\nOnBootSec=\nOnUnitActiveSec=\nOnCalendar=\nOnBootSec=2m\nOnUnitActiveSec=' + str(interval) + 's\n')
        command('systemctl', 'daemon-reload')
        command('systemctl', 'enable' if enabled else 'disable', '--now', 'memos-backup.timer')
        if enabled:
            command('systemctl', 'restart', 'memos-backup.timer')

    def activate(self, payload):
        with release_guard():
            return self.activate_locked(payload)

    def activate_locked(self, payload):
        path, data = self.draft(payload.get('draftToken'))
        if not data['tested'] or not data['trial'] or data['trial'].get('status') != 'success':
            raise ValueError('必须先通过连接检测及完整试备份')
        original = self.config_path.read_bytes()
        if hashlib.sha256(original).hexdigest() != data['baseDigest']:
            raise ValueError('活动配置已变化，请重新检测，避免覆盖新配置')
        current = json.loads(original)
        previous_schedule = self.schedule.read_text() if self.schedule.exists() else None
        with (Path(current['workDir']) / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            config = {**current, **{key: data['config'][key] for key in
                      ('repository', 'passwordFile', 'credentials', 'intervalSeconds', 'retention', 'enabled')}}
            work = Path(current['workDir'])
            transition = {'config': current, 'schedule': previous_schedule,
                          'receipts': {name: read_json(work / name) for name in ('last-success.json', 'last-attempt.json')}}
            atomic_json(self.control / 'activation.json', transition)
            try:
                atomic_json(self.config_path, config)
                self.schedule_config(True, config['intervalSeconds'])
                receipt = data['trial']
                remember(work, receipt)
                atomic_json(work / 'last-success.json', receipt)
                atomic_json(work / 'last-attempt.json', receipt)
            except Exception:
                self.restore_transition(transition)
                raise
            (self.control / 'activation.json').unlink()
        return {'status': 'enabled', 'config': public_config(config)}

    def set_enabled(self, enabled):
        with release_guard():
            config = self.config()
            previous_schedule = self.schedule.read_text() if self.schedule.exists() else None
            atomic_json(self.control / 'activation.json', {'config': config, 'schedule': previous_schedule})
            try:
                self.schedule_config(enabled, config.get('intervalSeconds', 300))
                config['enabled'] = enabled
                atomic_json(self.config_path, config)
            except Exception:
                self.recover_activation_locked()
                raise
            (self.control / 'activation.json').unlink()
            return {'status': 'enabled' if enabled else 'paused'}

    def manual_run(self):
        # The existing unit is the single owner of production backup execution.
        with release_guard():
            command('systemctl', 'start', '--no-block', 'memos-backup.service')
        return {'status': 'queued', 'message': '已交给现有服务器备份任务；请查看实际任务回执'}

    def restore(self, payload):
        identifier = payload.get('snapshotId', '')
        if not isinstance(identifier, str) or not re.fullmatch('[a-f0-9]{8,64}', identifier):
            raise ValueError('请选择明确的快照 ID')
        config = self.config(); work = Path(config['workDir'])
        known = [read_json(path) for path in (work / 'history').glob('*.json')]
        known.append(read_json(work / 'last-success.json', {}))
        if not any(item and item.get('status') == 'success' and item.get('snapshotId') == identifier and
                   item.get('repositoryId', repository_id(config)) == repository_id(config) for item in known):
            raise ValueError('快照没有当前目的地的完整成功回执，不能据此自动恢复')
        with (work / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            target = work / 'restores' / (str(int(time.time())) + '-' + secrets.token_hex(8))
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            # Backups pass relative data/manifest paths, so the snapshot tree
            # starts at /data even though snapshots.paths lists absolute inputs.
            restic(config, 'restore', identifier, '--target', str(target))
            manifest = verify(target)
            database = target / 'data' / DATABASE
            with closing(sqlite3.connect(database)) as db, db:
                safety = pause_restored_permissions(db)
                # Every S3 served object was included in the verified manifest.
                # Restored copies use local files and never contact the old bucket.
                for uid, relative in manifest.get('managedS3', {}).items():
                    raw = db.execute("SELECT payload FROM attachment WHERE uid=?", (uid,)).fetchone()
                    attachment_payload = json.loads(raw[0])
                    attachment_payload.pop('s3Object', None)
                    db.execute("UPDATE attachment SET storage_type='LOCAL',reference=?,payload=? WHERE uid=? AND storage_type='S3'",
                               (str(Path(config['logicalRoot']) / relative), json.dumps(attachment_payload), uid))
                # Existing objects are local now; new uploads must also stay in
                # this isolated copy, not reuse the production bucket/keys or
                # an absolute filepath template from the original instance.
                raw_storage = db.execute("SELECT value FROM system_setting WHERE name='STORAGE'").fetchone()
                original_storage = json.loads(raw_storage[0]) if raw_storage else {}
                local_storage = {'storageType': 'LOCAL', 'defaultStorageId': 'local',
                                 'storages': [{'id': 'local', 'type': 'STORAGE_TYPE_LOCAL'}],
                                 'filepathTemplate': 'assets/{timestamp}_{uuid}_{filename}'}
                upload_limit = original_storage.get('uploadSizeLimitMb', original_storage.get('upload_size_limit_mb'))
                if upload_limit is not None:
                    local_storage['uploadSizeLimitMb'] = upload_limit
                db.execute("INSERT INTO system_setting(name,value) VALUES('STORAGE',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
                           (json.dumps(local_storage),))
                db.execute("UPDATE memo SET visibility='PRIVATE'")
                db.execute("INSERT INTO system_setting(name,value) VALUES('ACCESS',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
                           (json.dumps({'accessMode': 'INSTANCE_ACCESS_MODE_PRIVATE'}),))
            result = {'status': 'isolated-verified', 'snapshotId': identifier, 'repositoryId': repository_id(config),
                      'restoredTs': int(time.time()), 'counts': manifest['counts'],
                      'mediaFilesVerified': len(manifest['files']) - 1, 'managedS3Count': len(manifest.get('managedS3', {})),
                      'manifestVerified': True, 'applicationVerified': False,
                      'storageIsolated': True, 'isolationId': target.name, **safety}
            atomic_json(target / 'restore-report.json', result)
            return result

    def submit(self, action, payload):
        if action not in ACTIONS or not isinstance(payload, dict):
            raise ValueError('unsupported backup action')
        if action != 'test' and set(payload) - ({'draftToken'} if action in ('trial', 'activate') else {'snapshotId'} if action == 'restore' else set()):
            raise ValueError('unsupported action fields')
        if not self.mutex.acquire(blocking=False):
            raise BlockingIOError('已有备份管理任务运行，请等待结果')
        job = {'id': secrets.token_hex(16), 'action': action, 'status': 'running', 'startedTs': int(time.time())}
        try:
            atomic_json(self.control / 'job.json', job)
        except Exception:
            self.mutex.release()
            raise
        def execute():
            try:
                if action in ('test', 'trial', 'activate', 'restore'):
                    result = getattr(self, action)(payload)
                elif action == 'run':
                    result = self.manual_run()
                elif action == 'check':
                    result = run(self.config(), 'check')
                else:
                    result = self.set_enabled(action == 'enable')
                job.update(status='skipped' if result.get('status') == 'skipped' else 'success', result=result)
            except Exception as error:
                message = str(error) if isinstance(error, (ValueError, BlockingIOError)) else '任务未完成；检查目的地权限、网络、恢复密码和服务器任务状态。活动配置以配置页为准。'
                job.update(status='failed', error=message)
            finally:
                job['completedTs'] = int(time.time())
                atomic_json(self.control / 'job.json', job)
                self.mutex.release()
        threading.Thread(target=execute, daemon=True).start()
        return public_job(job)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, *_):
        pass  # Never log request bodies, credentials or private data.

    def handle_request(self):
        if hasattr(socket, 'SO_PEERCRED'):
            _, uid, _ = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid not in (0, self.server.client_uid):
                return self.reply(403, {'message': 'backup agent peer not allowed'})
        try:
            if self.command == 'GET' and self.path == '/v1/status':
                return self.reply(200, self.server.agent.status())
            if self.command != 'POST' or self.path.removeprefix('/v1/') not in ACTIONS:
                return self.reply(404, {'message': 'unknown backup operation'})
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                return self.reply(400, {'message': 'invalid request size'})
            payload = json.loads(self.rfile.read(length))
            return self.reply(202, self.server.agent.submit(self.path[4:], payload))
        except BlockingIOError:
            return self.reply(409, {'message': '已有备份任务运行，请稍后重试'})
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {'message': '备份请求无效，请检查输入'})
        except Exception:
            return self.reply(503, {'message': '备份代理暂不可用，请检查服务器任务与配置'})

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        self.wfile.write(data)


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-uid', type=int, default=10001)
    parser.add_argument('--socket-gid', type=int, default=10001)
    args = parser.parse_args()
    os.umask(0o077)
    SOCKET.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chown(SOCKET.parent, 0, args.socket_gid); SOCKET.parent.chmod(0o750)
    SOCKET.unlink(missing_ok=True)
    with Server(str(SOCKET), Handler) as server:
        os.chown(SOCKET, 0, args.socket_gid); SOCKET.chmod(0o660)
        server.agent, server.client_uid = Agent(), args.client_uid
        server.serve_forever()


if __name__ == '__main__':
    main()
