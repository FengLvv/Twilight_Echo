<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  defineAsyncComponent
} from 'vue'
import type { VocalNote } from '../utils/numberedNotes.ts'
import { numberedNote } from '../utils/numberedNotes.ts'
import type { ChordKey } from '../utils/chordDegrees.ts'

const props = defineProps<{
  svg: string
  text: string
  notes: readonly VocalNote[]
  position: number
  tonalKey: ChordKey | null
  vertical?: boolean
  notationMode?: 'numbered' | 'staff'
  eager?: boolean
}>()
const VocalStaffScore = defineAsyncComponent(() => import('./VocalStaffScore.vue'))
const staffScore = ref<{ syncPosition(position: number): void }>()
const surface = ref<HTMLElement>()
const emit = defineEmits<{ layout: [] }>()
const namespace = 'http://www.w3.org/2000/svg'
const markup = computed(() => {
  if (props.notationMode === 'staff') return ''
  const doc = new DOMParser().parseFromString(props.svg, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.localName !== 'svg') return ''
  const tags = new Set([
    'svg',
    'g',
    'path',
    'text',
    'tspan',
    'line',
    'rect',
    'polygon',
    'polyline',
    'circle',
    'ellipse',
    'defs',
    'clipPath'
  ])
  const attributes = new Set([
    'viewBox',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'd',
    'points',
    'transform',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linejoin',
    'stroke-linecap',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-anchor',
    'data-note',
    'data-held',
    'opacity',
    'xmlns'
  ])
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    if (!tags.has(node.localName)) {
      node.remove()
      continue
    }
    for (const attr of [...node.attributes]) {
      if (!attributes.has(attr.name) || /url\s*\(/i.test(attr.value))
        node.removeAttribute(attr.name)
    }
  }
  for (const text of svg.querySelectorAll('text')) {
    if (text.closest('[data-note]') || /^[0-7–.]+$/.test(text.textContent?.trim() ?? '')) {
      text.setAttribute('data-score-symbol', '')
      text.setAttribute('font-size', '2.2001')
    }
  }
  for (const node of svg.querySelectorAll<SVGGElement>('[data-note]')) {
    const index = Number(node.getAttribute('data-note')),
      note = props.notes[index]
    if (!note || !Number.isInteger(index)) continue
    node.setAttribute('data-note-start', String(note.start))
    const text = node.querySelector('text'),
      container = text?.parentElement
    if (!text || !container || node.hasAttribute('data-held')) continue
    const pitch = numberedNote(note.midi, props.tonalKey)
    text.textContent = pitch.label.slice(-1)
    text.setAttribute('x', '.65')
    text.setAttribute('text-anchor', 'middle')
    if (pitch.label.length > 1) {
      const accidental = doc.createElementNS(namespace, 'text')
      accidental.textContent = pitch.label[0]
      accidental.setAttribute('data-score-symbol', '')
      accidental.setAttribute('data-score-accidental', '')
      accidental.setAttribute('x', '-.05')
      accidental.setAttribute('y', '-.6')
      accidental.setAttribute('font-size', '1.2')
      accidental.setAttribute('text-anchor', 'end')
      accidental.setAttribute('fill', 'currentColor')
      container.appendChild(accidental)
    }
    for (let i = 0; i < Math.min(4, Math.abs(pitch.octave)); i++) {
      const dot = doc.createElementNS(namespace, 'circle')
      dot.setAttribute('cx', '.65')
      dot.setAttribute('cy', String(pitch.octave > 0 ? -2.5 - i * 0.45 : 0.65 + i * 0.45))
      dot.setAttribute('r', '.13')
      dot.setAttribute('fill', 'currentColor')
      container.appendChild(dot)
    }
  }
  const width = Number(svg.getAttribute('viewBox')?.split(/\s+/)[2])
  const box = svg.getAttribute('viewBox')?.split(/\s+/).map(Number)
  if (props.vertical && box?.length === 4 && box.every(Number.isFinite)) {
    const [x, y, w, h] = box
    for (const text of svg.querySelectorAll('text')) {
      const tx = Number(text.getAttribute('x') ?? 0),
        ty = Number(text.getAttribute('y') ?? 0)
      text.setAttribute('transform', `rotate(-90 ${tx} ${ty})`)
      if (!text.closest('[data-note]') && !/^[0-7–.]+$/.test(text.textContent?.trim() ?? ''))
        text.setAttribute('style', 'writing-mode:vertical-rl;text-orientation:upright')
    }
    const group = doc.createElementNS(namespace, 'g')
    group.setAttribute('transform', `translate(${h} 0) rotate(90) translate(${-x} ${-y})`)
    while (svg.firstChild) group.appendChild(svg.firstChild)
    svg.appendChild(group)
    svg.setAttribute('viewBox', `0 0 ${h} ${w}`)
    svg.setAttribute('style', `height:${w / 2.47}em;width:auto;max-height:100%`)
  } else if (Number.isFinite(width))
    svg.setAttribute('style', `width:${width / 2.47}em;max-width:100%;height:auto`)
  return new XMLSerializer().serializeToString(svg)
})
function highlight(position = props.position) {
  staffScore.value?.syncPosition(position)
  for (const node of surface.value?.querySelectorAll('[data-note]') ?? []) {
    const n = props.notes[Number(node.getAttribute('data-note'))]
    if (n && position >= n.start && position < n.end) {
      if (!node.hasAttribute('aria-current')) node.setAttribute('aria-current', 'true')
    } else if (node.hasAttribute('aria-current')) node.removeAttribute('aria-current')
  }
}
watch(
  () => props.position,
  (value) => highlight(value)
)
function reflow() {
  const svg = surface.value?.querySelector('svg')
  if (!svg) return
  const box = svg.getBBox()
  if (!box.width || !box.height) return
  const pad = 0.35
  const rounded = (n: number) => Math.round(n * 1000) / 1000
  const viewBox = `${rounded(box.x - pad)} ${rounded(box.y - pad)} ${rounded(box.width + 2 * pad)} ${rounded(box.height + 2 * pad)}`
  if (svg.getAttribute('viewBox') === viewBox) return
  svg.setAttribute('viewBox', viewBox)
  svg.style.cssText = props.vertical
    ? `height:${(box.height + 2 * pad) / 2.47}em;width:auto;max-height:100%`
    : `width:${(box.width + 2 * pad) / 2.47}em;max-width:100%;height:auto`
  emit('layout')
}
watch(
  markup,
  async () => {
    await nextTick()
    reflow()
    highlight()
  },
  { immediate: true }
)
onMounted(() => {
  void document.fonts.ready.then(reflow)
  document.fonts.addEventListener('loadingdone', reflow)
})
onBeforeUnmount(() => document.fonts.removeEventListener('loadingdone', reflow))
defineExpose({ syncPosition: highlight, reflow })
</script>
<template>
  <span
    class="lyric-rhythmic-score"
    :data-notation-mode="notationMode ?? 'numbered'"
    :aria-label="`${text}，${notationMode === 'staff' ? '人声五线谱' : '人声简谱'}`"
  >
    <VocalStaffScore
      v-if="notationMode === 'staff'"
      ref="staffScore"
      :notes="notes"
      :tonal-key="tonalKey"
      :position="position"
      :eager="eager"
      @layout="emit('layout')"
    />
    <span v-else ref="surface" v-html="markup" />
  </span>
</template>
<style scoped>
.lyric-rhythmic-score {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  font-size: var(
    --lyric-score-font-size,
    clamp(12px, var(--lyric-style-font-size, var(--te-lyric-font-size, 18px)), 48px)
  );
  line-height: 1;
  color: inherit;
}
.lyric-rhythmic-score :deep(svg) {
  display: inline-block;
  vertical-align: middle;
  overflow: visible;
}
.lyric-rhythmic-score :deep(text) {
  font-family: var(--lyric-score-font-family, inherit);
  -webkit-text-stroke: 0;
}
.lyric-rhythmic-score :deep([data-score-symbol]) {
  font-family: 'Inter', var(--lyric-score-font-family, var(--te-font-sans));
  font-style: normal;
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
}
.lyric-rhythmic-score :deep([data-score-accidental]) {
  font-family: 'Segoe UI Symbol', 'DejaVu Sans', sans-serif;
  font-weight: 400;
}
.lyric-rhythmic-score :deep([data-note]) {
  opacity: 0.7;
}
.lyric-rhythmic-score :deep([aria-current='true']) {
  opacity: 1;
  color: var(--te-playback-lyric-active-text, currentColor);
}
</style>
