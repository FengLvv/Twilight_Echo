import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const execute = promisify(execFile)
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const exists = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Identity is captured while the child is ours; reused descendant PIDs are never terminated. */
export class StudyProcessTree {
  private readonly descendants = new Map<number, Promise<string | null>>()
  private readonly child: ChildProcessWithoutNullStreams
  private readonly spawnedAt = Date.now()
  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
  }
  private async identity(pid: number, deadline = Date.now() + 5000): Promise<string | null> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null
    if (process.platform !== 'win32') return exists(pid) ? String(pid) : null
    const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if($p){[string]$p.ParentProcessId+'|'+$p.CreationDate.ToUniversalTime().ToString('o')}`
    const { stdout } = await execute(
      join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      ),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: Math.max(1, Math.min(5000, deadline - Date.now())) }
    )
    return stdout.trim() || null
  }
  register(pid: number) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || this.descendants.has(pid)) return
    this.descendants.set(
      pid,
      this.identity(pid)
        .then((value) => {
          if (process.platform !== 'win32') return value
          const [parent, birth] = (value ?? '').split('|')
          return Number(parent) === this.child.pid && Date.parse(birth) >= this.spawnedAt - 2000
            ? value
            : null
        })
        .catch(() => null)
    )
  }
  async terminate(timeoutMs: number) {
    const child = this.child,
      end = Date.now() + timeoutMs
    if (process.platform === 'win32') {
      const kill = async (pid: number) => {
        await execute(
          join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
          ['/PID', String(pid), '/T', '/F'],
          { windowsHide: true, timeout: Math.max(100, end - Date.now()) }
        ).catch(() => {})
      }
      if (child.pid && child.exitCode === null && child.signalCode === null) await kill(child.pid)
      for (const [pid, identity] of this.descendants) {
        const original = await identity
        if (
          Date.now() < end &&
          original &&
          (await this.identity(pid, end).catch(() => null)) === original
        )
          await kill(pid)
      }
    } else if (child.pid) {
      // Vocal children inherit this session/group, including engraver descendants.
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        if (child.exitCode === null) child.kill('SIGKILL')
      }
    }
    while (Date.now() < end) {
      let alive = child.exitCode === null && child.signalCode === null
      for (const [pid, captured] of this.descendants) {
        const original = await captured
        if (exists(pid)) {
          if (!original) alive = true
          else {
            const current = await this.identity(pid, end).catch(() => undefined)
            if (current === undefined || current === original) alive = true
          }
        }
      }
      if (!alive) return
      await delay(50)
    }
    throw Object.assign(new Error('无法确认分析进程树已退出'), { code: 'RUNTIME_EXIT_UNCONFIRMED' })
  }
}
