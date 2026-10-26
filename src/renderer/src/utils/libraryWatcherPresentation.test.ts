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
  for (const code of ['ENOSPC', 'EMFILE', 'ENFILE', 'EACCES', 'EPERM', 'ENOENT', 'EIO'])
    assert.doesNotMatch(libraryWatcherErrorText(code), new RegExp(code))
  assert.match(libraryWatcherErrorText('ENOSPC'), /inotify/)
  // An unmapped code (such as the retired Linux one) still yields usable copy.
  assert.match(libraryWatcherErrorText('linux-recursive-watch-unsupported'), /重试/)
  assert.doesNotMatch(libraryWatcherErrorText('linux-recursive-watch-unsupported'), /linux-/)
  assert.equal(libraryWatcherErrorText(null), '')
  assert.equal(libraryWatcherErrorText(''), '')
})

test('the copy matches whether the folder polls or keeps retrying', () => {
  // UNRECOVERABLE_WATCH_ERRORS in watcher.ts demotes the folder to timed
  // reconciliation; anything else is re-armed. The copy must not claim both.
  for (const code of ['ENOSPC', 'EMFILE', 'ENFILE', 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'])
    assert.match(libraryWatcherErrorText(code), /已改为定时检查/)
  for (const code of ['EACCES', 'EPERM', 'ENOENT', 'EIO', 'some-unknown-code']) {
    assert.doesNotMatch(libraryWatcherErrorText(code), /已改为定时检查/)
    assert.match(libraryWatcherErrorText(code), /重试|核对|监听/)
  }
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
