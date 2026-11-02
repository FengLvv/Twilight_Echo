import type { NetworkSourceAdapter } from './types.ts'
export interface SftpLsItem {
  name: string
  directory: boolean
  size: number
}
export interface SftpBatchResult {
  stdout: string
  stderr: string
  code: number
}
export type SftpBatchRunner = (
  batch: string,
  deps: {
    host: string
    port: number
    username: string
    keyPath: string
  },
  signal?: AbortSignal
) => Promise<SftpBatchResult>
/** 解析 OpenSSH `sftp ls -l` 输出（与 Unix `ls -l` 同格式）。 */
export declare function parseLsOutput(output: string): SftpLsItem[]
export type SftpOperation =
  | {
      kind: 'list'
      path: string
    }
  | {
      kind: 'download'
      path: string
      local: string
    }
export type SftpOperationRunner = (
  operation: SftpOperation,
  connection: {
    host: string
    port: number
    username: string
    keyPath: string
  },
  signal?: AbortSignal
) => Promise<SftpBatchResult>
export declare function sftpBatch(operation: SftpOperation): string
/**
 * 系统 OpenSSH `sftp` 命令适配器：零新依赖，仅支持密钥认证。
 * 口令认证无法非交互完成，带口令私钥请改用 ssh-agent 或无口令密钥。
 */
export declare function createSftpSystemAdapter(deps: {
  runOperation: SftpOperationRunner
  tempDir: string
  newId(): string
}): NetworkSourceAdapter
