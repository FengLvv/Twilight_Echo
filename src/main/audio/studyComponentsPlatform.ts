import { app, dialog } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, stat, statfs, realpath, open } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, dirname, toNamespacedPath } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { coreArchive } from '../adapters/sdk/archive.ts'
import { resolveStudyRuntimeView } from './studyRuntimeView.ts'
import { componentBusy, componentPriority, type StudyComponent, type StudyComponentCatalog, type StudyComponentIO, type StudyComponentState, type StudyComponentStatus, type StudyRuntimePaths } from '../../shared/studyComponents.ts'

interface ExternalSource { directory: string; layout?: 'site-packages' }
interface Installed extends StudyComponentStatus { version?: string; directory?: string; layout?: 'site-packages' }
interface ComponentFile { path: string; bytes: number; sha256: string; originalSha256?: string }
interface ComponentManifest { id: string; version: string; files: ComponentFile[] }
const MODEL_PREFIX: Record<string, string> = {
  demucs: 'torch', mdx: 'UVR_MDXNET_KARA_2.onnx', duet: 'duet.safetensors', ecapa: 'speaker',
  sheetsage: 'sheetsage2', mert: 'mert2', btc: 'btc.safetensors', beat: 'vocal2midi/beat_this-final0.ckpt',
  tifa: 'vocal2midi/tifa', game: 'vocal2midi/game', lyric: 'lyric-line-v4-real1092-precision'
}
export async function hashComponentFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const block of createReadStream(path, { signal })) hash.update(block)
  return hash.digest('hex')
}
export function safeComponentPath(root: string, name: string): string {
  if (!name || name.includes('\\') || name.includes(':') || name.includes('\0') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('组件包含无效文件路径')
  const path = resolve(root, name), child = relative(resolve(root), path)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('组件路径越界')
  return path
}
const size = async (path: string): Promise<number> => (await stat(path).catch(() => null))?.size ?? 0
async function removeComponentTree(root: string, target: string) {
  const path = await realpath(target).catch(() => null)
  if (!path) return
  const boundary = await realpath(root), child = relative(boundary, path)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('组件清理路径越界')
  await rm(path, { recursive: true, force: true })
}

/** Fixed catalog IO only. Installation is requested and cancelled by the Core component service. */
export class StudyComponentsPlatform {
  private root = join(process.env.LOCALAPPDATA || app.getPath('userData'), 'TwilightEcho', 'analysis-components')
  private catalog!: StudyComponentCatalog
  private entries = new Map<string, Installed>()
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private initialized?: Promise<void>
  private saveWork = Promise.resolve()
  private stopped = false
  private imports = new Map<string, ExternalSource>()
  private lock?: { path: string; handle: Awaited<ReturnType<typeof open>> }
  private cudaProbe?: Promise<void>
  private cudaController?: AbortController
  private readonly resources = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'music-study')
  constructor(private readonly profile: string, private readonly inUse: () => boolean, private readonly fetcher: typeof fetch = fetch, private readonly externalHome?: () => string) {}
  private async init() {
    return this.initialized ??= (async () => {
      this.catalog = JSON.parse(await readFile(join(this.resources, 'components.json'), 'utf8'))
      if (this.catalog.schema !== 1 || this.catalog.repository !== 'FengLvv/Twilight_Echo') throw new Error('无效分析组件目录')
      const adjacent = join(dirname(app.getPath('exe')), 'analysis-components')
      if (app.isPackaged && (await stat(join(adjacent, 'installed.json')).catch(() => null))?.isFile()) this.root = adjacent
      try { this.root = JSON.parse(await readFile(join(this.profile, 'music-study-component-location.json'), 'utf8')).directory } catch { /* Default managed location. */ }
      if (process.env.TWILIGHT_STUDY_COMPONENTS_HOME) this.root = resolve(process.env.TWILIGHT_STUDY_COMPONENTS_HOME)
      await mkdir(this.root, { recursive: true })
      let indexed = false
      try {
        const rows: Installed[] = JSON.parse(await readFile(join(this.root, 'installed.json'), 'utf8'))
        indexed = true
        for (const row of rows) {
          const component = this.catalog.components.find(c => c.id === row.id)
          if (!component || row.version !== component.version) continue
          if (row.directory && !row.external) row.directory = resolve(this.root, row.directory)
          if (componentBusy(row.phase)) row.phase = 'interrupted'
          if (row.phase === 'ready' && (!row.directory || !(await stat(row.directory).catch(() => null))?.isDirectory())) row.phase = 'missing'
          if (row.layout && (row.layout !== 'site-packages' || row.id !== 'engine-torch' || !row.external)) continue
          this.entries.set(row.id, row)
          if (row.external && row.directory && row.phase !== 'ready' && row.phase !== 'missing') this.imports.set(row.id, { directory: row.directory, layout: row.layout })
        }
      } catch { /* An absent index contains no accepted installations. */ }
      for (const component of this.catalog.components) if (!this.entries.has(component.id)) this.entries.set(component.id, {
        id: component.id, version: component.version, phase: 'missing', receivedBytes: 0,
        totalBytes: component.parts.reduce((n, part) => n + part.bytes, 0)
      })
      if (!indexed && this.externalHome) await this.scheduleImport(this.externalHome())
    })()
  }
  private persist(): Promise<void> {
    const root = this.root
    const data = JSON.stringify([...this.entries.values()].map(row => ({ ...row, directory: row.directory && !row.external ? relative(root, row.directory).replace(/\\/g, '/') : row.directory })))
    return this.saveWork = this.saveWork.catch(() => {}).then(async () => {
      const temp = join(root, 'installed.' + randomUUID() + '.tmp')
      await writeFile(temp, data, 'utf8'); await rename(temp, join(root, 'installed.json'))
    })
  }
  private async acquireLock() {
    if (this.lock) return
    const path = join(this.root, 'installation.lock')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, 'wx')
        await handle.writeFile(JSON.stringify({ pid: process.pid }))
        this.lock = { path, handle }; return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        let pid = 0
        try { pid = JSON.parse(await readFile(path, 'utf8')).pid } catch { /* A newly created lock is treated as busy. */ }
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('另一个实例正在准备分析组件')
        let alive = true
        try { process.kill(pid, 0) } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH' }
        if (alive) throw new Error('另一个实例正在安装分析组件')
        await rm(path, { force: true })
      }
    }
    throw new Error('无法锁定分析组件目录')
  }
  private async releaseLock() {
    if (this.jobs.size || [...this.entries.values()].some(row => row.phase === 'queued')) return
    const lock = this.lock; this.lock = undefined
    if (lock) { await lock.handle.close(); await rm(lock.path, { force: true }) }
  }
  async state(): Promise<StudyComponentState> {
    await this.init()
    for (const item of this.catalog.components) {
      const row = this.entries.get(item.id)!
      if (row.phase !== 'ready') row.cachedBytes = (await Promise.all(item.parts.map(async part => Math.min(part.bytes, await size(join(this.root, 'downloads', part.sha256 + '.part')))))).reduce((a, b) => a + b, 0)
    }
    return { directory: this.root, supported: process.platform === 'win32' && process.arch === 'x64', catalog: this.catalog,
      components: [...this.entries.values()].map(({ directory: _directory, version: _version, layout: _layout, ...row }) => ({ ...row })), requests: [] }
  }
  async paths(): Promise<StudyRuntimePaths> {
    await this.init()
    const result: StudyRuntimePaths = { models: {} }
    const view = await resolveStudyRuntimeView(Object.fromEntries([...this.entries].filter(([, item]) => item.phase === 'ready' && item.directory && item.version).map(([id, item]) => [id, { directory: item.directory!, version: item.version! }])), app.getPath('temp'))
    for (const [id, item] of this.entries) {
      if (item.phase !== 'ready' || !item.directory) continue
      const directory = view[id]
      if (id === 'engine-main') result.python = join(directory, 'runtime/Scripts/python.exe')
      else if (id === 'engine-vocal') result.vocalPython = join(directory, 'runtime-vocal2midi/Scripts/python.exe')
      else if (id === 'engine-torch') result.sharedPython = item.layout === 'site-packages' ? directory : join(directory, 'shared-python/site-packages')
      else if (id === 'lilypond') result.notationHome = directory
      else if (MODEL_PREFIX[id]) result.models[MODEL_PREFIX[id]] = join(directory, 'models', MODEL_PREFIX[id])
    }
    return result
  }
  async invalidate(name: string, error: unknown) {
    const id = Object.keys(MODEL_PREFIX).find(id => name === MODEL_PREFIX[id] || name.startsWith(MODEL_PREFIX[id] + '/'))
    if (!id) return
    const row = this.entries.get(id)
    if (row) { row.phase = 'failed'; row.error = String(error); await this.persist() }
  }
  private component(id: string): StudyComponent {
    const value = this.catalog.components.find(item => item.id === id)
    if (!value) throw new Error('未知分析组件')
    return value
  }
  private async manifest(component: StudyComponent): Promise<ComponentManifest> {
    const value: ComponentManifest = JSON.parse(await readFile(join(this.resources, 'component-manifests', component.version + '.json'), 'utf8'))
    if (value.id !== component.id || value.version !== component.version) throw new Error('组件文件目录不匹配')
    return value
  }
  private importPath(source: ExternalSource, name: string): string {
    if (source.layout === 'site-packages') {
      const prefix = 'shared-python/site-packages/'
      if (!name.startsWith(prefix)) throw new Error('共享依赖文件目录不匹配')
      name = name.slice(prefix.length)
    }
    return safeComponentPath(source.directory, name)
  }
  private async verify(directory: string, manifest: ComponentManifest, signal?: AbortSignal, external = false, layout?: ExternalSource['layout']) {
    for (const file of manifest.files) {
      signal?.throwIfAborted()
      if (external && file.path === 'THIRD_PARTY.md') continue
      const path = this.importPath({ directory, layout }, file.path), info = await stat(path)
      const hash = await hashComponentFile(path, signal)
      if (hash !== file.sha256 && !(external && file.originalSha256 === hash)) throw new Error('组件文件校验失败：' + file.path)
      if (hash === file.sha256 && info.size !== file.bytes) throw new Error('组件文件大小错误：' + file.path)
    }
  }
  private async download(component: StudyComponent, signal: AbortSignal) {
    const row = this.entries.get(component.id)!, cache = join(this.root, 'downloads')
    await mkdir(cache, { recursive: true })
    let completed = 0
    const paths: string[] = []
    for (const part of component.parts) {
      const path = join(cache, part.sha256 + '.part')
      let valid = false
      if (await size(path) === part.bytes) valid = await hashComponentFile(path, signal) === part.sha256
      if (!valid) {
        if (await size(path) >= part.bytes) await rm(path, { force: true })
        for (let attempt = 0; attempt < 3; attempt++) {
          signal.throwIfAborted()
          const offset = await size(path)
          if (!part.url.startsWith(`https://github.com/${this.catalog.repository}/releases/download/`)) throw new Error('组件下载地址不受信任')
          const timeout = new AbortController(), combined = AbortSignal.any([signal, timeout.signal])
          let timer: ReturnType<typeof setTimeout> | undefined
          const touch = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(new Error('下载无进度，请重试')), 30_000) }
          touch()
          try {
            const response = await this.fetcher(part.url, { headers: { 'User-Agent': 'TwilightEcho-Components', 'Accept-Encoding': 'identity', ...(offset ? { Range: `bytes=${offset}-` } : {}) }, signal: combined })
            if (response.status === 416) { await rm(path, { force: true }); throw new Error('续传缓存失效') }
            if (!response.ok || !response.body) throw new Error(`组件下载失败：HTTP ${response.status}`)
            let received = response.status === 206 ? offset : 0
            if (response.status === 206) {
              const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
              if (!range || Number(range[1]) !== offset || Number(range[3]) !== part.bytes || Number(range[2]) >= part.bytes) throw new Error('续传范围不匹配')
            } else if (response.status !== 200) throw new Error('无效下载响应')
            row.phase = 'downloading'
            await pipeline(Readable.fromWeb(response.body as never), new Transform({ transform(block: Buffer, _encoding, callback) {
              touch(); received += block.length
              if (received > part.bytes) callback(new Error('下载大小超过组件清单'))
              else { row.receivedBytes = completed + received; callback(null, block) }
            } }), createWriteStream(path, { flags: received ? 'a' : 'w' }), { signal: combined })
            row.phase = 'verifying'
            if (received !== part.bytes || await hashComponentFile(path, signal) !== part.sha256) {
              await rm(path, { force: true }); throw new Error('下载校验失败')
            }
            valid = true; break
          } catch (error) {
            signal.throwIfAborted()
            if (attempt === 2) throw error
            await new Promise<void>((resolveWait, reject) => {
              const done = () => { clearTimeout(wait); signal.removeEventListener('abort', aborted); resolveWait() }
              const aborted = () => { clearTimeout(wait); signal.removeEventListener('abort', aborted); reject(signal.reason) }
              const wait = setTimeout(done, 1000 * (attempt + 1)); signal.addEventListener('abort', aborted, { once: true })
            })
          } finally { clearTimeout(timer) }
        }
      }
      if (!valid) throw new Error('组件下载未完成')
      completed += part.bytes; row.receivedBytes = completed; paths.push(path)
    }
    const archive = join(cache, component.archiveSha256 + '.zip')
    async function* chunks() { for (const path of paths) for await (const block of createReadStream(path, { signal })) yield block }
    await pipeline(Readable.from(chunks()), createWriteStream(archive), { signal })
    if (await hashComponentFile(archive, signal) !== component.archiveSha256) throw new Error('组件分卷合并校验失败')
    return { archive, parts: paths }
  }
  private async unpack(archive: string, target: string, component: StudyComponent, signal: AbortSignal) {
    const manifest = await this.manifest(component), expected = new Map(manifest.files.map(file => [file.path, file])), seen = new Set<string>()
    await mkdir(target, { recursive: true })
    await new Promise<void>((resolveZip, reject) => coreArchive.yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true }, (error: Error | null, zip: any) => {
      if (error || !zip) { reject(error || new Error('无法读取组件压缩包')); return }
      const abort = () => { zip.close(); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      const fail = (e: unknown) => { signal.removeEventListener('abort', abort); zip.close(); reject(e) }
      zip.on('error', fail)
      zip.on('end', () => { signal.removeEventListener('abort', abort); seen.size === manifest.files.length + 1 ? resolveZip() : reject(new Error('组件文件清单不完整')) })
      zip.on('entry', (entry: any) => {
        void (async () => {
          signal.throwIfAborted()
          const name = String(entry.fileName), path = safeComponentPath(target, name)
          if (seen.has(name.toLowerCase()) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('组件包含重复文件或符号链接')
          const file = expected.get(name)
          if (!file && name !== 'component-manifest.json') throw new Error('组件包含未注册文件')
          if (entry.uncompressedSize !== (file?.bytes ?? entry.uncompressedSize) || (!file && entry.uncompressedSize > 32 * 1024 ** 2)) throw new Error('组件文件大小错误')
          if (![0, 8].includes(entry.compressionMethod)) throw new Error('不支持的组件压缩格式')
          seen.add(name.toLowerCase()); await mkdir(dirname(path), { recursive: true })
          const stream: NodeJS.ReadableStream = await new Promise((ok, no) => zip.openReadStream(entry, (e: Error | null, value: NodeJS.ReadableStream) => e ? no(e) : ok(value)))
          await pipeline(stream, createWriteStream(path, { flags: 'wx' }), { signal })
          zip.readEntry()
        })().catch(fail)
      })
      zip.readEntry()
    }))
    await this.verify(target, manifest, signal)
  }
  private async install(component: StudyComponent, signal: AbortSignal) {
    const row = this.entries.get(component.id)!, destination = join(this.root, 'components', component.id, component.version.slice(0, 16))
    const temporary = join(this.root, 'staging', component.id + '-' + randomUUID())
    let download: Awaited<ReturnType<StudyComponentsPlatform['download']>> | undefined
    try {
      if (component.id === 'duet' || component.id === 'ecapa') await this.verifyCuda()
      signal.throwIfAborted()
      const cached = (await Promise.all(component.parts.map(async part => Math.min(part.bytes, await size(join(this.root, 'downloads', part.sha256 + '.part')))))).reduce((a, b) => a + b, 0)
      const disk = await statfs(this.root), needed = component.archiveBytes * 2 - cached + component.installedBytes + 256 * 1024 ** 2
      if (Number(disk.bavail) * Number(disk.bsize) < needed) throw new Error(`磁盘空间不足，需要约 ${(needed / 1e9).toFixed(2)} GB 可用空间，请更改保存位置`)
      download = await this.download(component, signal)
      row.phase = 'installing'; await this.persist()
      await this.unpack(download.archive, temporary, component, signal)
      if (component.id === 'engine-main' || component.id === 'engine-vocal') {
        const folder = component.id === 'engine-main' ? 'runtime' : 'runtime-vocal2midi'
        await new Promise<void>((ok, no) => execFile(toNamespacedPath(join(temporary, folder, 'Scripts/python.exe')), ['-I', '-c', 'import sys,json;assert sys.version_info[:2]==(3,11);print(json.dumps(sys.version_info[:2]))'], { windowsHide: true, timeout: 30_000, signal }, e => e ? no(e) : ok()))
      }
      signal.throwIfAborted(); await mkdir(dirname(destination), { recursive: true })
      if ((await stat(destination).catch(() => null))?.isDirectory()) {
        const existing = JSON.parse(await readFile(join(destination, 'component-manifest.json'), 'utf8'))
        if (existing.version !== component.version) throw new Error('组件目录版本冲突，请更改保存位置')
        try { await this.verify(destination, await this.manifest(component), signal) }
        catch {
          if (this.inUse()) throw new Error('请先结束分析，再修复正在使用的组件')
          const previous = join(this.root, 'staging', component.id + '-previous-' + randomUUID())
          const checked = await realpath(destination), boundary = await realpath(this.root)
          if (relative(boundary, checked).startsWith('..')) throw new Error('组件修复路径越界')
          await rename(checked, previous)
          try { await rename(temporary, destination) }
          catch (error) { await rename(previous, destination); throw error }
          await removeComponentTree(this.root, previous)
        }
      } else await rename(temporary, destination)
      Object.assign(row, { phase: 'ready', directory: destination, layout: undefined, external: false, error: undefined, version: component.version, receivedBytes: row.totalBytes })
      await this.persist()
      await Promise.all([download.archive, ...download.parts].map(path => rm(path, { force: true })))
    } finally { await removeComponentTree(this.root, temporary) }
  }
  private pump() {
    if (this.stopped) return
    const pending = [...this.entries.values()].filter(row => row.phase === 'queued' || this.jobs.has(row.id))
    const priority = Math.min(...pending.map(row => componentPriority(row.id)))
    for (const row of this.entries.values()) {
      if (this.jobs.size >= 2) break
      if (row.phase !== 'queued' || this.jobs.has(row.id) || componentPriority(row.id) !== priority) continue
      const controller = new AbortController()
      const external = this.imports.get(row.id)
      const work = external ? (async () => {
        row.phase = 'verifying'
        await this.verify(external.directory, await this.manifest(this.component(row.id)), controller.signal, true, external.layout)
        Object.assign(row, external, { phase: 'ready', external: true, error: undefined })
      })() : this.install(this.component(row.id), controller.signal)
      const done = work.catch(error => {
        if (!controller.signal.aborted) { row.phase = external ? 'missing' : 'failed'; row.error = external ? undefined : String(error) }
      }).finally(async () => { this.jobs.delete(row.id); await this.persist(); this.pump(); await this.releaseLock() })
      this.imports.delete(row.id)
      this.jobs.set(row.id, { controller, done })
    }
  }
  private verifyCuda(): Promise<void> {
    return this.cudaProbe ??= (async () => {
      const paths = await this.paths()
      if (!paths.python || !paths.sharedPython) throw new Error('请先安装公共分析运行环境')
      const controller = new AbortController(); this.cudaController = controller
      const bootstrap = 'import sys;sys.path.insert(0,sys.argv.pop(1));from study_bootstrap import run;run()'
      try {
        await new Promise<void>((ok, no) => execFile(toNamespacedPath(paths.python!), ['-X', 'utf8', '-c', bootstrap, this.resources, join(this.resources, 'probe_cuda.py')], {
          windowsHide: true, timeout: 60_000, signal: controller.signal,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', TWILIGHT_STUDY_COMPONENT_PATHS: JSON.stringify(paths) }
        }, error => error ? no(new Error('当前分析环境无法使用 CUDA，请更新 NVIDIA 驱动后重试双歌手分离')) : ok()))
      } finally { if (this.cudaController === controller) this.cudaController = undefined }
    })().catch(error => { this.cudaProbe = undefined; throw error })
  }
  private async scheduleImport(directory: string) {
    if (!(await stat(directory).catch(() => null))?.isDirectory()) return
    let scheduled = 0
    for (const component of this.catalog.components) {
      const manifest = await this.manifest(component), first = manifest.files.find(file => file.path !== 'THIRD_PARTY.md')
      if (this.entries.get(component.id)?.phase === 'ready') continue
      if (!first) continue
      const roots = [directory, join(directory, 'analysis-components'), join(directory, 'music-study-runtime')]
      const candidates: ExternalSource[] = []
      for (const root of roots) {
        for (const version of [component.version.slice(0, 16), component.version]) {
          for (const path of [join(root, 'components', component.id, version), join(root, component.id, version), join(root, version)]) candidates.push({ directory: path })
        }
        candidates.push({ directory: root })
        if (component.id === 'engine-torch') {
          for (const path of ['runtime/Scripts/Lib/site-packages', 'runtime/Lib/site-packages']) candidates.push({ directory: join(root, path), layout: 'site-packages' })
        }
      }
      let source: ExternalSource | undefined
      for (const candidate of candidates) {
        let path: string
        try { path = this.importPath(candidate, first.path) } catch { continue }
        if ((await stat(path).catch(() => null))?.isFile()) { source = candidate; break }
      }
      if (source) {
        await this.acquireLock()
        Object.assign(this.entries.get(component.id)!, source, { phase: 'queued', error: undefined, external: true })
        this.imports.set(component.id, source); scheduled++
      }
    }
    if (scheduled) { await this.persist(); this.pump() }
    return scheduled
  }
  async io(request: StudyComponentIO): Promise<StudyComponentState> {
    await this.init()
    try {
    if (request.action === 'start') {
      if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('分析组件目前支持 Windows x64')
      if (request.ids?.includes('duet')) await new Promise<void>((ok, no) => execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true, timeout: 10_000 }, (e, output) => e || !output.trim() ? no(new Error('双歌手分离需要可用的 NVIDIA CUDA GPU')) : ok()))
      await this.acquireLock()
      for (const id of request.ids || []) {
        this.component(id); const row = this.entries.get(id)!
        if (row.phase !== 'ready' && !componentBusy(row.phase)) Object.assign(row, { phase: 'queued', error: undefined })
      }
      await this.persist(); this.pump(); await this.releaseLock()
    } else if (request.action === 'task') {
      const component = this.component(request.id!), row = this.entries.get(component.id)!
      if (row.phase !== 'ready') {
        if (request.task === 'pause' || request.task === 'cancel') {
          this.imports.delete(row.id)
          row.phase = request.task === 'pause' ? 'paused' : 'cancelled'
          const job = this.jobs.get(row.id); job?.controller.abort(); await job?.done
        } else {
          await this.acquireLock(); row.phase = 'queued'; row.error = undefined
          if (row.external && row.directory) this.imports.set(row.id, { directory: row.directory, layout: row.layout })
        }
        await this.persist(); this.pump(); await this.releaseLock()
      }
    } else if (request.action === 'remove') {
      if (this.inUse()) throw new Error('请先结束正在运行的分析或分轨试听')
      await this.acquireLock()
      this.component(request.id!); const row = this.entries.get(request.id!)!
      if (this.jobs.has(row.id)) throw new Error('请先取消组件安装')
      const users = row.id === 'engine-vocal' ? ['tifa', 'game', 'beat', 'lyric', 'lilypond']
        : row.id === 'engine-main' || row.id === 'engine-torch' ? Object.keys(MODEL_PREFIX).filter(id => id !== 'lyric') : []
      if ([...this.entries.values()].some(other => other.phase === 'ready' && users.includes(other.id))) throw new Error('其他已安装功能仍在使用此公共运行环境')
      if (row.directory && !row.external) {
        const target = await realpath(row.directory), boundary = await realpath(join(this.root, 'components', row.id))
        if (dirname(target) !== boundary) throw new Error('组件删除路径越界')
        await removeComponentTree(this.root, target)
      }
      Object.assign(row, { phase: 'missing', directory: undefined, layout: undefined, external: false, receivedBytes: 0 }); await this.persist()
    } else if (request.action === 'directory') {
      if (this.inUse() || this.jobs.size) throw new Error('请先结束分析和组件下载')
      const chosen = await dialog.showOpenDialog({ title: '选择分析组件下载位置', properties: ['openDirectory', 'createDirectory'] })
      if (!chosen.canceled && chosen.filePaths[0]) {
        const next = resolve(chosen.filePaths[0])
        const installed = [...this.entries.values()].filter(row => row.phase === 'ready').map(row => ({ ...row, external: true }))
        this.root = next; this.entries.clear(); this.initialized = undefined
        await mkdir(this.profile, { recursive: true }); await writeFile(join(this.profile, 'music-study-component-location.json'), JSON.stringify({ directory: next }))
        await this.init(); for (const row of installed) this.entries.set(row.id, row); await this.persist()
      }
    } else if (request.action === 'import') {
      if (this.inUse() || this.jobs.size) throw new Error('请先结束分析和组件下载')
      const chosen = await dialog.showOpenDialog({ title: '选择已有分析环境', properties: ['openDirectory'] })
      if (!chosen.canceled && chosen.filePaths[0]) {
        if (!await this.scheduleImport(await realpath(chosen.filePaths[0]))) throw new Error('目录中没有可验证的分析组件')
      }
    }
    return this.state()
    } finally { await this.releaseLock() }
  }
  async close() {
    this.stopped = true
    this.cudaController?.abort()
    for (const [id, job] of this.jobs) {
      const row = this.entries.get(id)!
      if (componentBusy(row.phase)) row.phase = 'interrupted'
      if (row.phase !== 'ready') job.controller.abort()
    }
    await Promise.allSettled([...this.jobs.values()].map(job => job.done)); await this.saveWork
    for (const row of this.entries.values()) if (row.phase === 'queued') row.phase = 'interrupted'
    await this.persist(); await this.releaseLock()
    this.stopped = false
  }
}
