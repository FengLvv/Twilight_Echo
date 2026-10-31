import { app, dialog } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, stat, realpath, copyFile } from 'node:fs/promises'
import { join, resolve, relative, basename, extname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { STUDY_MODEL_HASHES } from './studyModelRegistry.ts'
import { createStudyCacheValidator } from './studyCache.ts'
import {
  grantCompletedDownloadAudioFile,
  resolveAuthorizedAudioFile,
  resolveConfiguredDownloadRoot
} from '../security/localPaths.ts'
import { validStudyTrack, STUDY_STAGES, type StudyPlatformOperations, type StudyResult, type StudyState, type StudyStage } from '../../shared/musicStudy.ts'

type Operations = {
  [K in keyof StudyPlatformOperations]: (
    input: StudyPlatformOperations[K]['input'],
    signal: AbortSignal
  ) => Promise<StudyPlatformOperations[K]['output']>
}
type Job = {
  child?: ChildProcess
  controller: AbortController
  done: Promise<void>
  running: boolean
  progress: number
  stage: string
  error?: string
  phase?: StudyStage
  resultRevision?: number
  result?: StudyResult
  loadedRevision?: number
}
export function createMusicStudyPlatform(profile: string) {
  const root = join(profile, 'music-study'),
    jobs = new Map<string, Job>(),
    activeRuns = new Set<Promise<void>>()
  const validateCache = createStudyCacheValidator()
  let lifetime = new AbortController(),
    draining: Promise<void> | null = null
  const worker = join(
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
    mixSequence = 0
  const init = () =>
    (selected ??= (async () => {
      await mkdir(root, { recursive: true })
      try {
        const data = JSON.parse(await readFile(configured, 'utf8'))
        home = data.home
      } catch {}
    })())
  const python = () =>
    join(
      home,
      'runtime',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python'
    )
  const directory = (id: string) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid project ID')
    return join(root, id)
  }
  const atomic = async (path: string, data: string) => {
    const temp = path + '.' + randomUUID() + '.tmp'
    await writeFile(temp, data, 'utf8')
    await rename(temp, path)
  }
  async function verify() {
    await init()
    lifetime.signal.throwIfAborted()
    if (!existsSync(python())) throw new Error('请选择包含 runtime 和 models 的完整分析环境目录')
    for (const [file, expected] of Object.entries(STUDY_MODEL_HASHES)) {
      const path = join(home, 'models', file),
        hash = createHash('sha256')
      for await (const block of createReadStream(path)) {
        lifetime.signal.throwIfAborted()
        hash.update(block)
      }
      if (hash.digest('hex') !== expected) throw new Error('模型校验失败: ' + file)
    }
  }
  async function run(
    operation: 'probe' | 'analyze' | 'export',
    request: object,
    dir: string,
    signal: AbortSignal,
    onEvent: (value: any) => void,
    assign?: (child: ChildProcess) => void
  ) {
    signal = AbortSignal.any([signal, lifetime.signal])
    await mkdir(dir, { recursive: true })
    const requestFile = join(dir, 'request-' + randomUUID() + '.json')
    await writeFile(requestFile, JSON.stringify(request), 'utf8')
    try {
      const completion = new Promise<void>((done, reject) => {
        signal.throwIfAborted()
        const child = spawn(python(), [worker, operation, requestFile], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONNOUSERSITE: '1',
            HF_HUB_OFFLINE: '1',
            TRANSFORMERS_OFFLINE: '1',
            OMP_NUM_THREADS: '8',
            TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1'
          }
        })
        assign?.(child)
        let pending = '',
          error = '',
          failure = ''
        const abort = () => {
          if (process.platform === 'win32' && child.pid)
            execFile(
              join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
              ['/PID', String(child.pid), '/T', '/F'],
              { windowsHide: true },
              () => {
                if (child.exitCode === null) child.kill()
              }
            )
          else child.kill()
        }
        signal.addEventListener('abort', abort, { once: true })
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (block) => {
          pending += block.toString('utf8')
          if (pending.length > 128 * 1024) {
            failure = '分析进程输出超出限制'
            child.kill()
            return
          }
          let index: number
          while ((index = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, index)
            pending = pending.slice(index + 1)
            try {
              const value = JSON.parse(line)
              if (value.kind === 'error') failure = value.message
              onEvent(value)
            } catch {}
          }
        })
        child.stderr?.on('data', (block) => {
          error = (error + block.toString('utf8')).slice(-6000)
        })
        child.on('error', reject)
        child.on('close', (code) => {
          signal.removeEventListener('abort', abort)
          if (signal.aborted) reject(new Error('任务已取消'))
          else if (code !== 0) reject(new Error(failure || error || '分析进程退出'))
          else done()
        })
      })
      activeRuns.add(completion)
      try {
        await completion
      } finally {
        activeRuns.delete(completion)
      }
    } finally {
      await rm(requestFile, { force: true })
    }
  }
  async function environment(): Promise<StudyState['environment']> {
    if (environmentCache) return environmentCache
    if (environmentPending) return environmentPending
    environmentPending = checkEnvironment().finally(() => {
      environmentPending = null
    })
    return environmentPending
  }
  async function checkEnvironment(): Promise<StudyState['environment']> {
    try {
      await verify()
      let result: StudyState['environment'] = { ready: false, gpu: false, gpuName: '' }
      await run(
        'probe',
        { pack: join(home, 'models') },
        root,
        AbortSignal.timeout(120000),
        (event) => {
          if (event.kind === 'probe')
            result = { ready: true, gpu: !!event.gpu, gpuName: String(event.gpuName || '') }
        }
      )
      environmentCache = result
      return result
    } catch (error) {
      return { ready: false, gpu: false, gpuName: '', error: String(error) }
    }
  }
  const chooseDirectory = async (title: string) => {
    const result = await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }
  const operations: Operations = {
    'study.captureLocal': async ({ id, path }) => {
      const source = await resolveAuthorizedAudioFile(path),
        dir = directory(id)
      await mkdir(dir, { recursive: true })
      const partial = join(dir, 'capture.part'),
        target = join(dir, 'source' + extname(source).toLowerCase())
      try {
        await copyFile(source, partial)
        await rename(partial, target)
        const info = await stat(source)
        await atomic(join(dir, 'source-info.json'), JSON.stringify({ path: source, size: info.size, mtimeMs: info.mtimeMs }))
      } catch (error) {
        await rm(partial, { force: true })
        throw error
      }
      return target
    },
    'study.environment': async () => environment(),
    'study.choosePack': async () => {
      if ([...jobs.values()].some((job) => job.running)) throw new Error('请等待或取消当前分析任务')
      await init()
      await environmentPending
      const path = await chooseDirectory('选择分轨分析环境（包含 runtime、models）')
      if (!path) return
      const previous = home
      home = await realpath(path)
      try {
        await verify()
        environmentCache = null
        const result = await environment()
        if (!result.ready) throw new Error(result.error || '环境不可用')
        await atomic(configured, JSON.stringify({ home }))
      } catch (error) {
        home = previous
        environmentCache = null
        throw error
      }
    },
    'study.chooseSource': async ({ id }, signal) => {
      const result = await dialog.showOpenDialog({
        title: '选择完整歌曲进行分轨',
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
        ? {
            path: await operations['study.captureLocal'](
              { id, path: await grantCompletedDownloadAudioFile(path) },
              signal
            ),
            title: basename(path)
          }
        : null
    },
    'study.startWorker': async (request) => {
      await init()
      if (jobs.get(request.id)?.running) throw new Error('项目正在运行')
      const dir = directory(request.id),
        controller = new AbortController()
      const job: Job = {
        controller,
        done: Promise.resolve(),
        running: true,
        progress: 0,
        stage: '完整缓存音频'
      }
      jobs.set(request.id, job)
      job.done = (async () => {
        const env = await environment()
        if (!env.ready) throw new Error(env.error || '环境不可用')
        await mkdir(dir, { recursive: true })
        let source = request.source
        if (!existsSync(join(dir, 'original.wav')) && !/^https?:\/\//i.test(source)) {
          const canonicalSource = await realpath(source)
          const ownedSource = relative(await realpath(dir), canonicalSource)
          source = /^source\.[a-z0-9]+$/i.test(ownedSource)
            ? canonicalSource
            : await operations['study.captureLocal'](
                { id: request.id, path: canonicalSource },
                controller.signal
              )
        }
        if (/^https?:\/\//i.test(source) && !existsSync(join(dir, 'original.wav'))) {
          const response = await fetch(source, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' }
          })
          if (!response.ok || !response.body)
            throw new Error('音源无法完整缓存（HTTP ' + response.status + '）')
          const declared = Number(response.headers.get('content-length') || 0)
          if (declared > 2 * 1024 ** 3) throw new Error('缓存文件超过 2 GB')
          const partial = join(dir, 'source.part'),
            complete = join(dir, 'source.cache')
          let bytes = 0
          const body = Readable.fromWeb(response.body as any)
          body.on('data', (chunk) => {
            bytes += chunk.length
            if (bytes > 2 * 1024 ** 3) body.destroy(new Error('缓存文件超过 2 GB'))
          })
          await pipeline(body, createWriteStream(partial), { signal: controller.signal })
          if (!bytes || (declared && bytes !== declared)) throw new Error('音频未完整下载')
          await rename(partial, complete)
          source = complete
        }
        await run(
          'analyze',
          {
            ...request,
            source,
            directory: dir,
            pack: join(home, 'models'),
            modelFingerprints: STUDY_MODEL_HASHES
          },
          dir,
          controller.signal,
          (event) => {
            if (event.kind === 'progress') {
              job.progress = Number(event.progress) || 0
              job.stage = String(event.stage).slice(0, 200)
              if (STUDY_STAGES.some(stage => stage === event.phase)) job.phase = event.phase
            } else if (event.kind === 'stageReady') {
              job.resultRevision = Number(event.resultRevision)
            }
          },
          (child) => (job.child = child)
        )
        job.stage = '分析完成'
        job.progress = 1
      })()
        .catch((error) => {
          job.error = String(error).slice(-2000)
          job.stage = controller.signal.aborted ? '任务已取消' : '分析失败'
        })
        .finally(() => {
          job.running = false
          job.child = undefined
        })
    },
    'study.hasSource': async ({ id }) => existsSync(join(directory(id), 'original.wav')),
    'study.validateCache': async ({ id, source }) => validateCache(directory(id), STUDY_MODEL_HASHES, source ? await resolveAuthorizedAudioFile(source).catch(() => undefined) : undefined),
    'study.workerStatus': async ({ id }) => {
      const job = jobs.get(id)
      if (!job)
        return {
          running: false,
          progress: 0,
          stage: '任务中断',
          error: '分析进程已重启，请继续任务'
        }
      const { running, progress, stage, error, phase, resultRevision } = job
      let result: StudyResult | undefined
      if (resultRevision || !running && !error) {
        const path = join(directory(id), 'result.json')
        if ((await stat(path)).size > 32 * 1024 ** 2) throw new Error('结果超出限制')
        if (job.loadedRevision !== resultRevision || !job.result) {
          const parsed = JSON.parse(await readFile(path,'utf8')) as StudyResult
          if (parsed.version !== 1 || !Number.isSafeInteger(parsed.frames) || parsed.frames <= 0 || parsed.sampleRate !== 44100 || !Array.isArray(parsed.stems) || parsed.stems.some(s=>!validStudyTrack(s))) throw new Error('无效的分轨结果')
          const checkpoint = JSON.parse(await readFile(join(directory(id),'stages.json'),'utf8'))
          for (const name of parsed.stems) {
            const expected = Object.values(checkpoint).map((entry:any)=>entry.files?.[name]).find(Boolean)
            const hash = createHash('sha256')
            if (!expected) throw new Error('分轨校验信息缺失')
            for await (const chunk of createReadStream(join(directory(id),name+'.wav'))) hash.update(chunk)
            if (hash.digest('hex') !== expected) throw new Error('分轨文件校验失败')
          }
          job.result = parsed
          job.loadedRevision = resultRevision
        }
        result = job.result
      }
      return { running, progress, stage, error, result, phase, resultRevision }
    },
    'study.cancelWorker': async ({ id }) => {
      const job = jobs.get(id)
      if (job?.running) {
        job.controller.abort()
        await job.done
      }
    },
    'study.removeFiles': async ({ id }) => {
      if (jobs.get(id)?.running) throw new Error('请先取消任务')
      const target = resolve(directory(id)),
        boundary = resolve(root)
      if (!relative(boundary, target) || relative(boundary, target).startsWith('..'))
        throw new Error('Invalid cache path')
      await rm(target, { recursive: true, force: true })
      jobs.delete(id)
    },
    'study.writeMix': async ({ id, gains, frames }) => {
      const dir = directory(id),
        entries = Object.entries(gains)
      for (const [stem] of entries)
        if (!existsSync(join(dir, stem + '.wav'))) throw new Error('分轨文件缺失，请重新分析')
      // Immutable manifests ensure an acknowledged reopen flushes decoded samples.
      const path = join(dir, 'mix-' + ++mixSequence + '-' + randomUUID() + '.temix')
      await atomic(
        path,
        'TEMIX1\n44100 ' +
          frames +
          ' ' +
          entries.length +
          '\n' +
          entries.map(([stem, gain]) => gain + '\n' + join(dir, stem + '.wav')).join('\n') +
          '\n'
      )
      return path
    },
    'study.exportFiles': async (request, signal) => {
      const destination = request.outputDirectory
        ? await resolveConfiguredDownloadRoot(request.outputDirectory)
        : await chooseDirectory('选择导出位置（创建独立子目录）')
      if (request.outputDirectory && !destination) throw new Error('导出目录未经用户授权')
      if (!destination) return null
      await mkdir(destination, { recursive: true })
      const output = join(destination, 'TwilightEcho-' + request.id.slice(0, 8) + '-' + Date.now())
      await mkdir(output, { recursive: false })
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
                .map(
                  (s) =>
                    s.start.toFixed(3) +
                    '\t' +
                    s.end.toFixed(3) +
                    '\t' +
                    s.label +
                    '\t' +
                    s.confidence
                )
                .join('\n')
      await writeFile(join(output, 'chords.' + request.chordFormat), text, 'utf8')
      await run(
        'export',
        {
          directory: directory(request.id),
          destination: output,
          format: request.audioFormat,
          stems: request.stems
        },
        directory(request.id),
        signal,
        () => {}
      )
      return output
    }
  }
  return {
    operations,
    idle: () =>
      (draining ??= (async () => {
        lifetime.abort(new Error('分析平台正在关闭'))
        for (const job of jobs.values()) if (job.running) job.controller.abort()
        await Promise.all([...jobs.values()].map((job) => job.done))
        await Promise.allSettled([environmentPending, ...activeRuns])
        // Main survives a Core restart. A drained platform must accept the next
        // Core generation after every child of the previous one has been joined.
        lifetime = new AbortController()
      })().finally(() => {
        draining = null
      }))
  }
}
