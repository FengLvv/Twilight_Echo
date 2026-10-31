const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createRequire } = require('node:module')

test(
  'real local worker fully caches HTTP audio, resumes offline, exports every format and joins cancellation',
  {
    skip: !process.env.TWILIGHT_MUSIC_STUDY_HOME,
    timeout: 480000
  },
  async () => {
    const root = resolve(__dirname, '..'),
      directory = await mkdtemp(join(tmpdir(), 'twilight-study-runtime-'))
    const esbuild = createRequire(require.resolve('vite'))('esbuild')
    const bundle = join(directory, 'platform.cjs'),
      runner = join(directory, 'runner.cjs'),
      profile = join(directory, 'profile')
    await mkdir(profile)
    await esbuild.build({
      entryPoints: [join(root, 'src/main/audio/musicStudyPlatform.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron', '*.node'],
      define: { 'import.meta.url': '__studyImportMetaUrl' },
      banner: {
        js: "const __studyImportMetaUrl=require('node:url').pathToFileURL(__filename).href;"
      },
      logLevel: 'silent'
    })
    await writeFile(runner, runtime)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(require('electron'), [runner, root, profile, bundle], {
      env,
      windowsHide: true,
      timeout: 460000,
      maxBuffer: 1024 * 1024
    })
    const evidence = JSON.parse(await readFile(join(profile, 'verification.json'), 'utf8'))
    assert.equal(evidence.offlineResume, true)
    assert.equal(evidence.cancelJoined, true)
    assert.equal(evidence.exports, 3)
    assert.equal(evidence.vocalStagesReuseSix, true)
    console.log(result.stdout.trim(), JSON.stringify(evidence), directory)
  }
)

const runtime = String.raw`
const {app,dialog}=require('electron'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict'),{join}=require('node:path'),{createHash}=require('node:crypto')
const [root,profile,bundle]=process.argv.slice(2)
app.setPath('userData',profile);app.getAppPath=()=>root
const wait=ms=>new Promise(done=>setTimeout(done,ms))
const signal=new AbortController().signal
let platform,server
app.whenReady().then(async()=>{
 try{
  platform=require(bundle).createMusicStudyPlatform(profile)
  const ops=platform.operations,environment=await ops['study.environment']({},signal)
  assert.equal(environment.ready,true,environment.error)
  const frames=44100*4,wave=Buffer.alloc(44+frames*4)
  wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(2,22);wave.writeUInt32LE(44100,24);wave.writeUInt32LE(176400,28);wave.writeUInt16LE(4,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(frames*4,40)
  for(let f=0;f<frames;f++){const frequencies=f<frames/2?[261.63,329.63,392]:[220,261.63,329.63],value=Math.round(frequencies.reduce((sum,hz)=>sum+Math.sin(2*Math.PI*hz*f/44100)*6000,0));wave.writeInt16LE(value,44+f*4);wave.writeInt16LE(value,46+f*4)}
  const local=join(profile,'selected.wav');fs.writeFileSync(local,wave)
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[local]})
  const selected=await ops['study.chooseSource']({id:'selected-local'},signal)
  assert.notEqual(selected.path,local)
  assert.deepEqual(fs.readFileSync(selected.path),wave)
  fs.renameSync(local,local+'.offline')
  const restarted=require(bundle).createMusicStudyPlatform(profile)
  await restarted.operations['study.startWorker']({id:'selected-local',source:selected.path,expectedDuration:4,leadBacking:false,twoSingers:false},signal)
  const localDeadline=Date.now()+130000
  while(Date.now()<localDeadline){const state=await restarted.operations['study.workerStatus']({id:'selected-local'},signal);if(!state.running){assert.equal(state.error,undefined,state.error);assert.equal(state.result.frames,frames);break}await wait(200)}
  assert.equal((await restarted.operations['study.workerStatus']({id:'selected-local'},signal)).running,false)
  await restarted.idle()
  let requests=0
  server=http.createServer((request,response)=>{requests++;response.setHeader('Content-Length',wave.length);response.end(wave)})
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  const url='http://127.0.0.1:'+server.address().port+'/song.wav'
  const input={id:'http-song',source:url,expectedDuration:4,leadBacking:false,twoSingers:false}
  const completed=async()=>{const deadline=Date.now()+130000;while(Date.now()<deadline){const state=await ops['study.workerStatus']({id:input.id},signal);if(!state.running){assert.equal(state.error,undefined,state.error);return state.result}await wait(200)}throw Error('worker timeout')}
  await ops['study.startWorker'](input,signal);const result=await completed()
  assert.equal(result.frames,frames);assert.equal(result.stems.length,6)
  const captured=fs.readFileSync(join(profile,'music-study',input.id,'source.cache'))
  assert.equal(createHash('sha256').update(captured).digest('hex'),createHash('sha256').update(wave).digest('hex'))
  await new Promise(done=>server.close(done));server=null
  await ops['study.startWorker'](input,signal);assert.equal((await completed()).sourceSha256,result.sourceSha256);assert.equal(requests,1)
  const cachedFiles=['drums','bass','other','vocals','guitar','piano'].map(name=>join(profile,'music-study',input.id,name+'.wav'))
  const before=cachedFiles.map(file=>fs.statSync(file).mtimeMs),chordStamp=fs.statSync(join(profile,'music-study',input.id,'chords.json')).mtimeMs
  for(const operation of ['leadBacking',...(environment.gpu?['twoSingers']:[])]){
   await ops['study.startWorker']({...input,operation},signal);const split=await completed()
   assert.equal(split.timings.six.cacheHit,true)
   assert.equal(split.ready.includes(operation),true)
   assert.deepEqual(cachedFiles.map(file=>fs.statSync(file).mtimeMs),before)
   assert.equal(fs.statSync(join(profile,'music-study',input.id,'chords.json')).mtimeMs,chordStamp)
  }
  assert.equal((await ops['study.validateCache']({id:input.id},signal)).ready.includes('chords'),true)
  const output=join(profile,'exports');fs.mkdirSync(output)
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[output]})
  for(const [audioFormat,chordFormat]of [['wav','txt'],['flac','csv'],['flac','json']]){
   const directory=await ops['study.exportFiles']({id:input.id,audioFormat,chordFormat,stems:['bass'],chords:result.chords},signal)
   const bytes=fs.readFileSync(join(directory,'bass.'+audioFormat));assert.equal(bytes.toString('ascii',0,4),audioFormat==='wav'?'RIFF':'fLaC')
   assert.ok(fs.readFileSync(join(directory,'chords.'+chordFormat)).length>0)
  }
  server=http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'audio/wav'});const timer=setInterval(()=>response.write(wave.subarray(0,1024)),200);response.on('close',()=>clearInterval(timer))})
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  await ops['study.startWorker']({...input,id:'cancel-source',source:'http://127.0.0.1:'+server.address().port+'/slow.wav'},signal)
  await wait(500);await ops['study.cancelWorker']({id:'cancel-source'},signal)
  assert.equal((await ops['study.workerStatus']({id:'cancel-source'},signal)).running,false)
  assert.equal(await ops['study.hasSource']({id:'cancel-source'},signal),false)
  fs.writeFileSync(join(profile,'verification.json'),JSON.stringify({offlineResume:true,cancelJoined:true,exports:3,vocalStagesReuseSix:true,frames,environment}))
  console.log('HTTP cache, offline resume, WAV/FLAC and TXT/CSV/JSON exports, cancellation passed')
 }catch(error){console.error(error);process.exitCode=1}
 finally{if(platform)await platform.idle();if(server){server.closeAllConnections();await new Promise(done=>server.close(done))}app.exit(process.exitCode||0)}
})
`
