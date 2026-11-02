"""Assemble the offline player using exactly the downloadable component catalog."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def assemble(player, packages, output):
    catalog = json.loads((packages / 'catalog.json').read_text(encoding='utf-8'))
    if output.exists():
        raise ValueError('Choose a new offline output directory')
    shutil.copytree(player, output)
    home = output / 'analysis-components'
    installed = []
    for component in catalog['components']:
        archive = packages / (component['id'] + '-' + component['version'][:16] + '.zip')
        if sha(archive) != component['archiveSha256']:
            raise ValueError('Invalid component archive: ' + component['id'])
        directory = home / 'components' / component['id'] / component['version'][:16]
        directory.mkdir(parents=True)
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                path = Path(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
                    raise ValueError('Invalid archive path')
            z.extractall(directory)
        manifest = json.loads((directory / 'component-manifest.json').read_text(encoding='utf-8'))
        if manifest['id'] != component['id'] or manifest['version'] != component['version']:
            raise ValueError('Mismatched offline component')
        for file in manifest['files']:
            if sha(directory / file['path']) != file['sha256']:
                raise ValueError('Invalid offline component file: ' + file['path'])
        installed.append(dict(id=component['id'], phase='ready', version=component['version'],
                              directory=directory.relative_to(home).as_posix(), external=False,
                              receivedBytes=sum(part['bytes'] for part in component['parts']),
                              totalBytes=sum(part['bytes'] for part in component['parts'])))
        print(json.dumps(dict(installed=component['id'])), flush=True)
    (home / 'installed.json').write_text(json.dumps(installed), encoding='utf-8')
    (output / 'Start.cmd').write_bytes(
        b'@echo off\r\nsetlocal\r\nset "PYTHONHOME="\r\nset "PYTHONPATH="\r\n'
        b'set "TWILIGHT_STUDY_COMPONENTS_HOME=%~dp0analysis-components"\r\n'
        b'start "" "%~dp0TwilightEcho.exe" %*\r\n')
    tools = output / 'release-tools'
    tools.mkdir(exist_ok=True)
    shutil.copyfile(Path(__file__).with_name('verify-offline-release.py'), tools / 'verify.py')
    engine = next(c for c in catalog['components'] if c['id'] == 'engine-main')
    python = f'analysis-components\\components\\engine-main\\{engine["version"][:16]}\\runtime\\Scripts\\python.exe'
    (output / 'Verify.cmd').write_bytes((
        '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n'
        f'"%~dp0{python}" -X utf8 "%~dp0release-tools\\verify.py" "%~dp0."\r\n'
        'exit /b %errorlevel%\r\n').encode('ascii'))
    (output / '使用说明.md').write_text('完整离线版：运行 Start.cmd。分析组件已安装，无需联网下载。\n组件目录和在线安装使用同一版本与校验值，可整体移动。\n', encoding='utf-8-sig')
    print(json.dumps(dict(output=str(output), catalog=catalog['version'], components=len(installed))), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('player', type=Path)
    parser.add_argument('packages', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    assemble(args.player.resolve(), args.packages.resolve(), args.output.resolve())
