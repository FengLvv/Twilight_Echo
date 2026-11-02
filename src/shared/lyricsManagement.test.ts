import assert from 'node:assert/strict'
import test from 'node:test'

const {
  DEFAULT_LYRICS_MANAGEMENT,
  clampLyricOffset,
  effectiveLyricOffsetSeconds,
  isLyricsManagementDocument,
  projectLyricDisplay,
  projectManagedLyrics
} = (await import(
  new URL('./lyricsManagement.ts', import.meta.url).href
)) as typeof import('./lyricsManagement.ts')

test('lyrics management defaults to showing integrated translations', () => {
  assert.equal(DEFAULT_LYRICS_MANAGEMENT.showOriginal, true)
  assert.equal(DEFAULT_LYRICS_MANAGEMENT.showTranslation, true)
})

test('lyric timing combines global and per-track offsets with a bounded range', () => {
  assert.equal(effectiveLyricOffsetSeconds(120, -45), 0.075)
  assert.equal(effectiveLyricOffsetSeconds(999_999, -999_999), 0)
  assert.equal(clampLyricOffset(-120_001), -120_000)
})

test('manual lyrics take precedence without changing automatic resolver output for other choices', () => {
  const automatic = {
    original: '[00:01.00]Provider',
    translation: '[00:01.00]Translation',
    romanization: null,
    originalSource: 'provider',
    translationSource: 'provider',
    romanizationSource: null
  }
  const manual = projectManagedLyrics(automatic, {
    offsetMs: 0,
    source: 'manual',
    original: '[00:01.00]Edited',
    translation: null,
    romanization: '[00:01.00]Roma',
    updatedAt: '2026-07-18T00:00:00.000Z'
  })

  assert.equal(manual.original, '[00:01.00]Edited')
  assert.equal(manual.originalSource, 'manual')
  assert.equal(manual.translation, null)
  assert.equal(manual.romanizationSource, 'manual')
  assert.equal(
    projectManagedLyrics(automatic, manualOverride()).original,
    '',
    'empty manual original must leave loading state (null → confirmed empty)'
  )
  assert.equal(
    projectManagedLyrics(automatic, { ...manualOverride(), source: 'provider' }),
    automatic
  )
  assert.deepEqual(automatic, {
    original: '[00:01.00]Provider',
    translation: '[00:01.00]Translation',
    romanization: null,
    originalSource: 'provider',
    translationSource: 'provider',
    romanizationSource: null
  })
})

test('layer source selections combine manual and automatic lyrics independently', () => {
  const automatic = {
    original: '[00:01.00]Local original',
    translation: '[00:01.00]Provider translation',
    romanization: '[00:01.00]Provider romanization',
    originalSource: 'local',
    translationSource: 'provider',
    romanizationSource: 'provider'
  }
  const mixed = projectManagedLyrics(automatic, {
    ...manualOverride(),
    source: 'auto',
    originalSelection: 'manual',
    translationSelection: 'automatic',
    romanizationSelection: 'manual',
    original: '[00:01.00]Custom original',
    translation: '[00:01.00]Unused translation',
    romanization: '[00:01.00]Custom romanization'
  })

  assert.deepEqual(mixed, {
    original: '[00:01.00]Custom original',
    translation: '[00:01.00]Provider translation',
    romanization: '[00:01.00]Custom romanization',
    originalSource: 'manual',
    translationSource: 'provider',
    romanizationSource: 'manual'
  })
})

test('provider and local layer choices keep resolver-owned content out of manual overrides', () => {
  const automatic = {
    original: '[00:01.00]Local original',
    translation: '[00:01.00]Provider translation',
    romanization: null,
    originalSource: 'local',
    translationSource: 'provider',
    romanizationSource: null
  }
  const projected = projectManagedLyrics(automatic, {
    ...manualOverride(),
    source: 'auto',
    originalSelection: 'local',
    translationSelection: 'provider',
    original: '[00:01.00]Stale manual original',
    translation: '[00:01.00]Stale manual translation'
  })

  assert.equal(projected.original, automatic.original)
  assert.equal(projected.translation, automatic.translation)
  assert.equal(projected.originalSource, 'local')
  assert.equal(projected.translationSource, 'provider')
})

test('lyric display toggles independently hide original, translation, and romanization', () => {
  const line = {
    text: 'Original',
    translation: 'Translation',
    romanization: 'Roma',
    voices: [
      {
        voiceKey: 'v1',
        role: 'lead',
        lane: 'center',
        text: 'Voice original',
        translation: { time: 1, text: 'Voice translation' },
        romanization: { time: 1, text: 'Voice romanization' }
      }
    ]
  }
  const hidden = projectLyricDisplay(line, {
    showOriginal: false,
    showTranslation: true,
    showRomanization: false
  })
  assert.deepEqual(hidden, {
    ...line,
    text: '',
    translation: 'Translation',
    romanization: null,
    voices: [
      {
        ...line.voices[0],
        text: '',
        translation: { time: 1, text: 'Voice translation' },
        romanization: null
      }
    ]
  })
})

test('lyrics management validation rejects malformed and oversized track maps', () => {
  assert.equal(
    isLyricsManagementDocument({
      schemaVersion: 1,
      globalOffsetMs: 0,
      showOriginal: true,
      showTranslation: true,
      showRomanization: false,
      tracks: { song: manualOverride() }
    }),
    true
  )
  assert.equal(isLyricsManagementDocument({ schemaVersion: 1, tracks: {} }), false)
})

function manualOverride() {
  return {
    offsetMs: 0,
    source: 'manual' as const,
    original: null,
    translation: null,
    romanization: null,
    updatedAt: '2026-07-18T00:00:00.000Z'
  }
}
