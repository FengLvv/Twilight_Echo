import assert from 'node:assert/strict'
import test from 'node:test'

const { getPluginThemeKey, resolveSelectedPluginTheme } = (await import(
  new URL('./themeSelection.ts', import.meta.url).href
)) as typeof import('./themeSelection.ts')

const themes = [
  {
    pluginId: 'com.example.first',
    id: 'nocturne',
    name: 'Nocturne'
  },
  {
    pluginId: 'com.example.second',
    id: 'nocturne',
    name: 'Nocturne Alternate'
  }
]

test('builds stable plugin theme keys with plugin id and theme id', () => {
  assert.equal(getPluginThemeKey(themes[0]), 'com.example.first:nocturne')
})

test('resolves selected plugin theme by full key', () => {
  assert.equal(
    resolveSelectedPluginTheme(themes, 'com.example.second:nocturne')?.pluginId,
    'com.example.second'
  )
})

test('returns null when selected plugin theme is unavailable', () => {
  assert.equal(resolveSelectedPluginTheme(themes, 'com.example.missing:nocturne'), null)
})
