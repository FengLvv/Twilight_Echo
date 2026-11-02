"""Check a distributable without Python, an account, a model download or network."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys


def verify(root):
    manifest = json.loads((root / 'release-manifest.json').read_text(encoding='utf-8'))
    for index, item in enumerate(manifest['files'], 1):
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Unsafe manifest path')
        path = root / relative
        if path.stat().st_size != item['bytes']:
            raise ValueError(f'File size mismatch: {relative}')
        with path.open('rb') as file:
            if hashlib.file_digest(file, 'sha256').hexdigest() != item['sha256']:
                raise ValueError(f'File checksum mismatch: {relative}')
        if index % 2500 == 0:
            print(f'Checked {index}/{len(manifest["files"])} files', flush=True)
    print(f'All {len(manifest["files"])} files verified: {manifest["version"]}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    verify(args.root.resolve())
