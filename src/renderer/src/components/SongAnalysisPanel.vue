<script setup lang="ts">
import { computed, defineAsyncComponent, ref, onMounted, onBeforeUnmount } from 'vue'
import type { StudyMix, StudyProject, StudyTrack } from '../../../shared/musicStudy.ts'
import { studyReady } from '../../../shared/musicStudy.ts'
import PlayerControlIcon from './player-bar/PlayerControlIcon.vue'
import AppearancePopover from './AppearancePopover.vue'
const Extras = defineAsyncComponent(() => import('./SongAnalysisExtras.vue'))
const props = defineProps<{
  project: StudyProject | null
  mode: StudyMix['mode']
  tracks: StudyMix['tracks']
  error?: string
  position: number
}>()
const emit = defineEmits<{
  change: []
  family: [mode: StudyMix['mode']]
  split: [kind: 'leadBacking' | 'twoSingers']
  environment: []
}>()
const more = ref(false)
const root = ref<HTMLElement | null>(null),
  extraWidth = ref(0)
let observer: ResizeObserver | undefined
function measure() {
  const anchor = root.value?.parentElement
  if (!anchor) return
  const box = anchor.getBoundingClientRect(),
    scale = box.width / (anchor.clientWidth || box.width || 1)
  extraWidth.value = Math.max(0, Math.min(100, (box.left - 24) / (scale || 1)))
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (root.value?.parentElement) observer.observe(root.value.parentElement)
  window.addEventListener('resize', measure)
  measure()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
})
const splitOpen = ref(false),
  splitAnchor = ref<HTMLElement | null>(null)
function setSplitAnchor(element: unknown) {
  splitAnchor.value = element instanceof HTMLElement ? element : null
}
const names: Record<StudyTrack, string> = {
  original: '原曲',
  vocals: '人声',
  drums: '鼓',
  bass: '贝斯',
  guitar: '吉他',
  piano: '钢琴',
  other: '其他乐器',
  lead: '主唱',
  backing: '和声',
  singerA: '歌手 A',
  singerB: '歌手 B'
}
const rows = computed<StudyTrack[]>(
  () =>
    [
      'vocals',
      ...(props.mode === 'leadBacking'
        ? ['lead', 'backing']
        : props.mode === 'twoSingers'
          ? ['singerA', 'singerB']
          : []),
      'drums',
      'bass',
      'guitar',
      'piano',
      'other'
    ] as StudyTrack[]
)
const ready = computed(() => studyReady(props.project?.result, 'six'))
const running = computed(() => ['running', 'queued'].includes(props.project?.status ?? ''))
function setting(track: StudyTrack) {
  return props.tracks[track] ?? (props.tracks[track] = { gain: 1, mute: false, solo: false })
}
function toggle(track: StudyTrack, key: 'mute' | 'solo') {
  setting(track)[key] = !setting(track)[key]
  emit('change')
}
function split(kind: 'leadBacking' | 'twoSingers') {
  splitOpen.value = false
  emit('split', kind)
}
</script>
<template>
  <section
    ref="root"
    class="song-analysis-panel"
    :style="{ '--analysis-extra-width': `${extraWidth}px` }"
    aria-label="歌曲分轨混音"
    @contextmenu.stop
  >
    <header v-if="ready">
      <button
        type="button"
        class="icon-button analysis-icon"
        aria-label="分析结果更多操作"
        title="更多操作"
        @click="more = true"
      >
        <i class="pi pi-ellipsis-h" aria-hidden="true" />
      </button>
    </header>
    <p v-if="error || project?.error" role="alert" class="study-error">
      {{ error || project?.error }} <button @click="emit('environment')">分析环境</button>
    </p>
    <div v-if="running && !ready" class="analysis-stage" role="status">
      <span>{{ project?.stage }}</span
      ><span>{{ Math.round((project?.progress ?? 0) * 100) }}%</span
      ><progress :value="project?.progress ?? 0" max="1" />
    </div>
    <p v-else-if="!ready && !error && !project?.error" class="analysis-stage">准备分析…</p>
    <div class="stem-rows" :aria-busy="!ready">
      <div
        v-for="track in rows"
        :key="track"
        class="stem-row"
        :class="{
          'stem-child': ['lead', 'backing', 'singerA', 'singerB'].includes(track),
          'stem-vocals': track === 'vocals'
        }"
        role="group"
        :aria-label="names[track]"
      >
        <div class="stem-heading">
          <strong>{{ names[track] }}</strong>
          <template v-if="track === 'vocals' && ready">
            <select
              v-if="
                studyReady(project?.result, 'leadBacking') ||
                studyReady(project?.result, 'twoSingers')
              "
              :value="mode"
              aria-label="人声结构"
              @change="
                emit('family', ($event.target as HTMLSelectElement).value as StudyMix['mode'])
              "
            >
              <option value="instruments">总人声</option>
              <option v-if="studyReady(project?.result, 'leadBacking')" value="leadBacking">
                主唱／和声
              </option>
              <option v-if="studyReady(project?.result, 'twoSingers')" value="twoSingers">
                歌手 A／B
              </option>
            </select>
            <button
              :ref="setSplitAnchor"
              type="button"
              class="ghost-button vocal-split"
              :aria-expanded="splitOpen"
              aria-haspopup="dialog"
              @click="splitOpen = !splitOpen"
            >
              多人声拆分 <i class="pi pi-angle-down" aria-hidden="true" />
            </button>
          </template>
        </div>
        <div class="stem-controls">
          <button
            type="button"
            class="icon-button analysis-icon"
            :disabled="!ready"
            :aria-label="names[track] + '独听'"
            title="独听"
            :aria-pressed="setting(track).solo"
            @click="toggle(track, 'solo')"
          >
            <i class="pi pi-headphones" aria-hidden="true" /></button
          ><button
            type="button"
            class="icon-button analysis-icon"
            :disabled="!ready"
            :aria-label="names[track] + '静音'"
            title="静音"
            :aria-pressed="setting(track).mute"
            @click="toggle(track, 'mute')"
          >
            <PlayerControlIcon :name="setting(track).mute ? 'muted' : 'volume'" /></button
          ><input
            v-model.number="setting(track).gain"
            :disabled="!ready"
            :aria-label="names[track] + '音量'"
            type="range"
            min="0"
            max="2"
            step="0.01"
            :style="{ '--range-value': `${setting(track).gain * 50}%` }"
            :aria-valuetext="
              setting(track).gain === 0
                ? '静音'
                : `${(20 * Math.log10(setting(track).gain)).toFixed(1)} dB`
            "
            @input="emit('change')"
          /><output
            >{{
              setting(track).gain === 0 ? '−∞' : (20 * Math.log10(setting(track).gain)).toFixed(1)
            }}
            dB</output
          >
        </div>
      </div>
    </div>
    <AppearancePopover
      :open="splitOpen"
      :anchor="splitAnchor"
      label="多人声拆分"
      @close="splitOpen = false"
      ><div class="split-options">
        <button type="button" class="ghost-button" @click="split('leadBacking')">
          主唱／和声分离</button
        ><button type="button" class="ghost-button" @click="split('twoSingers')">双歌手分离</button>
      </div></AppearancePopover
    >
    <Extras v-if="more && project" :project="project" @close="more = false" />
  </section>
</template>
<style scoped>
.song-analysis-panel {
  position: absolute;
  inset: 0 0 0 auto;
  width: calc(100% + var(--analysis-extra-width, 0px));
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  border: 0;
  padding: 0 10px 0 0;
  background: transparent;
  color: var(--te-playback-track-title, rgba(255, 255, 255, 0.92));
  scrollbar-width: thin;
}
.stem-rows {
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  flex: 1;
}
header,
.stem-heading,
.stem-controls,
.analysis-stage {
  display: flex;
  align-items: center;
  gap: 8px;
}
header {
  justify-content: flex-end;
  margin-bottom: 8px;
  padding: 0 0 8px;
  flex: none;
  background: transparent;
}
.song-analysis-panel button,
.song-analysis-panel select {
  font: inherit;
  color: inherit;
  border: 0;
  background: transparent;
  border-radius: var(--te-control-radius-md);
  padding: 6px 9px;
  cursor: pointer;
  font-size: 12px;
  min-height: 32px;
}
.song-analysis-panel button:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.song-analysis-panel button[aria-pressed='true'] {
  color: var(--te-playback-track-title, #fff);
  background: color-mix(in srgb, currentColor 18%, transparent);
}
.song-analysis-panel button:disabled {
  opacity: 0.4;
  cursor: default;
}
.song-analysis-panel :focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.stem-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.stem-vocals {
  grid-template-columns: 1fr;
  gap: 5px;
  padding-top: 0;
}
.stem-vocals .stem-heading {
  margin-bottom: 0;
}
.stem-vocals .stem-controls {
  margin-left: 76px;
}
.stem-heading {
  min-height: 26px;
  margin-bottom: 6px;
}
.stem-heading strong {
  font-size: 14px;
  font-weight: 600;
  margin-right: auto;
  white-space: nowrap;
}
.stem-controls input {
  color: inherit;
  width: 100%;
  min-width: 28px;
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    currentColor var(--range-value),
    color-mix(in srgb, currentColor 18%, transparent) var(--range-value)
  );
  cursor: pointer;
}
.stem-controls input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: currentColor;
  border: 0;
}
.stem-controls input::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: currentColor;
  border: 0;
}
.stem-controls output {
  font-size: 12px;
  min-width: 53px;
  opacity: 0.7;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.stem-controls button {
  flex: none;
}
.song-analysis-panel .analysis-icon {
  width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
  font-size: 18px;
  opacity: 0.65;
}
.song-analysis-panel .analysis-icon:hover,
.song-analysis-panel .analysis-icon[aria-pressed='true'] {
  opacity: 1;
}
.song-analysis-panel select {
  max-width: 135px;
  padding: 3px 4px;
  opacity: 0.75;
}
.song-analysis-panel select option {
  color: var(--te-neutral-900);
  background: var(--te-card-bg);
}
.stem-child {
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 1px solid color-mix(in srgb, currentColor 22%, transparent);
}
.analysis-stage {
  font-size: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
  margin: 8px 0;
}
.analysis-stage progress {
  width: 100%;
  height: 4px;
  accent-color: var(--te-primary-500);
}
.vocal-split {
  position: relative;
  font-size: 11px;
}
.song-analysis-panel .vocal-split {
  cursor: pointer;
  list-style: none;
  padding: 6px 4px;
  white-space: nowrap;
}
.split-options {
  display: grid;
  min-width: 180px;
  gap: 3px;
}
.split-options button {
  border: 0;
  text-align: left;
  min-height: 38px;
}
.study-error {
  font-size: 12px;
  overflow-wrap: anywhere;
  color: var(--te-primary-500);
}
@media (max-width: 1000px) {
  .song-analysis-panel {
    padding-right: 6px;
  }
  .stem-controls {
    gap: 4px;
  }
  .stem-controls button {
    padding: 5px;
  }
}
</style>
