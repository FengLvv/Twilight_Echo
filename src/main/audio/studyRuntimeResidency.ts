import type { StudyRuntimeStatus } from '../../shared/musicStudy.ts'

export const STUDY_GPU_IDLE_MS = 30000
type EventSink = (value: any) => void
interface ResidencyPorts {
  call(method: string, params: object, signal?: AbortSignal, event?: EventSink): Promise<any>
  alive(): boolean
  changed(value: Partial<StudyRuntimeStatus>): void
  failed(error: unknown): void
  schedule(callback: () => void, delay: number): () => void
}

/** Memory housekeeping only; Core remains the sole analysis scheduler. */
export class StudyRuntimeResidency {
  private readonly ports: ResidencyPorts
  private leases = 0
  private demand = false
  private suspended = false
  private parked = true
  private generation = 0
  private timer: (() => void) | null = null
  private offload: { controller: AbortController; done: Promise<void> } | null = null
  constructor(ports: ResidencyPorts) { this.ports = ports }
  private cancelTimer() { this.timer?.(); this.timer = null }
  private placement(value: any) {
    if (!value?.devices) return
    this.parked = !Object.entries(value.devices).some(([name, device]) => name !== 'six' && (device === 'cuda' || device === 'dml' || device === 'mixed'))
    this.ports.changed(value)
  }
  private arm() {
    if (this.suspended || this.parked || this.demand || this.leases || this.timer || this.offload || !this.ports.alive()) return
    const generation = this.generation
    this.timer = this.ports.schedule(() => {
      this.timer = null
      if (generation !== this.generation || this.suspended || this.demand || this.leases || !this.ports.alive()) return
      const controller = new AbortController()
      const offload = { controller, done: Promise.resolve() }
      this.offload = offload
      offload.done = this.ports.call('standby', {}, controller.signal)
        .then(value => { if (generation === this.generation && !this.suspended) this.placement(value) })
        .catch(error => { if (!controller.signal.aborted && generation === this.generation) this.ports.failed(error) })
        .finally(() => { if (this.offload === offload) this.offload = null; this.arm() })
    }, STUDY_GPU_IDLE_MS)
  }
  setDemand(busy: boolean) {
    this.demand = busy
    if (busy) { this.cancelTimer(); this.offload?.controller.abort() }
    else this.arm()
  }
  retain(): () => void {
    this.cancelTimer(); this.offload?.controller.abort(); this.leases++
    let released = false
    return () => {
      if (released) return
      released = true; this.leases--; this.arm()
    }
  }
  async run(method: string, params: object, signal?: AbortSignal, event: EventSink = () => {}): Promise<any> {
    if (this.suspended) throw new Error('分析运行时正在关闭')
    const release = this.retain(), generation = this.generation
    try {
      const result = await this.ports.call(method, params, signal, value => {
        if (generation === this.generation && !this.suspended) this.placement(value?.residency)
        event(value)
      })
      if (generation === this.generation && !this.suspended) this.placement(result)
      return result
    } finally { release() }
  }
  suspend() { this.suspended = true; this.generation++; this.cancelTimer(); this.offload?.controller.abort() }
  resume() { this.suspended = false; this.arm() }
}
