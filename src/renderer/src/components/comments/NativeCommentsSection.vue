<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { TrackData } from '../../../../shared/track.ts'
import type {
  CommentsRead,
  CommentsEdit,
  SongAssociation,
  CommentPage,
  CommentSong,
  MusicComment
} from '../../../../shared/ncmComments.ts'
import { useCoreConnection } from '../../stores/coreConnection.ts'
import { usePlayerStore } from '../../stores/usePlayerStore.ts'
import CoverImg from '../CoverImg.vue'
import CommentRow from './CommentRow.vue'
import CommentComposer from './CommentComposer.vue'
const core = useCoreConnection()
const { currentTrack } = usePlayerStore()
const emit = defineEmits<{ back: [] }>()
const list = ref<HTMLElement>()
const searchText = ref(''),
  songLink = ref('')
const state = reactive({
  association: null as SongAssociation | null,
  items: [] as MusicComment[],
  candidates: [] as CommentSong[],
  tab: (localStorage.getItem('native-comments-tab') === 'latest' ? 'latest' : 'hot') as
    | 'hot'
    | 'latest',
  loading: false,
  error: '',
  total: 0,
  offset: 0,
  hasMore: false,
  choosing: false,
  retryMore: false
})
let sequence = 0,
  scope = new AbortController()
const track = computed(() => currentTrack.value as TrackData | null)
const associationLabel = computed(
  () =>
    ({
      explicit: '网易云歌曲',
      manual: '手动关联',
      auto: '自动关联',
      paused: '已暂停自动关联',
      choose: '请选择对应歌曲'
    })[state.association?.kind ?? 'choose']
)
function resetRequests() {
  scope.abort()
  scope = new AbortController()
  return ++sequence
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
function compactTrack(value: CommentsEdit['track']) {
  const { id, title, artist, album, duration, ncmSongId, source } = value
  return { id, title, artist, album, duration, ncmSongId, source }
}
function read(request: CommentsRead) {
  return core.query(
    'comments.read',
    'track' in request ? { ...request, track: compactTrack(request.track) } : request,
    scope.signal
  )
}
function edit(request: CommentsEdit) {
  return core.command(
    'comments.edit',
    { ...request, track: compactTrack(request.track) },
    scope.signal
  )
}
async function resolve() {
  const id = resetRequests()
  Object.assign(state, {
    association: null,
    items: [],
    candidates: [],
    error: '',
    offset: 0,
    total: 0,
    hasMore: false,
    choosing: false,
    loading: !!track.value
  })
  if (list.value) list.value.scrollTop = 0
  searchText.value = track.value ? `${track.value.title} ${track.value.artist}` : ''
  songLink.value = ''
  if (!track.value) return
  try {
    const result = (await read({ operation: 'resolve', track: track.value })) as SongAssociation
    if (id !== sequence) return
    Object.assign(state, {
      association: result,
      candidates: result.candidates ?? [],
      choosing: !result.song,
      loading: false
    })
    if (result.song) await load()
  } catch (error) {
    if (id === sequence)
      Object.assign(state, { loading: false, choosing: true, error: message(error) })
  }
}
async function load(more = false, force = false) {
  if (!state.association?.song || state.loading) return
  const id = sequence
  Object.assign(state, { loading: true, error: '', retryMore: more })
  try {
    const page = (await read({
      operation: 'comments',
      songId: state.association.song.id,
      sort: state.tab,
      offset: more ? state.offset : 0,
      force
    })) as CommentPage
    if (id !== sequence) return
    const items = more ? [...state.items] : []
    const seen = new Set(items.map((item) => item.id))
    for (const item of page.items)
      if (!seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
    Object.assign(state, {
      items,
      total: page.total,
      offset: page.nextOffset,
      hasMore: page.hasMore,
      loading: false
    })
  } catch (error) {
    if (id === sequence) Object.assign(state, { loading: false, error: message(error) })
  }
}
async function tab(value: 'hot' | 'latest') {
  if (state.tab === value) return
  if (!state.association?.song) {
    state.tab = value
    localStorage.setItem('native-comments-tab', value)
    return
  }
  resetRequests()
  Object.assign(state, {
    tab: value,
    items: [],
    offset: 0,
    hasMore: false,
    loading: false,
    error: ''
  })
  localStorage.setItem('native-comments-tab', value)
  if (list.value) list.value.scrollTop = 0
  await load()
}
async function choose(operation: 'associate' | 'unlink' | 'rematch', value?: string) {
  if (!track.value) return
  const id = resetRequests()
  Object.assign(state, { loading: true, error: '' })
  try {
    const request = { operation, track: track.value, value }
    const result = (await (operation === 'rematch'
      ? read({ operation, track: track.value })
      : edit(request as CommentsEdit))) as SongAssociation
    if (id !== sequence) return
    Object.assign(state, {
      association: result,
      candidates: result.candidates ?? [],
      choosing: !result.song,
      items: [],
      total: 0,
      offset: 0,
      hasMore: false,
      loading: false
    })
    if (result.song) await load()
  } catch (error) {
    if (id === sequence) Object.assign(state, { loading: false, error: message(error) })
  }
}
async function search() {
  if (!track.value) return
  const id = resetRequests()
  Object.assign(state, { loading: true, error: '', choosing: true })
  try {
    const candidates = (await read({
      operation: 'search',
      query: searchText.value,
      track: track.value
    })) as CommentSong[]
    if (id === sequence) Object.assign(state, { candidates, loading: false })
  } catch (error) {
    if (id === sequence) Object.assign(state, { loading: false, error: message(error) })
  }
}
function retry() {
  if (!state.association?.song) void resolve()
  else void load(state.retryMore, true)
}
async function published() {
  resetRequests()
  Object.assign(state, { tab: 'latest', items: [], offset: 0, hasMore: false, loading: false, error: '' })
  localStorage.setItem('native-comments-tab', 'latest')
  await load(false, true)
}
watch(
  () =>
    JSON.stringify([
      track.value?.id,
      track.value?.title,
      track.value?.artist,
      track.value?.album,
      track.value?.duration,
      track.value?.ncmSongId
    ]),
  resolve,
  { immediate: true }
)
onBeforeUnmount(() => {
  resetRequests()
})
</script>
<template>
  <section class="native-comments-section" aria-label="网易云评论" data-native-comments>
    <button
      v-if="track"
      class="current-song-summary"
      type="button"
      title="回到歌词"
      aria-label="回到歌词"
      @click="emit('back')"
    >
      <CoverImg :cover="track.cover" :identity="track.id" alt="" />
      <span
        ><strong>{{ track.title }}</strong
        ><small> · {{ track.artist }}</small></span
      >
      <i class="ph ph-caret-up" aria-hidden="true"></i>
    </button>
    <header class="panel-heading">
      <h2>
        全部评论 <sup>{{ state.total.toLocaleString() }}</sup>
      </h2>
    </header>
    <div ref="list" class="panel-scroll">
      <section v-if="track && state.association?.kind !== 'explicit'" class="song-info">
        <div>
          <p class="association">
            {{ associationLabel
            }}<template v-if="state.association?.song">
              · {{ state.association.song.title }} / {{ state.association.song.artist }}</template
            >
          </p>
          <div class="association-actions">
            <button
              type="button"
              class="comment-action"
              :disabled="state.loading"
              @click="choose('rematch')"
            >
              更换关联</button
            ><button
              v-if="state.association?.song"
              type="button"
              class="comment-action"
              :disabled="state.loading"
              @click="choose('unlink')"
            >
              取消关联
            </button>
          </div>
        </div>
      </section>
      <div v-if="!track" class="empty-state">
        <i class="ph ph-chat-circle-text" aria-hidden="true"></i>
        <p>播放一首歌曲，在这里阅读它的评论。</p>
      </div>
      <template v-else>
        <section v-if="state.choosing" class="matching">
          <p>选择相同歌手、专辑和版本的网易云歌曲。</p>
          <form @submit.prevent="search">
            <label for="native-comment-search">搜索歌曲</label>
            <div class="input-row">
              <input id="native-comment-search" v-model="searchText" maxlength="200" /><button
                type="submit"
                :disabled="state.loading"
              >
                搜索
              </button>
            </div>
          </form>
          <button
            v-for="song in state.candidates"
            :key="song.id"
            class="candidate"
            type="button"
            :disabled="state.loading"
            @click="choose('associate', song.id)"
          >
            <strong>{{ song.title }}</strong
            ><span>{{ song.artist }} · {{ song.album }}</span
            ><span
              >{{ Math.floor(song.duration / 60) }}:{{
                String(Math.round(song.duration % 60)).padStart(2, '0')
              }}
              {{ song.version }}</span
            >
          </button>
          <form @submit.prevent="choose('associate', songLink)">
            <label for="native-song-link">网易云歌曲链接或 ID</label>
            <div class="input-row">
              <input
                id="native-song-link"
                v-model="songLink"
                maxlength="4096"
                placeholder="https://music.163.com/song?id=…"
              /><button type="submit" :disabled="state.loading || !songLink.trim()">关联</button>
            </div>
          </form>
        </section>
        <CommentComposer v-if="state.association?.song" :key="state.association.song.id"
          :song="state.association.song" @published="published" @latest="published" />
        <nav class="comment-tabs" aria-label="评论排序">
          <div role="tablist">
            <button
              v-for="value in ['hot', 'latest'] as const"
              :key="value"
              type="button"
              role="tab"
              :aria-selected="state.tab === value"
              :tabindex="state.tab === value ? 0 : -1"
              @click="tab(value)"
              @keydown.right.prevent="tab(value === 'hot' ? 'latest' : 'hot')"
              @keydown.left.prevent="tab(value === 'hot' ? 'latest' : 'hot')"
            >
              {{ value === 'hot' ? '热评' : '最新' }}
            </button>
          </div>
          <span>{{ state.total.toLocaleString() }}</span
          ><button
            type="button"
            class="icon-btn"
            title="刷新评论"
            aria-label="刷新评论"
            :disabled="state.loading || !state.association?.song"
            @click="load(false, true)"
          >
            <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
          </button>
        </nav>
        <div v-if="state.error" class="error-state" role="alert">
          <p>{{ state.error }}</p>
          <button type="button" @click="retry">重试</button>
        </div>
        <div
          v-if="state.loading && !state.items.length"
          class="loading-state"
          role="status"
          aria-live="polite"
        >
          <p>{{ state.association?.song ? '正在加载评论…' : '正在匹配歌曲…' }}</p>
          <div v-for="n in 3" :key="n" class="skeleton"></div>
        </div>
        <div
          role="tabpanel"
          :aria-label="state.tab === 'hot' ? '热评' : '最新评论'"
          :aria-busy="state.loading"
        >
          <CommentRow
            v-for="comment in state.items"
            :key="`${track.id}:${comment.id}`"
            :comment="comment"
            :signal="scope.signal"
          />
        </div>
        <p
          v-if="!state.loading && !state.error && state.association?.song && !state.items.length"
          class="empty-state"
        >
          暂无评论
        </p>
        <button
          v-if="state.hasMore"
          class="load-more"
          type="button"
          :disabled="state.loading"
          @click="load(true)"
        >
          {{ state.loading ? '正在加载…' : '加载更多评论' }}
        </button>
      </template>
      <p class="attribution">来自网易云音乐</p>
    </div>
  </section>
</template>
<style scoped>
.native-comments-section {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  --te-text-primary: var(--te-playback-page-text, #f4f7fb);
  --te-text-secondary: color-mix(in srgb, var(--te-playback-page-text, #f4f7fb) 56%, transparent);
  --te-hover-bg: color-mix(in srgb, var(--te-playback-page-text, #f4f7fb) 6%, transparent);
  --te-border-color: color-mix(in srgb, var(--te-playback-page-text, #f4f7fb) 10%, transparent);
  background: transparent;
  color: inherit;
  font-family: var(--te-font-sans);
  overflow: visible;
}
.current-song-summary {
  position: sticky;
  top: 56px;
  z-index: 3;
  backdrop-filter: blur(18px);
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(760px, 100%);
  margin: 0 auto 48px;
  padding: 10px 20px 10px 10px;
  border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.current-song-summary :deep(img) {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
}
.current-song-summary span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.current-song-summary strong {
  font-size: 17px;
  font-weight: 500;
}
.current-song-summary small {
  font-size: 14px;
  color: var(--te-text-secondary);
}
.current-song-summary:hover {
  background: var(--te-hover-bg);
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
}
h2 {
  font-size: 20px;
  margin: 0;
}
.panel-scroll {
  min-height: 0;
  padding: 0;
}
.song-info {
  display: flex;
  gap: 14px;
  align-items: center;
}
.song-info :deep(img) {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 12px;
}
.song-info > div {
  min-width: 0;
}
h3 {
  margin: 0 0 6px;
  font-size: 17px;
  overflow-wrap: anywhere;
}
p {
  line-height: 1.6;
}
.song-info p {
  font-size: 13px;
  margin: 3px 0;
  color: var(--te-text-secondary);
}
.association-actions {
  display: flex;
  gap: 12px;
}
.comment-tabs,
.comment-tabs > div {
  display: flex;
  align-items: center;
  gap: 14px;
}
.comment-tabs {
  position: relative;
  z-index: 1;
  background: transparent;
  padding: 16px 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  margin-top: 12px;
}
.comment-tabs > span {
  margin-left: auto;
  font-size: 12px;
  color: var(--te-text-secondary);
}
.comment-tabs [role='tab'] {
  font-weight: 600;
  padding: 8px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--te-text-secondary);
}
.comment-tabs [aria-selected='true'] {
  color: var(--te-text-primary);
  border-bottom-color: var(--te-primary-500);
}
button,
input {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.comment-action {
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--te-primary-500);
  font-size: 12px;
}
.icon-btn {
  border: 0;
  background: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
}
.icon-btn:hover {
  background: var(--te-hover-bg);
}
.icon-btn i {
  font-size: 20px;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
.empty-state {
  text-align: center;
  color: var(--te-text-secondary);
  padding: 36px 10px;
  font-size: 14px;
}
.empty-state i {
  font-size: 40px;
}
.attribution {
  text-align: center;
  font-size: 12px;
  color: var(--te-text-secondary);
  margin-top: 24px;
}
.matching p {
  font-size: 14px;
}
.matching label {
  display: block;
  font-size: 13px;
  margin: 12px 0 6px;
}
.input-row {
  display: flex;
  gap: 8px;
}
.input-row input {
  width: 100%;
  min-width: 0;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: var(--te-hover-bg);
  border-radius: 8px;
  padding: 8px;
}
.input-row button,
.load-more,
.error-state button {
  background: var(--te-hover-bg);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 8px;
  padding: 8px 12px;
  white-space: nowrap;
}
.candidate {
  width: 100%;
  display: flex;
  flex-direction: column;
  text-align: left;
  gap: 4px;
  background: none;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  padding: 12px 0;
}
.candidate:hover {
  color: var(--te-primary-500);
}
.candidate span {
  font-size: 12px;
  color: var(--te-text-secondary);
}
.load-more {
  width: 100%;
  margin-top: 20px;
}
.error-state {
  font-size: 14px;
  color: var(--te-text-primary);
  padding: 12px 0;
}
.skeleton {
  height: 64px;
  border-radius: 8px;
  background: var(--te-hover-bg);
  margin: 16px 0;
}
.loading-state {
  color: var(--te-text-secondary);
  font-size: 14px;
}
</style>
