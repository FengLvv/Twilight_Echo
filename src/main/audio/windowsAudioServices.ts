import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
type Execute = (file: string, args: string[], options: {
  windowsHide: boolean
  timeout: number
  maxBuffer: number
}) => Promise<unknown>

// Only the two named Windows services are touched. Stop() refuses unrelated
// running dependents; finally attempts to bring both services back even on error.
export const WINDOWS_AUDIO_RESTART_SCRIPT = `
$ErrorActionPreference = 'Stop'
$failed = $false
$audio = Get-Service -Name 'Audiosrv'
$endpoints = Get-Service -Name 'AudioEndpointBuilder'
$deadline = [TimeSpan]::FromSeconds(15)
try {
  foreach ($service in @($audio, $endpoints)) {
    $service.Refresh()
    if ($service.Status -ne 'Stopped') { $service.Stop() }
    $service.WaitForStatus('Stopped', $deadline)
  }
} catch {
  $failed = $true
} finally {
  foreach ($service in @($endpoints, $audio)) {
    try {
      $service.Refresh()
      if ($service.Status -eq 'StopPending') { $service.WaitForStatus('Stopped', $deadline) }
      $service.Refresh()
      if ($service.Status -ne 'Running' -and $service.Status -ne 'StartPending') { $service.Start() }
      $service.WaitForStatus('Running', $deadline)
    } catch {
      $failed = $true
    }
  }
}
if ($failed) { exit 1 }
exit 0
`.trim()

export async function restartWindowsAudioServices(options: {
  platform?: string
  execute?: Execute
} = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32')
    throw Object.assign(new Error('Windows audio service restart is unavailable'), { code: 'UNSUPPORTED_PLATFORM' })
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const encoded = Buffer.from(WINDOWS_AUDIO_RESTART_SCRIPT, 'utf16le').toString('base64')
  // EncodedCommand is fixed application code, never a renderer-supplied command.
  // Propagate the elevated child's exit code instead of trusting Start-Process.
  const elevation = `
$ErrorActionPreference = 'Stop'
try {
  $job = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}'
  exit $job.ExitCode
} catch {
  if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { exit 2 }
  exit 1
}`.trim()
  try {
    await (options.execute ?? execute)(
      powershell,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(elevation, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 180_000, maxBuffer: 64 * 1024 }
    )
  } catch (error) {
    const result = error as { code?: number | string; killed?: boolean }
    const code = result.killed ? 'AUDIO_SERVICES_TIMEOUT' : result.code === 2 ? 'CANCELLED' : 'AUDIO_SERVICES_FAILED'
    throw Object.assign(new Error(code), { code })
  }
}
