param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [string]$Root = "$env:LOCALAPPDATA\TwilightEcho\music-study-runtime"
)
$ErrorActionPreference = 'Stop'
$taskSpecification = Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'resources/music-study/lyric_line_models.json') -Raw | ConvertFrom-Json
$taskSource = (Resolve-Path -LiteralPath $SourceDirectory).Path
foreach ($taskEntry in $taskSpecification.files.PSObject.Properties) {
  $taskFile = Join-Path $taskSource $taskEntry.Name
  if (!(Test-Path -LiteralPath $taskFile) -or (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskEntry.Value) {
    throw "Lyric-line model checksum mismatch: $($taskEntry.Name)"
  }
}
$taskDestination = Join-Path ([IO.Path]::GetFullPath($Root)) "models/$($taskSpecification.directory)"
New-Item -ItemType Directory -Force -Path $taskDestination | Out-Null
foreach ($taskEntry in $taskSpecification.files.PSObject.Properties) {
  Copy-Item -LiteralPath (Join-Path $taskSource $taskEntry.Name) -Destination (Join-Path $taskDestination $taskEntry.Name) -Force
}
if (Test-Path -LiteralPath (Join-Path $taskSource 'README.md')) {
  Copy-Item -LiteralPath (Join-Path $taskSource 'README.md') -Destination (Join-Path $taskDestination 'README.md') -Force
}
Write-Host "Lyric-line model installed: $taskDestination"
