export interface FtpTools {
  Client: new (timeout?: number) => any
  FileType: {
    Unknown: number
    File: number
    Directory: number
    SymbolicLink: number
    [key: string]: any
  }
}
import { lazySdk, requireSdk } from './load.ts'
const ftp = lazySdk(() => requireSdk('basic-ftp'))
export const coreFtp: FtpTools = {
  get Client() {
    return ftp().Client
  },
  get FileType() {
    return ftp().FileType
  }
}
