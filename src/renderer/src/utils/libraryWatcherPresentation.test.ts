import assert from 'node:assert/strict'
import test from 'node:test'
import type { LibraryWatcherFolderStatus } from '../../../shared/localLibraryScan.ts'
import { libraryWatcherAttention, libraryWatcherErrorText } from './libraryWatcherPresentation.ts'

function folder(overrides: Partial<LibraryWatcherFolderStatus> = {}): LibraryWatcherFolderStatus {
  return {
    folder: '/music',
    state: 'active',
    mode: 'recursive',
    lastError: null,
    lastEventAt: null,
    lastReconcileAt: null,
    ...overrides
  }
}

test('watcher diagnostics never surface raw kernel error codes to the user', () => {
  // The retired 'linux-recursive-watch-unsupported' code reached the settings
  // page verbatim; known codes map to copy and unknown ones stay readable.
  for (const code of ['ENOSPC', 'EMFILE', 'ENFILE', 'EACCES', 'EPERM', 'ENOENT'])
    assert.doesNotMatch(libraryWatcherErrorText(code), new RegExp(code))
  assert.match(libraryWatcherErrorText('ENOSPC'), /inotify/)
  assert.equal(libraryWatcherErrorText(null), '')
  assert.equal(libraryWatcherErrorText(''), '')
  assert.doesNotMatch(libraryWatcherErrorText('linux-recursive-watch-unsupported'), /linux-/)
  assert.match(libraryWatcherErrorText('linux-recursive-watch-unsupported'), /定时检查/)
})

test('a degraded polling fallback is not reported as an actionable failure', () => {
  assert.equal(
    libraryWatcherAttention([folder({ state: 'degraded', mode: 'polling', lastError: 'ENOSPC' })]),
    ''
  )
  assert.equal(libraryWatcherAttention([folder()]), '')
  assert.equal(libraryWatcherAttention(null), '')
  assert.equal(libraryWatcherAttention([]), '')
  const attention = libraryWatcherAttention([
    folder({ state: 'failed', mode: 'none', lastError: 'EACCES' })
  ])
  assert.match(attention, /\/music/)
  assert.match(attention, /实时监听失败/)
  assert.doesNotMatch(attention, /EACCES/)
})

test('settings section renders watcher diagnostics through the presentation helpers', async () => {
  const { readFileSync } = await import('node:fs')
  const section = readFileSync(
    new URL('../components/settings-page/LibrarySettingsSection.vue', import.meta.url),
    'utf8'
  )
  // Raw lastError must not be interpolated into the template any more.
  assert.doesNotMatch(section, /\{\{\s*item\.lastError\s*\}\}/)
  assert.match(section, /libraryWatcherErrorText\(item\.lastError\)/)
  assert.match(section, /libraryWatcherAttention\(libraryWatcherStatus\?\.folders\)/)
})
