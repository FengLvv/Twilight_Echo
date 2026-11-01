import test from 'node:test'
import assert from 'node:assert/strict'
import { studyLyrics, isStudyCredit } from './studyLyrics.ts'
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

test('analysis excludes production and instrument credits while retaining sung text and original row ids',()=>{
  const original='[05:31.44]Say it\'s a new world\n[05:49.51]人声编辑：汝文博@SBMS Beijing\n[05:49.89]吉他：薛峰 郑楠\n[05:50.13]鼓：李彦超\n[05:50.30]鼓录音：李杨@55TEC\n[05:50.58]和声&和声设计：华晨宇'
  const rows=JSON.parse(studyLyrics(content(original),'song',351.28))
  assert.deepEqual(rows.map(row=>[row.id,row.text]),[[0,"Say it's a new world"]])
  for(const text of ['人声编辑：名字','鼓录音：名字@55TEC','和声&和声设计：名字','Recording Studio: 55TEC'])assert(isStudyCredit(text))
  for(const text of ['吉他轻轻唱','Hello: my world','梦一样的自由','Say it\'s a new world'])assert(!isStudyCredit(text))
})
