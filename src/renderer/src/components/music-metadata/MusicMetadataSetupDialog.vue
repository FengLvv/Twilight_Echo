<script setup lang="ts">
import { ref, useId } from 'vue'
import { useNativeDialog } from '../../composables/useNativeDialog.ts'
import { useFocusTrap } from '../../app/useDismissLayer.ts'

defineProps<{ saving: boolean; error: string }>()
const emit = defineEmits<{ choose: [enabled: boolean] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = `metadata-setup-${useId()}`
useNativeDialog(dialog)
useFocusTrap(dialog, () => true)
</script>

<template>
  <dialog
    ref="dialog"
    class="metadata-setup"
    :aria-labelledby="titleId"
    :aria-busy="saving"
    @cancel.prevent="!saving && emit('choose', false)"
  >
    <div class="metadata-setup-icon"><i class="pi pi-sparkles" aria-hidden="true" /></div>
    <p class="metadata-setup-eyebrow">音乐库资料</p>
    <h2 :id="titleId">让音乐资料更完整</h2>
    <p class="metadata-setup-description">
      自动补全歌手头像与简介、专辑资料等信息。一次开启全部资料源，缺失内容由网易云兜底，并保存在本地。
    </p>
    <p class="metadata-setup-privacy">
      查询歌曲、艺人、专辑名称、已有 ID
      及核对所需的时长与曲序，不上传音频或本地文件路径。以后可在设置中调整。
    </p>
    <p v-if="error" class="metadata-setup-error" role="alert">{{ error }}</p>
    <footer>
      <button type="button" :disabled="saving" @click="emit('choose', false)">暂不开启</button>
      <button
        type="button"
        class="metadata-setup-enable"
        autofocus
        :disabled="saving"
        @click="emit('choose', true)"
      >
        {{ saving ? '正在保存…' : '开启自动补全' }}
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.metadata-setup {
  position: fixed;
  inset: 0;
  box-sizing: border-box;
  width: min(520px, calc(100vw - 40px));
  max-height: calc(100dvh - 48px);
  margin: auto;
  padding: 32px;
  overflow: auto;
  border: 1px solid var(--te-card-border);
  border-radius: 24px;
  background: var(--te-card-bg);
  color: var(--te-neutral-900);
  box-shadow: 0 28px 100px rgb(0 0 0 / 25%);
  font: 15px/1.65 var(--te-font-body, system-ui, sans-serif);
}
.metadata-setup::backdrop {
  background: rgb(8 12 20 / 48%);
}
.metadata-setup-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin-bottom: 24px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--te-primary-500) 12%, transparent);
  color: var(--te-primary-500);
  font-size: 24px;
}
.metadata-setup-eyebrow {
  margin: 0 0 8px;
  color: var(--te-neutral-500);
  font-size: 13px;
}
h2 {
  margin: 0 0 16px;
  font-size: 25px;
  line-height: 1.3;
  font-weight: 650;
}
.metadata-setup-description {
  margin: 0;
}
.metadata-setup-privacy {
  margin: 16px 0 0;
  color: var(--te-neutral-500);
  font-size: 14px;
}
.metadata-setup-error {
  color: var(--te-danger-500, #dc3545);
}
footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}
button {
  min-height: 42px;
  padding: 10px 18px;
  border: 1px solid var(--te-card-border);
  border-radius: 12px;
  background: var(--te-subtle-bg);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button.metadata-setup-enable {
  border-color: transparent;
  background: var(--te-primary-500);
  color: #fff;
  font-weight: 600;
}
button:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
@media (max-width: 420px) {
  .metadata-setup {
    padding: 24px;
  }
  footer button {
    flex: 1;
  }
}
</style>
