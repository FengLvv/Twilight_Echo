import { planComponents, componentBusy, type StudyComponentState, type StudyComponentIO, type StudyFeature } from '../../shared/studyComponents.ts'

/** Core admits installation and retains consent requests; the platform only performs fixed IO. */
export class CoreStudyComponentsService {
  private pending = new Map<string, { title: string; features: StudyFeature[]; interactive: boolean }>()
  private dismissed = new Set<string>()
  private accepted = new Set<string>()
  private readonly io: (request: StudyComponentIO) => Promise<StudyComponentState>
  private readonly changed: () => void
  constructor(io: (request: StudyComponentIO) => Promise<StudyComponentState>, changed: () => void) { this.io = io; this.changed = changed }
  async state(): Promise<StudyComponentState> {
    const state = await this.io({ action: 'state' })
    state.requests = [...this.pending].flatMap(([owner, request]) => {
      const plan = planComponents(state, request.features)
      if (!plan.ids.length) { this.pending.delete(owner); return [] }
      if (plan.ids.every(id => componentBusy(state.components.find(item => item.id === id)?.phase ?? 'missing'))) return []
      return [{ owner, title: request.title, interactive: request.interactive, plan }]
    })
    return state
  }
  async require(features: StudyFeature[], owner: string, title: string, interactive: boolean): Promise<boolean> {
    const state = await this.state()
    if (!state.supported) throw new Error('分析组件目前支持 Windows x64')
    const plan = planComponents(state, features)
    if (!plan.ids.length) { this.pending.delete(owner); return true }
    interactive = interactive && !this.accepted.has(owner)
    if (!this.dismissed.has(owner) && (JSON.stringify(this.pending.get(owner)) !== JSON.stringify({ title, features, interactive }))) {
      this.pending.set(owner, { title, features, interactive }); this.changed()
    }
    return false
  }
  async plan(features: StudyFeature[]) { return planComponents(await this.state(), features) }
  async install(features: StudyFeature[]) {
    const state = await this.state()
    if (!state.supported) throw new Error('分析组件目前支持 Windows x64')
    const plan = planComponents(state, features)
    if (plan.ids.length) await this.io({ action: 'start', ids: plan.ids })
    const accepted = new Set(features)
    for (const [owner, request] of this.pending) if (request.features.every(feature => accepted.has(feature))) {
      this.pending.delete(owner); this.accepted.add(owner)
    }
    this.changed()
    return this.state()
  }
  release(owner: string) { this.pending.delete(owner); this.dismissed.delete(owner); this.accepted.delete(owner) }
  dismiss(owner: string) { this.pending.delete(owner); this.dismissed.add(owner); this.changed() }
  async action(request: StudyComponentIO) { await this.io(request); this.changed(); return this.state() }
}
