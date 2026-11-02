import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { studyLyricsFromText } from '../src/core/audio/studyLyrics.ts'

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,i,all)=>value.startsWith('--')?[...pairs,[value.slice(2),all[i+1]]]:pairs,[]))
const root=resolve(args.root??'.local/study-20-song-20261101'),profile=join(root,'profile')
const executable=resolve(args.executable??'dist/study-lyrics-fix/win-unpacked/TwilightEcho.exe')
const home=args.home??'D:/Tools/TwilightEchoToolchain/study'
const cli=process.env.TWILIGHT_AGENT_CLI??'D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe'
const run=promisify(execFile)
const expectedCount=Number(args['expected-count']??20)
assert(Number.isSafeInteger(expectedCount)&&expectedCount>0)
const runName=args['run-name']??''
assert(/^[a-z0-9-]*$/.test(runName),'Invalid run name')
const suffix=runName?'-'+runName:''
const resultFile=join(root,'results'+suffix+'.json'),eventsFile=join(root,'events'+suffix+'.jsonl'),resultRoot=join(root,'results'+suffix)
await mkdir(profile,{recursive:true});await mkdir(resultRoot,{recursive:true})
try{await readFile(join(profile,'settings.json'))}catch{await writeFile(join(profile,'settings.json'),JSON.stringify({onboardingCompleted:true,autoCheckLogin:false,motionPreference:'off',volume:0}))}
const env={...process.env,TWILIGHT_MUSIC_STUDY_HOME:home}
const baseline=args.baseline?JSON.parse(await readFile(join(root,'results-'+args.baseline+'.json'),'utf8')):[]
const inferenceEvidence=args.baseline?JSON.parse(await readFile(join(root,'inference-evidence.json'),'utf8')):{}
async function command(parts){
  let result
  try{result=await run(cli,['--json','--profile',profile,'--timeout','150',...parts],{env,windowsHide:true,timeout:160000,maxBuffer:64*1024**2})}
  catch(error){if(error.stdout){const value=JSON.parse(error.stdout);throw Error(value.error?.message??error.message)}throw error}
  const response=JSON.parse(result.stdout);if(!response.ok)throw Error(response.error?.message??'CLI operation failed');return response.value
}
const call=(name,payload={})=>command(['call',name,'--payload',JSON.stringify(payload)])
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
let results=[];try{results=JSON.parse(await readFile(resultFile,'utf8'))}catch{}
async function save(){await writeFile(resultFile,JSON.stringify(results,null,2))}
async function event(value){console.log(JSON.stringify({at:new Date().toISOString(),...value}));await appendFile(eventsFile,JSON.stringify({at:new Date().toISOString(),...value})+'\n')}
async function waitForProject(id,entry,result){
  const deadline=Date.now()+20*60*1000;let last=''
  while(Date.now()<deadline){
    const state=await call('study.state'),project=state.projects.find(row=>row.id===id)
    if(!project)throw Error('Analysis project disappeared')
    // Later cache hits must not erase the measured initial inference time.
    for(const [stage,timing] of Object.entries(project.stages??{})){
      if(timing.status!=='completed'||!Number.isFinite(timing.elapsedMs))continue
      if(!result.stageTimings[stage]||!timing.cacheHit)result.stageTimings[stage]=timing
    }
    if(project.stage!==last){last=project.stage;await event({title:entry.title,status:project.status,stage:project.stage})}
    if(!['running','queued'].includes(project.status))return project
    await sleep(1800)
  }
  await call('study.cancel',{id});throw Error('Analysis exceeded 20-minute limit')
}

function inspectResult(project,entry,originalLyrics){
  const value=project.result;assert(value?.ready.includes('melody')&&value.ready.includes('chords'))
  assert(Math.abs(value.duration-entry.duration)<1)
  let cursor=0
  for(const chord of value.chords.segments){assert(chord.end>chord.start);assert(Math.abs(chord.start-cursor)<1e-5);cursor=chord.end}
  assert(Math.abs(cursor-value.duration)<1e-5)
  const melody=value.melody;assert(melody?.notes.length&&melody.scores.length)
  const referenced=new Set()
  for(const note of melody.notes){assert(Number.isFinite(note.start)&&Number.isFinite(note.end)&&note.end>note.start&&note.start>=0&&note.end<=value.duration+.01);assert(note.midi>=0&&note.midi<=127);assert(Number.isFinite(note.beat)&&note.durationBeats>0)}
  for(const row of melody.scores){
    assert(!/<script|foreignObject|onload=/i.test(row.svg));let count=0
    for(const match of row.svg.matchAll(/data-note="(\d+)"/g)){const index=Number(match[1]);assert.equal(melody.notes[index]?.lineId,row.lineId);referenced.add(index);count++}
    assert(count>0)
    assert.equal(melody.notes.filter(n=>n.lineId===row.lineId).map(n=>n.lyric??'').join(''),row.text)
  }
  const lyrics=JSON.parse(studyLyricsFromText(originalLyrics,value.duration))
  const excluded=new Map((melody.lyricFilter?.excluded??[]).map(row=>[row.id,row.reason]))
  const structured=lyrics.every(row=>row.origin?.format==='amll-ttml')
  assert.equal(melody.lyricFilter?.mode,structured?'structured':'heuristic')
  if(structured){
    assert.equal(melody.lyricFilter.activity.status,'skipped')
    assert.equal(melody.timings.activityMs,0)
    assert.equal(melody.timings.lyricClassifierMs,0)
    assert.equal(melody.lyricFilter.classifier,undefined)
    assert.equal(excluded.size,0)
  }
  assert.equal(melody.lyricFilter?.alignment,undefined,'Experimental acoustic classifier must not enter production results')
  for(const [id,reason] of excluded){
    const row=lyrics.find(row=>row.id===id),activity=melody.lyricFilter.activity
    assert(row&&activity.status==='estimated')
    assert(reason==='non_lyric_classifier' ? melody.lyricFilter.classifier.candidates.includes(id) &&
      (row.end<=activity.start||row.start>=activity.end) :
      reason==='before_vocals'?row.end<=Math.max(0,activity.start-activity.margin):
      reason==='after_vocals'&&row.start>=activity.end+activity.margin)
    assert(!melody.scores.some(score=>score.lineId===id))
  }
  // Core freezes only sung rows. Every original row needs its own score.
  for(const row of lyrics)if(!excluded.has(row.id))assert(melody.scores.some(score=>score.lineId===row.id),'Missing lyric row '+row.id+': '+row.text)
  assert.equal(referenced.size,melody.notes.length,'Some inferred notes have no rendered time mapping')
  return {duration:value.duration,chords:value.chords.segments.length,notes:melody.notes.length,scoreRows:melody.scores.length,key:melody.key,
    sourceSha256:value.sourceSha256,notesHash:value.cache?.notesHash,timings:value.timings,melodyTimings:melody.timings,
    preparation:{mode:melody.lyricFilter.mode,activity:melody.lyricFilter.activity.status,excluded:excluded.size,
      classifier:melody.lyricFilter.classifier}}
}

async function exportScore(id,directory,notation){
  const response=await call('agent.music.export',{id,directory,notation,key:'auto'})
  const names=await readdir(response.directory)
  const pdf=names.find(name=>name.endsWith('.pdf'));assert(pdf)
  const bytes=await readFile(join(response.directory,pdf));assert(bytes.subarray(0,5).toString()==='%PDF-');assert(bytes.subarray(-64).toString().includes('%%EOF'))
  assert(names.some(name=>name.endsWith('.svg')))
  return {directory:response.directory,pdfBytes:bytes.length}
}

try{
  await command(['app','start','--executable',executable]);await event({app:'started',executable})
  await call('study.setCachePolicy',{limitBytes:2*1024**3,preloadNext:false})
  while(true){
    try{await readFile(join(root,'stop'+suffix));await event({stopped:'Requested between songs'});break}catch{}
    const cases=JSON.parse(await readFile(join(root,'cases.json'),'utf8'))
    const next=cases.find(entry=>!results.some(row=>row.ncmId===entry.ncmId&&(args['retry-failed']?row.outcome==='passed':true)))
    if(!next){if(cases.length===expectedCount)break;await sleep(1500);continue}
    const result={index:next.index,ncmId:next.ncmId,title:next.title,artist:next.artist,coverage:next.coverage,language:next.language,outcome:'running',stageTimings:{},startedAt:new Date().toISOString()}
    const existing=results.findIndex(row=>row.ncmId===next.ncmId)
    if(existing>=0)results[existing]=result;else results.push(result)
    await save();await event({case:next.index,title:next.title,status:'begin'})
    const wall=performance.now(),directory=join(resultRoot,String(next.index).padStart(2,'0')+'-'+next.ncmId)
    await mkdir(directory,{recursive:true})
    try{
      const prior=baseline.find(row=>row.ncmId===next.ncmId)
      const stages=args.baseline&&prior?.audio?['melody']:['six','chords','melody']
      const submission=await call('agent.music.submit',{file:next.file,stages})
      const id=submission.id;assert(id);result.projectId=id
      const final=await waitForProject(id,next,result)
      if(final.status!=='completed')throw Error(final.error??'Analysis '+final.status)
      const project=await call('study.project',{id})
      Object.assign(result,inspectResult(project,next,await readFile(next.lyricsFile,'utf8')))
      await writeFile(join(directory,'project.json'),JSON.stringify(project))
      if(args.baseline){
        result.recognitionEvidence=inferenceEvidence[next.ncmId]
        assert.equal(result.recognitionEvidence?.notesHash,result.notesHash,'Raw note identity changed during layout-only verification')
      }
      if(prior?.audio){
        assert.equal(prior.sourceSha256,result.sourceSha256)
        assert.equal(prior.audio.frames,project.result.frames)
        result.audio=prior.audio;result.audioVerification='prior full run, same PCM'
      }else{
        const audit=await run(join(home,'runtime/Scripts/python.exe'),[resolve('scripts/inspect-study-corpus-audio.py'),join(profile,'music-study',id)],{windowsHide:true,timeout:90000,maxBuffer:1024**2})
        result.audio=JSON.parse(audit.stdout);result.audioVerification='current run'
      }
      result.exports={}
      for(const notation of ['numbered','staff'])result.exports[notation]=await exportScore(id,join(directory,'exports'),notation)
      const cache=await call('study.cache');assert(cache.usedBytes<=cache.limitBytes);result.cache=cache
      result.outcome='passed'
    }catch(error){result.outcome='failed';result.error=String(error.message).replace(/https?:\/\/\S+/g,'<remote>')}
    result.wallMs=Math.round(performance.now()-wall);result.completedAt=new Date().toISOString();await save()
    await event({case:next.index,title:next.title,status:result.outcome,error:result.error,wallMs:result.wallMs,notes:result.notes,scores:result.scoreRows})
    if(args['retry-failed']&&result.outcome==='failed')break
  }
  await event({completed:results.length,passed:results.filter(row=>row.outcome==='passed').length,failed:results.filter(row=>row.outcome==='failed').length})
}finally{await save();await command(['app','stop']).catch(error=>event({shutdownError:error.message}))}
