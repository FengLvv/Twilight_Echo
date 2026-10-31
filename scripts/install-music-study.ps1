param(
  [string]$Root = "$env:LOCALAPPDATA\TwilightEcho\music-study-runtime",
  [ValidateSet('cuda','cpu')][string]$Device = 'cuda',
  [string]$UvPath = 'uv'
)
$ErrorActionPreference = 'Stop'
$taskRuntime = Join-Path $Root 'runtime'
$taskPython = Join-Path $taskRuntime 'Scripts\python.exe'
$taskWorker = Join-Path (Split-Path $PSScriptRoot -Parent) 'resources\music-study'
if (!(Get-Command $UvPath -ErrorAction SilentlyContinue)) {
  throw 'Install uv first (winget install astral-sh.uv), or pass -UvPath with its full path.'
}
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Write-Host 'High-accuracy chords use SheetSage2 / MERT-v2 (CC-BY-NC-4.0, noncommercial use only).'
Write-Host 'Chord weights require about 2.8 GB in addition to the separation models.'
if (!(Test-Path -LiteralPath $taskPython)) {
  & $UvPath venv --python 3.11 $taskRuntime
  if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
}
$taskIndex = if ($Device -eq 'cuda') { 'https://download.pytorch.org/whl/cu128' } else { 'https://download.pytorch.org/whl/cpu' }
& $UvPath pip install --python $taskPython torch==2.8.0 torchaudio==2.8.0 --index-url $taskIndex
if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed' }
& $UvPath pip install --python $taskPython -r (Join-Path $taskWorker 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Analysis dependencies installation failed' }
& $taskPython (Join-Path $taskWorker 'download_models.py') (Join-Path $Root 'models')
if ($LASTEXITCODE -ne 0) { throw 'Model preparation failed' }
$taskVocalRuntime = Join-Path $Root 'runtime-vocal2midi'
$taskVocalPython = Join-Path $taskVocalRuntime 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $taskVocalPython)) {
  & $UvPath venv --python 3.11 $taskVocalRuntime
  if ($LASTEXITCODE -ne 0) { throw 'Vocal notation environment creation failed' }
}
$env:PYTHONUTF8 = '1'
& $UvPath pip install --python $taskVocalPython torch==2.8.0 torchaudio==2.8.0 --index-url $taskIndex
if ($LASTEXITCODE -ne 0) { throw 'Vocal PyTorch installation failed' }
& $UvPath pip install --python $taskVocalPython -r (Join-Path $taskWorker 'requirements-vocal.txt')
if ($LASTEXITCODE -ne 0) { throw 'Vocal notation dependencies installation failed' }
& $taskVocalPython (Join-Path $taskWorker 'prepare_vocal_models.py') $Root
if ($LASTEXITCODE -ne 0) { throw 'Vocal notation model preparation failed' }
Write-Host "Analysis environment ready: $Root"
Write-Host 'Open 歌曲分析 → 选择分析环境 and choose this directory.'
