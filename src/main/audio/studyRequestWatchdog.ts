export const STUDY_WATCHDOG = {
  heartbeatMs: 30_000,
  startupMs: 180_000,
  warmupMs: 600_000,
  cancelMs: 5_000,
  exitMs: 10_000
}
export class StudyRequestWatchdog {
  private heartbeatAt: number
  private progressAt: number
  private readonly tokens = new Map<string, unknown>()
  private readonly children = new Map<number, { at: number; ready: boolean }>()
  private ready = false
  private cancelledAt: number | null = null
  readonly budgetMs: number
  private startedAt: number
  private readonly policy: typeof STUDY_WATCHDOG
  constructor(now: number, method: string, seconds: number, gpu: boolean, policy = STUDY_WATCHDOG) {
    this.startedAt = this.heartbeatAt = this.progressAt = now
    this.policy = policy
    this.budgetMs =
      method === 'warm'
        ? policy.warmupMs
        : Math.max(gpu ? 180_000 : 600_000, Math.max(0, seconds) * (gpu ? 6_000 : 30_000))
  }
  heartbeat(now: number, token?: unknown, source = 'executor') {
    this.ready = true
    this.heartbeatAt = now
    if (token !== undefined && token !== this.tokens.get(source)) {
      this.tokens.set(source, token)
      this.progressAt = now
    }
  }
  progress(now: number, token: unknown, source = 'event') {
    this.heartbeat(now, token, source)
  }
  childStarted(now: number, pid: number) {
    this.children.set(pid, { at: now, ready: false })
  }
  childHeartbeat(now: number, pid: number, token: unknown) {
    this.children.set(pid, { at: now, ready: true })
    this.progress(now, token, 'child:' + pid)
  }
  childFinished(pid: number) {
    this.children.delete(pid)
  }
  cancel(now: number) {
    this.cancelledAt ??= now
  }
  resume(now: number) {
    this.heartbeatAt = this.progressAt = now
    if (!this.ready) this.startedAt = now
    if (this.cancelledAt !== null) this.cancelledAt = now
    for (const child of this.children.values()) child.at = now
  }
  expired(now: number): string | null {
    if (this.cancelledAt !== null && now - this.cancelledAt >= this.policy.cancelMs)
      return '分析任务未响应取消'
    if (!this.ready && now - this.startedAt >= this.policy.startupMs) return '分析运行时启动超时'
    if (this.ready && now - this.heartbeatAt >= this.policy.heartbeatMs) return '分析运行时心跳中断'
    for (const child of this.children.values())
      if (now - child.at >= (child.ready ? this.policy.heartbeatMs : this.policy.startupMs))
        return '人声分析运行时心跳中断'
    if (now - this.progressAt >= this.budgetMs) return '分析阶段长时间没有进展'
    return null
  }
}
