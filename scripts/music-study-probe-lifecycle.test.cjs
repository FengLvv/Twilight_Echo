const test = require('node:test')
const assert = require('node:assert/strict')
const { writeFile, mkdtemp } = require('node:fs/promises')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { createRequire } = require('node:module')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

test(
  'concurrent environment checks share one real probe and shutdown joins its child',
  {
    skip: !process.env.TWILIGHT_MUSIC_STUDY_HOME,
    timeout: 180000
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'twilight-probe-lifecycle-'))
    const bundle = path.join(directory, 'platform.cjs'),
      runner = path.join(directory, 'runner.cjs')
    await createRequire(require.resolve('vite'))('esbuild').build({
      entryPoints: [path.resolve(__dirname, '../src/main/audio/musicStudyPlatform.ts')],
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
    const result = await promisify(execFile)(
      require('electron'),
      [runner, bundle, path.resolve(__dirname, '..'), directory],
      {
        windowsHide: true,
        env,
        timeout: 170000,
        maxBuffer: 20000
      }
    )
    const evidence = JSON.parse(
      result.stdout
        .trim()
        .split('\n')
        .find((line) => line.startsWith('{'))
    )
    assert.equal(evidence.concurrentProbeCount, 1)
    assert.equal(evidence.cancelledProbeJoined, true)
    assert.equal(evidence.reusableAfterDrain, true)
  }
)

const runtime = String.raw`
const {app}=require('electron'),cp=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path')
const [bundle,root,directory]=process.argv.slice(2);app.setPath('userData',path.join(directory,'profile'));app.getAppPath=()=>root
const children=[],spawn=cp.spawn;cp.spawn=(...args)=>{const child=spawn(...args);if(args[1]?.[1]==='probe')children.push(child);return child}
const wait=ms=>new Promise(r=>setTimeout(r,ms)),signal=new AbortController().signal
app.whenReady().then(async()=>{const create=require(bundle).createMusicStudyPlatform;let warm,cold;try{
 warm=create(path.join(directory,'warm'));const [a,b]=await Promise.all([warm.operations['study.environment']({},signal),warm.operations['study.environment']({},signal)])
 assert.equal(a.ready,true,a.error);assert.deepEqual(a,b);assert.equal(children.length,1,'concurrent checks must share one Python probe');await warm.idle()
 cold=create(path.join(directory,'cold'));const checking=cold.operations['study.environment']({},signal);const deadline=Date.now()+30000
 while(children.length<2&&Date.now()<deadline)await wait(30);assert.equal(children.length,2)
 await cold.idle();const result=await checking;assert.equal(result.ready,false);assert.ok(children[1].exitCode!==null||children[1].signalCode!==null,'probe child must be joined')
 const resumed=await cold.operations['study.environment']({},signal);assert.equal(resumed.ready,true,resumed.error);assert.equal(children.length,3)
 console.log(JSON.stringify({concurrentProbeCount:1,cancelledProbeJoined:true,reusableAfterDrain:true,cuda:a.gpu}));
}catch(error){console.error(error);process.exitCode=1}finally{if(warm)await warm.idle();if(cold)await cold.idle();app.exit(process.exitCode||0)}})
`
