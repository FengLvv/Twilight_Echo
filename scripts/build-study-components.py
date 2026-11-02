"""Build immutable, independently downloadable analysis components from a verified pack."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import struct

ROOT = Path(__file__).resolve().parents[1]
PART_BYTES = 1536 * 1024 ** 2
MODEL_GROUPS = {
    'demucs': ['torch/'], 'mdx': ['UVR_MDXNET_KARA_2.onnx'],
    'duet': ['duet.safetensors'], 'ecapa': ['speaker/'],
    'sheetsage': ['sheetsage2/'], 'mert': ['mert2/'], 'btc': ['btc.safetensors'],
    'beat': ['vocal2midi/beat_this'], 'tifa': ['vocal2midi/tifa/'],
    'game': ['vocal2midi/game/'], 'lyric': ['lyric-line-'],
}
TITLES = {'engine-main': '分析运行环境', 'engine-vocal': '曲谱运行环境',
          'engine-torch': '共享 PyTorch / CUDA', 'lilypond': '排谱工具',
          'demucs': '六轨分离', 'mdx': '主唱／和声', 'duet': '双歌手分离',
          'ecapa': '歌手连续性', 'sheetsage': '和弦识别', 'mert': '和弦音频编码',
          'btc': '轻量和弦对比', 'beat': '节拍识别', 'tifa': '歌词对齐',
          'game': '旋律识别', 'lyric': '歌词过滤'}


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def component(path):
    top = path.split('/')[0]
    if top in ('runtime', 'runtime-vocal2midi', 'shared-python', 'notation-tools'):
        return {'runtime': 'engine-main', 'runtime-vocal2midi': 'engine-vocal',
                'shared-python': 'engine-torch', 'notation-tools': 'lilypond'}[top]
    if top == 'models':
        for name, prefixes in MODEL_GROUPS.items():
            if any(path[7:].startswith(prefix) for prefix in prefixes):
                return name
    raise ValueError('Unclassified analysis file: ' + path)


def build(source, output, catalog_path, repository):
    release = json.loads((source / 'release-manifest.json').read_text(encoding='utf-8-sig'))
    grouped = {}
    for entry in release['files']:
        name = entry['path'].replace('\\', '/')
        if name.startswith('music-study-runtime/'):
            relative = name[len('music-study-runtime/'):]
            grouped.setdefault(component(relative), []).append((relative, entry))
    output.mkdir(parents=True, exist_ok=True)
    components = []
    for key, entries in sorted(grouped.items()):
        rows = []
        for name, info in entries:
            path = source / info['path']
            if path.stat().st_size != info['bytes'] or sha(path) != info['sha256']:
                raise ValueError('Invalid release input: ' + name)
            data = b'Lib\nDLLs\nLib/site-packages\nimport site\n' if name.endswith('/python311._pth') else None
            rows.append(dict(path=name, bytes=len(data) if data is not None else info['bytes'],
                             sha256=hashlib.sha256(data).hexdigest() if data is not None else info['sha256']))
        notice = (ROOT / 'resources/music-study/THIRD_PARTY.md').read_bytes()
        notice += b'\n\nModel weight licenses: https://creativecommons.org/licenses/by-nc/4.0/ and https://creativecommons.org/licenses/by-nc-sa/4.0/ (see the model-specific notices above).\n'
        for license_file in sorted((ROOT / 'resources/music-study').rglob('*')):
            if license_file.is_file() and ('license' in license_file.name.lower() or license_file.name == 'THIRD_PARTY_NOTICES.md'):
                notice += ('\n\n---\n\n' + license_file.relative_to(ROOT).as_posix() + '\n\n').encode() + license_file.read_bytes()
        rows.append(dict(path='THIRD_PARTY.md', bytes=len(notice), sha256=hashlib.sha256(notice).hexdigest()))
        identity = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
        manifest = dict(schema=1, id=key, version=identity, platform='win32-x64', files=rows)
        local_manifest = json.loads(json.dumps(manifest))
        originals = {name: info['sha256'] for name, info in entries}
        for row in local_manifest['files']:
            if row['path'].endswith('/python311._pth'):
                row['originalSha256'] = originals[row['path']]
        manifest_directory = catalog_path.parent / 'component-manifests'
        manifest_directory.mkdir(parents=True, exist_ok=True)
        (manifest_directory / (identity + '.json')).write_text(json.dumps(local_manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        archive = output / f'{key}-{identity[:16]}.zip'
        if not archive.exists():
            temporary = archive.with_suffix('.zip.tmp')
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
                for name, info in entries:
                    if name.endswith('/python311._pth'):
                        z.writestr(name, b'Lib\nDLLs\nLib/site-packages\nimport site\n')
                    else:
                        z.write(source / info['path'], name)
                z.writestr('THIRD_PARTY.md', notice)
                z.writestr('component-manifest.json', json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
            temporary.replace(archive)
        # Stable timestamps and permissions also canonicalize an existing build.
        with zipfile.ZipFile(archive) as z:
            positions = [entry.header_offset for entry in z.infolist()]
            central = z.start_dir
        with archive.open('r+b') as stream:
            for position in positions:
                stream.seek(position + 10)
                stream.write(struct.pack('<HH', 0, 33))
            stream.seek(central)
            for _ in positions:
                position = stream.tell()
                header = stream.read(46)
                if header[:4] != b'PK\x01\x02':
                    raise ValueError('Invalid ZIP central directory')
                name_len, extra_len, comment_len = struct.unpack_from('<HHH', header, 28)
                stream.seek(position + 12); stream.write(struct.pack('<HH', 0, 33))
                stream.seek(position + 38); stream.write(struct.pack('<I', 0o100644 << 16))
                stream.seek(position + 46 + name_len + extra_len + comment_len)
        parts = []
        count = (archive.stat().st_size + PART_BYTES - 1) // PART_BYTES
        with archive.open('rb') as stream:
            for index in range(count):
                part = archive if count == 1 else archive.with_name(archive.name + f'.part{index + 1:03}')
                if count > 1:
                    with part.open('wb') as target:
                        remaining = PART_BYTES
                        while remaining and (block := stream.read(min(4 * 1024 ** 2, remaining))):
                            target.write(block)
                            remaining -= len(block)
                parts.append(dict(name=part.name, bytes=part.stat().st_size, sha256=sha(part)))
        item = dict(id=key, title=TITLES[key], version=identity, platform='win32-x64',
                    installedBytes=sum(row['bytes'] for row in rows), archiveBytes=archive.stat().st_size,
                    archiveSha256=sha(archive), parts=parts)
        components.append(item)
        print(json.dumps(dict(component=key, installedBytes=item['installedBytes'], downloadBytes=sum(p['bytes'] for p in parts))), flush=True)
    version = hashlib.sha256(json.dumps(components, sort_keys=True).encode()).hexdigest()[:16]
    tag = 'analysis-components-' + version
    for item in components:
        for part in item['parts']:
            part['url'] = f'https://github.com/{repository}/releases/download/{tag}/{part["name"]}'
    catalog = dict(schema=1, version=version, repository=repository, tag=tag, platform='win32-x64', sourceCommit=release['sourceCommit'], components=components)
    for target in (catalog_path, output / 'catalog.json'):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(tag=tag, components=len(components), catalog=str(catalog_path))), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'resources/music-study/components.json')
    parser.add_argument('--repository', default='FengLvv/Twilight_Echo')
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve(), args.catalog.resolve(), args.repository)
