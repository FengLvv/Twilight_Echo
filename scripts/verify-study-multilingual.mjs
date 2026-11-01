import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { StudyResidentProcess } from '../src/main/audio/studyResidentProcess.ts'

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,i,all)=>value.startsWith('--')?[...pairs,[value.slice(2),all[i+1]]]:pairs,[]))
for(const key of ['home','directory','lyrics','output'])assert(args[key],`--${key} is required`)
const output=resolve(args.output);await mkdir(output,{recursive:true})
const lines=JSON.parse(await readFile(args.lyrics,'utf8'))
const runtime=new StudyResidentProcess(()=>join(args.home,'runtime-vocal2midi/Scripts/python.exe'),resolve(args.runtime??'resources/music-study/vocal_runtime.py'),
  text=>{void appendFile(join(output,'runtime.log'),text)})
const params={directory:resolve(args.directory),pack:join(args.home,'models'),lyrics:JSON.stringify(lines),parent:'multilingual-real-song-v2'}
const evidence={lines:lines.length,checks:{}}
try {
  const start=performance.now()
  const result=args.notes ? JSON.parse(await readFile(args.notes,'utf8')) : await runtime.call('notes',params,undefined,event=>{if(event.kind==='progress')console.log(event.stage)})
  if(args.notes)evidence.recognitionReusedFrom=resolve(args.notes)
  evidence.recognitionMs=Math.round(performance.now()-start)
  assert(result.notes.length)
  for(const note of result.notes){assert(Number.isFinite(note.start)&&note.end>note.start);assert(lines.some(row=>row.id===note.lineId))}
  const englishLines=lines.filter(row=>/[A-Za-z]/.test(row.text))
  assert(englishLines.some(row=>result.notes.some(n=>n.lineId===row.id)))
  const chineseLines=lines.filter(row=>/[\u3400-\u9fff]/.test(row.text))
  assert(chineseLines.some(row=>result.notes.some(n=>n.lineId===row.id)))
  evidence.notes=result.notes.length;evidence.metrics=result.timings
  evidence.unscoredLines=lines.filter(row=>!result.notes.some(n=>n.lineId===row.id))
  evidence.checks.fullSongMixedLanguage=true
  await writeFile(join(output,'notes.json'),JSON.stringify(result))
  const scoreStart=performance.now()
  const scores=await runtime.call('score',{...params,notes:result.notes,lines})
  evidence.layoutMs=Math.round(performance.now()-scoreStart);evidence.scores=scores.length
  for(const score of scores)for(const m of score.svg.matchAll(/data-note="(\d+)"/g))assert.equal(result.notes[Number(m[1])].lineId,score.lineId)
  evidence.checks.scoreReferences=true
  await writeFile(join(output,'scores.json'),JSON.stringify(scores))
  await runtime.call('standby',{})
  const reused=await runtime.call('notes',{...params,previous:result})
  assert.deepEqual(reused.notes,result.notes)
  assert.equal(reused.timings.processedGroups,0)
  evidence.checks.reuseAfterIdle=true
}finally{
  await runtime.close()
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2))
  console.log(JSON.stringify(evidence,null,2))
}
