const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml')
const minimatch=require('minimatch')
test('packaged study resources contain the local Python import and data-file closure',()=>{
  const root=path.resolve(__dirname,'..'),directory=path.join(root,'resources/music-study')
  const config=yaml.load(fs.readFileSync(path.join(root,'electron-builder.yml'),'utf8'))
  const filter=config.extraResources.find(x=>x.to==='music-study').filter
  const pending=['worker.py','vocal_pipeline.py'],seen=new Set()
  while(pending.length){
    const file=pending.pop();if(seen.has(file))continue;seen.add(file)
    assert(filter.some(p=>!p.startsWith('!')&&minimatch(file,p)),`${file} is missing from the app package`)
    if(!file.endsWith('.py'))continue
    const source=fs.readFileSync(path.join(directory,file),'utf8')
    const names=[...source.matchAll(/(?:from|import)\s+(\w+)|with_name\(['"]([^'"]+)['"]\)/g)]
      .map(m=>m[2]||m[1]+'.py').filter(n=>fs.existsSync(path.join(directory,n)))
    pending.push(...names)
  }
  assert(seen.has('vocal_melody.py'));assert(seen.has('vocal_models.json'))
  const packed=process.env.TWILIGHT_PACKAGED_STUDY
  if(packed)for(const file of seen)assert(fs.existsSync(path.join(packed,file)),`Packaged artifact missing ${file}`)
})
