<script setup lang="ts">
import { ref } from 'vue'
import ChordDisplayControl from '../../components/ChordDisplayControl.vue'
import type { DesktopLyricsAnalysis } from '../../../../shared/desktopLyrics.ts'
import type { StudyLyricDisplayPatch } from '../../../../shared/musicStudy.ts'
import type {
  DesktopLyricsPalette,
  DesktopLyricsSettingsV3,
  DesktopLyricsTransportAction
} from '../../../../shared/desktopLyrics.ts'

defineProps<{
  settings: DesktopLyricsSettingsV3
  playing: boolean
  analysis?: DesktopLyricsAnalysis
  available?: boolean
  error?: string
}>()
const emit = defineEmits<{
  transport: [action: DesktopLyricsTransportAction]
  patch: [patch: Partial<DesktopLyricsSettingsV3>]
  lock: []
  close: []
  analysis: [patch: Omit<StudyLyricDisplayPatch, 'songId'>]
  interaction: [active: boolean]
}>()
const paletteOpen = ref(false)
const palettes: Array<{ id: DesktopLyricsPalette; label: string; color: string }> = [
  { id: 'accent', label: '封面强调色', color: 'var(--dl-accent)' },
  { id: 'sunset', label: '落日晖', color: '#f3a6a6' },
  { id: 'twilight', label: 'Twilight', color: '#7aa2ff' },
  { id: 'warm', label: '暖白', color: '#ffd27a' },
  { id: 'custom', label: '自定义', color: 'var(--dl-custom)' }
]

function resize(fontSize: number): void {
  emit('patch', { fontSize: Math.min(64, Math.max(20, fontSize)) })
}

function selectPalette(palette: DesktopLyricsPalette): void {
  emit('patch', { palette })
  paletteOpen.value = false
}
</script>

<template>
  <div class="dl-toolbar" data-dl-interactive>
    <button type="button" title="上一首" aria-label="上一首" @click="emit('transport', 'previous')">
      <i class="ph ph-skip-back"></i>
    </button>
    <button
      type="button"
      :title="playing ? '暂停' : '播放'"
      :aria-label="playing ? '暂停' : '播放'"
      @click="emit('transport', 'playPause')"
    >
      <i :class="playing ? 'ph ph-pause' : 'ph ph-play'"></i>
    </button>
    <button type="button" title="下一首" aria-label="下一首" @click="emit('transport', 'next')">
      <i class="ph ph-skip-forward"></i>
    </button>
    <span class="dl-toolbar-divider"></span>
    <template v-if="available">
      <button
        type="button"
        aria-label="显示和弦"
        :title="error || analysis?.error || '和弦'"
        :aria-pressed="analysis?.display.chordsVisible ?? false"
        :aria-busy="!!analysis?.chordsBusy"
        :class="{ 'is-selected': analysis?.display.chordsVisible }"
        @click="emit('analysis', { chordsVisible: !analysis?.display.chordsVisible })"
      >
        <i
          :class="
            analysis?.chordsBusy && analysis?.display.chordsVisible
              ? 'ph ph-spinner dl-analysis-spinning'
              : 'ph ph-piano-keys'
          "
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        :aria-label="analysis?.display.notationMode === 'staff' ? '人声五线谱' : '人声简谱'"
        :title="error || analysis?.error || (analysis?.display.notationMode === 'staff' ? '五线谱' : '简谱')"
        :aria-pressed="analysis?.display.notationVisible ?? false"
        :aria-busy="!!analysis?.melodyBusy"
        :class="{ 'is-selected': analysis?.display.notationVisible }"
        @click="emit('analysis', { notationVisible: !analysis?.display.notationVisible })"
      >
        <i
          :class="
            analysis?.melodyBusy && analysis?.display.notationVisible
              ? 'ph ph-spinner dl-analysis-spinning'
              : 'ph ph-music-notes'
          "
          aria-hidden="true"
        />
      </button>
      <ChordDisplayControl
        :mode="analysis?.display.mode ?? 'names'"
        :selected-key="analysis?.display.key ?? 'auto'"
        :inferred="analysis?.inferred ?? null"
        :notation-visible="analysis?.display.notationVisible"
        :notation-mode="analysis?.display.notationMode"
        @notation-mode="(value) => emit('analysis', { notationMode: value })"
        @mode="(value) => emit('analysis', { mode: value })"
        @key="(value) => emit('analysis', { key: value })"
        @open="(value) => emit('interaction', value)"
      />
      <span class="dl-toolbar-divider"></span>
    </template>
    <button
      type="button"
      title="减小字号"
      aria-label="减小字号"
      @click="resize(settings.fontSize - 2)"
    >
      A−
    </button>
    <button
      type="button"
      title="增大字号"
      aria-label="增大字号"
      @click="resize(settings.fontSize + 2)"
    >
      A+
    </button>
    <div class="dl-palette-anchor">
      <button
        type="button"
        title="歌词配色"
        aria-label="歌词配色"
        :aria-expanded="paletteOpen"
        @click="paletteOpen = !paletteOpen"
      >
        <i class="ph ph-palette"></i>
      </button>
      <Transition name="dl-popover">
        <div v-if="paletteOpen" class="dl-palette-menu">
          <button
            v-for="palette in palettes"
            :key="palette.id"
            type="button"
            :class="{ 'is-selected': settings.palette === palette.id }"
            :title="palette.label"
            @click="selectPalette(palette.id)"
          >
            <span class="dl-swatch" :style="{ background: palette.color }"></span>
            {{ palette.label }}
          </button>
        </div>
      </Transition>
    </div>
    <button
      type="button"
      title="显示翻译"
      aria-label="显示翻译"
      :aria-pressed="settings.translationVisible"
      :class="{ 'is-selected': settings.translationVisible }"
      @click="emit('patch', { translationVisible: !settings.translationVisible })"
    >
      译
    </button>
    <button type="button" title="锁定桌面歌词" aria-label="锁定桌面歌词" @click="emit('lock')">
      <i class="ph ph-lock"></i>
    </button>
    <button
      class="is-close"
      type="button"
      title="关闭桌面歌词"
      aria-label="关闭桌面歌词"
      @click="emit('close')"
    >
      <i class="ph ph-x"></i>
    </button>
  </div>
</template>
