<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMusicStudyStore } from '../stores/musicStudy.ts'
import type { StudyProject, StudyTrack } from '../../../shared/musicStudy.ts'
const props = defineProps<{ project: StudyProject }>(),
  emit = defineEmits<{ close: [] }>()
const store = useMusicStudyStore(),
  core = store.core
const root = ref<HTMLElement>(),
  error = ref(''),
  notice = ref(''),
  busy = ref(false),
  comparison = ref(false),
  page = ref(0)
const audioFormat = ref<'wav' | 'flac'>('flac'),
  chordFormat = ref<'csv' | 'txt' | 'json'>('csv')
const stems = ref<StudyTrack[]>([...(props.project.result?.stems ?? [])])
const names: Partial<Record<StudyTrack, string>> = {
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
const rows = computed(
  () =>
    (comparison.value
      ? props.project.result?.originalChords.segments
      : props.project.result?.chords.segments
    )?.slice(page.value * 40, (page.value + 1) * 40) ?? []
)
const editing = ref(-1),
  label = ref(''),
  start = ref(0),
  end = ref(0)
onMounted(() => root.value?.focus())
async function action(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    await store.readSong(props.project.songId ?? '')
    void store.refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
function edit(index: number) {
  const chord = rows.value[index]
  editing.value = page.value * 40 + index
  label.value = chord.label
  start.value = chord.start
  end.value = chord.end
}
</script>
<template>
  <Teleport to="body"
    ><div class="analysis-extras-backdrop" @click.self="emit('close')">
      <section
        ref="root"
        class="analysis-extras"
        role="dialog"
        aria-modal="true"
        aria-label="分析结果"
        tabindex="-1"
        @keydown.esc.stop.prevent="emit('close')"
      >
        <header>
          <h2>{{ project.title }}</h2>
          <button aria-label="关闭分析结果" @click="emit('close')">×</button>
        </header>
        <p v-if="error" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <details open>
          <summary>导出</summary>
          <div class="extras-actions">
            <select v-model="audioFormat" aria-label="音频导出格式">
              <option value="flac">FLAC · 24 bit</option>
              <option value="wav">WAV · 24 bit</option></select
            ><select v-model="chordFormat" aria-label="和弦导出格式">
              <option value="csv">CSV</option>
              <option value="txt">TXT</option>
              <option value="json">JSON</option></select
            ><button
              :disabled="busy"
              @click="
                action(async () => {
                  const path = await core.command('study.export', {
                    id: project.id,
                    audioFormat,
                    chordFormat,
                    stems: [...stems]
                  })
                  if (path) notice = '已导出到 ' + path
                })
              "
            >
              选择目录并导出
            </button>
          </div>
          <div class="extras-actions">
            <label v-for="stem in project.result?.stems" :key="stem"
              ><input v-model="stems" type="checkbox" :value="stem" />{{ names[stem] }}</label
            >
          </div>
        </details>
        <details>
          <summary>和弦校正与对照</summary>
          <div class="extras-actions">
            <label><input v-model="comparison" type="checkbox" />原曲分析对照</label
            ><button
              :disabled="busy"
              @click="
                action(() =>
                  core.command('study.analyzeChords', { id: project.id, stems: ['original'] })
                )
              "
            >
              识别原曲和弦</button
            ><button
              :disabled="busy"
              @click="
                action(() =>
                  core.command('study.analyzeChords', {
                    id: project.id,
                    stems: ['bass', 'piano', 'guitar', 'other']
                  })
                )
              "
            >
              重新识别伴奏和弦
            </button>
          </div>
          <p>重新识别伴奏会替换已有和弦校正。</p>
          <table>
            <thead>
              <tr>
                <th>开始 / 结束（秒）</th>
                <th>和弦</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(chord, index) in rows" :key="chord.start">
                <td>{{ chord.start.toFixed(2) }} – {{ chord.end.toFixed(2) }}</td>
                <td>{{ chord.label }}{{ chord.edited ? ' · 已校正' : '' }}</td>
                <td><button v-if="!comparison" @click="edit(index)">校正</button></td>
              </tr>
            </tbody>
          </table>
          <div class="extras-actions">
            <button :disabled="!page" @click="page--">上一页</button><span>{{ page + 1 }}</span
            ><button :disabled="rows.length < 40" @click="page++">下一页</button>
          </div>
          <form
            v-if="editing >= 0"
            class="extras-actions"
            @submit.prevent="
              action(async () => {
                await core.command('study.edit', {
                  id: project.id,
                  revision: project.revision,
                  index: editing,
                  label,
                  start,
                  end
                })
                editing = -1
              })
            "
          >
            <label>和弦<input v-model="label" required maxlength="16" /></label
            ><label
              >开始<input
                v-model.number="start"
                type="number"
                step=".001"
                min="0"
                required /></label
            ><label
              >结束<input v-model.number="end" type="number" step=".001" min="0" required /></label
            ><button :disabled="busy">保存校正</button>
          </form>
        </details>
        <details>
          <summary>分析设置</summary>
          <div class="extras-actions">
            <button :disabled="busy" @click="action(() => core.command('study.choosePack', {}))">
              选择分析环境</button
            ><button
              :disabled="busy"
              @click="
                action(async () => {
                  await core.command('study.delete', { id: project.id })
                  emit('close')
                })
              "
            >
              清除分析结果和缓存
            </button>
          </div>
        </details>
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.analysis-extras-backdrop {
  position: fixed;
  inset: var(--te-titlebar-inset, 32px) 0 0;
  z-index: 1100;
  background: #0006;
  display: grid;
  place-items: center;
  padding: 24px;
}
.analysis-extras {
  box-sizing: border-box;
  width: min(720px, 100%);
  max-height: 80vh;
  overflow: auto;
  padding: 24px;
  border-radius: 18px;
  background: var(--te-card-bg);
  color: var(--te-neutral-900);
  border: 1px solid var(--te-card-border);
  box-shadow: 0 24px 80px #0004;
}
.analysis-extras header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.analysis-extras h2 {
  font-size: 20px;
  margin: 0;
}
.analysis-extras button,
.analysis-extras select,
.analysis-extras input:not([type='checkbox']) {
  font: inherit;
  color: inherit;
  background: var(--te-subtle-bg);
  border: 1px solid var(--te-card-border);
  padding: 8px 10px;
  border-radius: 8px;
}
.analysis-extras button {
  cursor: pointer;
  min-height: 36px;
}
.analysis-extras :focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 2px;
}
.analysis-extras details {
  border-top: 1px solid var(--te-card-border);
  padding: 16px 0;
}
.analysis-extras summary {
  cursor: pointer;
  font-weight: 600;
}
.extras-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 12px;
}
.extras-actions label {
  display: flex;
  align-items: center;
  gap: 5px;
}
.extras-actions input:not([type='checkbox']) {
  width: 85px;
}
.analysis-extras p {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.analysis-extras table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 12px;
}
.analysis-extras td,
.analysis-extras th {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid var(--te-card-border);
}
</style>
