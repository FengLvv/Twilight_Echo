import { mkdir, realpath, lstat, symlink, unlink } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { createHash } from 'node:crypto'

/** Native ML/Guile libraries do not all understand extended-length Windows paths. */
export async function resolveStudyRuntimeView(
  entries: Record<string, { directory: string; version: string }>,
  temporary: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const root = join(temporary, 'te-analysis')
  if (process.platform === 'win32') await mkdir(root, { recursive: true })
  const key = (path: string) => process.platform === 'win32' ? normalize(path).toLowerCase() : path
  for (const [id, entry] of Object.entries(entries)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !/^[a-f0-9]{64}$/.test(entry.version)) throw new Error('无效组件运行路径')
    const target = await realpath(entry.directory)
    if (process.platform !== 'win32') { result[id] = target; continue }
    const digest = createHash('sha256').update(key(target)).digest('hex').slice(0, 12)
    const alias = join(root, `${id}-${entry.version.slice(0, 12)}-${digest}`)
    const existing = await lstat(alias).catch(() => null)
    if (existing) {
      const current = await realpath(alias).catch(() => null)
      if (current && key(current) !== key(target)) throw new Error('组件运行目录联接目标不匹配')
      if (!current) {
        if (!existing.isSymbolicLink()) throw new Error('组件运行目录被占用')
        await unlink(alias)
      }
    }
    if (!(await lstat(alias).catch(() => null))) {
      try { await symlink(target, alias, 'junction') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    if (key(await realpath(alias)) !== key(target)) throw new Error('组件运行路径校验失败')
    result[id] = alias
  }
  return result
}
