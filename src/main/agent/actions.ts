import { app } from 'electron'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { parseFile } from 'music-metadata'
import type { CoreApplicationRuntime } from '../app/coreApplication.ts'
import type { AgentBridgeOptions } from './bridge.ts'
import type { CoreQueueTrackInput } from '../../shared/coreQueueSubmission.ts'
import type { StudyStage } from '../../shared/musicStudy.ts'
import { validStudyPayload } from '../../shared/musicStudy.ts'
import { inferChordKey, keyName, parseKey, romanChord } from '../../shared/lyrics/chordDegrees.ts'
import { rhythmicLyricScore } from '../../shared/lyrics/lyricAnalysis.ts'
import { createNativeScoreExporter } from './scoreExport.ts'
import {
  grantAgentSelectedAudioFile, grantUserSelectedLibraryRoot, grantUserSelectedCacheRoot,
  grantUserSelectedDownloadRoot, grantUserSelectedImpulseResponse, grantUserSelectedVst3SearchPath
} from '../security/localPaths.ts'

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string' }
const idSchema = objectSchema({ id: text }, ['id'])
const recordId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw new Error('Invalid analysis project id')
  return value
}

export function createAgentActions(profile: string, application: CoreApplicationRuntime) {
  const exporter = createNativeScoreExporter()
  const project = async (id: unknown) => application.request('study.project', { id: recordId(id) })
  const directory = (id: unknown) => join(profile, 'music-study', recordId(id))
  async function files(root: string, folder = root): Promise<Array<{ path: string; relativePath: string; bytes: number }>> {
    const output: Array<{ path: string; relativePath: string; bytes: number }> = []
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), info = await lstat(path)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) output.push(...await files(root, path))
      else if (/\.(wav|flac|mid|musicxml|svg|json)$/i.test(entry.name)) output.push({ path, relativePath: relative(root, path), bytes: info.size })
      if (output.length > 10000) throw new Error('Analysis artifact inventory exceeds limit')
    }
    return output
  }
  const custom: NonNullable<AgentBridgeOptions['custom']> = {
    'agent.files.authorize': {
      kind: 'command', description: 'Explicit local CLI file/directory selection through native path grants.',
      inputSchema: objectSchema({ path: text, kind: { enum: ['audio','library','cache','download','impulse','vst3'] } }, ['path','kind']),
      async run(payload) {
        if (typeof payload.path !== 'string') throw new Error('Expected path')
        const grants = { audio: grantAgentSelectedAudioFile, library: grantUserSelectedLibraryRoot, cache: grantUserSelectedCacheRoot,
          download: grantUserSelectedDownloadRoot, impulse: grantUserSelectedImpulseResponse, vst3: grantUserSelectedVst3SearchPath }
        const grant = grants[payload.kind as keyof typeof grants]
        if (!grant) throw new Error('Unknown native path grant kind')
        return { path: await grant(payload.path), kind: payload.kind }
      }
    },
    'agent.music.submit': {
      kind: 'command', description: 'Queue explicit local/NCM/catalog sources and selected analysis stages without changing playback.',
      inputSchema: objectSchema({ file: text, ncmId: text, songId: text, input: { type: 'object' }, stages: { type: 'array', items: { enum: ['six','chords','originalChords','melody','leadBacking','twoSingers'] } }, lyrics: text }, ['stages']),
      async run(payload) {
        if (Object.keys(payload).some(key => !['file','ncmId','songId','input','stages','lyrics'].includes(key))) throw new Error('Unknown analysis submission field')
        if ([payload.file,payload.ncmId,payload.songId,payload.input].filter(value => value !== undefined).length !== 1) throw new Error('Select exactly one analysis source')
        let input: CoreQueueTrackInput | undefined, current = false, lyrics = payload.lyrics
        if (typeof payload.file === 'string') {
          const path = await grantAgentSelectedAudioFile(payload.file)
          const metadata = await parseFile(path, { duration: true })
          const id = 'agent-file:' + createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex')
          input = { kind: 'local', id, fallback: { filePath: path, title: metadata.common.title || basename(path,extname(path)), artist: metadata.common.artist || '', album: metadata.common.album || '', duration: metadata.format.duration || 0 } }
          if (lyrics === undefined) {
            const sidecar = path.slice(0,-extname(path).length) + '.lrc'
            try { if ((await stat(sidecar)).size <= 2 * 1024 * 1024) lyrics = await readFile(sidecar,'utf8') } catch {}
          }
        } else if (payload.ncmId !== undefined || typeof payload.songId === 'string' && /^ncm:\d+$/.test(payload.songId)) {
          const value = String(payload.ncmId ?? String(payload.songId).slice(4))
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error('Invalid NCM song id')
          input = { kind:'provider', track:{ id:'ncm:'+value, ncmSongId:Number(value), source:'ncm', title:'网易云 '+value, artist:'', album:'', duration:0 } }
        } else if (payload.songId === 'current') current = true
        else if (typeof payload.songId === 'string') input = { kind:'local', id:payload.songId }
        else if (payload.input && typeof payload.input === 'object') input = payload.input as CoreQueueTrackInput
        else throw new Error('Invalid analysis source')
        const request = { ...(input ? {input} : {current}), stages:payload.stages as StudyStage[], ...(lyrics !== undefined ? {lyrics:lyrics as string} : {}) }
        if (!validStudyPayload('study.submit', request)) throw new Error('Invalid analysis stages or timed lyrics')
        return application.request('study.submit', request)
      }
    },
    'agent.music.artifacts': {
      kind:'query', description:'Inspect verified native analysis artifacts without copying audio.', inputSchema:idSchema,
      async run(payload) {
        const value = await project(payload.id)
        return { id:value.id, title:value.title, status:value.status, sourceSha256:value.result?.sourceSha256, files:await files(directory(value.id)) }
      }
    },
    'agent.music.context': {
      kind:'query', description:'Read the real analysis with shared key inference and Roman chord degrees.', inputSchema:idSchema,
      async run(payload) {
        const value = await project(payload.id)
        const inferred = inferChordKey(value.result?.chords.segments ?? []) ?? value.result?.melody?.key ?? null
        const manual = parseKey(value.lyricDisplay?.key ?? 'auto'), key = manual ?? inferred
        return { ...value, tonality: { key, name:key ? keyName(key) : null, source:manual ? 'manual' : 'estimated',
          degrees:value.result?.chords.segments.map(chord=>({...chord,degree:romanChord(chord.label,key)})) ?? [] } }
      }
    },
    'agent.music.export': {
      kind:'command', description:'Export SVG and PDF from the same native score components as the player.',
      inputSchema:objectSchema({id:text,directory:text,notation:{enum:['numbered','staff']},key:text},['id','directory','notation']),
      async run(payload) {
        if (typeof payload.directory !== 'string' || !payload.directory || !['numbered','staff'].includes(String(payload.notation))) throw new Error('Expected directory and numbered/staff notation')
        const value = await project(payload.id), melody = value.result?.melody
        if (!melody?.scores?.length) throw new Error('Complete vocal melody analysis before exporting scores')
        const setting = payload.key ?? 'auto'
        if (setting !== 'auto' && (typeof setting !== 'string' || !parseKey(setting))) throw new Error('Invalid display key')
        const key = parseKey(String(setting)) ?? inferChordKey(value.result?.chords.segments ?? []) ?? melody.key
        const rows = melody.scores.flatMap(row => { const score = rhythmicLyricScore(melody,row.lineId,row.text); return score ? [{...score,lineId:row.lineId}] : [] })
        const exported = await exporter.export({ id:value.id,title:value.title,notation:payload.notation as 'numbered'|'staff',key,rows },resolve(payload.directory))
        const native = (await files(directory(value.id))).filter(file=>/\.(mid|musicxml)$/i.test(file.path) && !file.path.endsWith('.layout.musicxml'))
        const source = join(exported.directory,'source')
        await mkdir(source)
        for (const [index,file] of native.entries()) await copyFile(file.path,join(source,String(index).padStart(4,'0')+'-'+basename(file.path)))
        await writeFile(join(exported.directory,'analysis.json'),JSON.stringify({ id:value.id, title:value.title, sourceSha256:value.result?.sourceSha256,
          key, melody:{...melody,scores:undefined}, chords:value.result?.chords },null,2))
        return { ...exported, sourceArtifacts:native.length, analysis:join(exported.directory,'analysis.json') }
      }
    },
    'agent.music.exportAudio': {
      kind:'command',description:'Export selected stems and chords through the native study exporter to an explicit directory.',
      inputSchema:objectSchema({id:text,directory:text,audioFormat:{enum:['wav','flac']},chordFormat:{enum:['txt','csv','json']},stems:{type:'array',items:{type:'string'}}},['id','directory','audioFormat','chordFormat','stems']),
      async run(payload) {
        if (typeof payload.directory !== 'string' || !payload.directory) throw new Error('Expected export directory')
        const target = resolve(payload.directory)
        await mkdir(target,{recursive:true})
        const outputDirectory = await grantUserSelectedDownloadRoot(target)
        const request = {id:payload.id,outputDirectory,audioFormat:payload.audioFormat,chordFormat:payload.chordFormat,stems:payload.stems}
        if (!validStudyPayload('study.export',request)) throw new Error('Invalid stem export request')
        return application.request('study.export',request as Parameters<CoreApplicationRuntime['request']>[1] as never)
      }
    },
    'agent.app.quit': {
      kind:'command',description:'Ask the application to quit normally, preserving its native shutdown flow.',inputSchema:objectSchema({},[]),
      async run() { setTimeout(()=>app.quit(),100); return { quitting:true } }
    }
  }
  return { custom, stop:()=>exporter.stop() }
}
