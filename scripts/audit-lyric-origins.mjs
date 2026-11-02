import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {studyLyricRows,isStudyCredit} from '../src/core/audio/studyLyrics.ts'
import {studyVocalKeys} from '../src/main/audio/studyCache.ts'

const read=async file=>JSON.parse(await readFile(file,'utf8'))
const samples=[]
for(const root of ['.local/vocal-boundary-20261101','.local/credit-lexicon-20261101']){
  for(const sample of await read(join(root,'cases.json'))){
    const original=await readFile(sample.lyricsFile,'utf8')
    const rows=studyLyricRows(original,sample.duration,0,true)
    const selected=studyLyricRows(original,sample.duration)
    samples.push({title:sample.title,ncmId:sample.ncmId,duration:sample.duration,rows,selected})
  }
}
const code=`import sys,json
sys.path.insert(0,'resources/music-study')
from vocal_pipeline import validate_lines
from vocal_melody import model_keys
samples=json.load(sys.stdin)
print(json.dumps(dict(keys=model_keys(),selected=[[row['id'] for row in validate_lines(json.dumps(sample['rows'],ensure_ascii=False),sample['duration'])] for sample in samples])))`
const python=process.env.TWILIGHT_STUDY_PYTHON??'D:/Tools/TwilightEchoToolchain/study/runtime/Scripts/python.exe'
const response=spawnSync(python,['-c',code],{input:JSON.stringify(samples),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}})
assert.equal(response.status,0,response.stderr)
const parity=JSON.parse(response.stdout)
assert.deepEqual(parity.keys,studyVocalKeys())
assert.deepEqual(parity.selected,samples.map(sample=>sample.selected.map(row=>row.id)))
const report={songs:samples.length,candidateRows:samples.reduce((n,s)=>n+s.rows.length,0),
  sourceMetadata:samples.reduce((n,s)=>n+s.rows.filter(row=>row.origin?.kind==='metadata').length,0),
  unknownStructured:samples.reduce((n,s)=>n+s.rows.filter(row=>row.origin?.kind==='unknown').length,0),
  additionalSourceMatches:samples.flatMap(s=>s.rows.filter(row=>row.origin?.kind==='metadata'&&!isStudyCredit(row.text)).map(row=>({title:s.title,id:row.id,text:row.text}))),
  crossRuntime:{modelKeys:true,selection:true},
  perSong:samples.map(s=>({title:s.title,ncmId:s.ncmId,candidateRows:s.rows.length,selectedRows:s.selected.length,
    sourceMetadata:s.rows.filter(row=>row.origin?.kind==='metadata').length,unknownStructured:s.rows.filter(row=>row.origin?.kind==='unknown').length}))}
const output=resolve(process.argv[2]??'.local/lyric-evidence-20261101/source-audit.json')
await writeFile(output,JSON.stringify(report,null,2))
console.log(JSON.stringify({...report,perSong:undefined},null,2))
