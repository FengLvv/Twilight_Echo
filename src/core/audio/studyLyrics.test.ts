import test from 'node:test'
import assert from 'node:assert/strict'
import { studyLyrics, isStudyCredit, studyLyricRows } from './studyLyrics.ts'
import type { CoreLyricsContent } from '../../shared/coreLyrics.ts'
import { buildLyricLines } from '../../shared/lyrics/lyricLineBuilder.ts'
import { projectDesktopLyricsLines } from '../../shared/lyrics/desktopLyricsProjection.ts'
import { rhythmicLyricScore, primaryLyricScore } from '../../shared/lyrics/lyricAnalysis.ts'
import { primaryLyricVoice } from '../../shared/lyrics/lyricLead.ts'
const content = (original:string,offsetSeconds=0):CoreLyricsContent => ({
  revision:1,contentRevision:1,current:{trackId:'song',occurrenceId:'one'},
  automatic:null,effective:{original,translation:'translated',romanization:'romanized',originalSource:'provider',translationSource:'provider',romanizationSource:'provider'},
  override:null,offsetSeconds
})

test('credit diagnostics retain original row identities while production freezes only non-credit lyrics',()=>{
  const original='[00:00]作词：某某\n[00:02]真正演唱的歌词'
  const raw=studyLyricRows(original,8,0,true)
  assert.deepEqual(raw.map(r=>r.id),[0,1])
  assert.deepEqual(JSON.parse(studyLyrics(content(original),'song',8)),[raw[1]])
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

test('empty LRC timestamps bound singing before long instrumental gaps without changing display row ids',()=>{
  const original='[03:34.92]最后一句\n[03:40.39]\n[04:20.00]下一句'
  assert.deepEqual(JSON.parse(studyLyrics(content(original),'song',300)),[
    {id:0,start:214.92,end:220.39,text:'最后一句'},
    {id:1,start:260,end:272,text:'下一句'}
  ])
})

test('analysis excludes production and instrument credits while retaining sung text and original row ids',()=>{
  const original='[05:31.44]Say it\'s a new world\n[05:49.51]人声编辑：汝文博@SBMS Beijing\n[05:49.89]吉他：薛峰 郑楠\n[05:50.13]鼓：李彦超\n[05:50.30]鼓录音：李杨@55TEC\n[05:50.58]和声&和声设计：华晨宇'
  const rows=JSON.parse(studyLyrics(content(original),'song',351.28))
  assert.deepEqual(rows.map(row=>[row.id,row.text]),[[0,"Say it's a new world"]])
  for(const text of ['人声编辑：名字','鼓录音：名字@55TEC','和声&和声设计：名字','Recording Studio: 55TEC'])assert(isStudyCredit(text))
  for(const text of ['民谣吉他：名字','Loop：名字','弦乐编曲：名字','弦乐改编：名字','弦乐演奏：名字',
    '人声录音室: Studio','插画: Lost7','Programing / Guitars / Keyboards &Sythn : 音乐人'])assert(isStudyCredit(text))
  for(const text of ['吉他轻轻唱','Hello: my world','梦一样的自由','Say it\'s a new world'])assert(!isStudyCredit(text))
})

test('observed studio labels, instrument credits and exact copyright notices preserve ordinary lyric sentences',()=>{
  for(const text of ['配唱编写：某某','人声录音师：某某','人声录音棚A：某棚','人声录音棚B：某棚',
    '鼓录音室2：某棚','低音吉他：某某','曼陀林：某某','小号：某某','Vocal edite：某某',
    'OP: Publisher','C - Line: 2016 Publisher','Lead & Background Vocals: Singer',
    'Talkbox: Player','Mixing Assistant: Engineer','未经著作权人许可 不得翻录翻唱或使用'])
    assert(isStudyCredit(text),text)
  for(const text of ['我在录音室里等你','录音室A的灯还亮着：你在哪','制作人说：再唱一次',
    'I said: stay','Love: don’t leave','你说未经著作权人许可 不得翻录翻唱或使用',
    '未经许可我还是爱你','Recorded at dawn, I remembered you'])assert(!isStudyCredit(text),text)
})

const ttml = (body:string,head='') => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head>${head}</head><body><div>${body}</div></body></tt>`

test('TTML freezes only the lead with its own bounds; metadata and backing stay out without heuristic credit removal',()=>{
  const source=ttml('<p begin="00:02.000" end="00:06.000"><span begin="00:02.000" end="00:04.000">作词：我心中的你</span><span ttm:role="x-bg" begin="00:03.000" end="00:06.000">伴唱</span><span ttm:role="x-translation">translation</span></p>',
    '<metadata><p begin="00:00.000" end="00:01.000">Unfamiliar attribution</p></metadata>')
  const display=buildLyricLines(source,null)
  assert.equal(display.length,1)
  assert(display[0].text.includes('伴唱'))
  assert.equal(display[0].voices?.filter(v=>v.role==='background').length,1)
  const rows=JSON.parse(studyLyrics(content(source,.5),'song',10))
  assert.deepEqual(rows,[{id:0,start:1.5,end:3.5,text:'作词：我心中的你',origin:{format:'amll-ttml',kind:'lyric'}}])
})

test('background-only TTML paragraphs are omitted from notation without changing display row identity',()=>{
  const source=ttml('<p begin="00:00.000" end="00:01.000" ttm:role="x-bg">背景声</p><p begin="00:02.000" end="00:04.000">真正主唱</p><p begin="00:02.000" end="00:04.000" ttm:role="x-translation">translation</p>')
  const display=buildLyricLines(source,null)
  assert.equal(display.length,2)
  const rows=JSON.parse(studyLyrics(content(source),'song',8))
  assert.deepEqual(rows,[{id:1,start:2,end:4,text:'真正主唱',origin:{format:'amll-ttml',kind:'lyric'}}])
})

test('lead selection retains the primary displayed voice and source row id for overlapping singers',()=>{
  const source=ttml('<p begin="00:02.000" end="00:05.000" ttm:agent="v1">First singer</p><p begin="00:02.000" end="00:05.000" ttm:agent="v2">Second singer</p>')
  const display=buildLyricLines(source,null)
  const rows=studyLyricRows(source,8)
  assert(rows.length>0)
  for(const row of rows)assert.equal(row.text,primaryLyricVoice(display[row.id])?.text)
})

test('the same lead score binds to the player and desktop while supporting lyrics remain visible',()=>{
  const source=ttml('<p begin="00:01.000" end="00:04.000"><span begin="00:01.000" end="00:03.000">Lead words</span><span ttm:role="x-bg" begin="00:02.000" end="00:04.000">Backing words</span></p>')
  const display=buildLyricLines(source,null),rows=studyLyricRows(source,8),lead=primaryLyricVoice(display[0])!
  assert.equal(rows[0].text,lead.text)
  const melody={algorithm:'test',source:'vocals' as const,key:null,notes:[{lineId:0,start:1,end:3,midi:60,lyric:lead.text}],
    scores:[{lineId:0,text:lead.text,svg:'<svg><g data-note="0"/></svg>'}]}
  assert(rhythmicLyricScore(melody,0,lead.text))
  assert(primaryLyricScore(rhythmicLyricScore(melody,0,lead.text),display[0]))
  assert.equal(primaryLyricScore(rhythmicLyricScore(melody,0,lead.text),{...display[0],voices:undefined}),undefined)
  const desktop=projectDesktopLyricsLines(display)
  assert.equal(desktop[0].text,lead.text)
  assert(rhythmicLyricScore(melody,0,desktop[0].text))
  assert(display[0].voices?.some(voice=>voice.text==='Backing words'))
})
