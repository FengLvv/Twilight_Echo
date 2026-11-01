<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SettingsGroup from './SettingsGroup.vue'
import { useCoreConnection } from '../../stores/coreConnection.ts'
import type { StudyCacheStatus } from '../../../../shared/musicStudy.ts'

const core = useCoreConnection()
const cache = ref<StudyCacheStatus | null>(null)
const busy = ref(false), error = ref('')
const sizes = [1, 2, 4, 8, 16, 32]
const gib = 1024 ** 3
const limit = computed(() => (cache.value?.limitBytes ?? 2 * gib) / gib)
const format = (bytes: number) => bytes >= gib ? `${(bytes / gib).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
const summary = computed(() => cache.value ? `${format(cache.value.usedBytes)} / ${format(cache.value.limitBytes)}` : '')
let timer: ReturnType<typeof setTimeout> | null = null, stopped = false, lastRefresh = 0

async function refresh() {
  if (busy.value || stopped) return
  try {
    const value = await core.query('study.cache', {})
    if (!stopped) cache.value = value
    lastRefresh = Date.now()
  } catch (e) { if (!stopped) error.value = e instanceof Error ? e.message : String(e) }
}
async function change(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { cache.value = await action() as StudyCacheStatus; lastRefresh = Date.now() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
watch(() => core.state.value?.studyRevision, () => {
  if (timer || stopped) return
  timer = setTimeout(() => { timer = null; void refresh() }, Math.max(0, 5000 - (Date.now() - lastRefresh)))
})
onMounted(() => { void refresh() })
onBeforeUnmount(() => { stopped = true; if (timer) clearTimeout(timer) })
</script>

<template>
  <SettingsGroup id="playback-song-analysis" title="歌曲分析" :summary="summary" :attention="error">
    <div class="setting-list" :aria-busy="busy">
      <div class="setting-item">
        <div class="setting-copy"><strong id="analysis-preload-label">预分析下一首</strong></div>
        <button type="button" class="toggle-switch" :class="{ active: cache?.preloadNext }"
          role="switch" :aria-checked="cache?.preloadNext ?? true" aria-labelledby="analysis-preload-label"
          :disabled="busy || !cache" @click="change(() => core.command('study.setCachePolicy', { preloadNext: !cache?.preloadNext }))" />
      </div>
      <hr />
      <div class="setting-item">
        <label class="setting-copy" for="analysis-cache-limit"><strong>音频缓存上限</strong></label>
        <select id="analysis-cache-limit" class="preview-select" :value="limit" :disabled="busy || !cache"
          @change="change(() => core.command('study.setCachePolicy', { limitBytes: Number(($event.target as HTMLSelectElement).value) * gib }))">
          <option v-if="!sizes.includes(limit)" :value="limit">{{ limit }} GB</option>
          <option v-for="size in sizes" :key="size" :value="size">{{ size }} GB</option>
        </select>
      </div>
      <hr />
      <div class="setting-item">
        <div class="setting-copy"><strong>音频缓存</strong></div>
        <button type="button" class="preset-btn" :disabled="busy || !cache?.usedBytes"
          :title="cache?.protectedBytes ? '正在使用的音频会保留' : undefined"
          @click="change(() => core.command('study.clearAudioCache', {}))">清理音频缓存</button>
      </div>
    </div>
  </SettingsGroup>
</template>
