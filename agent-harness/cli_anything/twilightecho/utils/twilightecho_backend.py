import json
import os
import re
import time
import uuid
import subprocess
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener, ProxyHandler


class BackendError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def default_profile():
    explicit = os.environ.get('TWILIGHT_ECHO_PROFILE')
    if explicit:
        return Path(explicit).expanduser().resolve()
    if os.name == 'nt':
        return Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming')) / 'TwilightEcho'
    if os.sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/TwilightEcho'
    return Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'TwilightEcho'


class Backend:
    def __init__(self, profile=None, timeout=60):
        self.profile = Path(profile).expanduser().resolve() if profile else default_profile()
        self.timeout = timeout
        self._opener = build_opener(ProxyHandler({}))

    def discovery(self):
        path = self.profile / 'agent-endpoint.json'
        try:
            if path.stat().st_size > 32768:
                raise ValueError('oversized endpoint file')
            data = json.loads(path.read_text(encoding='utf-8'))
            url = urlparse(data['url'])
            if data.get('protocolVersion') != 1 or url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port or url.path != '/v1' or url.username or url.password or url.query or url.fragment:
                raise ValueError('invalid local endpoint')
            if not re.fullmatch('[a-f0-9]{64}', data.get('token', '')):
                raise ValueError('invalid credential')
            return data
        except FileNotFoundError:
            raise BackendError('APP_NOT_RUNNING', f'No Twilight Echo agent endpoint in {self.profile}. Start the CLI-enabled application or choose --profile.') from None
        except (ValueError, KeyError, TypeError, OSError):
            raise BackendError('INVALID_ENDPOINT', f'Invalid agent discovery file: {path}') from None

    def request(self, route, payload=None):
        data = self.discovery()
        headers = {'Authorization': 'Bearer ' + data['token']}
        body = None
        if payload is not None:
            try:
                body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
            except (ValueError, TypeError) as error:
                raise BackendError('INVALID_INPUT', str(error)) from None
            headers['Content-Type'] = 'application/json'
        request = Request(data['url'] + route, data=body, headers=headers)
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                result = json.load(response)
        except HTTPError as error:
            try:
                result = json.loads(error.read())
            except (ValueError, OSError):
                raise BackendError('HTTP_ERROR', f'Application returned HTTP {error.code}') from None
        except (URLError, TimeoutError, OSError):
            raise BackendError('UNAVAILABLE', 'Twilight Echo is not responding. Check the selected profile and app status. Commands are not automatically retried.') from None
        if not isinstance(result,dict):
            raise BackendError('INVALID_RESPONSE','Application returned an invalid response envelope')
        if not result.get('ok'):
            error = result.get('error', {})
            raise BackendError(error.get('code', 'APP_ERROR'), error.get('message', 'Application request failed'))
        return result.get('value')

    def status(self):
        return self.request('/status')

    def start(self, executable, headless=True, timeout=60):
        try:
            return {'started': False, **self.status()}
        except BackendError as error:
            if error.code not in ('APP_NOT_RUNNING', 'UNAVAILABLE'):
                raise
        candidate = Path(executable or os.environ.get('TWILIGHT_ECHO_EXE', '')).expanduser().resolve()
        if not candidate.is_file():
            raise BackendError('MISSING_APPLICATION', 'Supply --executable with the CLI-enabled TwilightEcho executable, or set TWILIGHT_ECHO_EXE.')
        self.profile.mkdir(parents=True, exist_ok=True)
        arguments = [str(candidate), '--agent-profile', str(self.profile)]
        if headless:
            arguments.append('--agent-headless')
        log = self.profile / 'agent-launch.log'
        environment = dict(os.environ)
        environment.pop('ELECTRON_RUN_AS_NODE', None)
        with log.open('ab') as output:
            child = subprocess.Popen(arguments, stdout=output, stderr=output, stdin=subprocess.DEVNULL,
                                     env=environment, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                                     start_new_session=os.name != 'nt')
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                value = self.status()
                if (value.get('snapshot') or {}).get('phase') == 'ready':
                    return {'started': True, **value}
            except BackendError as error:
                if error.code not in ('APP_NOT_RUNNING', 'UNAVAILABLE'):
                    raise
            if child.poll() is not None:
                raise BackendError('START_FAILED', f'Application exited with code {child.returncode}; inspect {log}')
            time.sleep(.3)
        raise BackendError('START_TIMEOUT', f'Application has not become ready; inspect {log}. The process was not force-closed.')

    def capabilities(self, domain=None):
        return self.request('/capabilities' + ('?' + urlencode({'domain': domain}) if domain else ''))

    def describe(self, operation):
        return self.request('/describe?' + urlencode({'name': operation}))

    def call(self, operation, payload, request_id=None):
        return self.request('/rpc', {'id': request_id or str(uuid.uuid4()), 'operation': operation, 'payload': payload})

    def wait_job(self, project_id, timeout=3600, interval=.75):
        deadline = time.monotonic() + timeout
        while True:
            project = self.call('study.project', {'id': project_id})
            if project['status'] == 'completed':
                return project
            if project['status'] in ('failed', 'cancelled', 'interrupted'):
                raise BackendError('JOB_' + project['status'].upper(), project.get('error') or project.get('stage') or project['status'])
            if time.monotonic() >= deadline:
                raise BackendError('WAIT_TIMEOUT', f'Job {project_id} is still {project["status"]}; continue with music wait --id {project_id}.')
            time.sleep(interval)
