<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import renderAbc from 'abcjs/src/api/abc_tunebook_svg.js'
import { vocalStaffAbc } from '../utils/vocalStaff.ts'
import type { VocalNote } from '../utils/numberedNotes.ts'
import type { ChordKey } from '../utils/chordDegrees.ts'

const props = defineProps<{
  notes: readonly VocalNote[]
  tonalKey: ChordKey | null
  position: number
  eager?: boolean
}>()
const emit = defineEmits<{ layout: [] }>()
const surface = ref<HTMLElement>()
let visible = false
let observer: IntersectionObserver | undefined
function highlight(position = props.position) {
  for (const element of surface.value?.querySelectorAll<SVGElement>('[data-note]') ?? []) {
    const note = props.notes[Number(element.dataset.note)]
    const active = !!note && position >= note.start && position < note.end
    if (active && !element.hasAttribute('aria-current'))
      element.setAttribute('aria-current', 'true')
    else if (!active) element.removeAttribute('aria-current')
  }
}
async function draw() {
  await nextTick()
  if (!surface.value || !visible) return
  const { abc, events } = vocalStaffAbc(props.notes, props.tonalKey)
  const [tune] = renderAbc(surface.value, abc, {
    add_classes: true,
    foregroundColor: 'currentColor',
    staffwidth: Math.max(220, events.length * 24),
    paddingtop: 4,
    paddingbottom: 4,
    paddingleft: 4,
    paddingright: 4,
    selectTypes: false,
    format: { vocalfont: { face: 'Inter, MiSans, sans-serif', size: 15 }, stretchlast: 0 }
  })
  for (const { startChar, index } of events) {
    const element = tune?.getElementFromChar(startChar) as {
      abselem?: { elemset: SVGElement[] }
    } | null
    if (!element?.abselem) continue
    for (const node of element.abselem.elemset) {
      node.setAttribute('data-note', String(index))
      node.setAttribute('data-note-start', String(props.notes[index].start))
    }
  }
  const svg = surface.value.querySelector('svg')
  if (svg) {
    const box = svg.getBBox(),
      pad = 5
    svg.setAttribute(
      'viewBox',
      `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`
    )
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.width = `${(box.width + 2 * pad) / 18}em`
    svg.style.maxWidth = '100%'
    svg.style.height = 'auto'
    // The engraver fixes the host in pixels; let our responsive SVG own its height.
    surface.value.style.removeProperty('height')
    surface.value.style.removeProperty('width')
    surface.value.style.removeProperty('overflow')
  }
  highlight()
  emit('layout')
}
watch(() => [props.notes, props.tonalKey], draw, { immediate: true })
watch(() => props.position, highlight)
onMounted(() => {
  if (props.eager) { visible = true; void draw() }
  else observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      if (visible) void draw()
    },
    { rootMargin: '100% 0px' }
  )
  if (surface.value) observer?.observe(surface.value)
  void document.fonts.ready.then(draw)
  document.fonts.addEventListener('loadingdone', draw)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  document.fonts.removeEventListener('loadingdone', draw)
})
defineExpose({ syncPosition: highlight })
</script>
<template><span ref="surface" class="vocal-staff-score" /></template>
<style scoped>
.vocal-staff-score {
  display: block;
  writing-mode: horizontal-tb;
  line-height: 1;
}
.vocal-staff-score:empty {
  min-height: 4.5em;
}
.vocal-staff-score :deep(svg) {
  display: inline-block;
  vertical-align: middle;
  overflow: visible;
}
.vocal-staff-score :deep(text) {
  font-family: var(--lyric-score-font-family, var(--te-font-sans));
  font-weight: 500;
  -webkit-text-stroke: 0;
}
.vocal-staff-score :deep([data-note]) {
  opacity: 0.7;
}
.vocal-staff-score :deep([aria-current='true']) {
  opacity: 1;
  color: var(--te-playback-lyric-active-text, currentColor);
}
</style>
