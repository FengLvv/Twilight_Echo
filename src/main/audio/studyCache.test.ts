import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createStudyCacheValidator, studySignature, studyVocalKeys } from './studyCache.ts'
import credits from '../../../resources/music-study/lyric_credits.json' with { type: 'json' }
import { STUDY_MELODY_ALGORITHM, STUDY_SCORE_LAYOUT, type StudyResult } from '../../shared/musicStudy.ts'

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'study-cache-'))
  const six=studySignature(['htdemucs6-reference-seeded-v1','torch/hub/checkpoints/5c90dfd2-34c22ccb.th'],'pcm',{})
  const result: StudyResult={version:1,duration:10,sampleRate:44100,frames:441000,stems:['vocals'],
    harmonicStems:['piano'],sourceSha256:'pcm',waveforms:{},ready:['six','chords','melody'],
    chords:{segments:[],tuningCents:null,algorithm:'model'},originalChords:{segments:[]},
    melody:{algorithm:STUDY_MELODY_ALGORITHM,source:'vocals',key:null,lyricsKey:'lyrics',notes:[],scores:[]},
    cache:{files:{},notesHash:'notes',signatures:{six,
      chords:studySignature(['sheetsage2-mert2-chord-full-paper-v1','sheetsage2/model.safetensors','mert2/model.safetensors'],six+'|piano',{}),
      notes:studySignature(studyVocalKeys(),six+'|lyrics',{}),
      score:STUDY_SCORE_LAYOUT+'|notes'}},
    models:{instruments:'six',voices:'kara',singers:'duet',singersSampleRate:24000,singersChannels:1}}
  for(const name of ['original','vocals','drums','bass','other','piano','guitar'] as const){
    await writeFile(join(root,name+'.wav'),name)
    result.cache!.files[name]={bytes:Buffer.byteLength(name),sha256:createHash('sha256').update(name).digest('hex')}
  }
  return {root,result,validate:createStudyCacheValidator(),close:()=>rm(root,{recursive:true,force:true})}
}

test('audio corruption invalidates its group while canonical chords and vocal scores remain usable offline',async t=>{
  const f=await fixture();t.after(f.close)
  assert.deepEqual((await f.validate(f.root,{},'missing-source.flac',f.result,true)).ready,['six','chords','melody'])
  await writeFile(join(f.root,'vocals.wav'),'damage') // same size, different PCM content
  const ready=(await f.validate(f.root,{},undefined,f.result,true)).ready
  assert.deepEqual(ready,['chords','melody'])
})

test('pronunciation algorithm changes require inference; engraving changes require only layout',async t=>{
  const f=await fixture();t.after(f.close)
  f.result.cache!.signatures.score='lyric-phrase-v1|notes'
  let checked=await f.validate(f.root,{},undefined,f.result)
  assert.equal(checked.notesReady,true);assert(!checked.ready.includes('melody'))
  f.result.melody!.algorithm='vocal2midi-tifa-game-medium-rhythm-v1'
  checked=await f.validate(f.root,{},undefined,f.result)
  assert.equal(checked.notesReady,false);assert(!checked.ready.includes('melody'))
})

test('a chord model update preserves the independent vocal result and six-track group',async t=>{
  const f=await fixture();t.after(f.close)
  const checked=await f.validate(f.root,{'sheetsage2/model.safetensors':'changed'},undefined,f.result)
  assert.deepEqual(checked.ready,['six','melody'])
  assert.equal(checked.notesReady,true)
})

test('changing the credit policy invalidates vocal inference without evicting six tracks or chords',async t=>{
  const f=await fixture();t.after(f.close)
  const updated={...credits,roles:[...credits.roles,'Additional test credit role']}
  const checked=await createStudyCacheValidator(updated)(f.root,{},undefined,f.result)
  assert.equal(checked.notesReady,false)
  assert.deepEqual(checked.ready,['six','chords'])
})

test('structured TTML notes do not depend on the fallback text classifier or credit dictionary',async t=>{
  const f=await fixture();t.after(f.close)
  f.result.melody!.lyricFilter={mode:'structured',activity:{algorithm:'amll-structured-lyrics-v1',status:'skipped',start:null,end:null,margin:0},excluded:[]}
  f.result.cache!.signatures.notes=studySignature(studyVocalKeys(credits,true),f.result.cache!.signatures.six+'|lyrics',{})
  const updated={...credits,roles:[...credits.roles,'Unrelated fallback change']}
  const checked=await createStudyCacheValidator(updated)(f.root,{},undefined,f.result)
  assert(checked.notesReady)
  assert(checked.ready.includes('melody'))
  assert(!studyVocalKeys(credits,true).some(key=>key.startsWith('lyric-line-policy:')))
})
