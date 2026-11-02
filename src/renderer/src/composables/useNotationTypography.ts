import { inject, nextTick, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue'

const typographyKey: InjectionKey<(pixels: number | null) => void> = Symbol('notation-typography')

export function provideNotationTypography() {
  const pixels = ref<number | null>(null)
  provide(typographyKey, value => { pixels.value = value })
  return pixels
}

export function useNotationTypography(root: Ref<HTMLElement | undefined>) {
  const report = inject(typographyKey, null)
  let observer: ResizeObserver | undefined
  const measure = () => {
    if (!report) return
    const text = root.value?.querySelector<SVGTextElement>('text.abcjs-lyric, text[data-score-lyric]')
    const transform = text?.getCTM()
    const size = text && transform
      ? parseFloat(getComputedStyle(text).fontSize) * Math.hypot(transform.c, transform.d) : 0
    report(size > 0 && Number.isFinite(size) ? Math.round(size * 100) / 100 : null)
  }
  onMounted(() => {
    observer = new ResizeObserver(measure)
    if (root.value) observer.observe(root.value)
    void nextTick(measure)
  })
  onBeforeUnmount(() => { observer?.disconnect(); report?.(null) })
  return measure
}
