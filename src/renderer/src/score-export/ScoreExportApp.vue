<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import LyricRhythmicScore from '../components/LyricRhythmicScore.vue'
import { keyName } from '../../../shared/lyrics/chordDegrees.ts'
import type { AgentScoreExportData } from '../../../shared/agentScoreExport.ts'

const data = ref<AgentScoreExportData>()
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
onMounted(async () => {
  try {
    data.value = await window.api.scoreExport.bootstrap()
    await nextTick()
    const deadline = performance.now() + 90000
    while (document.querySelectorAll('.score-export-row svg').length !== data.value.rows.length) {
      if (performance.now() > deadline) throw new Error('Native score renderer timed out')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await document.fonts.ready
    await frame(); await frame()
    const rows = data.value.rows.map(row => {
      const source = document.querySelector<SVGSVGElement>(`[data-line-id="${row.lineId}"] svg`)
      if (!source) throw new Error('Missing native score row')
      const svg = source.cloneNode(true) as SVGSVGElement
      const originals = [source, ...source.querySelectorAll('*')]
      const copies = [svg, ...svg.querySelectorAll('*')]
      originals.forEach((element, index) => {
        const copy = copies[index] as SVGElement
        const style = getComputedStyle(element)
        copy.style.color = '#111'
        copy.style.opacity = '1'
        if (element.tagName === 'text' || element.tagName === 'tspan') {
          copy.style.fontFamily = style.fontFamily
          copy.style.fontSize = style.fontSize
          copy.style.fontWeight = style.fontWeight
          copy.style.fontStyle = style.fontStyle
        }
        copy.removeAttribute('aria-current')
      })
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      svg.style.cssText = 'width:100%;height:auto;color:#111;overflow:visible'
      return { lineId: row.lineId, text: row.text, svg: new XMLSerializer().serializeToString(svg) }
    })
    await window.api.scoreExport.complete({ rows })
  } catch (error) {
    await window.api.scoreExport.complete({ rows: [], error: error instanceof Error ? error.message : String(error) })
  }
})
</script>
<template>
  <main v-if="data" class="score-export-document">
    <h1>{{ data.title }}</h1>
    <p>{{ data.notation === 'staff' ? '五线谱' : '简谱' }} · {{ data.key ? keyName(data.key) : '调性未确定' }}</p>
    <section v-for="row in data.rows" :key="row.lineId" :data-line-id="row.lineId" class="score-export-row">
      <LyricRhythmicScore :svg="row.svg" :text="row.text" :notes="row.notes" :tonal-key="data.key" :notation-mode="data.notation" :position="-1" eager />
    </section>
  </main>
</template>
<style>
html:has(.score-export-document), html:has(.score-export-document) body { height:auto!important;min-height:100%!important;overflow:visible!important;background:#fff!important;color:#111!important; }
.score-export-document { --lyric-score-font-size:18px; --lyric-score-font-family:var(--te-font-sans); padding:24px; color:#111; background:#fff; }
.score-export-document h1 { font-size:24px; margin:0 0 8px; }
.score-export-document p { font-size:12px; margin:0 0 18px; }
.score-export-row { break-inside:avoid; padding:12px 0; }
.score-export-document [data-note] { opacity:1!important; }
@media print { .score-export-document { padding:0; } }
</style>
