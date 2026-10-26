import { basename, extname, join, parse } from '../../shared/portablePath.ts'
import { coreFs, coreFsPromises } from '../ports/index.ts'
import { isCanonicalPathInside, resolveCanonicalExistingPath } from '../persistence/pathGrants.ts'
import { flushFileToDisk } from './downloadTargets.ts'
import type { ProviderDownloadTaskSnapshot } from '../../shared/providerDownloads.ts'

interface ResultOptions {
  libraryRoots: string[]
  downloadRoots: string[]
  addToLibrary: boolean
  enqueue?: (path: string) => void | Promise<void>
  updatePath: (path: string) => void
  grant: (path: string) => Promise<string>
}
export async function resolveCompletedDownloadResult(
  task: ProviderDownloadTaskSnapshot,
  options: ResultOptions
): Promise<string> {
  if (task.status !== 'completed' || !task.targetPath) throw new Error('下载尚未完成')
  if (!/^[a-zA-Z0-9-]+$/.test(task.id)) throw new Error('下载任务标识无效')
  const source = await resolveCanonicalExistingPath(task.targetPath, 'file')
  if (
    ![...options.libraryRoots, ...options.downloadRoots].some((root) =>
      isCanonicalPathInside(root, source)
    )
  )
    throw new Error('下载目录已失效，请重新选择目录')
  let target = source
  if (options.addToLibrary) {
    if (!options.enqueue) throw new Error('曲库索引服务尚未就绪，请稍后重试')
    if (!options.libraryRoots.length) throw new Error('请先在设置中添加音乐库目录')
    if (!options.libraryRoots.some((root) => isCanonicalPathInside(root, source))) {
      target = join(
        options.libraryRoots[0],
        `${parse(basename(source)).name}-${task.id}${extname(source)}`
      )
      await coreFsPromises.copyFile(source, target, coreFs.constants.COPYFILE_EXCL)
      try {
        await flushFileToDisk(target)
      } catch (error) {
        await coreFsPromises.rm(target, { force: true })
        throw error
      }
      options.updatePath(target)
    }
    await options.enqueue(target)
  }
  return options.grant(target)
}
