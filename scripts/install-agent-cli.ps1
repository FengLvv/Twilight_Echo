param(
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'TwilightEchoCLI'),
  [string]$WheelsDirectory = (Join-Path $PSScriptRoot 'cli'),
  [string]$Python = 'python',
  [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($InstallDirectory)
$wheels = [IO.Path]::GetFullPath($WheelsDirectory)
if (-not (Test-Path -LiteralPath $wheels -PathType Container)) { throw "Wheel directory does not exist: $wheels" }
if (-not (Get-ChildItem -LiteralPath $wheels -Filter 'cli_anything_twilightecho-*.whl')) { throw 'Twilight Echo CLI wheel is missing' }
$runtime = Join-Path $target 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $runtime)) {
  & $Python -m venv $target
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required to create the CLI environment' }
}
& $runtime -m pip install --upgrade --force-reinstall --no-index --find-links $wheels cli-anything-twilightecho
if ($LASTEXITCODE -ne 0) { throw 'CLI installation failed' }
$bin = Join-Path $target 'Scripts'
if (-not $NoPath) {
  $oldPath = [string][Environment]::GetEnvironmentVariable('Path','User')
  $present = @($oldPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') }).Count -gt 0
  if (-not $present) { [Environment]::SetEnvironmentVariable('Path',($oldPath.TrimEnd(';') + ';' + $bin),'User') }
}
& (Join-Path $bin 'cli-anything-twilightecho.exe') --version
Write-Host "CLI installed: $(Join-Path $bin 'cli-anything-twilightecho.exe')"
Write-Host 'Open a new terminal to inherit user PATH. Run app start --executable with the CLI-enabled player.'
