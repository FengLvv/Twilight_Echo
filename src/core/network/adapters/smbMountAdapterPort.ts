import type { CorePlatformId } from '../../../shared/audioEngineTypes.ts'
import type { NetworkSourceProfile } from '../../../shared/networkSources.ts'
import type { NetworkSourceAdapter } from './types.ts'
export interface MountCommandResult {
  code: number
  stdout: string
  stderr: string
}
export type MountCommandRunner = (
  command: 'net' | 'gio' | 'mount' | 'umount',
  args: string[],
  signal?: AbortSignal
) => Promise<MountCommandResult>
export interface MountAdapterDeps {
  platform: CorePlatformId
  runCommand: MountCommandRunner
  /** 挂载键（UNC / gvfs URI / NFS 挂载点）→ 本地路径映射，测试可注入。 */
  localMap?: (mountKey: string, remotePath: string) => string
  mountBaseDir: string
  gvfsRoot: string | null
  findGvfsMount?: (profile: NetworkSourceProfile) => Promise<string | null>
}
/**
 * SMB 系统挂载 adapter（B 方案）：
 * - Windows：`net use \\host\share [password] /user:user`，本地路径为 UNC；
 * - Linux：`gio mount smb://host/share`（仅匿名/已缓存凭据，非交互式不支持口令）；
 * - 挂载后按本地文件读取；close 时卸载。
 * NFS 需要 root 权限的 mount，另行评估（见施工文档 §10）。
 */
export declare function createSmbMountAdapter(deps: MountAdapterDeps): NetworkSourceAdapter
/**
 * NFS 系统挂载 adapter（仅 Linux，需要 root 权限执行 mount -t nfs）。
 * 挂载点临时目录在会话内创建，close 时 umount 并清理。
 */
export declare function createNfsMountAdapter(deps: MountAdapterDeps): NetworkSourceAdapter
