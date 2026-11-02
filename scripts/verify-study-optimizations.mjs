import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { StudyResidentProcess } from '../src/main/audio/studyResidentProcess.ts'
import { studyLyricsFromText } from '../src/core/audio/studyLyrics.ts'

const home = process.argv[2] ?? 'D:/Tools/TwilightEchoToolchain/study'
const root = resolve('.local/study-optimization-evidence', String(Date.now()))
await mkdir(root, { recursive: true })
const rpc = new StudyResidentProcess(() => join(home, 'runtime/Scripts/python.exe'), resolve('resources/music-study/worker.py'),
  message => { void appendFile(join(root, 'runtime.log'), message) })
const fingerprints = {...JSON.parse(await readFile('resources/music-study/models.json', 'utf8')).files,
  ...JSON.parse(await readFile('resources/music-study/vocal_models.json', 'utf8')).files}
const lyrics = studyLyricsFromText(await readFile('.local/vocal-rhythm-media/Qinghuaci.lrc', 'utf8'), 268.879)
const lines = JSON.parse(lyrics)
const params = {directory:join(root,'audio'), source:resolve('.local/vocal-rhythm-media/Qinghuaci.wav'),
  pack:join(home,'models'), modelFingerprints:fingerprints, budgetBytes:2*1024**3, lyrics, operation:'melody'}
const evidence = {root, phases:[], checks:{}, lines:lines.length}
const save = () => writeFile(join(root, 'verification.json'), JSON.stringify(evidence,null,2))
let latest
async function call(method, params) {
  const start=performance.now()
  const result=await rpc.call(method,params,undefined,event=>{
    if(event.kind==='stageReady') console.log(event.phase, event.result.timings[event.phase])
  })
  evidence.phases.push({method, wallMs:Math.round(performance.now()-start)})
  await save()
  return result
}
try {
  evidence.warm=await call('warm',{pack:params.pack})
  latest=await call('analyze',params)
  await writeFile(join(root,'initial.json'),JSON.stringify(latest))
  evidence.initial={timing:latest.timings.melody,metrics:latest.melody.timings,groups:latest.melody.reuse.groups.length,notes:latest.melody.notes.length,scores:latest.melody.scores.length}
  assert(evidence.initial.groups>2)
  evidence.active=await call('residency',{})
  evidence.idle=await call('standby',{})
  assert.equal(evidence.idle.devices.six,'cuda')
  for(const [name,device] of Object.entries(evidence.idle.devices)) if(name!=='six') assert.equal(device,'cpu')
  assert(evidence.idle.cudaAllocatedBytes<256*1024**2)
  evidence.checks.allOptionalOffloaded=true
  const changed=structuredClone(lines)
  changed[1].text+='，'
  const edited=await call('analyze',{...params,previous:latest,lyrics:JSON.stringify(changed)})
  await writeFile(join(root,'edited.json'),JSON.stringify(edited))
  assert.equal(edited.melody.timings.processedGroups,1)
  assert.equal(edited.melody.timings.reusedGroups,evidence.initial.groups-1)
  assert.equal(edited.melody.timings.beatReused,true)
  const affected=latest.melody.reuse.groups.find(group=>group.lineIds.includes(lines[1].id)).lineIds
  assert.deepEqual(edited.melody.notes.filter(n=>!affected.includes(n.lineId)),latest.melody.notes.filter(n=>!affected.includes(n.lineId)))
  for(const row of edited.melody.scores) if(!affected.includes(row.lineId)) {
    assert(row.key)
    const indices=[...row.svg.matchAll(/data-note="(\d+)"/g)].map(match=>Number(match[1]))
    assert(indices.length)
    assert(indices.every(i=>edited.melody.notes[i].lineId===row.lineId))
  }
  evidence.edited={timing:edited.timings.melody,metrics:edited.melody.timings}
  evidence.checks.partialContextAndScoreReuse=true
  await call('residency',{})
  await call('standby',{})
  const cached=await call('analyze',{...params,previous:edited,lyrics:JSON.stringify(changed)})
  assert.equal(cached.timings.melody.cacheHit,true)
  assert.deepEqual(cached.melody,edited.melody)
  assert.equal((await call('residency',{})).devices.tifa,'cpu')
  evidence.checks.cacheDoesNotRestoreGpu=true
  // Reindexing lyrics must reuse contexts and rewrite SVG global note indices.
  for(const line of changed) line.id+=1000
  const reindexed=await call('analyze',{...params,previous:cached,lyrics:JSON.stringify(changed)})
  assert.equal(reindexed.melody.timings.processedGroups,0)
  assert.equal(reindexed.melody.timings.reusedGroups,evidence.initial.groups)
  assert(reindexed.melody.notes.every(n=>n.lineId>=1000))
  for(const row of reindexed.melody.scores) for(const match of row.svg.matchAll(/data-note="(\d+)"/g))
    assert.equal(reindexed.melody.notes[Number(match[1])].lineId,row.lineId)
  evidence.reindexed={timing:reindexed.timings.melody,metrics:reindexed.melody.timings}
  evidence.checks.identityChangesReuseWithoutInference=true
  await call('standby',{})
  const forced=structuredClone(latest)
  delete forced.cache.signatures.notes
  delete forced.melody.reuse
  const rerun=await call('analyze',{...params,previous:forced})
  assert.deepEqual(rerun.melody.notes,latest.melody.notes)
  evidence.checks.sameNotesAfterOffloadAndRestore=true
  evidence.finalIdle=await call('standby',{})
  await save()
  console.log(JSON.stringify(evidence,null,2))
} finally {
  await rpc.close()
  await save()
}
