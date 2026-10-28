import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { collectionReleaseDate } from '../../../../shared/releaseDate.ts'
import type { GridItem } from './types.ts'

export function useAlbumReleaseDate(album: () => GridItem | null | undefined) {
  const now = shallowRef(Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  function schedule(expiresAt: number | undefined) {
    clearTimeout(timer)
    now.value = Date.now()
    if (expiresAt !== undefined && expiresAt > now.value)
      timer = setTimeout(() => schedule(expiresAt), Math.min(2147483647, expiresAt - now.value))
  }
  watch(() => album()?.metadataReleaseDate?.usage?.expiresAt, expiresAt => {
    schedule(expiresAt)
  }, { immediate: true })
  onScopeDispose(() => clearTimeout(timer))
  return computed(() => collectionReleaseDate(album(), now.value))
}
