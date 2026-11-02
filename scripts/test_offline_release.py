from pathlib import Path
import hashlib
import json
import random
import runpy
import shutil
import subprocess
import tempfile
import unittest
import zipfile

HERE = Path(__file__).parent
split = runpy.run_path(str(HERE / 'split-offline-release.py'))['split']
verify = runpy.run_path(str(HERE / 'verify-offline-release.py'))['verify']


class ReleaseTests(unittest.TestCase):
    def test_source_snapshot_is_complete_committed_source_and_rejects_dirty_trees(self):
        with tempfile.TemporaryDirectory(prefix='release-source-') as temporary:
            root = Path(temporary)
            source = root / 'source'; source.mkdir()
            output = root / 'output'; output.mkdir()
            (source / 'packages/plugin-api').mkdir(parents=True)
            (source / 'packages/plugin-api/index.ts').write_text('export type Release = true', encoding='utf-8')
            (source / 'package.json').write_text('{"version":"1.0.0-test"}', encoding='utf-8')
            def git(*args):
                subprocess.run(['git', *args], cwd=source, check=True, capture_output=True)
            git('init'); git('add', '.')
            git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'test')
            module = runpy.run_path(str(HERE / 'finalize-offline-release.py'))
            snapshot = module['source_snapshot']
            snapshot.__globals__['ROOT'] = source
            snapshot(output)
            with zipfile.ZipFile(output / 'TwilightEcho-1.0.0-test-source.zip') as archive:
                self.assertIn('TwilightEcho-1.0.0-test-source/packages/plugin-api/index.ts', archive.namelist())
            (source / 'package.json').write_text('{"version":"2.0.0-test"}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Commit the release source'):
                snapshot(output)

    def test_checksum_verifier_detects_corruption_and_rejects_path_escape(self):
        with tempfile.TemporaryDirectory(prefix='release-verify-') as temporary:
            root = Path(temporary)
            (root / 'data').write_bytes(b'original')
            manifest = dict(version='test', files=[dict(path='data', bytes=8,
                sha256=hashlib.sha256(b'original').hexdigest())])
            (root / 'release-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            verify(root)
            (root / 'data').write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                verify(root)
            manifest['files'][0]['path'] = '../data'
            (root / 'release-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Unsafe manifest'):
                verify(root)

    @unittest.skipUnless(shutil.which('powershell.exe'), 'Windows merger integration')
    def test_windows_merger_roundtrips_zip_in_unicode_directory_and_refuses_corruption(self):
        with tempfile.TemporaryDirectory(prefix='release-volumes-') as temporary:
            root = Path(temporary) / '发行 校验'
            root.mkdir()
            archive = root / 'TwilightEcho-1.4.0-preview.2-win-x64-full.zip'
            payload = random.Random(42).randbytes(150000)
            with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED) as zipped:
                zipped.writestr('TwilightEcho/说明.txt', payload)
            info = split(archive, 64000)
            self.assertEqual(len(info['parts']), 3)
            self.assertTrue(all(part['bytes'] <= 64000 for part in info['parts']))
            archive.rename(root / 'original.zip')
            command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(root/'Merge-Offline.ps1')]
            merged = subprocess.run(command, capture_output=True)
            self.assertEqual(merged.returncode, 0, merged.stderr.decode('utf-8', errors='replace'))
            with zipfile.ZipFile(archive) as zipped:
                self.assertIsNone(zipped.testzip())
                self.assertEqual(zipped.read('TwilightEcho/说明.txt'), payload)
            archive.unlink()
            part = root / info['parts'][0]['name']
            with part.open('ab') as file:
                file.write(b'corruption')
            failed = subprocess.run(command, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertFalse(archive.exists())


if __name__ == '__main__':
    unittest.main()
