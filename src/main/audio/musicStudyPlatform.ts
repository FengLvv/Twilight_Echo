import { app, dialog, powerMonitor } from 'electron'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, stat, realpath, readdir } from 'node:fs/promises'
import { join, resolve, relative, basename, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { STUDY_MODEL_HASHES } from './studyModelRegistry.ts'
import { createStudyCacheValidator } from './studyCache.ts'
import { StudyResidentProcess } from './studyResidentProcess.ts'
import { StudyRuntimeResidency, STUDY_GPU_IDLE_MS } from './studyRuntimeResidency.ts'
import {
  grantCompletedDownloadAudioFile,
  resolveAuthorizedAudioFile,
  resolveConfiguredDownloadRoot
} from '../security/localPaths.ts'
import {
  validStudyTrack,
  STUDY_STAGES,
  type StudyPlatformOperations,
  type StudyResult,
  type StudyState,
  type StudyRuntimeStatus,
  type StudyAudioGroup
} from '../../shared/musicStudy.ts'

type Operations = {
  [K in keyof StudyPlatformOperations]: (
    input: StudyPlatformOperations[K]['input'],
    signal: AbortSignal
  ) => Promise<StudyPlatformOperations[K]['output']>
}
type Job = {
  runId: string
  generation: number
  controller: AbortController
  done: Promise<void>
  running: boolean
  progress: number
  stage: string
  error?: string
  phase?: import('../../shared/musicStudy.ts').StudyStage
  resultRevision?: number
  result?: StudyResult
  interrupted?: boolean
}
const coreModels = [
  'torch/hub/checkpoints/5c90dfd2-34c22ccb.th',
  'sheetsage2/model.safetensors',
  'sheetsage2/config.json',
  'mert2/model.safetensors',
  'mert2/config.json'
]

export function createMusicStudyPlatform(profile: string) {
  const root = join(profile, 'music-study'),
    jobs = new Map<string, Job>(),
    validateCache = createStudyCacheValidator()
  const script = join(
    app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
    'music-study',
    'worker.py'
  )
  const configured = join(root, 'environment.json')
  let home =
    process.env.TWILIGHT_MUSIC_STUDY_HOME || join(app.getPath('exe'), '..', 'music-study-runtime')
  let selected: Promise<void> | null = null,
    environmentCache: StudyState['environment'] | null = null,
    environmentPending: Promise<StudyState['environment']> | null = null,
    lifetime = new AbortController(),
    draining: Promise<void> | null = null
  let runtimeState: StudyRuntimeStatus = { state: 'stopped', pid: null, loaded: [] }
  const verified = new Map<string, string>()
  const mixSlots = new Map<string, number>()
  const python = () =>
    join(
      home,
      'runtime',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python'
    )
  const runtime = new StudyResidentProcess(python, script)
  powerMonitor.on('resume', () => runtime.resumeWatchdog())
  const residency = new StudyRuntimeResidency({
    call: (method, params, signal, event) => runtime.call(method, params, signal, event),
    alive: () => runtime.pid !== null,
    changed: (value) => {
      runtimeState = { ...runtimeState, ...value }
    },
    failed: (error) => console.warn('[study.residency]', String(error)),
    schedule: (callback, delay) => {
      const timer = setTimeout(callback, delay)
      timer.unref()
      return () => clearTimeout(timer)
    }
  })
  const init = () =>
    (selected ??= (async () => {
      await mkdir(root, { recursive: true })
      try {
        home = JSON.parse(await readFile(configured, 'utf8')).home
      } catch { /* A missing or unreadable local configuration uses the default runtime. */ }
      const trash = join(root, '.trash')
      if (existsSync(trash)) {
        const boundary = await realpath(root),
          target = await realpath(trash),
          child = relative(boundary, target)
        if (!child || isAbsolute(child) || child.startsWith('..'))
          throw new Error('Invalid cache recovery path')
        await rm(target, { recursive: true, force: true })
      }
      // Only recover our own generated workspace, never user music or exports.
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.name)) continue
        const dir = await owned(entry.name)
        for (const file of await readdir(dir, { withFileTypes: true })) {
          if (
            file.isSymbolicLink() ||
            !(
              /\.part(?:\.wav)?$|\.tmp$|\.temix$/.test(file.name) ||
              file.name === 'source.cache' ||
              file.name.startsWith('vocal-align-')
            )
          )
            continue
          const target = await realpath(join(dir, file.name)),
            child = relative(dir, target)
          if (!child || isAbsolute(child) || child.startsWith('..'))
            throw new Error('Invalid temporary audio path')
          await rm(target, { recursive: file.isDirectory(), force: true })
        }
      }
    })())
  const directory = (id: string) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid project ID')
    return join(root, id)
  }
  const atomic = async (path: string, data: string) => {
    const temp = path + '.' + randomUUID() + '.tmp'
    await writeFile(temp, data, 'utf8')
    await rename(temp, path)
  }
  async function digest(path: string, signal?: AbortSignal) {
    const hash = createHash('sha256')
    for await (const block of createReadStream(path)) {
      signal?.throwIfAborted()
      hash.update(block)
    }
    return hash.digest('hex')
  }
  async function verify(names = coreModels) {
    await init()
    if (!existsSync(python())) throw new Error('请选择包含 runtime 和 models 的分析环境')
    for (const name of names) {
      const path = join(home, 'models', name),
        info = await stat(path),
        version = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
      if (verified.get(path) === version) continue
      if ((await digest(path, lifetime.signal)) !== STUDY_MODEL_HASHES[name])
        throw new Error('模型校验失败：' + name)
      verified.set(path, version)
    }
  }
  async function environment(): Promise<StudyState['environment']> {
    if (environmentCache?.ready && runtime.pid) return environmentCache
    if (environmentPending) return environmentPending
    environmentPending = (async () => {
      try {
        runtimeState = { state: 'warming', pid: runtime.pid, loaded: [] }
        await verify()
        const value = await residency.run('warm', { pack: join(home, 'models') }, lifetime.signal)
        runtimeState = { ...value, state: 'ready', pid: runtime.pid }
        return (environmentCache = { ready: true, gpu: !!value.gpu, gpuName: value.gpuName })
      } catch (error) {
        runtimeState = { state: 'failed', pid: runtime.pid, loaded: [], error: String(error) }
        return (environmentCache = { ready: false, gpu: false, gpuName: '', error: String(error) })
      }
    })().finally(() => {
      environmentPending = null
    })
    return environmentPending
  }
  const chooseDirectory = async (title: string) => {
    const value = await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
    return value.canceled ? null : (value.filePaths[0] ?? null)
  }
  const cacheDestination = (target: string) => {
    const path = relative(resolve(root), resolve(target))
    return (
      !path ||
      (!isAbsolute(path) &&
        path !== '..' &&
        !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')))
    )
  }
  const kindOf = (name: string): StudyAudioGroup['kind'] =>
    /^(lead|backing)(\.|$)/.test(name)
      ? 'leadBacking'
      : /^(singerA|singerB)(\.|$)/.test(name)
        ? 'twoSingers'
        : 'six'
  async function files(path: string): Promise<Array<{ path: string; bytes: number; top: string }>> {
    const output: Array<{ path: string; bytes: number; top: string }> = []
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue
      const target = join(path, entry.name)
      if (entry.isDirectory())
        for (const value of await files(target)) output.push({ ...value, top: entry.name })
      else if (entry.isFile())
        output.push({ path: target, bytes: (await stat(target)).size, top: entry.name })
    }
    return output
  }
  async function owned(id: string) {
    const target = await realpath(directory(id)),
      boundary = await realpath(root),
      child = relative(boundary, target)
    if (!child || child.startsWith('..') || resolve(boundary, child) !== target)
      throw new Error('Invalid cache path')
    return target
  }
  const operations: Operations = {
    'study.captureLocal': async ({ path }) => resolveAuthorizedAudioFile(path),
    'study.environment': async () => environment(),
    'study.runtime': async () => ({
      idleOffloadSeconds: STUDY_GPU_IDLE_MS / 1000,
      ...runtimeState,
      pid: runtime.pid,
      ...(!runtime.pid && runtimeState.state === 'ready'
        ? {
            state: 'stopped' as const,
            loaded: [],
            devices: {},
            cudaAllocatedBytes: 0,
            cudaReservedBytes: 0,
            residentWeightBytes: 0,
            estimatedDirectMLBytes: 0
          }
        : {})
    }),
    'study.runtimeActivity': async ({ busy }) => {
      residency.setDemand(busy)
    },
    'study.choosePack': async () => {
      if ([...jobs.values()].some((job) => job.running)) throw new Error('请先结束当前分析任务')
      const value = await chooseDirectory('选择分析环境（包含 runtime、models）')
      if (!value) return
      residency.suspend()
      await runtime.close()
      await environmentPending
      const previous = home
      home = await realpath(value)
      verified.clear()
      environmentCache = null
      residency.resume()
      const result = await environment()
      if (!result.ready) {
        residency.suspend()
        await runtime.close()
        home = previous
        environmentCache = null
        residency.resume()
        throw new Error(result.error)
      }
      await atomic(configured, JSON.stringify({ home }))
    },
    'study.chooseSource': async () => {
      const result = await dialog.showOpenDialog({
        title: '选择歌曲',
        properties: ['openFile'],
        filters: [
          {
            name: '音频',
            extensions: ['wav', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'alac', 'wma']
          }
        ]
      })
      const path = result.canceled ? null : result.filePaths[0]
      return path
        ? { path: await grantCompletedDownloadAudioFile(path), title: basename(path) }
        : null
    },
    'study.startWorker': async (request) => {
      await init()
      if (jobs.get(request.id)?.running) throw new Error('项目正在运行')
      const dir = directory(request.id),
        controller = new AbortController()
      const releaseRuntime = residency.retain()
      const signal = AbortSignal.any([controller.signal, lifetime.signal])
      const job: Job = {
        runId: request.runId,
        generation: runtime.generationId,
        resultRevision: 0,
        controller,
        done: Promise.resolve(),
        running: true,
        progress: 0,
        stage: '准备音频',
        result: request.previous
      }
      jobs.set(request.id, job)
      job.done = (async () => {
        const env = await environment()
        job.generation = runtime.generationId
        if (!env.ready) throw new Error(env.error)
        await verify()
        const voiceModels =
          request.operation === 'leadBacking'
            ? ['UVR_MDXNET_KARA_2.onnx']
            : request.operation === 'twoSingers'
              ? ['duet.safetensors', 'speaker/embedding_model.ckpt']
              : []
        if (voiceModels.length) await verify(voiceModels)
        await mkdir(dir, { recursive: true })
        let source = request.source,
          input = request.previous?.cache?.input
        const metadata = await validateCache(dir, STUDY_MODEL_HASHES, undefined, request.previous)
        const notesOnly = request.operation === 'melody' && metadata.notesReady
        const budget = request.budgetBytes ?? 2 * 1024 ** 3
        if (!notesOnly && !existsSync(join(dir, 'original.wav')) && source) {
          if (/^https?:\/\//i.test(source)) {
            const response = await fetch(source, {
              signal,
              headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' }
            })
            if (!response.ok || !response.body)
              throw new Error('音源不可用（HTTP ' + response.status + '）')
            const partial = join(dir, 'source.part'),
              complete = join(dir, 'source.cache')
            const declared = Number(response.headers.get('content-length') || 0)
            if (declared > budget) throw new Error('音频缓存容量不足')
            let bytes = 0
            const hash = createHash('sha256'),
              body = Readable.fromWeb(response.body as any)
            const limiter = new Transform({
              transform(block, _encoding, callback) {
                if (bytes + block.length > budget) return callback(new Error('音频缓存容量不足'))
                bytes += block.length
                hash.update(block)
                callback(null, block)
              }
            })
            try {
              await pipeline(body, limiter, createWriteStream(partial), { signal })
              if (!bytes || (declared && bytes !== declared)) throw new Error('音源下载不完整')
              await rename(partial, complete)
              source = complete
              input = { path: '', size: bytes, mtimeMs: 0, sha256: hash.digest('hex') }
            } finally {
              await rm(partial, { force: true })
            }
          } else {
            source = await resolveAuthorizedAudioFile(source)
            const info = await stat(source)
            input = {
              path: source,
              size: info.size,
              mtimeMs: info.mtimeMs,
              sha256: await digest(source, signal)
            }
          }
        }
        const previous = request.previous ? structuredClone(request.previous) : undefined
        if (previous)
          previous.ready = notesOnly
            ? metadata.ready
            : (await validateCache(dir, STUDY_MODEL_HASHES, undefined, previous, true)).ready
        await residency.run(
          'analyze',
          {
            ...request,
            previous,
            source,
            directory: dir,
            pack: join(home, 'models'),
            modelFingerprints: STUDY_MODEL_HASHES
          },
          signal,
          (event) => {
            if (event.kind === 'runtime' && event.releasedOptional) {
              runtimeState.loaded = runtimeState.loaded.filter(
                (name) => name === 'six' || name === 'chords'
              )
            } else if (
              event.kind === 'runtime' &&
              ['melody', 'leadBacking', 'twoSingers'].includes(event.loadedOptional)
            ) {
              runtimeState.loaded = [...new Set([...runtimeState.loaded, event.loadedOptional])]
            } else if (event.kind === 'progress') {
              job.progress = Number(event.progress) || 0
              job.stage = String(event.stage).slice(0, 200)
              if (STUDY_STAGES.includes(event.phase)) job.phase = event.phase
            } else if (event.kind === 'stageReady') {
              const result = event.result as StudyResult
              if (
                result?.version !== 1 ||
                !result.cache ||
                !Number.isSafeInteger(result.frames) ||
                result.frames <= 0 ||
                result.sampleRate !== 44100 ||
                result.stems.some((stem) => !validStudyTrack(stem))
              )
                throw new Error('无效分析结果')
              if (input) result.cache.input = input
              job.result = result
              job.resultRevision = Number(event.resultRevision)
              job.phase = event.phase
            }
          }
        )
        job.stage = '分析完成'
        job.progress = 1
      })()
        .catch((error) => {
          job.error = String(error).slice(-2000)
          job.interrupted = ['RUNTIME_INTERRUPTED', 'RUNTIME_EXIT_UNCONFIRMED'].includes(
            error?.code
          )
          job.stage = signal.aborted
            ? '任务已取消'
            : job.interrupted
              ? '分析中断，可重试'
              : '分析失败'
        })
        .finally(async () => {
          try {
            if (runtime.pid && !lifetime.signal.aborted)
              await residency.run('residency', {}, lifetime.signal)
          } catch {
            /* Process failures remain on the job; metadata never restarts it. */
          } finally {
            job.running = false
            releaseRuntime()
          }
        })
    },
    'study.hasSource': async ({ id }) => existsSync(join(directory(id), 'original.wav')),
    'study.validateCache': async ({ id, source, result, verifyAudio }) =>
      validateCache(directory(id), STUDY_MODEL_HASHES, source, result, verifyAudio),
    'study.workerStatus': async ({ id }) => {
      const job = jobs.get(id)
      if (!job)
        return {
          runId: '',
          generation: runtime.generationId,
          resultAvailable: false,
          running: false,
          progress: 0,
          stage: '任务中断',
          error: '分析进程已重启'
        }
      const {
        running,
        progress,
        stage,
        error,
        phase,
        resultRevision,
        runId,
        generation,
        interrupted
      } = job
      return {
        running,
        progress,
        stage,
        error,
        phase,
        resultRevision,
        runId,
        generation,
        interrupted,
        recovering: runtime.recoveryBlocked,
        resultAvailable: !!job.result
      }
    },
    'study.workerResult': async (request) => {
      const job = jobs.get(request.id)
      if (
        !job?.result ||
        job.runId !== request.runId ||
        job.generation !== request.generation ||
        job.resultRevision !== request.resultRevision
      )
        return null
      return job.result
    },
    'study.ackWorkerResult': async (request) => {
      const job = jobs.get(request.id)
      if (
        job?.runId === request.runId &&
        job.generation === request.generation &&
        job.resultRevision === request.resultRevision &&
        request.terminal &&
        !job.running
      )
        jobs.delete(request.id)
    },
    'study.cancelWorker': async ({ id }) => {
      const job = jobs.get(id)
      if (job?.running) {
        job.controller.abort()
        await job.done
      }
      if (runtime.recoveryBlocked)
        throw Object.assign(new Error('无法确认分析进程退出'), { code: 'RUNTIME_EXIT_UNCONFIRMED' })
    },
    'study.audioInventory': async () => {
      await init()
      const groups: StudyAudioGroup[] = []
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.name)) continue
        const totals = new Map<StudyAudioGroup['kind'], number>()
        for (const file of await files(await owned(entry.name))) {
          const kind = kindOf(file.top)
          totals.set(kind, (totals.get(kind) ?? 0) + file.bytes)
        }
        for (const [kind, bytes] of totals) if (bytes) groups.push({ id: entry.name, kind, bytes })
      }
      return groups
    },
    'study.removeAudio': async ({ id, kind }) => {
      if (jobs.get(id)?.running) throw new Error('音频正在分析中')
      if (!existsSync(directory(id))) return
      const dir = await owned(id)
      const entries = (await readdir(dir, { withFileTypes: true })).filter(
        (entry) => kindOf(entry.name) === kind
      )
      const trash = join(root, '.trash', id + '-' + kind + '-' + randomUUID())
      await mkdir(trash, { recursive: true })
      const actualTrash = await realpath(trash),
        trashChild = relative(await realpath(root), actualTrash)
      if (!trashChild || isAbsolute(trashChild) || trashChild.startsWith('..'))
        throw new Error('Invalid cache deletion path')
      const moved: string[] = []
      try {
        for (const entry of entries) {
          await rename(join(dir, entry.name), join(trash, entry.name))
          moved.push(entry.name)
        }
        await rm(trash, { recursive: true, force: true })
      } catch (error) {
        for (const name of moved)
          if (existsSync(join(trash, name))) await rename(join(trash, name), join(dir, name))
        throw error
      }
    },
    'study.removeFiles': async ({ id }, signal) => {
      for (const kind of ['six', 'leadBacking', 'twoSingers'] as const)
        await operations['study.removeAudio']({ id, kind }, signal)
      if (existsSync(directory(id))) await rm(await owned(id), { recursive: true, force: true })
      jobs.delete(id)
    },
    'study.writeMix': async ({ id, gains, frames }) => {
      const dir = directory(id),
        entries = Object.entries(gains)
      for (const [stem] of entries)
        if (!existsSync(join(dir, stem + '.wav'))) throw new Error('分轨音频已被淘汰，请重新生成')
      const slot = ((mixSlots.get(id) ?? 0) + 1) % 2
      const path = join(dir, 'mix-' + slot + '.temix')
      const content =
        'TEMIX1\n44100 ' +
        frames +
        ' ' +
        entries.length +
        '\n' +
        entries.map(([stem, gain]) => gain + '\n' + join(dir, stem + '.wav')).join('\n') +
        '\n'
      if (Buffer.byteLength(content) > 32768) throw new Error('分轨音频路径过长')
      await atomic(path, content)
      mixSlots.set(id, slot)
      return path
    },
    'study.exportFiles': async (request, signal) => {
      const destination = request.outputDirectory
        ? await resolveConfiguredDownloadRoot(request.outputDirectory)
        : await chooseDirectory('选择导出位置')
      if (!destination) return null
      if (cacheDestination(destination)) throw new Error('导出位置不能位于分析缓存内')
      const output = join(destination, 'TwilightEcho-' + request.id.slice(0, 8) + '-' + Date.now())
      await mkdir(output, { recursive: true })
      const segments = request.chords.segments
      const text =
        request.chordFormat === 'json'
          ? JSON.stringify(request.chords, null, 2)
          : request.chordFormat === 'csv'
            ? 'start_seconds,end_seconds,chord,confidence,edited\r\n' +
              segments
                .map((s) => [s.start, s.end, s.label, s.confidence, !!s.edited].join(','))
                .join('\r\n')
            : segments
                .map((s) =>
                  [s.start.toFixed(3), s.end.toFixed(3), s.label, s.confidence].join('\t')
                )
                .join('\n')
      await writeFile(join(output, 'chords.' + request.chordFormat), text, 'utf8')
      if (request.stems.length)
        await residency.run(
          'export',
          {
            directory: directory(request.id),
            destination: output,
            format: request.audioFormat,
            stems: request.stems
          },
          signal
        )
      return output
    },
    'study.exportSources': async (request, signal) => {
      const target = await resolveConfiguredDownloadRoot(request.outputDirectory)
      if (!target) throw new Error('导出目录未经授权')
      if (cacheDestination(target)) throw new Error('导出位置不能位于分析缓存内')
      await residency.run(
        'notationSources',
        {
          directory: target,
          melody: request.melody,
          lines: JSON.parse(request.lyrics),
          pack: join(home, 'models')
        },
        signal
      )
      return (await files(target)).length
    }
  }
  return {
    operations,
    idle: () =>
      (draining ??= (async () => {
        residency.suspend()
        lifetime.abort(new Error('分析平台正在关闭'))
        for (const job of jobs.values()) job.controller.abort()
        await runtime.close()
        await Promise.allSettled([...jobs.values()].map((job) => job.done))
        await environmentPending
        jobs.clear()
        environmentCache = null
        runtimeState = { state: 'stopped', pid: null, loaded: [] }
        lifetime = new AbortController()
        residency.setDemand(false)
        residency.resume()
      })().finally(() => {
        draining = null
      }))
  }
}
