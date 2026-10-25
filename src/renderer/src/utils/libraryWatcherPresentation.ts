import type { LibraryWatcherFolderStatus } from '../../../shared/localLibraryScan.ts'

/**
 * Watcher diagnostics carry kernel/platform error codes. They must stay in the
 * main-process log; the settings page only shows actionable copy.
 *
 * Keep this in step with `UNRECOVERABLE_WATCH_ERRORS` in the main-process
 * watcher: codes listed there leave the folder on timed reconciliation, while
 * every other code is re-armed with backoff, so the copy must not claim both.
 */
const WATCHER_ERROR_TEXT: Record<string, string> = {
  ENOSPC: '系统 inotify 监听数量已达上限，已改为定时检查',
  EMFILE: '系统文件句柄不足，已改为定时检查',
  ENFILE: '系统文件句柄不足，已改为定时检查',
  ERR_FEATURE_UNAVAILABLE_ON_PLATFORM: '当前系统不支持实时监听，已改为定时检查',
  EACCES: '暂时没有权限监听该文件夹，正在重试',
  EPERM: '暂时没有权限监听该文件夹，正在重试',
  ENOENT: '文件夹当前无法访问，恢复后将自动重试',
  EIO: '磁盘暂时无法访问，恢复后将自动重试',
  'empty-watch-event': '文件系统报告了不含路径的变动，已触发一次核对',
  'not-started': '尚未开始监听'
}
export function libraryWatcherErrorText(code: string | null | undefined): string {
  if (!code) return ''
  return WATCHER_ERROR_TEXT[code] ?? '实时监听暂时不可用，正在重试'
}

/**
 * A folder in `degraded`/`polling` mode is a supported fallback, not a fault the
 * user has to act on, so only `failed` folders raise the group's attention banner.
 */
export function libraryWatcherAttention(
  folders: LibraryWatcherFolderStatus[] | null | undefined
): string {
  const failed = folders?.find((folder) => folder.state === 'failed')
  if (!failed) return ''
  return `${failed.folder} 的实时监听失败：${libraryWatcherErrorText(failed.lastError)}`
}
