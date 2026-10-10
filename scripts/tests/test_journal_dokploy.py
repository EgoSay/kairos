import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import journal_dokploy as dokploy


class DokployTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        config = self.root / 'dokploy.json'
        config.write_text(json.dumps({'url': 'http://127.0.0.1:3000', 'apiKey': 'private-test-key', 'composeId': 'existing'}))
        template = self.root / 'compose.yaml'
        template.write_text('services:\n  memos:\n    image: ${MEMOS_IMAGE}\n  cloudflared:\n    image: cloudflare/cloudflared:2026.10.0\n')
        self.config_patch = patch.object(dokploy, 'CONFIG', config)
        self.template_patch = patch.object(dokploy, 'TEMPLATE', template)
        self.config_patch.start()
        self.template_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.addCleanup(self.template_patch.stop)
        self.client = dokploy.Dokploy()
        self.previous_image = 'ghcr.io/egosay/kairos@sha256:' + 'a' * 64
        self.previous = template.read_text().replace('${MEMOS_IMAGE}', self.previous_image)
        self.live = {'composeId': 'existing', 'appName': dokploy.APP_NAME, 'sourceType': 'raw',
                     'branch': 'main', 'autoDeploy': False, 'composeType': 'docker-compose',
                     'composeFile': self.previous, 'composePath': './docker-compose.yml', 'command': '', 'env': 'PRIVATE_TOKEN=kept',
                     'composeStatus': 'done', 'deployments': []}
        self.release = {'repository': 'ghcr.io/egosay/kairos', 'digest': 'sha256:' + 'b' * 64,
                        'composeSha256': hashlib.sha256(template.read_bytes()).hexdigest()}
        self.calls = []

    def api(self, endpoint, payload=None):
        self.calls.append((endpoint, payload))
        if endpoint == 'compose.update':
            self.live.update(payload)
        return copy.deepcopy(self.live)

    def prepare(self):
        with patch.object(self.client, 'request', side_effect=self.api):
            return self.client.prepare(self.release, self.previous_image)

    def test_wrong_template_stops_before_contacting_or_mutating_dokploy(self):
        with patch.object(self.client, 'request') as request:
            with self.assertRaisesRegex(ValueError, 'template'):
                self.client.prepare({**self.release, 'composeSha256': 'c' * 64}, self.previous_image)
        request.assert_not_called()

    def test_wrong_application_autodeploy_and_source_are_rejected(self):
        for field, value in [('appName', 'new-empty-app'), ('autoDeploy', True), ('branch', 'production/old'),
                             ('sourceType', 'github'), ('composeType', 'stack'), ('composeId', 'other'),
                             ('composePath', './scripts/old-compose.yml'), ('command', 'custom compose command')]:
            with self.subTest(field=field), patch.object(self.client, 'request', return_value={**self.live, field: value}):
                with self.assertRaises(RuntimeError):
                    self.client.prepare(self.release, self.previous_image)

    def test_running_deployment_or_wrong_previous_image_stops_preflight(self):
        for changed in ({'composeStatus': 'running'}, {'composeFile': self.previous.replace('a' * 64, 'c' * 64)}):
            with self.subTest(changed=changed), patch.object(self.client, 'request', return_value={**self.live, **changed}):
                with self.assertRaises(RuntimeError):
                    self.client.prepare(self.release, self.previous_image)

    def test_only_compose_is_changed_and_exact_previous_declaration_is_restored(self):
        state = self.prepare()
        self.assertIn('cloudflare/cloudflared:2026.10.0', state['candidateCompose'])
        self.assertNotIn('private-test-key', json.dumps(state))
        self.assertNotIn('PRIVATE_TOKEN', json.dumps(state))
        with patch.object(self.client, 'request', side_effect=self.api):
            self.client.update(state, state['previousCompose'], state['candidateCompose'])
            self.client.restore(state)
        self.assertEqual(self.live['composeFile'], self.previous)
        self.assertEqual(self.live['env'], 'PRIVATE_TOKEN=kept')
        writes = [payload for endpoint, payload in self.calls if endpoint == 'compose.update']
        self.assertEqual(len(writes), 2)
        self.assertTrue(all(set(payload) == {'composeId', 'composeFile'} for payload in writes))

    def test_manual_changes_are_never_overwritten_on_update_or_rollback(self):
        state = self.prepare()
        self.live['env'] = 'PRIVATE_TOKEN=changed-by-owner'
        with patch.object(self.client, 'request', side_effect=self.api):
            with self.assertRaisesRegex(RuntimeError, 'changed'):
                self.client.update(state, state['previousCompose'], state['candidateCompose'])
            with self.assertRaisesRegex(RuntimeError, 'changed'):
                self.client.restore(state)
        self.assertFalse(any(endpoint == 'compose.update' for endpoint, _ in self.calls))

    def test_update_with_lost_response_can_be_restored_from_observed_state(self):
        state = self.prepare()
        def lost_response(endpoint, payload=None):
            result = self.api(endpoint, payload)
            if endpoint == 'compose.update':
                raise TimeoutError('response lost after successful write')
            return result
        with patch.object(self.client, 'request', side_effect=lost_response):
            with self.assertRaises(TimeoutError):
                self.client.update(state, state['previousCompose'], state['candidateCompose'])
        with patch.object(self.client, 'request', side_effect=self.api):
            self.client.restore(state)
        self.assertEqual(self.live['composeFile'], self.previous)

    def test_waits_for_matching_deployment_and_does_not_trust_old_success(self):
        states = [
            {**self.live, 'deployments': [{'title': 'older', 'status': 'done'}]},
            {**self.live, 'composeStatus': 'running', 'deployments': [{'title': 'candidate', 'status': 'running'}]},
            {**self.live, 'deployments': [{'title': 'candidate', 'status': 'done'}]},
        ]
        with patch.object(self.client, 'read', side_effect=states), patch.object(dokploy.time, 'sleep') as sleep:
            self.assertEqual(self.client.wait_terminal('candidate')['status'], 'done')
        self.assertEqual(sleep.call_count, 2)

    def test_unknown_queue_outcome_requires_manual_inspection(self):
        with patch.object(self.client, 'read', return_value=self.live), \
                patch.object(dokploy.time, 'monotonic', side_effect=[0, 0, 181]), patch.object(dokploy.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'outcome unknown'):
                self.client.wait_terminal('unobserved')

    def test_api_key_is_only_in_header_and_timeout_is_bounded(self):
        with patch.object(dokploy.urllib.request, 'urlopen') as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b'{}'
            self.client.request('compose.one')
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:3000/api/compose.one?composeId=existing')
        self.assertEqual(request.get_header('X-api-key'), 'private-test-key')
        self.assertEqual(urlopen.call_args.kwargs['timeout'], 20)

    def rollback_fixture(self):
        previous = {'Config': {'Labels': {'com.docker.compose.project': dokploy.APP_NAME,
                                          'com.docker.compose.service': 'memos'},
                               'Env': ['MEMOS_DATA=/var/opt/memos', 'MEMOS_BACKUP_SOCKET=/run/kairos-backup/agent.sock',
                                       'LITERAL_SECRET=synthetic$secret=with=equals']},
                    'Mounts': [{'Type': 'volume', 'Name': 'existing-journal-data', 'Source': '/host/data',
                                'Destination': '/var/opt/memos', 'RW': True},
                               {'Type': 'bind', 'Source': '/run/kairos-backup', 'Destination': '/run/kairos-backup', 'RW': False}],
                    'NetworkSettings': {'Networks': {'existing-network': {}}}}
        resolved = {'services': {'memos': {'image': self.previous_image, 'restart': 'unless-stopped',
                                          'environment': {'OLD': 'declared'}, 'init': True, 'mem_limit': '384m',
                                          'security_opt': ['no-new-privileges:true'],
                                          'healthcheck': {'test': ['CMD', '/bin/true']},
                                          'depends_on': {'other': {'condition': 'service_started'}},
                                          'networks': {'default': {'aliases': ['memos']}},
                                          'volumes': [{'type': 'volume', 'source': 'data', 'target': '/var/opt/memos'},
                                                      {'type': 'bind', 'source': '/old/socket', 'target': '/run/kairos-backup'}]},
                                  'other': {'image': 'synthetic:other', 'environment': {'UNRELATED_SECRET': 'do-not-copy'}}},
                    'volumes': {'data': {'name': 'declared-data'}}, 'networks': {'default': {'name': 'existing-network'}}}
        return previous, resolved

    def test_rollback_uses_previous_service_and_actual_environment_mounts_networks(self):
        previous, resolved = self.rollback_fixture()
        target = self.root / 'rollback.yaml'; state = {'previousCompose': self.previous}
        def render(args, **kwargs):
            path = Path(args[args.index('-f') + 1])
            value = resolved if path.name == 'compose.yaml' else json.loads(path.read_text())
            self.assertNotIn('PRIVATE_TOKEN=kept', args)
            self.assertNotIn('UNRELATED_HOST_ENV', kwargs['env'])
            return subprocess.CompletedProcess(args, 0, json.dumps(value), '')
        with patch.object(self.client, 'check', return_value=self.live) as check, \
                patch.object(dokploy.subprocess, 'run', side_effect=render), patch.dict(os.environ, {'UNRELATED_HOST_ENV': 'private'}):
            self.client.prepare_rollback(state, previous, self.previous_image, target)
        check.assert_called_once_with(state, self.previous)
        rollback = json.loads(target.read_text()); service = rollback['services']['memos']
        self.assertEqual(set(rollback['services']), {'memos'})
        self.assertEqual(service['image'], self.previous_image)
        self.assertEqual(service['pull_policy'], 'never')
        self.assertEqual(service['environment']['MEMOS_BACKUP_SOCKET'], '/run/kairos-backup/agent.sock')
        self.assertEqual(service['environment']['LITERAL_SECRET'], 'synthetic$$secret=with=equals')
        self.assertNotIn('depends_on', service)
        self.assertEqual(service['security_opt'], ['no-new-privileges:true'])
        self.assertEqual(service['healthcheck'], resolved['services']['memos']['healthcheck'])
        self.assertEqual(service['volumes'][0]['source'], 'existing-journal-data')
        self.assertEqual(rollback['volumes'], {'existing-journal-data': {'name': 'existing-journal-data', 'external': True}})
        self.assertTrue(service['volumes'][1]['read_only'])
        self.assertFalse(service['volumes'][1]['bind']['create_host_path'])
        self.assertEqual(service['networks'], {'existing-network': {'aliases': ['memos']}})
        self.assertTrue(rollback['networks']['existing-network']['external'])
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('UNRELATED_SECRET', target.read_text())
        self.assertFalse(list(self.root.glob('.rollback-compose-*')))

    def test_rollback_render_failure_is_sanitized_and_keeps_previous_artifact(self):
        previous, _ = self.rollback_fixture()
        target = self.root / 'rollback.yaml'; target.write_text('previous verified artifact')
        with patch.object(self.client, 'check', return_value=self.live), \
                patch.object(dokploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'PRIVATE_SECRET')):
            with self.assertRaisesRegex(RuntimeError, 'not be resolved safely') as raised:
                self.client.prepare_rollback({'previousCompose': self.previous}, previous, self.previous_image, target)
        self.assertNotIn('PRIVATE_SECRET', str(raised.exception))
        self.assertEqual(target.read_text(), 'previous verified artifact')
        self.assertFalse(list(self.root.glob('.rollback-compose-*')))

    def test_rollback_rejects_missing_data_mount_or_wrong_container_before_downtime(self):
        for missing in ('mount', 'identity', 'image'):
            previous, resolved = self.rollback_fixture()
            if missing == 'mount': previous['Mounts'] = []
            if missing == 'identity': previous['Config']['Labels']['com.docker.compose.project'] = 'another-project'
            if missing == 'image': resolved['services']['memos']['image'] = 'synthetic:wrong'
            target = self.root / 'rollback.yaml'
            with self.subTest(missing=missing), patch.object(self.client, 'check', return_value=self.live), \
                    patch.object(dokploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(resolved), '')):
                with self.assertRaises(RuntimeError):
                    self.client.prepare_rollback({'previousCompose': self.previous}, previous, self.previous_image, target)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
