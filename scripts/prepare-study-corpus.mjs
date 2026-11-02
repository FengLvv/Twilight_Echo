import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, extname } from 'node:path'
import { parseFile } from 'music-metadata'

const cli=process.env.TWILIGHT_AGENT_CLI??'D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe'
const root=resolve(process.argv[2]??'.local/study-20-song-20261101')
const profile=process.argv[3]??'C:/Users/vilolu/AppData/Roaming/TwilightEcho'
const run=promisify(execFile)
await mkdir(root,{recursive:true})
const settings=JSON.parse(await readFile(join(profile,'settings.json'),'utf8'))
const cache=join(settings.musicCachePath||join(profile,'music-cache'),'ncm-cache')
async function call(method,args){
  const response=await run(cli,['--json','--profile',profile,'--timeout','120','call','providers.call','--payload',JSON.stringify({providerId:'ncm',method,args})],{windowsHide:true,timeout:130000,maxBuffer:16*1024**2})
  const value=JSON.parse(response.stdout);if(!value.ok)throw Error(value.error.message);return value.value
}
// Coverage labels are test selection categories, not provider genre metadata.
const plans=process.argv[4]?JSON.parse(await readFile(resolve(process.argv[4]),'utf8')):[
 ['十年','陈奕迅','华语抒情','zh'],['遇见','孙燕姿','女声民谣流行','zh'],
 ['倔强','五月天','华语摇滚','zh'],['平凡之路','朴树','民谣摇滚','zh'],
 ['Play我呸 (Alesso Remix Version)','蔡依林','中英混合舞曲／说唱','zh-en'],['光年之外','G.E.M.邓紫棋','高音流行','zh'],
 ['爱人错过','告五人','独立乐队','zh'],['大鱼','周深','假声／长拖音','zh'],
 ['云烟成雨','房东的猫','民谣','zh'],['最炫民族风','凤凰传奇','双主唱／说唱','zh'],
 ['Someone Like You','Adele','钢琴／灵魂流行','en'],['bad guy','Billie Eilish','电子流行','en'],
 ['Just the Way You Are','Bruno Mars','R&B流行','en'],['Numb','Linkin Park','新金属','en'],
 ['Stan','Eminem','说唱／副歌','en'],['Get Lucky','Daft Punk','放克／迪斯科','en'],
 ['Bohemian Rhapsody','Queen','多段式摇滚／合唱','en'],["Don't Know Why",'Norah Jones','爵士流行','en'],
 ['夜に駆ける','YOASOBI','日语电子流行','ja'],['残響散歌','Aimer','日语摇滚','ja']
]
const normalize=text=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')
const countLimit=Number(process.argv[5]??plans.length)
assert(Number.isSafeInteger(countLimit)&&countLimit>0)
let cases=[];try{cases=JSON.parse(await readFile(join(root,'cases.json'),'utf8'))}catch{}
const failures=[]
const save=async()=>{await writeFile(join(root,'cases.json'),JSON.stringify(cases,null,2));await writeFile(join(root,'selection-failures.json'),JSON.stringify(failures,null,2))}
for(let index=0;index<plans.length;index++){
  if(cases.length>=countLimit)break
  if(cases.some(row=>row.index===index+1))continue
  const [title,artist,coverage,language]=plans[index]
  console.log('search',index+1,title,artist)
  try{
    const found=await call('searchSongs',[`${title} ${artist}`,12,0])
    const expected=normalize(title),artistKey=normalize(artist)
    const candidates=found.items.filter(track=>normalize(track.artist).length>0&&(normalize(track.artist).includes(artistKey)||artistKey.includes(normalize(track.artist))))
      .filter(track=>normalize(track.title).includes(expected)||expected.includes(normalize(track.title)))
      .filter(track=>track.duration>90&&track.duration<600&&(!/live|伴奏|翻唱|instrumental|remix|dj版|现场/i.test(track.title)||/remix|live/i.test(title)))
      .sort((a,b)=>(normalize(a.title)===expected?-10:0)-(normalize(b.title)===expected?-10:0))
    if(!candidates.length)throw Error('No matching original recording in search results')
    let selected=null
    for(const track of candidates.slice(0,4)){
      try{
        const lyrics=await call('getLyrics',[track])
        const original=lyrics.wordLyrics||lyrics.lyrics
        if(typeof original!=='string'||!(/\[\d+:\d+|\[\d+,\d+\]/.test(original)))throw Error('No timed original lyrics')
        const url=await call('getPlaybackUrl',[track,{quality:'standard'}])
        if(!url)throw Error('Official playback unavailable')
        const id=String(track.ncmSongId??track.id.replace(/^ncm:/,''))
        const deadline=Date.now()+120000;let cached
        while(Date.now()<deadline){
          const names=(await readdir(cache)).filter(n=>n.startsWith(id+'.')&&/\.(flac|mp3|m4a|wav|aac|ogg)$/i.test(n))
          const entries=await Promise.all(names.map(async name=>({path:join(cache,name),info:await stat(join(cache,name))})))
          cached=entries.sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs).find(value=>value.info.size>100000)
          if(cached)break
          await new Promise(done=>setTimeout(done,750))
        }
        if(!cached)throw Error('Authorized background audio cache did not finish')
        const metadata=await parseFile(cached.path,{duration:true})
        const duration=metadata.format.duration
        if(!duration||duration<track.duration*.96-1)throw Error(`Incomplete recording: ${duration??0}/${track.duration} seconds`)
        const directory=join(root,'media',String(index+1).padStart(2,'0')+'-'+id)
        await mkdir(directory,{recursive:true})
        const safeName=track.title.replace(/[<>:"/\\|?*]/g,'_')
        const file=join(directory,safeName+extname(cached.path)),lyricsFile=join(directory,safeName+'.lrc')
        await copyFile(cached.path,file);await writeFile(lyricsFile,original,'utf8')
        const sourceSha256=createHash('sha256').update(await readFile(file)).digest('hex')
        assert(!cases.some(row=>row.sourceSha256===sourceSha256),'Duplicate source recording')
        selected={index:index+1,ncmId:id,title:track.title,artist:track.artist,album:track.album,coverage,language,
          duration,expectedDuration:track.duration,file,lyricsFile,lyricsFormat:lyrics.wordLyrics?'yrc':'lrc',sourceSha256}
        break
      }catch(error){failures.push({index:index+1,title,ncmId:String(track.ncmSongId),error:String(error.message).replace(/https?:\/\/\S+/g,'<remote>')})}
    }
    if(!selected)throw Error('No complete, authorized recording with timed lyrics')
    cases.push(selected);cases.sort((a,b)=>a.index-b.index);await save()
    console.log('prepared',index+1,selected.title,selected.ncmId,Math.round(selected.duration)+'s',selected.lyricsFormat)
  }catch(error){failures.push({index:index+1,title,error:error.message});await save();console.log('unavailable',index+1,title,error.message)}
}
await save();const completion={prepared:cases.length,missing:plans.map((p,i)=>({index:i+1,title:p[0]})).filter(p=>!cases.some(row=>row.index===p.index))}
await writeFile(join(root,'selection.done.json'),JSON.stringify(completion,null,2));console.log(JSON.stringify(completion))
