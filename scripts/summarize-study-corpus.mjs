import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'

const root=resolve(process.argv[2]??'.local/study-20-song-20261101')
const runName=process.argv[3]??'reviewed'
assert(/^[a-z0-9-]+$/.test(runName))
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const cases=await read(join(root,'cases.json')),baseline=await read(join(root,'results.json'))
const verified=await read(join(root,`results-${runName}.json`)),exportsAudit=await read(join(root,`export-audit-${runName}.json`))
assert.equal(cases.length,20);assert.equal(new Set(cases.map(c=>c.sourceSha256)).size,20)
assert.equal(verified.length,20);assert(verified.every(row=>row.outcome==='passed'))
assert.equal(exportsAudit.length,40)
const songs=[]
for(const entry of cases){
 const result=verified.find(r=>r.ncmId===entry.ncmId);assert(result)
 const project=await read(join(root,'results-'+runName,String(entry.index).padStart(2,'0')+'-'+entry.ncmId,'project.json'))
 assert.equal(project.result.melody.algorithm,'vocal2midi-tifa-game-medium-rhythm-v4')
 assert.equal(project.result.melody.timings.reusedGroups,0)
 assert(project.result.melody.timings.processedGroups>0)
 assert.equal(result.recognitionEvidence.notesHash,project.result.cache.notesHash)
 assert(Number.isFinite(result.recognitionEvidence.elapsedMs))
 assert.equal(exportsAudit.filter(row=>row.index===entry.index).length,2)
 const chordDurations={}
 for(const segment of project.result.chords.segments)chordDurations[segment.label]=(chordDurations[segment.label]??0)+segment.end-segment.start
 const dominant=Object.entries(chordDurations).sort((a,b)=>b[1]-a[1])[0]
 songs.push({index:entry.index,ncmId:entry.ncmId,title:entry.title,artist:entry.artist,coverage:entry.coverage,
  language:entry.language,duration:result.duration,chords:result.chords,notes:result.notes,scoreRows:result.scoreRows,
  melodyAlgorithm:project.result.melody.algorithm,recognitionMs:result.recognitionEvidence.elapsedMs,
  layoutMs:result.timings.melody.parts.layoutMs??null,wallMs:result.wallMs,
  inferredMelodyKey:result.key,sourceSha256:entry.sourceSha256,pcmSha256:result.sourceSha256,
  maxAudioPeak:Math.max(...Object.values(result.audio.peaks)),audioMixtureResidualRatio:result.audio.mixtureResidualRatio,
  cacheBytes:result.cache.usedBytes,dominantChord:{label:dominant[0],durationShare:dominant[1]/result.duration},outcome:result.outcome})
}
const stats=values=>{const sorted=values.toSorted((a,b)=>a-b);return {min:sorted[0],median:(sorted[9]+sorted[10])/2,max:sorted.at(-1)}}
const summary={date:'2026-11-01',hardware:'NVIDIA RTX 5080 16 GiB; system RAM 127.5 GiB; Windows 11',
 executable:'dist/study-corpus-reviewed/win-unpacked/TwilightEcho.exe',
 corpus:{songs:20,seconds:songs.reduce((s,r)=>s+r.duration,0),selection:'Authorized full recordings from NetEase; coverage labels manually selected, not provider genre metadata'},
 baseline:{passed:baseline.filter(r=>r.outcome==='passed').length,failed:baseline.filter(r=>r.outcome==='failed').map(r=>({index:r.index,title:r.title,error:r.error}))},
 verified:{passed:20,failed:0,exports:40,notes:songs.reduce((s,r)=>s+r.notes,0),scoreRows:songs.reduce((s,r)=>s+r.scoreRows,0),
  cacheLimitBytes:2*1024**3,maxObservedCommittedCacheBytes:Math.max(...songs.map(r=>r.cacheBytes)),
  recognitionMs:stats(songs.map(r=>r.recognitionMs)),layoutMs:stats(songs.map(r=>r.layoutMs)),
  maxMidiRoundTripErrorMs:Math.max(...exportsAudit.map(r=>r.midiMaxTimeErrorMs))},
 qualityObservations:songs.filter(s=>s.dominantChord.durationShare>.95).map(s=>({index:s.index,title:s.title,
  observation:'Chord output is highly concentrated; requires listening/reference-score review, not counted as recognition accuracy',...s.dominantChord})),songs}
const reportPath=resolve('docs/study-20-song-validation-20261101.md')
await writeFile(resolve('docs/study-20-song-validation-20261101.json'),JSON.stringify(summary,null,2)+'\n')
const seconds=ms=>(ms/1000).toFixed(1)
const duration=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`
const rows=songs.map(s=>`| ${s.index} | [${s.title}](https://music.163.com/song?id=${s.ncmId}) | ${s.artist} | ${s.coverage} | ${duration(s.duration)} | ${s.chords} | ${s.notes} / ${s.scoreRows} | ${seconds(s.recognitionMs)} / ${seconds(s.layoutMs)} | 通过${s.dominantChord.durationShare>.95?'；和弦待核对':''} |`).join('\n')
const report=`# 20 首完整歌曲验证 · 2026-11-01

同一批 20 首完整歌曲，首轮 14 首通过、6 首失败；修复后 20 首通过，40 份简谱／五线谱原生导出通过。覆盖华语、英语、日语、双主唱、说唱、舞曲、摇滚、爵士及长拖音，共 ${(summary.corpus.seconds/60).toFixed(1)} 分钟音源。曲风标签是人工选样类别。

## 环境与验证边界

- Windows 11，RTX 5080 16 GiB，系统内存 127.5 GiB。使用隔离 QA profile、音量为 0，未切换用户原有播放器的播放状态。
- 实际已打包应用：\`${summary.executable}\`。实际模型、完整音源与原始定时歌词，经 Agent CLI 顺序提交六轨、和弦、旋律任务。
- Core 管理的音频缓存上限保持 2 GiB；观察到的最大已提交占用 ${(summary.verified.maxObservedCommittedCacheBytes/1024**3).toFixed(3)} GiB。通过连续任务检验淘汰与持久结果复用。
- 检查七个 WAV（原曲＋六轨）的帧数、采样率、声道、有限 PCM；和弦覆盖完整时间轴；每行演唱歌词有谱面，每个音符有 SVG 时间映射，原词未被识别器改写。
- 40 份原生 SVG/PDF 导出：MIDI 的音高、音符数量及原始起止时间与内部结果逐一比较，最大往返误差 ${summary.verified.maxMidiRoundTripErrorMs.toFixed(3)} ms；MusicXML 的逐行音高、歌词、连音身份核对通过。
- 这是功能、数据完整性与导出一致性验证。没有人工标注的音高／和弦真值，不能将 20/20 功能通过率称为识别准确率；双人合唱、说唱和复杂和声仍需听辨核对。本轮未逐首运行可选主唱／和声、双歌手子轨拆分。
- 《Stan》的服务端歌词有星号遮罩。保留接口原文，不补写被遮罩的词；相关段落无法据此验证逐词发音准确度。
- 谱面当前以 4/4 组织小节，时间量化来自推断节拍；本轮没有验证变拍号或自由节奏的乐理正确性。
- 质量疑点：《Play我呸 (Alesso Remix Version)》仅输出 5 段和弦，约 99% 时长被标为 Bb。该输出过于集中，保留为待听辨／参考谱核对项，不能以流程通过认定识别可靠。

## 发现与修复

1. 制作署名误入音符：中英制作角色与乐器角色组合共用一份有限规则，覆盖实际遇到的录音室、编曲、插画等署名及服务端拼写别名，保留正常演唱原词。
2. MP3 尾部时间差：《倔强》《大鱼》的元数据时长比解码后长约 50 ms；演唱歌词仅允许在 100 ms 内裁到实际尾部，明显错位继续拒绝；署名先过滤。
3. 英语数字：\`24/7\`、\`90\` 等生成合法候选发音，保留数字原词和行归属；由 TiFA 根据音频选择整条发音。
4. 标点：\`「」『』\` 等 Unicode 标点不再成为未知音素，独立 \`-\`／\`--\` 不再被当成英文单词生成虚构发音；词内连字符、撇号、长音与原文对应保留。
5. 排谱进程：首轮两首歌触发 Windows \`libintl-8.dll\` 访问冲突；将 LilyPond 子进程语言环境固定为 C，补全退出码诊断。同一歌曲 57 行 SVG 与修改前逐字节一致，完整复测未再触发。
6. 缓存阶段状态：六轨输出带回旧音符时，按统一来源校验判断是否可复用，正确预留识谱临时空间；对子进程传递算法版本，避免错误复用与错误标记。新增接近缓存上限的实际回归场景。
7. 时值与小节边界：《大鱼》的复合休止符曾在转换时丢失附点，现先分解复合时值；《Stan》的首音量化到下一小节后曾留下空小节，现以相同量化网格确定小节基准。保留时长、连音身份和原生小节校验。
8. 间奏边界：空白 LRC 时间行现在用于结束前一句演唱，防止将后续无词间奏当成长达 40 秒的歌词范围；普通歌词的行 ID 与显示不变。

算法身份升级为 \`vocal2midi-tifa-game-medium-rhythm-v4\`，排版身份升级为 \`lyric-phrase-v4\`，旧结果按内容身份失效，不冒充新模型结果。

## 样本结果

“识谱 / 排谱”单位为秒。识谱是生成 V4 原始音符的独立计时，包含依赖和模型加载、节拍、歌词对齐及音高推理。20 首均重新执行过 V4 音符识别，未复用旧算法的识别上下文；随后仅排谱修复的复核复用这些音符，并逐首核对内容哈希。19 首音频检查沿用同一 PCM 的完整运行证据，《Stan》在恢复时重新检查六轨；新版排谱与两种导出对全部 20 首重新执行。该数值不包含六轨、和弦、首次环境检查和导出，不能视为端到端时长。识谱中位数 ${seconds(summary.verified.recognitionMs.median)} 秒，范围 ${seconds(summary.verified.recognitionMs.min)}–${seconds(summary.verified.recognitionMs.max)} 秒；排谱中位数 ${seconds(summary.verified.layoutMs.median)} 秒。

| # | 歌曲 | 歌手 | 覆盖类别 | 时长 | 和弦段 | 音符 / 谱面行 | 识谱 / 排谱 s | 结果 |
|---|---|---|---|---:|---:|---:|---:|---|
${rows}

## 复现与证据

\`scripts/prepare-study-corpus.mjs\` 选择完整音源；\`scripts/test-study-corpus.mjs --run-name complete --executable dist/study-corpus-final/win-unpacked/TwilightEcho.exe\` 运行完整分析；\`scripts/test-study-corpus.mjs --run-name reviewed --baseline complete --executable dist/study-corpus-reviewed/win-unpacked/TwilightEcho.exe\` 复核新版排谱；\`scripts/audit-study-corpus-exports.py .local/study-20-song-20261101 reviewed\` 核对导出；\`scripts/summarize-study-corpus.mjs\` 生成本文及配套 JSON。恢复复测依赖本机保存的 \`inference-evidence.json\`，不能用缺失或不同哈希的原始音符替代。

完整日志、逐首结果、音频与导出只保留在本机 \`.local/study-20-song-20261101\`，未将歌曲或歌词加入仓库。源码回归：195 项 Node 测试与 29 项歌词解析测试、Python 专项测试、三个 TypeScript 工程检查及打包资源闭包检查通过。
`
await writeFile(reportPath,report)
console.log(JSON.stringify({report:reportPath,...summary.verified}))
