"""Seal the verified offline tree and make a native Windows ZIP64 deliverable."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def committed_source():
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
        raise ValueError('Commit the release source before sealing its artifacts')
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def finalize(bundle, output):
    source_commit = committed_source()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    files = []
    for file in sorted(bundle.rglob('*')):
        if not file.is_file() or '__pycache__' in file.parts or file.suffix in {'.pyc', '.pyo'} or file.name == 'release-manifest.json':
            continue
        if file.is_symlink():
            raise ValueError('A release must not depend on filesystem links')
        files.append(dict(path=file.relative_to(bundle).as_posix(), bytes=file.stat().st_size, sha256=sha(file)))
    manifest = dict(schema=1, product='TwilightEcho', version=version, platform='win32-x64',
        createdUtc=datetime.now(timezone.utc).isoformat(), bytes=sum(file['bytes'] for file in files),
        python='CPython 3.11.14 standalone', models='registered-hashes-only',
        sourceCommit=source_commit, sourceIncludesWorkingTreeChanges=False, files=files)
    (bundle / 'release-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    listing = output / 'offline-archive-list.txt'
    names = [file['path'] for file in files] + ['release-manifest.json']
    listing.write_text('\n'.join(bundle.name+'/'+name for name in names)+'\n', encoding='utf-8')
    summary = {key: value for key, value in manifest.items() if key != 'files'}
    summary['files'] = len(files)
    (output / 'offline-content-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(summary), flush=True)


def source_snapshot(output):
    source_commit = committed_source()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    target = output / f'TwilightEcho-{version}-source.zip'
    if target.exists():
        raise ValueError('Source archive already exists')
    subprocess.run(['git', 'archive', '--format=zip', f'--prefix=TwilightEcho-{version}-source/',
                    f'--output={target}', source_commit], cwd=ROOT, check=True)
    with zipfile.ZipFile(target) as archive:
        count = len(archive.infolist())
    print(json.dumps(dict(source=target.name, commit=source_commit, files=count, bytes=target.stat().st_size)), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('bundle', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    finalize(args.bundle.resolve(), args.output.resolve())
    source_snapshot(args.output.resolve())
