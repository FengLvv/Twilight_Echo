import type { LibraryWatcherFolderStatus } from '../../../shared/localLibraryScan.ts'

/**
 * Watcher diagnostics carry kernel/platform error codes. They must stay in the
 * main-process log; the settings page only shows actionable copy.
 */
const WATCHER_ERROR_TEXT: Record<string, string> = {
  ENOSPC: '系统 inotify 监听数量已达上限，已改为定时检查',
  EMFILE: '系统文件句柄不足，已改为定时检查',
  ENFILE: '系统文件句柄不足，已改为定时检查',
  EACCES: '没有权限监听该文件夹，已改为定时检查',
  EPERM: '没有权限监听该文件夹，已改为定时检查',
  ENOENT: '文件夹当前不可访问，将在恢复后重试',
  ERR_FEATURE_UNAVAILABLE_ON_PLATFORM: '当前系统不支持实时监听，已改为定时检查',
  'empty-watch-event': '文件系统报告了不含路径的变动，已触发一次核对',
  'not-started': '尚未开始监听'
}
export function libraryWatcherErrorText(code: string | null | undefined): string {
  if (!code) return ''
  return WATCHER_ERROR_TEXT[code] ?? '实时监听不可用，已改为定时检查'
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
