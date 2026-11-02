import { computed, onMounted, onBeforeUnmount, shallowRef, ref } from 'vue'
import { useCoreConnection } from './coreConnection.ts'
import { componentIds, componentBusy, planComponents, STUDY_FEATURE_TITLES, type StudyComponentState, type StudyComponentPlan, type StudyFeature } from '../../../shared/studyComponents.ts'

const state = shallowRef<StudyComponentState | null>(null)
const error = ref(''), selected = shallowRef<StudyComponentPlan | null>(null)
let users = 0, timer: ReturnType<typeof setTimeout> | undefined, reading = false
export const componentPhaseLabel: Record<string, string> = {
  missing: '未安装', queued: '等待中', downloading: '下载中', verifying: '校验中', installing: '安装中',
  ready: '已安装', paused: '已暂停', interrupted: '等待继续', failed: '安装失败', cancelled: '已取消'
}
export function componentSize(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`
}
export function useStudyComponents() {
  const core = useCoreConnection()
  async function refresh() {
    if (reading) return
    reading = true
    try { state.value = await core.query('study.components', {}) || null; error.value = '' }
    catch (e) { error.value = e instanceof Error ? e.message : String(e) }
    finally { reading = false }
  }
  async function poll() {
    await refresh()
    if (users) timer = setTimeout(poll, state.value?.components.some(item => componentBusy(item.phase)) ? 700 : 2500)
  }
  onMounted(() => { if (++users === 1) void poll() })
  onBeforeUnmount(() => { if (--users === 0) clearTimeout(timer) })
  async function run(action: () => Promise<unknown>) {
    error.value = ''
    try { await action(); await refresh() }
    catch (e) { error.value = e instanceof Error ? e.message : String(e); throw e }
  }
  function featureReady(feature: StudyFeature) {
    return componentIds([feature]).every(id => state.value?.components.find(item => item.id === id)?.phase === 'ready')
  }
  async function request(features: StudyFeature[]) {
    await refresh()
    if (state.value) selected.value = planComponents(state.value, features)
  }
  return { state, error, selected, refresh, run, request, featureReady,
    featureTitles: STUDY_FEATURE_TITLES,
    task: (id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') => run(() => core.command('study.componentTask', { id, action })),
    active: computed(() => state.value?.components.filter(item => componentBusy(item.phase)).length ?? 0),
    tasks: computed(() => state.value?.components.filter(item => !['missing', 'ready'].includes(item.phase)) ?? []),
    install: (features: StudyFeature[]) => run(() => core.command('study.componentInstall', { features })),
    remove: (id: string) => run(() => core.command('study.componentRemove', { id })),
    directory: () => run(() => core.command('study.componentDirectory', {})),
    import: () => run(() => core.command('study.componentImport', {})),
    dismiss: (owner: string) => run(() => core.command('study.componentDismiss', { owner }))
  }
}
