"""Build a relocatable, allowlisted Windows analysis pack from verified local IO.

Both interpreters are standalone CPython installations. No virtualenv launcher,
user profile, editable package, download cache or previous model is shipped.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SHARED = ('torch', 'torchgen', 'functorch', 'torchaudio',
          'torch-2.8.0+cu128.dist-info', 'torchaudio-2.8.0+cu128.dist-info')
SITE_CUSTOMIZE = '''"""Immutable, relocatable dependencies, including native Windows long paths."""
import sys
sys.dont_write_bytecode = True
import os
if os.name == 'nt':
    def extended(path):
        path = os.path.abspath(path)
        if path.startswith('\\\\\\\\?\\\\'):
            return path
        return '\\\\\\\\?\\\\UNC\\\\' + path[2:] if path.startswith('\\\\\\\\') else '\\\\\\\\?\\\\' + path
    sys.path[:] = [extended(path) for path in sys.path if path]
'''


def digest(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def excluded(path):
    return any(part in {'__pycache__', '.git'} for part in path.parts) or \
        path.suffix in {'.pyc', '.pyo', '.egg-link'} or path.name in {
            'direct_url.json', 'RECORD', '_virtualenv.pth', '_virtualenv.py', 'easy-install.pth'} or \
        path.name.startswith('__editable__')


def copy_tree(source, target, *, ignored=()):
    source, target = Path(source), Path(target)
    for file in source.rglob('*'):
        relative = file.relative_to(source)
        if excluded(relative) or relative.parts[0] in ignored or not file.is_file():
            continue
        if file.is_symlink():
            raise ValueError(f'Unexpected link in release input: {relative}')
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, destination)


def portable_runtime(base, source, destination):
    # The player launches runtime/Scripts/python.exe. Keeping the complete
    # standalone install there gives CPython a real, relative sys.prefix.
    install = destination / 'Scripts'
    copy_tree(base, install)
    packages = install / 'Lib/site-packages'
    source_packages = source / 'Lib/site-packages'
    editable = set()
    for direct in source_packages.glob('*.dist-info/direct_url.json'):
        data = json.loads(direct.read_text(encoding='utf-8'))
        if data.get('dir_info', {}).get('editable') or data.get('url', '').startswith('file:'):
            editable.add(direct.parent.name)
    copy_tree(source_packages, packages, ignored=(*SHARED, *editable))
    for pth in packages.glob('*.pth'):
        for line in pth.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.startswith(('import ', '#')) and (':' in line or line.startswith(('/', '\\'))):
                raise ValueError(f'Absolute site-package path in {pth.name}')
    (install / 'python311._pth').write_text(
        'Lib\nDLLs\nLib/site-packages\n../../shared-python/site-packages\n'
        '../../../resources/music-study\nimport site\n', encoding='utf-8')
    (install / 'Lib/sitecustomize.py').write_text(SITE_CUSTOMIZE, encoding='utf-8')
    if not (install / 'python.exe').is_file() or not (install / 'python311.dll').is_file():
        raise ValueError('Standalone CPython 3.11 x64 is required')


def share_torch(main, vocal, destination):
    total = 0
    for name in SHARED:
        first, second = main / 'Lib/site-packages' / name, vocal / 'Lib/site-packages' / name
        files = {file.relative_to(first): file for file in first.rglob('*')
                 if file.is_file() and not excluded(file.relative_to(first))}
        other = {file.relative_to(second) for file in second.rglob('*')
                 if file.is_file() and not excluded(file.relative_to(second))}
        if not files or files.keys() != other:
            raise ValueError(f'Shared dependency file sets differ: {name}')
        print(f'Checking common dependency: {name}', flush=True)
        for relative, source in files.items():
            if source.stat().st_size != (second / relative).stat().st_size or digest(source) != digest(second / relative):
                raise ValueError(f'Shared dependency differs: {name}/{relative}')
            target = destination / name / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            total += source.stat().st_size
    return total


def copy_models(source, destination, registry_directory):
    files = {}
    for name in ('models.json', 'vocal_models.json'):
        files.update(json.loads((registry_directory / name).read_text(encoding='utf-8'))['files'])
    classifier = json.loads((registry_directory / 'lyric_line_models.json').read_text(encoding='utf-8'))
    files.update({f'{classifier["directory"]}/{name}': value for name, value in classifier['files'].items()})
    for name, expected in files.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Model registry escaped the pack')
        original = source / relative
        if digest(original) != expected:
            raise ValueError(f'Model checksum mismatch: {name}')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    return len(files)


def write_launchers(output):
    (output / 'Start.cmd').write_bytes(
        b'@echo off\r\nsetlocal\r\nset "PYTHONHOME="\r\nset "PYTHONPATH="\r\n'
        b'set "PYTHONNOUSERSITE=1"\r\nset "PYTHONDONTWRITEBYTECODE=1"\r\n'
        b'set "TWILIGHT_MUSIC_STUDY_HOME=%~dp0music-study-runtime"\r\n'
        b'start "" "%~dp0TwilightEcho.exe" %*\r\n')
    tools = output / 'release-tools'
    tools.mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'scripts/verify-offline-release.py', tools / 'verify.py')
    (output / 'Verify.cmd').write_bytes(
        b'@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n'
        + rb'"%~dp0music-study-runtime\runtime\Scripts\python.exe" -X utf8 "%~dp0release-tools\verify.py" "%~dp0."'
        + b'\r\nset "result=%errorlevel%"\r\npause\r\nexit /b %result%\r\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-home', type=Path, required=True)
    parser.add_argument('--python-home', type=Path, required=True)
    parser.add_argument('--player', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Output must be a new, dedicated release directory')
    if not (args.player / 'TwilightEcho.exe').is_file():
        raise ValueError('A packaged Windows player is required')
    output.mkdir(parents=True)
    copy_tree(args.player, output)
    home = output / 'music-study-runtime'
    models = copy_models(args.source_home / 'models', home / 'models', ROOT / 'resources/music-study')
    print(f'Copied {models} registered model files', flush=True)
    saved = share_torch(args.source_home / 'runtime', args.source_home / 'runtime-vocal2midi', home / 'shared-python/site-packages')
    for name in ('runtime', 'runtime-vocal2midi'):
        print(f'Building standalone {name}', flush=True)
        portable_runtime(args.python_home, args.source_home / name, home / name)
    copy_tree(args.source_home / 'notation-tools', home / 'notation-tools')
    write_launchers(output)
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    readme = (ROOT / 'docs/offline-release-readme.md').read_text(encoding='utf-8').replace('@VERSION@', version)
    (output / '使用说明.md').write_text(readme, encoding='utf-8-sig')
    (output / 'LICENSE.txt').write_bytes((ROOT / 'LICENSE').read_bytes())
    print(json.dumps(dict(output=str(output), models=models, sharedBytes=saved), ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
