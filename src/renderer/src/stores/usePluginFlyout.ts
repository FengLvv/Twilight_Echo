import { computed, ref } from 'vue'

export interface PluginFlyoutTarget {
  pluginId: string
  title: string
}

const target = ref<PluginFlyoutTarget | null>(null)

/** Host-owned flyout for plugin panel experiences opened from native controls. */
export function usePluginFlyout() {
  return {
    target: computed(() => target.value),
    open(next: PluginFlyoutTarget): void {
      target.value = next
    },
    toggle(next: PluginFlyoutTarget): void {
      target.value = target.value?.pluginId === next.pluginId ? null : next
    },
    close(): void {
      target.value = null
    }
  }
}
