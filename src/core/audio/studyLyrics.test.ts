import test from 'node:test'
import assert from 'node:assert/strict'
import { studyLyrics } from './studyLyrics.ts'
import type { CoreLyricsContent } from '../../shared/coreLyrics.ts'
const content = (original:string,offsetSeconds=0):CoreLyricsContent => ({
  revision:1,contentRevision:1,current:{trackId:'song',occurrenceId:'one'},
  automatic:null,effective:{original,translation:'translated',romanization:'romanized',originalSource:'provider',translationSource:'provider',romanizationSource:'provider'},
  override:null,offsetSeconds
})
test('notation freezes selected original lyrics in audio time and retains display row indices',()=>{
  const rows=JSON.parse(studyLyrics(content('[00:00.00]作词：作者\n[00:02.00]釉色渲染仕女图\n[00:04.00]韵味被私藏',.5),'song',9))
  assert.deepEqual(rows,[{id:1,start:1.5,end:3.5,text:'釉色渲染仕女图'},{id:2,start:3.5,end:9,text:'韵味被私藏'}])
})
test('notation accepts native word-timed lyrics and rejects absent or stale lyrics',()=>{
  const rows=JSON.parse(studyLyrics(content('[1000,2000](1000,500,0)大(1500,1500,0)人'),'song',5))
  assert.equal(rows[0].text,'大人');assert.equal(rows[0].start,1);assert.equal(rows[0].end,3)
  assert.throws(()=>studyLyrics(content('plain lyrics'),'song',10),/带时间/)
  assert.throws(()=>studyLyrics(content('[00:01]词'),'different',10),/变化/)
})
