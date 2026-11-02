"""Make GitHub-size chunks of a normal ZIP, with a PowerShell merge launcher."""
from pathlib import Path
import argparse
import hashlib
import json


def split(archive, limit=1800 * 1024**2):
    if limit <= 0:
        raise ValueError('Part size must be positive')
    total = hashlib.sha256()
    chunks = []
    with archive.open('rb') as source:
        while True:
            first = source.read(min(4 * 1024**2, limit))
            if not first:
                break
            index = len(chunks) + 1
            target = archive.with_name(archive.name + f'.{index:03}')
            digest = hashlib.sha256()
            written = 0
            with target.open('xb') as output:
                block = first
                while block:
                    output.write(block); digest.update(block); total.update(block); written += len(block)
                    if written >= limit:
                        break
                    block = source.read(min(4 * 1024**2, limit-written))
            chunks.append(dict(name=target.name, bytes=written, sha256=digest.hexdigest()))
            print(f'Created {target.name}', flush=True)
    manifest = dict(archive=archive.name, bytes=archive.stat().st_size, sha256=total.hexdigest(), parts=chunks)
    (archive.parent / 'offline-volumes.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    (archive.parent / 'Merge-Offline.ps1').write_text(MERGE, encoding='utf-8-sig')
    (archive.parent / 'Merge-Offline.cmd').write_bytes(b'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Merge-Offline.ps1"\r\npause\r\n')
    return manifest


MERGE = '''$ErrorActionPreference = 'Stop'
function Get-ReleaseHash([string]$releaseFile) {
  $releaseReader = [IO.File]::OpenRead($releaseFile)
  $releaseAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($releaseAlgorithm.ComputeHash($releaseReader)).Replace('-', '').ToLowerInvariant() }
  finally { $releaseReader.Dispose(); $releaseAlgorithm.Dispose() }
}
$releaseInfo = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'offline-volumes.json') -Raw | ConvertFrom-Json
if ($releaseInfo.archive -notmatch '^TwilightEcho-[a-zA-Z0-9.-]+-win-x64-full\\.zip$') { throw 'Invalid archive name' }
$releaseOutput = Join-Path $PSScriptRoot $releaseInfo.archive
if (Test-Path -LiteralPath $releaseOutput) {
  if ((Get-ReleaseHash $releaseOutput) -eq $releaseInfo.sha256) { Write-Host 'ZIP already verified. Open it in Explorer to extract.'; exit 0 }
  throw 'A different ZIP already exists. Move it before merging.'
}
foreach ($releasePart in $releaseInfo.parts) {
  if ($releasePart.name -notmatch ('^' + [regex]::Escape($releaseInfo.archive) + '\\.[0-9]{3}$')) { throw 'Invalid part name' }
  $releasePath = Join-Path $PSScriptRoot $releasePart.name
  if ((Get-Item -LiteralPath $releasePath).Length -ne $releasePart.bytes -or (Get-ReleaseHash $releasePath) -ne $releasePart.sha256) { throw "Missing or corrupt part: $($releasePart.name)" }
}
$releaseStream = [IO.File]::Open($releaseOutput, [IO.FileMode]::CreateNew)
try {
  foreach ($releasePart in $releaseInfo.parts) {
    Write-Host "Merging $($releasePart.name)"
    $releaseInput = [IO.File]::OpenRead((Join-Path $PSScriptRoot $releasePart.name))
    try { $releaseInput.CopyTo($releaseStream) } finally { $releaseInput.Dispose() }
  }
} finally { $releaseStream.Dispose() }
if ((Get-ReleaseHash $releaseOutput) -ne $releaseInfo.sha256) { throw 'Merged ZIP checksum mismatch' }
Write-Host 'Complete. Open the verified ZIP in Explorer, extract all files, then run Start.cmd.'
'''


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    print(json.dumps(split(args.archive.resolve())), flush=True)
