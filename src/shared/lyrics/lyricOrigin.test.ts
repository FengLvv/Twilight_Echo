import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimedLrc, parseNeteaseJsonLyricLine } from './lyricParser.ts'
import { buildLyricLines } from './lyricLineBuilder.ts'
import { studyLyricRows, studyLyricsFromText } from '../../core/audio/studyLyrics.ts'

const record = (t: number, text: string) => JSON.stringify({ t, c: [{ tx: text }] })

test('explicit provider metadata is excluded by provenance even without any known credit words', () => {
  for (const body of ['[00:02]真正演唱的歌词', '[2000,2000](2000,2000,0)真正演唱的歌词']) {
    const source = record(-1, 'A completely unfamiliar attribution') + '\n' + body
    const parsed = parseTimedLrc(source)
    assert.deepEqual(parsed[0].origin, { format: 'netease-json', kind: 'metadata' })
    const display = buildLyricLines(source, null)
    assert.equal(display[0].text, 'A completely unfamiliar attribution')
    assert.deepEqual(display[0].origin, parsed[0].origin)
    const raw = studyLyricRows(source, 8, 0, true)
    const analysis = JSON.parse(studyLyricsFromText(source, 8))
    assert.equal(raw.length, 2)
    assert.deepEqual(analysis, [raw[1]])
  }
})

test('timed or unclassified JSON text is retained; the format alone is not a metadata verdict', () => {
  const source = record(1000, 'I love you') + '\n[00:03]下一句'
  const analysis = JSON.parse(studyLyricsFromText(source, 9, .5))
  assert.equal(analysis[0].start, .5)
  assert.deepEqual(analysis[0].origin, { format: 'netease-json', kind: 'unknown' })
  assert.equal(analysis[0].text, 'I love you')
  assert.equal(parseNeteaseJsonLyricLine('{"c":[{"tx":"Unknown text"}]}')?.origin.kind, 'unknown')
  assert.equal(parseNeteaseJsonLyricLine('{"t":"-1","c":[{"tx":"Unknown text"}]}')?.origin.kind, 'unknown')
})

test('structured records do not disappear into inferred translation layers at shared timestamps', () => {
  const source = [record(1000, 'Unfamiliar credit A'), '[00:01]真正歌词一',
    record(3000, 'Unfamiliar credit B'), '[00:03]真正歌词二'].join('\n')
  const lines = buildLyricLines(source, null)
  assert.equal(lines.length, 4)
  assert(lines.every(line => line.translation == null))
  assert.equal(JSON.parse(studyLyricsFromText(source, 8)).length, 4)
})
