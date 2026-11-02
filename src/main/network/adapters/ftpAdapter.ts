import { createFtpAdapter as createAdapter } from '../../adapters/network/adapters/ftpAdapter.ts'
export function createFtpAdapter(): ReturnType<typeof createAdapter> {
  return createAdapter({ verbose: process.env.NETWORK_FTP_DEBUG === '1' })
}
