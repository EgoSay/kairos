"""Private, single-application Dokploy adapter for the restricted release gate.

The API key stays on the server. CI supplies identities, never API credentials,
arbitrary Compose content, service IDs or commands. The installed template must
match the tagged source before the gate pauses writes.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

from journal_cloud_backup import atomic_json

CONFIG = Path('/etc/memos-backup/dokploy.json')
TEMPLATE = Path('/opt/memos-backup/compose.dokploy.yaml')
APP_NAME = 'memos-journal-ci55cj'
IMAGE = re.compile(r'(?m)^    image: (.+)$')
PROTECTED = ('composeId', 'appName', 'env', 'composeType', 'sourceType', 'branch',
             'autoDeploy', 'composePath', 'command', 'environmentId', 'serverId', 'mounts', 'domains',
             'randomize', 'isolatedDeployment', 'isolatedDeploymentsVolume', 'suffix')


def protected_digest(compose):
    values = {key: compose.get(key) for key in PROTECTED}
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


class Dokploy:
    def __init__(self):
        self.config = json.loads(CONFIG.read_text())

    def request(self, endpoint, payload=None):
        url = self.config['url'].rstrip('/') + '/api/' + endpoint
        data = None if payload is None else json.dumps(payload).encode()
        if payload is None:
            url += '?' + urllib.parse.urlencode({'composeId': self.config['composeId']})
        request = urllib.request.Request(url, data=data, headers={
            'x-api-key': self.config['apiKey'], 'Content-Type': 'application/json',
            'User-Agent': 'Kairos-Release/1.0',
        })
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    def read(self):
        value = self.request('compose.one')
        if (value['composeId'] != self.config['composeId'] or value['appName'] != APP_NAME
                or value['sourceType'] != 'raw' or value['branch'] != 'main'
                or value['autoDeploy'] is not False or value['composeType'] != 'docker-compose'
                or value['composePath'] not in ('./docker-compose.yml', 'docker-compose.yml')
                or value.get('command')):
            raise RuntimeError('unexpected Dokploy application configuration')
        return value

    def prepare(self, release, previous_image):
        template = TEMPLATE.read_bytes()
        if hashlib.sha256(template).hexdigest() != release.get('composeSha256'):
            raise ValueError('install the tagged Compose template before releasing')
        source = template.decode()
        if not IMAGE.search(source):
            raise ValueError('Compose template has no image')
        current = self.read()
        if current['composeStatus'] == 'running':
            raise RuntimeError('Dokploy deployment already running')
        previous = current['composeFile']
        if not IMAGE.search(previous) or IMAGE.search(previous).group(1) != previous_image:
            raise RuntimeError('Dokploy declaration differs from the running image')
        candidate = IMAGE.sub('    image: ' + release['repository'] + '@' + release['digest'], source, count=1)
        return {'previousCompose': previous, 'candidateCompose': candidate,
                'protectedDigest': protected_digest(current)}

    def check(self, state, expected):
        current = self.read()
        if protected_digest(current) != state['protectedDigest'] or current['composeFile'] != expected:
            raise RuntimeError('Dokploy configuration changed during release')
        return current

    def prepare_rollback(self, state, previous, previous_image, target):
        """Freeze the previous service while pinning its existing mounts/networks."""
        current = self.check(state, state['previousCompose'])
        labels = previous.get('Config', {}).get('Labels', {})
        if labels.get('com.docker.compose.project') != APP_NAME or labels.get('com.docker.compose.service') != 'memos':
            raise RuntimeError('previous container is not the expected Compose service')
        # Resolve the previous declaration before downtime, using the same
        # private Dokploy environment. Never put env values on a command line,
        # in an exception, or in the public prepare response.
        with tempfile.TemporaryDirectory(prefix='.rollback-compose-', dir=target.parent) as directory:
            root = Path(directory)
            source, environment = root / 'compose.yaml', root / 'environment'
            source.write_text(state['previousCompose']); source.chmod(0o600)
            environment.write_text(current.get('env') or ''); environment.chmod(0o600)
            # Shell variables must not override the saved Dokploy environment.
            process_environment = {key: os.environ[key] for key in ('PATH', 'HOME', 'DOCKER_CONFIG') if key in os.environ}
            def render(path):
                result = subprocess.run(['docker', 'compose', '-p', APP_NAME, '--env-file', str(environment),
                                         '-f', str(path), 'config', '--format', 'json'],
                                        env=process_environment, capture_output=True, text=True, timeout=60)
                if result.returncode:
                    raise RuntimeError('previous Compose could not be resolved safely; service was not stopped')
                return json.loads(result.stdout)
            resolved = render(source)
            service = resolved.get('services', {}).get('memos')
            if not service or service.get('image') != previous_image:
                raise RuntimeError('resolved previous Compose image differs from the running digest')
            # config emits runnable escaped Compose strings. Only new literal
            # values from inspect need escaping to survive a second parse.
            literal = lambda value: value.replace('$', '$$')
            service['environment'] = {key: literal(value) for key, value in
                                      (item.split('=', 1) for item in previous['Config'].get('Env', []))}
            service.pop('env_file', None)
            service.pop('depends_on', None)
            service['pull_policy'] = 'never'  # The known previous image is already present locally.
            declared_mounts = {item['target']: item for item in service.get('volumes', [])}
            mounts, volumes = [], {}
            for mount in previous.get('Mounts', []):
                kind, destination = mount['Type'], mount['Destination']
                if kind not in ('volume', 'bind', 'tmpfs'):
                    raise RuntimeError('previous container has an unsupported mount type')
                item = {**declared_mounts.get(destination, {}), 'type': kind, 'target': literal(destination),
                        'read_only': not mount['RW']}
                if kind == 'volume':
                    name = mount.get('Name')
                    if not name:
                        raise RuntimeError('previous data volume identity is missing')
                    item['source'] = name
                    volumes[name] = {'name': name, 'external': True}
                elif kind == 'bind':
                    item['source'] = literal(mount['Source'])
                    item['bind'] = {**item.get('bind', {}), 'create_host_path': False}
                else:
                    item.pop('source', None)
                mounts.append(item)
            if not any(item['target'] == '/var/opt/memos' for item in mounts):
                raise RuntimeError('previous journal data mount is missing')
            service['volumes'] = mounts
            declared_networks = service.get('networks', {})
            options = {resolved.get('networks', {}).get(key, {}).get('name', key): value
                       for key, value in declared_networks.items()}
            networks = previous.get('NetworkSettings', {}).get('Networks', {})
            if not networks:
                raise RuntimeError('previous container network identity is missing')
            service['networks'] = {name: options.get(name) for name in networks}
            rollback = {'name': APP_NAME, 'services': {'memos': service}, 'volumes': volumes,
                        'networks': {name: {'name': name, 'external': True} for name in networks}}
            for resource in ('configs', 'secrets'):
                if resource in resolved:
                    rollback[resource] = resolved[resource]
            candidate = root / 'rollback.json'
            atomic_json(candidate, rollback)
            render(candidate)  # Reject dangling references/invalid models before stopping writes.
            atomic_json(target, rollback)

    def update(self, state, expected, target):
        self.check(state, expected)
        self.request('compose.update', {'composeId': self.config['composeId'], 'composeFile': target})
        self.check(state, target)

    def deploy(self, title):
        self.request('compose.deploy', {'composeId': self.config['composeId'], 'title': title,
                                       'description': 'Verified Kairos tag; backup gate prepared'})

    def wait_terminal(self, title):
        # A timed-out POST may still enqueue work. Never restore data while an
        # unobserved or running deployment could later overwrite that restore.
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            current = self.read()
            match = next((item for item in current['deployments'] if item['title'] == title), None)
            if match and match['status'] in ('done', 'error') and current['composeStatus'] != 'running':
                return match
            time.sleep(3)
        raise RuntimeError('Dokploy deployment still running or outcome unknown; preserve data and inspect receipts')

    def restore(self, state):
        # An update timeout is ambiguous too; accept only the known before/after
        # states, and never replace an unrelated administrator change.
        current = self.read()
        if current['composeFile'] == state['previousCompose']:
            self.check(state, state['previousCompose'])
        else:
            self.update(state, state['candidateCompose'], state['previousCompose'])
