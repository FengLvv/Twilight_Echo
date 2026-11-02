"""Publish fixed component assets without replacing any existing release file."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class Github:
    def __init__(self, repository):
        token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if not token:
            env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never'}
            result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                                    capture_output=True, text=True, env=env)
            values = dict(row.split('=', 1) for row in result.stdout.splitlines() if '=' in row)
            token = values.get('password') if result.returncode == 0 else None
        if not token:
            raise RuntimeError('GitHub release credentials are unavailable')
        self.repository = repository
        self.headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                        'User-Agent': 'TwilightEcho-components', 'X-GitHub-Api-Version': '2022-11-28'}

    def call(self, path, method='GET', body=None):
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = {**self.headers, **({'Content-Type': 'application/json'} if data else {})}
        request = urllib.request.Request('https://api.github.com/repos/' + self.repository + path,
                                         data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response) if response.status != 204 else None
        except urllib.error.HTTPError as error:
            if method == 'GET' and error.code == 404:
                return None
            raise RuntimeError(f'GitHub request failed: HTTP {error.code}') from None

    def upload(self, release, file):
        length = file.stat().st_size

        class Reader:
            def __init__(self, stream):
                self.stream, self.received, self.last = stream, 0, time.monotonic()

            def read(self, size):
                block = self.stream.read(size)
                self.received += len(block)
                if time.monotonic() - self.last > 15:
                    print(json.dumps(dict(asset=file.name, sentBytes=self.received, totalBytes=length)), flush=True)
                    self.last = time.monotonic()
                return block

        url = f'https://uploads.github.com/repos/{self.repository}/releases/{release}/assets?' + urllib.parse.urlencode({'name': file.name})
        with file.open('rb') as stream:
            request = urllib.request.Request(url, data=Reader(stream), method='POST',
                headers={**self.headers, 'Content-Type': 'application/octet-stream', 'Content-Length': str(length)})
            with urllib.request.urlopen(request, timeout=600) as response:
                return json.load(response)


def publish(directory, commit, public):
    catalog = json.loads((directory / 'catalog.json').read_text(encoding='utf-8'))
    if catalog['repository'] != 'FengLvv/Twilight_Echo' or not catalog['tag'].startswith('analysis-components-'):
        raise ValueError('Unexpected component repository or tag')
    files = [directory / 'catalog.json']
    for component in catalog['components']:
        for part in component['parts']:
            file = directory / part['name']
            if file.parent != directory or file.stat().st_size != part['bytes'] or sha(file) != part['sha256']:
                raise ValueError('Invalid component release input')
            if file.stat().st_size >= 2 * 1024 ** 3:
                raise ValueError('GitHub asset size limit exceeded')
            files.append(file)
    sums = directory / 'checksums.sha256'
    sums.write_text(''.join(f'{sha(file)}  {file.name}\n' for file in files), encoding='utf-8')
    files.append(sums)
    github = Github(catalog['repository'])
    release = github.call('/releases/tags/' + catalog['tag'])
    if not release:
        release = next((item for item in github.call('/releases?per_page=100') if item['tag_name'] == catalog['tag']), None)
    if not release:
        body = '\n'.join([
            'Twilight Echo 按需分析组件。由播放器自动下载、合并分卷、校验并安装，无需手动安装 Python。', '',
            '播放器更新与组件版本独立；本标签不是播放器更新。完整离线版继续单独提供。', '',
            'SheetSage2 / MERT 权重：CC BY-NC 4.0；TiFA / GAME 权重：CC BY-NC-SA 4.0。',
            '各组件内包含来源和许可说明；其余组件遵循各自上游许可。', '',
            '|组件|下载大小|', '|---|---:|',
            *[f'|{c["title"]}|{sum(p["bytes"] for p in c["parts"]) / 1e6:.1f} MB|' for c in catalog['components']]])
        release = github.call('/releases', 'POST', dict(tag_name=catalog['tag'], target_commitish=commit,
            name='分析组件 ' + catalog['version'], body=body, draft=True, prerelease=True, make_latest='false'))
    existing = {asset['name']: asset for asset in github.call(f'/releases/{release["id"]}/assets?per_page=100')}
    for file in files:
        expected = 'sha256:' + sha(file)
        asset = existing.get(file.name)
        if asset and release['draft'] and file.name in ('catalog.json', 'checksums.sha256') and asset.get('digest') != expected:
            github.call(f'/releases/assets/{asset["id"]}', 'DELETE')
            asset = None
        if asset and asset.get('state') == 'starter' and release['draft']:
            github.call(f'/releases/assets/{asset["id"]}', 'DELETE')
            asset = None
        if not asset:
            if not release['draft']:
                raise ValueError('Published component releases are immutable')
            asset = github.upload(release['id'], file)
        if asset.get('digest') != expected or asset['size'] != file.stat().st_size:
            raise ValueError('GitHub component digest mismatch: ' + file.name)
        print(json.dumps(dict(verified=file.name, bytes=asset['size'])), flush=True)
    if public and release['draft']:
        release = github.call(f'/releases/{release["id"]}', 'PATCH', dict(draft=False, prerelease=True, make_latest='false', target_commitish=commit))
    result = dict(url=release['html_url'], id=release['id'], tag=catalog['tag'], draft=release['draft'], assets=len(files))
    (directory / 'github-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--commit')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    commit = args.commit or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    publish(args.directory.resolve(), commit, args.publish)
