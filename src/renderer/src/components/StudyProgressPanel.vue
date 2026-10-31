<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMusicStudyProgress } from '../stores/musicStudy.ts'
import type { StudyProjectSummary } from '../../../shared/musicStudy.ts'
const emit = defineEmits<{ close: [] }>(),
  store = useMusicStudyProgress(),
  root = ref<HTMLElement>(),
  error = ref('')
const working = (song: StudyProjectSummary) => ['queued', 'running'].includes(song.status)
const retryable = (song: StudyProjectSummary) =>
  ['failed', 'cancelled', 'interrupted'].includes(song.status)
const songs = computed(() => {
  const rows = new Map<string, StudyProjectSummary>()
  for (const song of store.state.value?.projects ?? []) {
    const key = song.songId || song.id,
      current = rows.get(key)
    if (!current || (working(song) && !working(current))) rows.set(key, song)
  }
  return [...rows.values()]
})
onMounted(() => root.value?.focus())
async function action(song: StudyProjectSummary) {
  error.value = ''
  try {
    await store.core.command(working(song) ? 'study.cancel' : 'study.retry', { id: song.id })
    await store.refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
function paginate(delta: number) {
  store.page.value += delta
  void store.refresh()
}
function title(song: StudyProjectSummary) {
  return working(song)
    ? '识别中 · 点击取消'
    : retryable(song)
      ? `${song.status === 'failed' ? '识别失败' : '识别中断'} · 点击重试`
      : '已识别'
}
</script>
<template>
  <Teleport to="body"
    ><div class="study-progress-dismiss" @pointerdown.self="emit('close')">
      <section
        id="study-progress-panel"
        ref="root"
        class="study-progress-panel"
        role="dialog"
        aria-label="分析进度"
        tabindex="-1"
        @keydown.esc.stop.prevent="emit('close')"
      >
        <header>
          <h2>分析进度</h2>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭分析进度"
            @click="emit('close')"
          >
            <i class="pi pi-times" aria-hidden="true" />
          </button>
        </header>
        <p v-if="error || store.failure.value" role="alert">{{ error || store.failure.value }}</p>
        <p v-else-if="!songs.length" class="empty">暂无分析任务</p>
        <ul>
          <li v-for="song in songs" :key="song.songId || song.id">
            <span class="song-title" :title="song.title">{{ song.title }}</span
            ><button
              v-if="working(song) || retryable(song)"
              type="button"
              class="icon-button status-action"
              :title="title(song)"
              :aria-label="`${song.title}：${title(song)}`"
              @click="action(song)"
            >
              <i
                :class="working(song) ? 'pi pi-spin pi-spinner' : 'pi pi-exclamation-circle'"
                aria-hidden="true"
              /></button
            ><span v-else class="song-done" role="img" aria-label="已识别" title="已识别"
              ><i class="pi pi-check-circle" aria-hidden="true"
            /></span>
          </li>
        </ul>
        <footer v-if="(store.state.value?.total ?? 0) > 50">
          <button
            type="button"
            class="icon-button"
            :disabled="!store.page.value"
            aria-label="上一页"
            @click="paginate(-1)"
          >
            <i class="pi pi-angle-left" aria-hidden="true" /></button
          ><span>{{ store.page.value + 1 }}</span
          ><button
            type="button"
            class="icon-button"
            :disabled="(store.page.value + 1) * 50 >= (store.state.value?.total ?? 0)"
            aria-label="下一页"
            @click="paginate(1)"
          >
            <i class="pi pi-angle-right" aria-hidden="true" />
          </button>
        </footer>
      </section></div
  ></Teleport>
</template>
<style scoped>
.study-progress-dismiss {
  position: fixed;
  inset: var(--te-titlebar-inset, 32px) 0 0;
  z-index: 1200;
  background: transparent;
}
.study-progress-panel {
  position: absolute;
  right: 14px;
  top: 8px;
  width: min(320px, calc(100vw - 28px));
  max-height: min(60vh, 480px);
  overflow: auto;
  padding: 12px 16px;
  box-sizing: border-box;
  border-radius: var(--te-control-radius-lg, 16px);
  background: var(--te-card-bg);
  color: var(--te-neutral-900);
  border: 1px solid var(--te-card-border);
  box-shadow: 0 18px 60px #0003;
}
header,
li,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
ul {
  list-style: none;
  padding: 4px 0;
  margin: 0;
}
li {
  min-height: 42px;
}
.song-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.song-done,
.status-action {
  flex: none;
  width: 30px;
  text-align: center;
  font-size: 16px;
}
.song-done {
  color: var(--te-primary-500);
}
button {
  border: 0;
  background: transparent;
  color: inherit;
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  border-radius: var(--te-control-radius-md);
}
button:hover {
  background: var(--te-subtle-bg);
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 2px;
}
p {
  font-size: 12px;
  color: var(--te-neutral-500);
  overflow-wrap: anywhere;
}
.empty {
  padding: 14px 0;
}
footer {
  font-size: 12px;
  margin-top: 8px;
}
</style>
