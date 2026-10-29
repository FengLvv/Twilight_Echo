<script lang="ts">
import { reactive } from 'vue'
import { useCoreConnection } from '../../stores/coreConnection.ts'
import { createCommentDrafts } from './commentDrafts.ts'
import type { CommentPublishResult } from '../../../../shared/ncmComments.ts'
const drafts = createCommentDrafts(
  async (request) =>
    (await useCoreConnection().command('comments.publish', request)) as CommentPublishResult,
  (value) => reactive(value)
)
</script>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  NCM_COMMENT_MAX_LENGTH,
  type CommentAccount,
  type CommentSong
} from '../../../../shared/ncmComments.ts'
const props = defineProps<{ song: CommentSong }>()
const emit = defineEmits<{ published: []; latest: [] }>()
const core = useCoreConnection()
const expanded = ref(false)
const checking = ref(false)
const account = ref<CommentAccount | null>(null)
const accountError = ref('')
const input = ref<HTMLTextAreaElement>()
const draft = computed(() => drafts.get(props.song.id))
const count = computed(() => Array.from(draft.value.text.trim()).length)
const canSend = computed(
  () =>
    account.value?.loggedIn &&
    !checking.value &&
    !draft.value.sending &&
    count.value > 0 &&
    count.value <= NCM_COMMENT_MAX_LENGTH
)
const scope = new AbortController()
let generation = 0
async function checkAccount() {
  const id = ++generation
  checking.value = true
  accountError.value = ''
  try {
    const result = await core.query('comments.account', {}, scope.signal)
    if (id === generation && !scope.signal.aborted) account.value = result
  } catch {
    if (!scope.signal.aborted && id === generation) {
      account.value = null
      accountError.value = '暂时无法检查网易云登录状态，请重试'
    }
  } finally {
    if (id === generation) checking.value = false
  }
}
async function open() {
  expanded.value = true
  await nextTick()
  input.value?.focus()
  void checkAccount()
}
async function send() {
  if (!canSend.value || !account.value) return
  // No view-lifetime AbortSignal: hiding the section must not replay or discard an accepted write.
  await drafts.submit(props.song.id, account.value.context)
}
watch(
  () => draft.value.result,
  (result) => {
    if (result?.status === 'published') emit('published')
  }
)
watch(
  () => draft.value.text,
  (text) => {
    if (text.trim() && draft.value.result?.status === 'published') draft.value.result = null
  }
)
onBeforeUnmount(() => {
  generation++
  scope.abort()
})
</script>
<template>
  <section class="comment-composer" aria-label="写网易云评论" data-comment-composer>
    <div v-if="!expanded" class="composer-bar">
      <button type="button" class="composer-toggle" @click="open">
        <i class="ph ph-note-pencil" aria-hidden="true"></i>写评论
      </button>
    </div>
    <form v-else @submit.prevent="send" :aria-busy="draft.sending">
      <div class="composer-heading">
        <label for="native-comment-content"
          >写评论 <small>· {{ song.title }} / {{ song.artist }}</small></label
        >
        <button
          type="button"
          class="composer-close"
          aria-label="收起评论输入框"
          @click="expanded = false"
        >
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </div>
      <textarea
        id="native-comment-content"
        ref="input"
        v-model="draft.text"
        rows="4"
        :maxlength="NCM_COMMENT_MAX_LENGTH * 2"
        :disabled="draft.sending"
        :aria-invalid="count > NCM_COMMENT_MAX_LENGTH"
        aria-describedby="native-comment-help native-comment-feedback"
        placeholder="分享你听这首歌时的感受…"
        @keydown.enter.ctrl.prevent="send"
        @keydown.enter.meta.prevent="send"
      ></textarea>
      <div class="composer-footer">
        <p id="native-comment-help">
          <template v-if="checking">正在检查登录…</template>
          <template v-else-if="account?.loggedIn">将发布到网易云音乐 · Ctrl+Enter 发布</template>
          <template v-else>{{ accountError || '请先在网易云音乐源中登录' }}</template>
          <button
            v-if="!checking && !account?.loggedIn"
            type="button"
            class="composer-link"
            @click="checkAccount"
          >
            重新检查登录
          </button>
        </p>
        <span class="composer-count" :class="{ excessive: count > NCM_COMMENT_MAX_LENGTH }"
          >{{ count }}/{{ NCM_COMMENT_MAX_LENGTH }}</span
        >
        <button type="submit" class="composer-submit" :disabled="!canSend">
          {{
            draft.sending
              ? '正在发布…'
              : draft.result?.status === 'unknown'
                ? '确认未发布后重发'
                : '发布评论'
          }}
        </button>
      </div>
      <div id="native-comment-feedback" aria-live="polite" class="composer-feedback">
        <p v-if="draft.result?.status === 'published'" role="status">发布成功，已刷新最新评论。</p>
        <template v-else-if="draft.result">
          <p role="alert">{{ draft.result.message }}</p>
          <button
            v-if="draft.result.status === 'unknown'"
            type="button"
            class="composer-link"
            @click="emit('latest')"
          >
            查看最新评论
          </button>
          <button
            v-else
            type="button"
            class="composer-link"
            :disabled="checking"
            @click="checkAccount"
          >
            重新检查登录
          </button>
        </template>
      </div>
    </form>
  </section>
</template>
<style scoped>
.comment-composer {
  color: inherit;
  margin: 20px 0 10px;
  background: transparent;
}
button,
textarea {
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
.composer-bar {
  display: flex;
  justify-content: flex-end;
}
.composer-toggle,
.composer-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 20px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
}
.composer-toggle:hover,
.composer-submit:not(:disabled):hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.composer-toggle i {
  font-size: 20px;
}
.composer-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
label {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
label small {
  color: var(--te-text-secondary);
  font-size: 14px;
}
.composer-close {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  background: transparent;
  border: 0;
  border-radius: 50%;
}
.composer-close:hover {
  background: var(--te-hover-bg);
}
textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 116px;
  resize: vertical;
  padding: 14px 16px;
  font-size: 15px;
  line-height: 1.6;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, currentColor 3%, transparent);
}
textarea::placeholder {
  color: var(--te-text-secondary);
}
.composer-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 12px;
}
.composer-footer p {
  flex: 1;
  min-width: 180px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--te-text-secondary);
}
.composer-count {
  font-size: 13px;
  color: var(--te-text-secondary);
}
.composer-count.excessive {
  color: #f08a8a;
}
.composer-link {
  padding: 4px 0;
  border: 0;
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.composer-footer .composer-link {
  margin-left: 8px;
}
.composer-feedback {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.6;
}
.composer-feedback p {
  margin: 0;
}
button:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .composer-footer p {
    flex-basis: 100%;
  }
  .composer-count {
    margin-right: auto;
  }
}
</style>
