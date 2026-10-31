import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createStudyCacheValidator } from './studyCache.ts'
import { VOCAL_MODEL_HASHES } from './studyModelRegistry.ts'

test('cache validity follows input, model and per-stage files and keeps captured sources usable offline', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const hash = (data: string) => createHash('sha256').update(data).digest('hex')
  const sixKey = 'torch/hub/checkpoints/5c90dfd2-34c22ccb.th',
    voiceKey = 'UVR_MDXNET_KARA_2.onnx'
  const fp = {
    [sixKey]: 'six-model',
    [voiceKey]: 'voice-model',
    'sheetsage2/model.safetensors': 'chord-model',
    'mert2/model.safetensors': 'mert-model'
  }
  const files = [
    'original',
    'vocals',
    'drums',
    'bass',
    'other',
    'piano',
    'guitar',
    'lead',
    'backing'
  ]
  for (const file of files) await writeFile(join(root, file + '.wav'), file)
  const sixFiles = Object.fromEntries(files.slice(1, 7).map((file) => [file, hash(file)]))
  const stages = {
    six: { signature: 'six-model|' + hash('original'), files: sixFiles },
    leadBacking: {
      signature: 'voice-model|' + hash('vocals'),
      files: { lead: hash('lead'), backing: hash('backing') }
    }
  }
  await writeFile(join(root, 'stages.json'), JSON.stringify(stages))
  const result = {
    sourceSha256: hash('original'),
    ready: ['six', 'chords', 'leadBacking'],
    harmonicStems: ['bass', 'piano', 'guitar', 'other']
  }
  await writeFile(join(root, 'result.json'), JSON.stringify(result))
  const signature =
    'chord-model|mert-model|' +
    result.harmonicStems.map((file) => file + ':' + hash(file)).join('|')
  await writeFile(join(root, 'chords.json'), JSON.stringify({ signature, chords: {} }))
  const validate = createStudyCacheValidator()
  assert.deepEqual((await validate(root, fp, join(root, 'missing-source.flac'))).ready, [
    'six',
    'leadBacking',
    'chords'
  ])
  await writeFile(
    join(root, 'result.json'),
    JSON.stringify({ ...result, melody: { algorithm:'vocal2midi-tifa-game-medium-rhythm-v1' }, ready: [...result.ready, 'melody'] })
  )
  const notesCache = JSON.stringify({
      signature: ['vocal2midi-tifa-game-medium-rhythm-v1', ...Object.keys(VOCAL_MODEL_HASHES).sort()].join('|') + '|' + hash('vocals') + '|' + hash('lyrics'),
      lyrics:'lyrics',
      melody: { notes: [] }
    })
  await writeFile(join(root,'vocal-notes.json'),notesCache)
  await writeFile(join(root,'vocal-score.json'),JSON.stringify({signature:'lyric-phrase-v1|'+hash(notesCache),scores:[]}))
  assert((await validate(root, fp)).ready.includes('melody'))
  assert(
    !(await validate(root, { ...fp, [Object.keys(VOCAL_MODEL_HASHES)[0]]: 'new-vocal-model' })).ready.includes(
      'melody'
    )
  )
  await rm(join(root,'vocal-score.json'))
  assert.deepEqual((await validate(root, fp)).ready, ['six', 'leadBacking', 'chords'])
  await writeFile(join(root, 'vocal-notes.json'), '{broken')
  assert.deepEqual((await validate(root, fp)).ready, ['six', 'leadBacking', 'chords'])
  await writeFile(join(root, 'result.json'), JSON.stringify(result))
  assert.deepEqual((await validate(root, { ...fp, [voiceKey]: 'new-voice' })).ready, [
    'six',
    'chords'
  ])
  assert.deepEqual(
    (await validate(root, { ...fp, 'mert2/model.safetensors': 'new-chords' })).ready,
    ['six', 'leadBacking']
  )
  await writeFile(join(root, 'lead.wav'), 'damaged')
  assert.deepEqual((await validate(root, fp)).ready, ['six', 'chords'])
  await rm(join(root, 'bass.wav'))
  assert.deepEqual((await validate(root, fp)).ready, [])
  await writeFile(join(root, 'source.flac'), 'original-source')
  const source = join(root, 'selected.flac')
  await writeFile(source, 'replacement-source')
  assert.equal((await validate(root, fp, source)).sourceChanged, true)
  assert.equal(await readFile(join(root, 'source.flac'), 'utf8'), 'original-source')
})
