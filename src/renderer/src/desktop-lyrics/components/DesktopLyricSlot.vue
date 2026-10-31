<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, computed } from 'vue'
import {
  desktopLyricsFitScale,
  desktopLyricsWordProgress,
  type DesktopLyricsLine,
  type DesktopLyricsTextAlign,
  type DesktopLyricsWritingMode
} from '../../../../shared/desktopLyrics.ts'
import { buildDesktopLyricsKaraokePlan, desktopLyricsKaraokeTime } from '../desktopLyricsKaraoke.ts'
import LyricRhythmicScore from '../../components/LyricRhythmicScore.vue'
import LyricChords from '../../components/LyricChords.vue'
import { romanChord } from '../../../../shared/lyrics/chordDegrees.ts'
import type { DesktopLyricsAnalysis } from '../../../../shared/desktopLyrics.ts'

const props = defineProps<{
  line: DesktopLyricsLine | null
  active: boolean
  align: DesktopLyricsTextAlign
  writingMode: DesktopLyricsWritingMode
  translationVisible: boolean
  romanizationVisible: boolean
  analysis?: DesktopLyricsAnalysis
  lyricOffsetMs?: number
  playbackRate?: number
  compact?: boolean
}>()

const shell = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const scale = ref(1)
const clipped = ref(false)
const score = ref<InstanceType<typeof LyricRhythmicScore>>()
const audioPosition = ref(0)
let annotationKey = ''
const hasAnnotations = computed(() => !!props.line?.score || !!props.line?.chords?.length)
const displayedChords = computed(() => {
  const chords = props.line?.chords ?? []
  if (!props.compact) return chords
  const current =
    chords.find(
      (c) => c.label !== 'N' && audioPosition.value >= c.start && audioPosition.value < c.end
    ) ?? chords.find((c) => c.label !== 'N')
  return current ? [current] : []
})
const chordLabel = (label: string) =>
  props.analysis?.display.mode === 'degrees' ? romanChord(label, props.analysis.key) : label
function syncAnnotations(positionMs: number) {
  const position = (positionMs - (props.lyricOffsetMs ?? 0)) / 1000
  score.value?.syncPosition(position)
  const key =
    props.line?.chords?.find((c) => position >= c.start && position < c.end)?.start?.toString() ??
    ''
  if (key !== annotationKey) {
    annotationKey = key
    audioPosition.value = position
  }
}
const fillElements: Array<HTMLElement | null> = []
let karaokeAnimations: Animation[] = []
let karaokeLineId = ''
let karaokeReady = false
let karaokeBuildQueued = false
let latestPositionMs = 0
let latestPlaying = false
let resizeObserver: ResizeObserver | undefined

function setFill(index: number, element: unknown): void {
  fillElements[index] = element instanceof HTMLElement ? element : null
}

function supportsWebAnimations(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
}

function lineStartMs(): number {
  return props.line?.startMs ?? props.line?.words?.[0]?.startMs ?? 0
}

function clearKaraoke(): void {
  for (const animation of karaokeAnimations) animation.cancel()
  karaokeAnimations = []
  karaokeLineId = ''
  karaokeReady = false
  for (const element of fillElements) {
    if (!element) continue
    element.classList.remove('is-karaoke', 'is-fallback')
    element.style.removeProperty('mask-image')
    element.style.removeProperty('-webkit-mask-image')
    element.style.removeProperty('mask-size')
    element.style.removeProperty('-webkit-mask-size')
    element.style.removeProperty('mask-repeat')
    element.style.removeProperty('--dl-word-remaining')
  }
}

async function fit(): Promise<void> {
  await nextTick()
  const host = shell.value
  const line = content.value
  if (!host || !line) return
  const vertical = props.writingMode === 'vertical'
  const contentSize = vertical ? line.scrollHeight : line.scrollWidth
  const availableSize = vertical ? host.clientHeight : host.clientWidth
  const next = desktopLyricsFitScale(contentSize, availableSize)
  scale.value = hasAnnotations.value
    ? Math.min(
        1,
        host.clientWidth / Math.max(1, line.scrollWidth),
        host.clientHeight / Math.max(1, line.scrollHeight)
      )
    : next
  clipped.value = contentSize * scale.value > availableSize + 1
}

function syncFallback(positionMs: number): void {
  if (!props.active || !props.line?.words?.length) return
  for (let index = 0; index < props.line.words.length; index += 1) {
    const element = fillElements[index]
    if (!element?.classList.contains('is-fallback')) continue
    element.style.setProperty(
      '--dl-word-remaining',
      `${((1 - desktopLyricsWordProgress(props.line.words[index], positionMs)) * 100).toFixed(2)}%`
    )
  }
}

function buildKaraoke(): void {
  karaokeBuildQueued = false
  clearKaraoke()
  const line = props.line
  if (!props.active || !line?.words?.length || line.score) return
  const startMs = lineStartMs()
  const canAnimate = supportsWebAnimations()
  karaokeLineId = line.id
  karaokeReady = true

  for (let index = 0; index < line.words.length; index += 1) {
    const element = fillElements[index]
    if (!element) continue
    const plan = buildDesktopLyricsKaraokePlan(line.words[index], startMs, props.writingMode)
    element.style.setProperty('mask-image', plan.maskImage)
    element.style.setProperty('-webkit-mask-image', plan.maskImage)
    element.style.setProperty('mask-size', plan.maskSize)
    element.style.setProperty('-webkit-mask-size', plan.maskSize)
    element.style.setProperty('mask-repeat', 'no-repeat')
    element.classList.add('is-karaoke')
    if (canAnimate) {
      try {
        karaokeAnimations.push(element.animate(plan.keyframes, plan.timing))
        continue
      } catch {
        element.classList.add('is-fallback')
        continue
      }
    }
    element.classList.add('is-fallback')
  }

  syncKaraoke(latestPositionMs, latestPlaying, true)
}

function scheduleKaraokeBuild(): void {
  if (karaokeBuildQueued || !props.active || !props.line?.words?.length) return
  karaokeBuildQueued = true
  void nextTick(buildKaraoke)
}

function animationEndTime(animation: Animation): number | null {
  const endTime = animation.effect?.getComputedTiming().endTime
  return typeof endTime === 'number' && Number.isFinite(endTime) ? endTime : null
}

function syncKaraoke(positionMs: number, playing: boolean, hard = false): void {
  audioPosition.value = (positionMs - (props.lyricOffsetMs ?? 0)) / 1000
  syncAnnotations(positionMs)
  latestPositionMs = positionMs
  latestPlaying = playing
  const line = props.line
  if (!props.active || !line?.words?.length) return
  if (!karaokeReady || karaokeLineId !== line.id) {
    scheduleKaraokeBuild()
    return
  }

  const target = desktopLyricsKaraokeTime(positionMs, lineStartMs())
  for (const animation of karaokeAnimations) {
    animation.playbackRate = props.playbackRate ?? 1
    const endTime = animationEndTime(animation)
    const boundedTarget = endTime == null ? target : Math.min(target, endTime)
    const current = Number(animation.currentTime ?? 0)
    if (hard || Math.abs(boundedTarget - current) > 48) animation.currentTime = boundedTarget
    if (playing) {
      if (endTime != null && target >= endTime) {
        if (animation.playState !== 'finished') {
          animation.currentTime = endTime
          animation.finish()
        }
      } else if (animation.playState !== 'finished') animation.play()
    } else animation.pause()
  }
  syncFallback(positionMs)
}

watch(
  () => [props.line?.id, props.line?.words, props.active, props.writingMode, !!props.line?.score],
  () => {
    fillElements.length = props.line?.words?.length ?? 0
    clearKaraoke()
    void fit()
    scheduleKaraokeBuild()
  },
  { immediate: true, flush: 'post' }
)
watch(
  () => [
    props.line?.score,
    props.line?.chords,
    props.analysis?.display.mode,
    props.analysis?.display.key
  ],
  () => {
    annotationKey = ''
    void fit()
  },
  { flush: 'post' }
)
watch(
  () => [props.translationVisible, props.romanizationVisible],
  () => void fit()
)
onMounted(() => {
  resizeObserver = new ResizeObserver(() => void fit())
  if (shell.value) resizeObserver.observe(shell.value)
  void fit()
  scheduleKaraokeBuild()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  clearKaraoke()
})
defineExpose({ syncKaraoke, syncAnnotations, fit })
</script>

<template>
  <div
    ref="shell"
    class="dl-slot-shell"
    :class="[
      `is-${align}`,
      `is-${writingMode}`,
      { 'is-active': active, 'has-annotations': hasAnnotations }
    ]"
  >
    <div
      v-if="line"
      ref="content"
      class="dl-line-content"
      :class="{
        'is-clipped': clipped,
        'is-compact': compact && hasAnnotations,
        'is-chord-only': !line.text && !line.score
      }"
      :style="{ transform: `scale(${scale})` }"
    >
      <LyricChords
        v-if="displayedChords.length"
        :chords="displayedChords"
        :position="audioPosition"
        :start="line.startMs === null ? undefined : (line.startMs - (lyricOffsetMs ?? 0)) / 1000"
        :end="line.endMs === null ? undefined : (line.endMs - (lyricOffsetMs ?? 0)) / 1000"
        :format-label="chordLabel"
      />
      <div v-if="line.text || line.score" class="dl-primary-line">
        <LyricRhythmicScore
          v-if="line.score"
          ref="score"
          :svg="line.score.svg"
          :text="line.text"
          :notes="line.score.notes"
          :position="audioPosition"
          :tonal-key="analysis?.key ?? null"
          :notation-mode="analysis?.display.notationMode"
          :vertical="writingMode === 'vertical'"
          @layout="fit"
        />
        <template v-else-if="active && line.words?.length">
          <span
            v-for="(word, index) in line.words"
            :key="`${word.startMs}-${index}`"
            class="dl-word"
          >
            <span>{{ word.text }}</span>
            <span :ref="(element) => setFill(index, element)" class="dl-word-fill">{{
              word.text
            }}</span>
          </span>
        </template>
        <span v-else>{{ line.text }}</span>
      </div>
      <div v-if="translationVisible && line.translation" class="dl-translation">
        {{ line.translation }}
      </div>
      <div v-if="romanizationVisible && line.romanization" class="dl-romanization">
        {{ line.romanization }}
      </div>
    </div>
  </div>
</template>
