import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {parseNeteaseJsonLyricLine} from '../src/shared/lyrics/lyricParser.ts'

const root=resolve(process.argv[2]??'.local/vocal-boundary-20261101')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const cases=await read(join(root,'cases.json')),results=await read(join(root,'results.json'))
assert.equal(cases.length,30);assert.equal(results.length,30);assert(results.every(row=>row.outcome==='passed'))
const totals={rows:0,ruleRemoved:0,timeRemoved:0,additionalRemoved:0,structuredCredits:0,ruleStructured:0,combinedStructured:0}
const songs=[],falseDrops=[],extras=[]
const norm=text=>text.trim().replace(/\s+/g,' ')
for(const sample of results){
 const entry=cases.find(row=>row.ncmId===sample.ncmId)
 const input=await read(join(root,'cases',String(sample.index).padStart(2,'0')+'-'+sample.ncmId,'input.json'))
 const raw=await readFile(entry.lyricsFile,'utf8')
 const labels=new Set(raw.split('\n').filter(l=>l.trim().startsWith('{')).map(l=>parseNeteaseJsonLyricLine(l.trim())?.text).filter(Boolean).map(norm))
 const metadata=input.rows.filter(row=>labels.has(norm(row.text)))
 const ruleSet=new Set(sample.ruleExcluded),extraSet=new Set(sample.additionalExcluded.map(row=>row.id))
 const row={index:sample.index,ncmId:sample.ncmId,title:sample.title,artist:entry.artist,album:entry.album,
  coverage:entry.coverage,duration:entry.duration,inputRows:sample.inputRows,ruleRemoved:ruleSet.size,
  timeRemoved:sample.timeExcluded.length,additionalRemoved:extraSet.size,combinedRemoved:ruleSet.size+extraSet.size,
  structuredCredits:metadata.length,ruleStructured:metadata.filter(r=>ruleSet.has(r.id)).length,
  combinedStructured:metadata.filter(r=>ruleSet.has(r.id)||extraSet.has(r.id)).length,
  activity:sample.activity,elapsedMs:sample.elapsedMs}
 if(sample.index<=20){
  const baseline=await read(resolve('.local/study-20-song-20261101/results-reviewed',String(sample.index).padStart(2,'0')+'-'+sample.ncmId,'project.json'))
  const sung=new Set(baseline.result.melody.scores.map(row=>row.lineId))
  row.referenceSungRows=sung.size
  for(const id of extraSet)if(sung.has(id))falseDrops.push({title:row.title,id})
 }
 for(const removed of sample.excludedRows)extras.push({title:sample.title,...removed})
 for(const key of Object.keys(totals))totals[key]+=key==='rows'?row.inputRows:row[key]
 songs.push(row)
}
assert.equal(falseDrops.length,0)
// Manually reviewed against the provider text; these are three production credits.
assert.deepEqual(extras.map(x=>[x.title,x.row.id]),[['Fix You',37],['Fix You',38],['Fix You',42]])
const times=songs.map(row=>row.elapsedMs).sort((a,b)=>a-b)
let integration=null
try{
 const checked=await read(join(root,'integration/results-filtered.json'))
 if(checked.length===5&&checked.every(row=>row.outcome==='passed')){
  const audit=await read(join(root,'integration/export-audit-filtered.json'));assert.equal(audit.length,10)
  integration={songs:5,exports:10,passed:checked.map(row=>row.title)}
 }
}catch(error){if(error.code!=='ENOENT')throw error}
const summary={date:'2026-11-01',algorithm:'vocal-stem-outer-energy-v1',melodyAlgorithm:'vocal2midi-tifa-game-medium-rhythm-v5',
 corpus:{songs:30,additionalSongs:10,totalMinutes:songs.reduce((n,s)=>n+s.duration,0)/60},totals,
 combinedRemoved:totals.ruleRemoved+totals.additionalRemoved,
 textTimeOverlap:totals.timeRemoved-totals.additionalRemoved,
 timingMs:{min:times[0],median:(times[14]+times[15])/2,max:times.at(-1)},
 referenceSungRows:songs.reduce((sum,row)=>sum+(row.referenceSungRows??0),0),newlyRemovedSungRows:0,
 manuallyReviewedAdditionalCredits:extras,integration,songs}
await writeFile(resolve('docs/vocal-boundary-validation-20261101.json'),JSON.stringify(summary,null,2)+'\n')
const rows=songs.map((s,i)=>`| ${i+1} | ${s.title} | ${s.artist} | ${s.ruleRemoved} | ${s.timeRemoved} | ${s.additionalRemoved} | ${s.combinedRemoved} | ${s.activity.status==='estimated'?s.activity.start.toFixed(2)+'–'+s.activity.end.toFixed(2):'不确定，保留'} | ${s.elapsedMs} |`).join('\n')
const doc=`# 署名规则与人声范围联合过滤 · 2026-11-01

测试 30 首完整歌曲：原 20 首加 10 首新增样本，共 ${summary.corpus.totalMinutes.toFixed(1)} 分钟。新增样本覆盖弱声、气声、长前奏、长尾奏及现场版本。曲风为人工选择的覆盖类别。

## 结果

| 方法 | 本批剔除行数 |
|---|---:|
| 原有署名规则 | ${totals.ruleRemoved} |
| 单独人声范围 | ${totals.timeRemoved} |
| 两者重叠 | ${summary.textTimeOverlap} |
| 时间法额外补充 | ${totals.additionalRemoved} |
| 联合过滤 | ${summary.combinedRemoved} |

这批原始输入有 ${totals.rows} 行。独立用网易云 JSON 格式的结构化署名作为参照，共 ${totals.structuredCredits} 行：规则覆盖 ${totals.ruleStructured} 行，联合覆盖 ${totals.combinedStructured} 行。该覆盖率只适用于这批结构化署名，不代表任意歌曲的署名过滤准确率。

时间法额外剔除了《Fix You》片尾三行：音频助理、低音吉他、录音工程师。逐条对照接口原文，三行均为明确的制作署名，没有借此扩大原词表。对照原 20 首已生成谱面的 ${summary.referenceSungRows} 行演唱文本，新增误删为 0；新增剔除的 3 行也均为署名。此结论是样本检查，不能保证所有轻声、短促人声或错误时间戳都能正确处理。

范围检测中位数 ${summary.timingMs.median} ms，范围 ${summary.timingMs.min}–${summary.timingMs.max} ms，包含读取原曲和人声 WAV；不包含分轨、Python 进程启动和识谱。

## 实现与边界

保留原有行首角色规则。在六轨完成后，复用人声轨，以短时能量、相对原曲能量占比、持续时间和动态范围估计活动首尾；首尾各留 0.8 秒。没有新增推理模型或显存驻留。

只剔除完全在保护范围外的首尾行；跨界行和内部间奏行保留。信号过弱、近乎恒定或无法形成可靠范围时不授权删除；若候选全会被删，也保留原规则结果。正常歌词显示及原文不改，过滤只影响识谱输入。额外删除的行 ID、理由、范围与耗时保存在真实识谱结果中，可经 Agent CLI 检查。

分轨残留、混响、现场欢呼、无词人声会把活动范围拉宽，所以时间法不能单独替代署名规则；与真实演唱同时出现的署名仍主要靠文本规则。本次是信号活动估计，不是语音内容识别或逐帧人工标注的歌声分类评测。

## 完整程序验证

${integration?'新包内 '+integration.songs+' 首完成六轨、和弦、人声简谱及五线谱导出，'+integration.exports+' 份原生导出通过 MIDI/MusicXML 一致性检查。样本：'+integration.passed.join('、')+'。':'完整程序验证正在进行，尚未计入通过结果。'}

源码测试包括 196 项 Node 回归、42 项 Python 专项测试、三个 TypeScript 工程检查与打包资源闭包检查。可运行包位于 \`dist/study-vocal-boundaries/win-unpacked/TwilightEcho.exe\`。

## 逐首记录

“额外”指时间法在规则过滤之后新增剔除的行数；活动范围单位为秒，不等于人工确认的首个和最后一个演唱音节。专辑及版本信息见配套 JSON。

| # | 歌曲 | 歌手 | 规则 | 时间 | 额外 | 联合 | 估计活动范围 s | 检测 ms |
|---|---|---|---:|---:|---:|---:|---|---:|
${rows}

## 本机复现

\`scripts/test-vocal-boundaries.mjs\` 通过真实播放器逐首运行六轨并对比三种选择结果；\`scripts/probe-vocal-boundaries.py\` 复用生产检测函数；\`scripts/summarize-vocal-boundaries.mjs\` 生成报告。详细输入、行 ID、排除理由及谱面证据位于本机 \`.local/vocal-boundary-20261101\`，歌曲与歌词未加入 Git。
`
await writeFile(resolve('docs/vocal-boundary-validation-20261101.md'),doc)
console.log(JSON.stringify({totals,combined:summary.combinedRemoved,timing:summary.timingMs,integration}))
