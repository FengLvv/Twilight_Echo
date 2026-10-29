<script setup lang="ts">
import { ref, watch, onBeforeUnmount, onMounted, nextTick } from 'vue'
import type { MusicComment } from '../../../../shared/ncmComments.ts'
import { useCoreConnection } from '../../stores/coreConnection.ts'
const props = defineProps<{ comment: MusicComment; signal: AbortSignal }>()
const expanded = ref(false),
  avatar = ref(''),
  copied = ref(false)
const text = ref<HTMLElement>(),
  overflowing = ref(false)
let resize: ResizeObserver | undefined
function measureText() {
  if (!expanded.value && text.value)
    overflowing.value = text.value.scrollHeight > text.value.clientHeight + 1
}
onMounted(() => {
  measureText()
  resize = new ResizeObserver(measureText)
  if (text.value) resize.observe(text.value)
})
watch(
  () => props.comment.content,
  () => void nextTick(measureText)
)
let pending: AbortController | undefined
watch(
  () => [props.comment.avatarUrl, props.signal] as const,
  async ([url, signal]) => {
    pending?.abort()
    const controller = (pending = new AbortController())
    avatar.value = ''
    if (!url) return
    try {
      const image = await useCoreConnection().query(
        'comments.read',
        { operation: 'image', url },
        AbortSignal.any([signal, controller.signal])
      )
      if (!signal.aborted && !controller.signal.aborted && typeof image === 'string')
        avatar.value = image
    } catch {
      /* Initials remain visible when the avatar is unavailable. */
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  pending?.abort()
  resize?.disconnect()
})
async function copy() {
  try {
    await navigator.clipboard.writeText(props.comment.content)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>
<template>
  <article class="comment-row" :data-comment-id="comment.id">
    <div class="avatar" aria-hidden="true">
      <img v-if="avatar" :src="avatar" alt="" @error="avatar = ''" /><span v-else>{{
        comment.nickname.slice(0, 1)
      }}</span>
    </div>
    <div class="comment-content">
      <header>
        <span>{{ comment.nickname }}</span>
      </header>
      <p ref="text" class="comment-text" :class="{ collapsed: !expanded }">{{ comment.content }}</p>
      <button
        v-if="overflowing"
        type="button"
        class="comment-action"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : '展开' }}
      </button>
      <blockquote v-for="(reply, index) in comment.replies" :key="index">
        {{ reply.nickname }}：{{ reply.content }}
      </blockquote>
      <footer>
        <time
          :datetime="new Date(comment.time).toISOString()"
          :title="new Date(comment.time).toLocaleString()"
          >{{ new Date(comment.time).toLocaleDateString() }}</time
        ><span class="likes" :aria-label="`${comment.likes} 次点赞`"
          >{{ comment.likes.toLocaleString() }}
          <i class="ph ph-thumbs-up" aria-hidden="true"></i></span
        ><button
          type="button"
          class="comment-action"
          :aria-label="`复制 ${comment.nickname} 的评论`"
          @click="copy"
        >
          {{ copied ? '已复制' : '复制' }}
        </button>
      </footer>
    </div>
  </article>
</template>
<style scoped>
.comment-row {
  display: flex;
  gap: 18px;
  padding: 26px 0;
  border-bottom: 1px solid var(--te-border-color, color-mix(in srgb, currentColor 12%, transparent));
}
.avatar {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--te-hover-bg);
  display: grid;
  place-items: center;
  color: var(--te-text-secondary);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.comment-content {
  flex: 1;
  min-width: 0;
}
header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--te-text-secondary);
  font-size: 12px;
}
header span:first-child {
  overflow-wrap: anywhere;
  color: color-mix(
    in srgb,
    var(--accent-color, currentColor) 35%,
    var(--te-text-primary, currentColor) 65%
  );
  font-size: 14px;
}
.comment-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.8;
  margin: 10px 0;
}
.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
blockquote {
  margin: 10px 0;
  padding: 2px 12px;
  border-left: 2px solid var(--te-border-color);
  background: transparent;
  color: var(--te-text-secondary);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
footer {
  margin-top: 12px;
}
.likes {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.comment-action {
  padding: 3px 0;
  border: 0;
  background: none;
  color: color-mix(
    in srgb,
    var(--accent-color, currentColor) 35%,
    var(--te-text-primary, currentColor) 65%
  );
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
</style>
