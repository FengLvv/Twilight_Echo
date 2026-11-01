import { DEFAULT_STUDY_CACHE_POLICY, type StudyAudioGroup, type StudyCacheStatus } from '../../shared/musicStudy.ts'
import type { StudyRecord } from './musicStudyService.ts'

export interface StudyAudioCachePorts {
  inventory(): Promise<StudyAudioGroup[]>
  remove(group: StudyAudioGroup): Promise<void>
  record(id: string): StudyRecord | undefined
  save(record: StudyRecord): Promise<void>
  resultBytes(): Promise<number>
  now(): number
}

/** Core serializes disk reservations, leases and eviction in the same lane. */
export class CoreStudyAudioCache {
  policy = { ...DEFAULT_STUDY_CACHE_POLICY }
  private leases = new Map<string, number>()
  private reservations = new Map<string, number>()
  private lane: Promise<unknown> = Promise.resolve()
  private nextId: string | null = null
  private readonly ports: StudyAudioCachePorts
  constructor(ports: StudyAudioCachePorts) { this.ports = ports }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const work = this.lane.then(action); this.lane = work.catch(() => {}); return work
  }
  protectNext(id: string | null) { this.nextId = id }
  private protected(id: string) { return !!this.leases.get(id) || this.reservations.has(id) || this.nextId === id }
  private access(group: StudyAudioGroup) { return this.ports.record(group.id)?.audioAccess?.[group.kind] ?? 0 }
  private async evict(group: StudyAudioGroup) {
    await this.ports.remove(group)
    const record = this.ports.record(group.id)
    if (record?.result) {
      record.result.ready = record.result.ready.filter(stage => stage !== group.kind)
      const removed = group.kind === 'six' ? ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] : group.kind === 'leadBacking' ? ['lead', 'backing'] : ['singerA', 'singerB']
      record.result.stems = record.result.stems.filter(stem => !removed.includes(stem))
      if (group.kind === 'leadBacking') record.leadBacking = false
      if (group.kind === 'twoSingers') record.twoSingers = false
      if (record.stages?.[group.kind]) record.stages[group.kind] = { status: 'idle', progress: 0 }
      await this.ports.save(record)
    }
  }
  acquire(id: string): Promise<() => void> {
    return this.serial(async () => {
      this.leases.set(id, (this.leases.get(id) ?? 0) + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const count = (this.leases.get(id) ?? 1) - 1
        if (count) this.leases.set(id, count); else this.leases.delete(id)
      }
    })
  }
  touch(id: string, kinds: StudyAudioGroup['kind'][] = ['six']) {
    const record = this.ports.record(id)
    if (!record) return
    record.audioAccess ??= {}
    for (const kind of kinds) record.audioAccess[kind] = this.ports.now()
  }
  reserve(id: string, estimate: number, signal?: AbortSignal): Promise<number> {
    return this.serial(async () => {
      signal?.throwIfAborted()
      const groups = await this.ports.inventory()
      const totals = new Map<string, number>()
      for (const group of groups) totals.set(group.id, (totals.get(group.id) ?? 0) + group.bytes)
      for (const [reservedId, bytes] of this.reservations) totals.set(reservedId, Math.max(totals.get(reservedId) ?? 0, bytes))
      let other = [...totals].filter(([key]) => key !== id).reduce((sum, [, bytes]) => sum + bytes, 0)
      const candidates = groups.filter(g => g.id !== id && !this.protected(g.id)).sort((a, b) => this.access(a) - this.access(b))
      for (const group of candidates) {
        if (this.policy.limitBytes - other >= estimate) break
        signal?.throwIfAborted()
        await this.evict(group); other -= group.bytes
      }
      signal?.throwIfAborted()
      const budget = this.policy.limitBytes - other
      const own = groups.filter(g => g.id === id).reduce((sum, g) => sum + g.bytes, 0)
      if (budget < Math.max(estimate, own)) throw new Error('音频缓存容量不足，请调整缓存上限或结束正在使用的分轨')
      this.reservations.set(id, budget)
      return budget
    })
  }
  releaseReservation(id: string) { this.reservations.delete(id) }
  async trim(clear = false) {
    return this.serial(async () => {
      const groups = await this.ports.inventory()
      let used = groups.reduce((sum, group) => sum + group.bytes, 0)
      for (const group of groups.sort((a, b) => this.access(a) - this.access(b))) {
        const committed = this.ports.record(group.id)?.result?.ready.includes(group.kind)
        if (this.protected(group.id) || !clear && committed && used <= this.policy.limitBytes) continue
        await this.evict(group); used -= group.bytes
      }
    })
  }
  async status(): Promise<StudyCacheStatus> {
    await this.lane
    const groups = await this.ports.inventory()
    const current = new Map<string, number>()
    for (const group of groups) current.set(group.id, (current.get(group.id) ?? 0) + group.bytes)
    return { ...this.policy, usedBytes: groups.reduce((sum, group) => sum + group.bytes, 0),
      reservedBytes: [...this.reservations].reduce((sum, [id, bytes]) => sum + Math.max(0, bytes - (current.get(id) ?? 0)), 0),
      protectedBytes: groups.filter(group => this.protected(group.id)).reduce((sum, group) => sum + group.bytes, 0),
      resultBytes: await this.ports.resultBytes() }
  }
}
