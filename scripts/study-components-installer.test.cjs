const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdir, writeFile, readFile, mkdtemp } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { createRequire } = require('node:module')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash, randomBytes } = require('node:crypto')
const { deflateRawSync } = require('node:zlib')
const crc32 = require('buffer-crc32')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

function archive(entries) {
  const locals = [], central = []; let offset = 0
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32.unsigned(bytes)
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26)
    locals.push(header, filename, compressed)
    const row = Buffer.alloc(46); row.writeUInt32LE(0x02014b50); row.writeUInt16LE(20, 4); row.writeUInt16LE(20, 6); row.writeUInt16LE(8, 10)
    row.writeUInt32LE(crc, 16); row.writeUInt32LE(compressed.length, 20); row.writeUInt32LE(bytes.length, 24); row.writeUInt16LE(filename.length, 28); row.writeUInt32LE(offset, 42)
    central.push(row, filename); offset += header.length + filename.length + compressed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

test('real installer: ranged resume, split archives, restart, corruption, safe extraction, external reuse and deletion', { timeout: 120000, skip: process.platform !== 'win32' || process.arch !== 'x64' }, async () => {
  const root = resolve(__dirname, '..'), directory = await mkdtemp(join(root, '.local', '组件安装-test-'))
  const resources = join(directory, 'resources/music-study'), bytes = randomBytes(1024 * 512)
  await mkdir(join(resources, 'component-manifests'), { recursive: true })
  const components = [], data = {}
  await writeFile(join(directory, 'payload.bin'), bytes)
  for (const [id, name] of [['demucs', 'models/torch/test.bin'], ['mdx', 'models/UVR_MDXNET_KARA_2.onnx'], ['mert', 'models/mert2/test.bin'], ['btc', '../escape.bin'], ['engine-torch', 'shared-python/site-packages/torch/test.bin']]) {
    const version = sha(Buffer.from(id)), files = [{ path: name, bytes: bytes.length, sha256: sha(bytes) }]
    const manifest = { id, version, files }, packed = archive([[name, bytes], ['component-manifest.json', Buffer.from(JSON.stringify(manifest))]])
    await writeFile(join(resources, 'component-manifests', version + '.json'), JSON.stringify(manifest))
    const slices = [packed.subarray(0, 250000), packed.subarray(250000)]
    const parts = slices.map((part, i) => {
      const file = `${id}.zip.part${i}`; data[file] = part.toString('base64')
      return { name: file, url: 'https://github.com/FengLvv/Twilight_Echo/releases/download/analysis-components-test/' + file, bytes: part.length, sha256: sha(part) }
    })
    components.push({ id, title: id, version, platform: 'win32-x64', installedBytes: bytes.length, archiveBytes: packed.length, archiveSha256: sha(packed), parts })
  }
  await writeFile(join(resources, 'components.json'), JSON.stringify({ schema: 1, version: 'test', repository: 'FengLvv/Twilight_Echo', tag: 'analysis-components-test', platform: 'win32-x64', components }))
  await writeFile(join(directory, 'data.json'), JSON.stringify(data))
  const esbuild = createRequire(require.resolve('vite'))('esbuild')
  await esbuild.build({ entryPoints: [join(root, 'src/main/audio/studyComponentsPlatform.ts')], outfile: join(directory, 'platform.cjs'), bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], define: { 'import.meta.url': '__fixtureUrl' },
    banner: { js: "const __fixtureUrl=require('node:url').pathToFileURL(__filename).href;" }, logLevel: 'silent' })
  await writeFile(join(directory, 'runner.cjs'), runner)
  const environment = { ...process.env, TWILIGHT_STUDY_COMPONENTS_HOME: join(directory, 'managed') }; delete environment.ELECTRON_RUN_AS_NODE
  const result = await promisify(execFile)(require('electron'), [join(directory, 'runner.cjs')], { env: environment, windowsHide: true, timeout: 110000, maxBuffer: 1024 * 1024 })
  assert.match(result.stdout, /COMPONENT_INSTALLER_OK/)
  console.log(directory, result.stdout.trim())
})

const runner = String.raw`
const {app,dialog}=require('electron'),fs=require('node:fs'),{join}=require('node:path'),assert=require('node:assert/strict')
app.getAppPath=()=>__dirname;app.setPath('userData',join(__dirname,'profile'))
const data=JSON.parse(fs.readFileSync(join(__dirname,'data.json'))),wait=ms=>new Promise(r=>setTimeout(r,ms))
let calls=0,ranges=0,corrupt=false,installer,inUse=false;const started=[]
async function fetcher(url,options){
 calls++;started.push(url);const bytes=Buffer.from(data[url.split('/').at(-1)],'base64'),offset=Number(options.headers.Range?.match(/\d+/)?.[0]||0);if(offset)ranges++
 let pos=offset
 const body=new ReadableStream({async pull(controller){await wait(4);if(options.signal.aborted){controller.error(options.signal.reason);return}if(pos>=bytes.length){controller.close();return}const chunk=Buffer.from(bytes.subarray(pos,Math.min(pos+16384,bytes.length)));pos+=chunk.length;if(corrupt)chunk[0]^=1;controller.enqueue(chunk)}})
 return new Response(body,{status:offset?206:200,headers:{'content-range':'bytes '+offset+'-'+(bytes.length-1)+'/'+bytes.length}})
}
async function until(id,phase){for(let i=0;i<1000;i++){const row=(await installer.state()).components.find(c=>c.id===id);if(row.phase===phase)return row;if(row.phase==='failed'&&phase!=='failed')throw new Error(row.error);await wait(10)}throw new Error('Timed out '+id+' '+phase)}
app.whenReady().then(async()=>{try{
 const {StudyComponentsPlatform,safeComponentPath}=require('./platform.cjs'),profile=join(__dirname,'profile')
 for(const path of ['../bad','a/../../bad','C:/bad','a\\bad','/abs','a//bad'])assert.throws(()=>safeComponentPath(profile,path))
 installer=new StudyComponentsPlatform(profile,()=>inUse,fetcher)
 await installer.state();assert.equal(calls,0)
 await installer.io({action:'start',ids:['demucs','mert']});await until('demucs','downloading');await wait(20);assert.equal(started.some(url=>url.includes('/mert.')),false)
 await installer.io({action:'task',id:'demucs',task:'pause'});assert.equal((await installer.state()).components.find(c=>c.id==='demucs').phase,'paused')
 await installer.io({action:'task',id:'demucs',task:'resume'});await until('demucs','ready');assert.ok(ranges>0)
 const paths=await installer.paths();assert.ok(paths.models.torch)
 await installer.io({action:'start',ids:['demucs']});assert.equal((await installer.state()).components.find(c=>c.id==='demucs').phase,'ready')
 inUse=true;await assert.rejects(installer.io({action:'remove',id:'demucs'}));inUse=false
 await installer.io({action:'start',ids:['mdx']});await until('mdx','downloading');await wait(15);await installer.close()
 const oldCalls=calls;installer=new StudyComponentsPlatform(profile,()=>false,fetcher);assert.equal((await installer.state()).components.find(c=>c.id==='mdx').phase,'interrupted');await wait(40);assert.equal(calls,oldCalls)
 await installer.io({action:'task',id:'mdx',task:'resume'});await until('mdx','ready')
 await installer.io({action:'start',ids:['btc']});const bad=await until('btc','failed');assert.match(bad.error,/路径|invalid relative path|\.\./i);assert.equal(fs.existsSync(join(__dirname,'escape.bin')),false)
 const external=join(__dirname,'external');fs.mkdirSync(join(external,'models'),{recursive:true});const source=Object.values(data)[0];const mdxPath=(await installer.paths()).models['UVR_MDXNET_KARA_2.onnx'];fs.copyFileSync(mdxPath,join(external,'models/UVR_MDXNET_KARA_2.onnx'))
 await installer.io({action:'remove',id:'mdx'});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[external]});await installer.io({action:'import'});await until('mdx','ready')
 assert.equal((await installer.state()).components.find(c=>c.id==='mdx').external,true);await installer.io({action:'remove',id:'mdx'});assert.ok(fs.existsSync(join(external,'models/UVR_MDXNET_KARA_2.onnx')))
 corrupt=true;await installer.io({action:'start',ids:['mdx']});assert.match((await until('mdx','failed')).error,/校验/);corrupt=false
 await installer.io({action:'task',id:'mdx',task:'retry'});await until('mdx','ready')
 const bundle=join(__dirname,'complete-offline-bundle'),catalog=JSON.parse(fs.readFileSync(join(__dirname,'resources/music-study/components.json')))
 const mdx=catalog.components.find(c=>c.id==='mdx'),version=mdx.version.slice(0,16),nested=join(bundle,'analysis-components/components/mdx',version,'models');fs.mkdirSync(nested,{recursive:true});fs.copyFileSync((await installer.paths()).models['UVR_MDXNET_KARA_2.onnx'],join(nested,'UVR_MDXNET_KARA_2.onnx'))
 await installer.io({action:'remove',id:'mdx'});const noDownload=calls;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[bundle]});await installer.io({action:'import'});await until('mdx','ready');assert.equal(calls,noDownload);assert.ok(fs.realpathSync((await installer.paths()).models['UVR_MDXNET_KARA_2.onnx']).startsWith(bundle))
 const legacy=join(__dirname,'existing-runtime'),torchHome=join(legacy,'runtime/Lib/site-packages');fs.mkdirSync(join(torchHome,'torch'),{recursive:true});fs.copyFileSync(join(__dirname,'payload.bin'),join(torchHome,'torch/test.bin'))
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[legacy]});await installer.io({action:'import'});await until('engine-torch','ready');assert.equal(calls,noDownload);assert.equal(fs.realpathSync((await installer.paths()).sharedPython),fs.realpathSync(torchHome))
 await installer.close();installer=new StudyComponentsPlatform(profile,()=>false,fetcher);await installer.state();assert.equal(fs.realpathSync((await installer.paths()).sharedPython),fs.realpathSync(torchHome));await installer.io({action:'remove',id:'mdx'});await installer.io({action:'remove',id:'demucs'});await installer.io({action:'remove',id:'mert'});await installer.io({action:'remove',id:'engine-torch'});assert.ok(fs.existsSync(join(torchHome,'torch/test.bin')))
 await installer.io({action:'start',ids:['mdx']});await until('mdx','ready');await installer.close()
 const previous=process.env.TWILIGHT_STUDY_COMPONENTS_HOME,next=previous+'-moved';fs.renameSync(previous,next);process.env.TWILIGHT_STUDY_COMPONENTS_HOME=next;installer=new StudyComponentsPlatform(profile,()=>false,fetcher);assert.equal((await installer.state()).components.find(c=>c.id==='mdx').phase,'ready');assert.ok(fs.realpathSync((await installer.paths()).models['UVR_MDXNET_KARA_2.onnx']).startsWith(next));await installer.close()
 console.log('COMPONENT_INSTALLER_OK',JSON.stringify({calls,ranges}));app.exit(0)
}catch(error){console.error(error.stack);if(installer)await installer.close();app.exit(1)}})
`
