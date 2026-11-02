import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join, toNamespacedPath } from 'node:path'
import { StudyProcessTree } from './studyProcessTree.ts'
import { StudyRequestWatchdog, STUDY_WATCHDOG } from './studyRequestWatchdog.ts'

type Pending = {
  resolve(value: any): void
  reject(error: Error): void
  event(value: any): void
  dispose(): void
  clock: StudyRequestWatchdog
  active: boolean
  cause?: Error
}

/** A transport only. Core schedules jobs; the process retains its model objects. */
export class StudyResidentProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private closing: Promise<void> | null = null
  private generation = 0
  private errors = ''
  private tree: StudyProcessTree | null = null
  private monitor: ReturnType<typeof setInterval> | null = null
  private processReady = false
  private gpu = false
  private blocked: Error | null = null
  private readonly python: () => string
  private readonly script: string
  private readonly diagnostic: (message: string) => void
  constructor(
    python: () => string,
    script: string,
    diagnostic: (message: string) => void = () => {},
    private readonly componentPaths: () => import('../../shared/studyComponents.ts').StudyRuntimePaths = () => ({ models: {} })
  ) {
    this.python = python
    this.script = script
    this.diagnostic = diagnostic
  }
  get pid() {
    return this.child?.pid ?? null
  }
  get recoveryBlocked() {
    return this.blocked !== null
  }
  resumeWatchdog() {
    const now = Date.now()
    for (const request of this.pending.values()) request.clock.resume(now)
  }
  get generationId() {
    return this.generation
  }
  private start() {
    if (this.blocked) throw this.blocked
    if (this.child) return this.child
    if (this.closing) throw new Error('分析运行时正在关闭')
    const generation = ++this.generation
    const bootstrap = 'import sys;sys.path.insert(0,sys.argv.pop(1));from study_bootstrap import run;run()'
    const args = existsSync(join(dirname(this.script), 'study_bootstrap.py'))
      ? ['-X', 'utf8', '-u', '-c', bootstrap, dirname(this.script), this.script]
      : ['-X', 'utf8', '-u', this.script]
    const executable = this.python()
    const child = spawn(process.platform === 'win32' ? toNamespacedPath(executable) : executable, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TWILIGHT_STUDY_COMPONENT_PATHS: JSON.stringify(this.componentPaths()),
        PYTHONUTF8: '1',
        PYTHONNOUSERSITE: '1',
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        OMP_NUM_THREADS: '4',
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1'
      }
    })
    this.child = child
    this.tree = new StudyProcessTree(child)
    this.processReady = false
    this.monitor = setInterval(() => {
      for (const request of this.pending.values()) {
        if (!request.active && this.processReady) continue
        const reason = request.clock.expired(Date.now())
        if (reason) {
          void this.recover(new Error(reason)).catch((error) => this.diagnostic(String(error)))
          break
        }
      }
    }, 1000)
    this.monitor.unref()
    this.errors = ''
    let buffered = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (block: string) => {
      if (generation !== this.generation || this.closing) return
      buffered += block
      if (buffered.length > 32 * 1024 ** 2) {
        void this.recover(new Error('分析运行时输出超出限制')).catch((error) =>
          this.diagnostic(String(error))
        )
        return
      }
      let end: number
      while ((end = buffered.indexOf('\n')) >= 0) {
        if (generation !== this.generation || this.closing) return
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        let value: any
        try {
          value = JSON.parse(line)
        } catch {
          continue
        }
        if (value.kind === 'heartbeat' || value.kind === 'started') {
          this.processReady = true
          const active = this.pending.get(value.requestId)
          if (active) {
            if (!active.active) {
              active.active = true
              active.clock.resume(Date.now())
            }
            active.clock.heartbeat(Date.now(), value.progressToken)
          }
          continue
        }
        const request = this.pending.get(value.id)
        if (!request) continue
        if (value.event) {
          if (value.event.kind === 'childStarted') {
            this.tree?.register(value.event.pid)
            request.clock.childStarted(Date.now(), value.event.pid)
          }
          if (value.event.kind === 'runtimeHeartbeat')
            request.clock.childHeartbeat(Date.now(), value.event.pid, value.event.progressToken)
          if (value.event.kind === 'childFinished') request.clock.childFinished(value.event.pid)
          if (value.event.kind === 'progress')
            request.clock.progress(
              Date.now(),
              JSON.stringify([value.event.phase, value.event.stage, value.event.progress])
            )
          try {
            request.event(value.event)
          } catch (error) {
            request.cause = error instanceof Error ? error : new Error(String(error))
            request.clock.cancel(Date.now())
            child.stdin.write(JSON.stringify({ method: 'cancel', target: value.id }) + '\n')
          }
        } else {
          this.pending.delete(value.id)
          request.dispose()
          if (request.cause) request.reject(request.cause)
          else if (value.error)
            request.reject(
              Object.assign(new Error(value.error), {
                code: value.cancelled ? 'CANCELLED' : 'ANALYSIS_FAILED'
              })
            )
          else {
            if (typeof value.result?.gpu === 'boolean') this.gpu = value.result.gpu
            request.resolve(value.result)
          }
        }
      }
    })
    child.stderr.on('data', (block) => {
      const message = block.toString('utf8')
      this.errors = (this.errors + message).slice(-6000)
      this.diagnostic(message)
    })
    const failed = (error: Error) => {
      if (generation === this.generation && !this.closing)
        void this.recover(error).catch((error) => this.diagnostic(String(error)))
    }
    child.on('error', failed)
    child.on('close', () => failed(new Error(this.errors || '分析运行时已退出')))
    child.stdin.on('error', failed)
    return child
  }
  private fail(error: Error) {
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const request of requests) {
      request.dispose()
      request.reject(error)
    }
  }
  async call(
    method: string,
    params: object,
    signal?: AbortSignal,
    event: (value: any) => void = () => {}
  ): Promise<any> {
    if (this.closing) await this.closing
    signal?.throwIfAborted()
    if (this.pending.size >= 32) throw new Error('分析运行时请求过多')
    const child = this.start(),
      id = randomUUID()
    const serialized = JSON.stringify({ id, method, params }) + '\n'
    if (serialized.length > 32 * 1024 ** 2) throw new Error('分析请求超出限制')
    return new Promise((resolve, reject) => {
      const clock = new StudyRequestWatchdog(
        Date.now(),
        method,
        Number((params as any).expectedDuration ?? (params as any).previous?.duration ?? 180),
        this.gpu
      )
      const abort = () => {
        const request = this.pending.get(id)
        if (request)
          request.cause = Object.assign(new Error('分析任务已取消'), { code: 'CANCELLED' })
        clock.cancel(Date.now())
        if (!child.stdin.destroyed)
          child.stdin.write(JSON.stringify({ method: 'cancel', target: id }) + '\n')
      }
      this.pending.set(id, {
        resolve,
        reject,
        event,
        clock,
        active: false,
        dispose: () => signal?.removeEventListener('abort', abort)
      })
      signal?.addEventListener('abort', abort, { once: true })
      child.stdin.write(serialized, (error) => {
        if (error) void this.recover(error).catch((failure) => this.diagnostic(String(failure)))
      })
      if (signal?.aborted) abort()
    })
  }
  private recover(reason: Error): Promise<void> {
    return this.close(reason, reason.message === '分析任务未响应取消' ? 0 : STUDY_WATCHDOG.cancelMs)
  }
  async close(
    reason = new Error('分析运行时已关闭'),
    graceMs = STUDY_WATCHDOG.cancelMs
  ): Promise<void> {
    if (this.closing) return this.closing
    const child = this.child,
      tree = this.tree
    if (!child || !tree) return
    this.closing = (async () => {
      if (this.monitor) clearInterval(this.monitor)
      this.monitor = null
      const exited = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve()
        else child.once('close', () => resolve())
      })
      if (!child.stdin.destroyed) child.stdin.end()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, graceMs)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
      try {
        await tree.terminate(STUDY_WATCHDOG.exitMs)
        this.child = null
        this.tree = null
        this.blocked = null
        this.generation++
        this.fail(Object.assign(reason, { code: 'RUNTIME_INTERRUPTED' }))
      } catch (error) {
        this.blocked = error instanceof Error ? error : new Error(String(error))
        this.fail(this.blocked)
        throw this.blocked
      }
    })().finally(() => {
      this.closing = null
    })
    return this.closing
  }
}
