import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {studyLyricRows,isStudyCredit} from '../src/core/audio/studyLyrics.ts'

const root=resolve(process.argv[2]??'.local/vocal-boundary-20261101')
const executable=resolve(process.argv[3]??'dist/study-corpus-reviewed/win-unpacked/TwilightEcho.exe')
const expectedCount=Number(process.argv[4]??30)
assert(Number.isSafeInteger(expectedCount)&&expectedCount>0)
const profile=resolve('.local/study-20-song-20261101/profile')
const home='D:/Tools/TwilightEchoToolchain/study',cli='D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe'
const run=promisify(execFile),env={...process.env,TWILIGHT_MUSIC_STUDY_HOME:home,PYTHONIOENCODING:'utf-8'}
await mkdir(root,{recursive:true})
let results=[];try{results=JSON.parse(await readFile(join(root,'results.json'),'utf8'))}catch{}
async function command(parts){const r=await run(cli,['--json','--profile',profile,'--timeout','150',...parts],{env,windowsHide:true,timeout:160000,maxBuffer:32*1024**2});const v=JSON.parse(r.stdout);if(!v.ok)throw Error(v.error.message);return v.value}
const call=(name,payload={})=>command(['call',name,'--payload',JSON.stringify(payload)])
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
async function event(value){const row=JSON.stringify({at:new Date().toISOString(),...value});console.log(row);await appendFile(join(root,'events.jsonl'),row+'\n')}
const old=JSON.parse(await readFile(process.argv[5]??'.local/study-20-song-20261101/cases.json','utf8'))
const indexOffset=Math.max(0,...old.map(row=>row.index))
try{
 await command(['app','start','--executable',executable]);await call('study.setCachePolicy',{limitBytes:2*1024**3,preloadNext:false})
 while(true){
  let additional=[];try{additional=JSON.parse(await readFile(join(root,'additional/cases.json'),'utf8'))}catch{}
  const cases=[...old,...additional.map(r=>({...r,index:r.index+indexOffset}))]
  await writeFile(join(root,'cases.json'),JSON.stringify(cases,null,2))
  const next=cases.find(c=>!results.some(r=>r.ncmId===c.ncmId))
  if(!next){if(cases.length>=expectedCount)break;await sleep(1500);continue}
  await event({index:next.index,title:next.title,status:'six'})
  const entry={index:next.index,ncmId:next.ncmId,title:next.title,artist:next.artist,coverage:next.coverage,outcome:'running'}
  try{
   const submission=await call('agent.music.submit',{file:next.file,stages:['six']});entry.projectId=submission.id
   const deadline=Date.now()+12*60*1000
   while(true){
    const state=await call('study.state'),p=state.projects.find(r=>r.id===submission.id)
    if(!['running','queued'].includes(p.status)){if(p.status!=='completed')throw Error(p.error??p.status);break}
    if(Date.now()>deadline){await call('study.cancel',{id:submission.id});throw Error('Six-stage timeout')}
    await sleep(1500)
   }
   const project=await call('study.project',{id:submission.id});assert(project.sixReady)
   const rows=studyLyricRows(await readFile(next.lyricsFile,'utf8'),project.result.duration,0,true)
   const request={audioDirectory:join(profile,'music-study',submission.id),rows,ruleExcluded:rows.filter(r=>isStudyCredit(r.text)).map(r=>r.id)}
   const folder=join(root,'cases',String(next.index).padStart(2,'0')+'-'+next.ncmId);await mkdir(folder,{recursive:true})
   const requestPath=join(folder,'input.json');await writeFile(requestPath,JSON.stringify(request))
   const checked=await run(join(home,'runtime/Scripts/python.exe'),[resolve('scripts/probe-vocal-boundaries.py'),requestPath],{env,windowsHide:true,timeout:120000,maxBuffer:4*1024**2})
   Object.assign(entry,JSON.parse(checked.stdout),{outcome:'passed'})
   await writeFile(join(folder,'result.json'),JSON.stringify(entry,null,2))
  }catch(error){entry.outcome='failed';entry.error=String(error.message).replace(/https?:\/\/\S+/g,'<remote>')}
  results.push(entry);await writeFile(join(root,'results.json'),JSON.stringify(results,null,2))
  await event({index:entry.index,title:entry.title,outcome:entry.outcome,activity:entry.activity,additional:entry.additionalExcluded?.length,error:entry.error})
 }
}finally{await command(['app','stop']).catch(error=>event({shutdownError:error.message}))}
