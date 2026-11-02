import { createRequire } from 'node:module'
export const requireSdk = createRequire(import.meta.url)
export function lazySdk<T>(load: () => T): () => T {
  let cached: T
  let loaded = false
  return () => {
    if (!loaded) {
      cached = load()
      loaded = true
    }
    return cached
  }
}
export const defaultSdk = (name: string) => {
  const value = requireSdk(name)
  return value.default ?? value
}
