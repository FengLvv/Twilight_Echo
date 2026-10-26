import { createHash } from '../../shared/portableCrypto.ts'
import { coreFs } from '../ports/index.ts'

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = coreFs.createReadStream(filePath)
    stream.on('error', rejectHash)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}
