"""Private, single-application Dokploy adapter for the restricted release gate.

The API key stays on the server. CI supplies identities, never API credentials,
arbitrary Compose content, service IDs or commands. The installed template must
match the tagged source before the gate pauses writes.
"""
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

CONFIG = Path('/etc/memos-backup/dokploy.json')
TEMPLATE = Path('/opt/memos-backup/compose.dokploy.yaml')
APP_NAME = 'memos-journal-ci55cj'
IMAGE = re.compile(r'(?m)^    image: (.+)$')
PROTECTED = ('composeId', 'appName', 'env', 'composeType', 'sourceType', 'branch',
             'autoDeploy', 'environmentId', 'serverId', 'mounts', 'domains',
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
                or value['autoDeploy'] is not False or value['composeType'] != 'docker-compose'):
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
