import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {parseNeteaseJsonLyricLine} from '../src/shared/lyrics/lyricParser.ts'
import {isStudyCredit} from '../src/core/audio/studyLyrics.ts'

const root=resolve('.local/credit-lexicon-20261101')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const old=await read(join(root,'policy-before.json'))
const alternatives=values=>'(?:'+[...values].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')'
const instrument=alternatives(old.instrumentPrefixes)+'?'+alternatives(old.instruments)+alternatives(old.instrumentRoles)+'?'
const role='(?:'+alternatives(old.roles)+'|'+instrument+')'
const oldPattern=new RegExp('^'+role+'(?:\\s*(?:[&＆/／、+]|及|与)\\s*'+role+')*\\s*[:：]','i')
const before=text=>oldPattern.test(text.trim().replace(/\s+/g,' '))
const norm=text=>text.trim().replace(/\s+/g,' ')
const sources=[resolve('.local/vocal-boundary-20261101'),root]
const uncovered=new Map(),newlyMatched=[],falseDrops=[],songs=[],unsupported=[]
let structured=0,oldCovered=0,newCovered=0,oldAll=0,newAll=0,timeAll=0,combinedAll=0,combinedCovered=0,inputRows=0,duration=0
const combinedUncovered=[]
for(const source of sources){
 const cases=await read(join(source,'cases.json')),results=await read(join(source,'results.json')).catch(()=>[])
 for(const result of results.filter(r=>r.outcome==='passed')){
  const sample=cases.find(c=>c.ncmId===result.ncmId),input=await read(join(source,'cases',String(result.index).padStart(2,'0')+'-'+result.ncmId,'input.json'))
  const lyric=await readFile(sample.lyricsFile,'utf8')
  const labels=new Set(lyric.split('\n').filter(l=>l.trim().startsWith('{')).map(l=>parseNeteaseJsonLyricLine(l.trim())?.text).filter(Boolean).map(norm))
  let sungIds=new Set()
  if(source===sources[0]&&result.index<=20){
   const reference=await read(resolve('.local/study-20-song-20261101/results-reviewed',String(result.index).padStart(2,'0')+'-'+sample.ncmId,'project.json'))
   sungIds=new Set(reference.result.melody.scores.map(row=>row.lineId))
  }
  const timeIds=new Set(result.timeExcluded.map(row=>row.id))
  duration+=sample.duration
  const entry={title:sample.title,ncmId:sample.ncmId,artist:sample.artist,oldMatches:0,newMatches:0,timeMatches:0,combinedMatches:0,structured:0,oldStructured:0,newStructured:0,combinedStructured:0}
  for(const row of input.rows){
   const prior=before(row.text),current=isStudyCredit(row.text),meta=labels.has(norm(row.text)),time=timeIds.has(row.id)
   inputRows++
   assert(!prior||current,'Existing credit coverage lost: '+row.text)
   if(prior){oldAll++;entry.oldMatches++}if(current){newAll++;entry.newMatches++}
   if(time){timeAll++;entry.timeMatches++}if(current||time){combinedAll++;entry.combinedMatches++}
   if(meta){
    structured++;entry.structured++;if(prior){oldCovered++;entry.oldStructured++}if(current){newCovered++;entry.newStructured++}
    if(current||time){combinedCovered++;entry.combinedStructured++}
    else combinedUncovered.push({title:sample.title,ncmId:sample.ncmId,id:row.id,text:row.text,time:row.start,activity:result.activity})
    if(!current){
     const header=norm(row.text).split(/[:：]/)[0],examples=uncovered.get(header)??[]
     examples.push({song:sample.title,ncmId:sample.ncmId,id:row.id,text:row.text,time:row.start});uncovered.set(header,examples)
     if(!/[:：]/.test(row.text))unsupported.push({title:sample.title,text:row.text})
    }
   }
   if(current&&!prior){
    const item={title:sample.title,ncmId:sample.ncmId,id:row.id,text:row.text,structured:meta}
    newlyMatched.push(item);if(sungIds.has(row.id))falseDrops.push(item)
   }
  }
  songs.push(entry)
 }
}
const report={songs:songs.length,duration,inputRows,structured,oldCovered,newCovered,oldAll,newAll,timeAll,combinedAll,combinedCovered,combinedUncovered,newlyMatched,falseDrops,
 uncovered:[...uncovered].map(([header,examples])=>({header,count:examples.length,examples})),unsupported,perSong:songs}
await writeFile(join(root,'lexicon-audit.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({songs:songs.length,structured,oldCovered,newCovered,oldAll,newAll,newlyMatched:newlyMatched.length,falseDrops,
 uncovered:report.uncovered.map(row=>({header:row.header,count:row.count,example:row.examples[0]}))},null,2))
