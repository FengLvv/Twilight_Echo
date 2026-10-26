import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import * as nodeStream from 'node:stream'
import { finished as nodeFinished, pipeline as nodePipeline } from 'node:stream/promises'
import * as nodeOs from 'node:os'
import * as nodeHttp from 'node:http'
import * as nodeHttps from 'node:https'
import * as nodeNet from 'node:net'
import * as nodeDgram from 'node:dgram'
import * as nodeTls from 'node:tls'
import * as nodeZlib from 'node:zlib'
import * as nodeCrypto from 'node:crypto'
import { createRequire as nodeCreateRequire } from 'node:module'
import {
  registerCorePorts,
  type CorePorts,
  type CoreFsPort,
  type CoreFsPromisesPort,
  type CoreStreamPort,
  type CoreOsPort,
  type CoreProcessPort,
  type CoreHttpPort,
  type CoreHttpsPort,
  type CoreNetPort,
  type CoreDgramPort,
  type CoreTlsPort,
  type CoreZlibPort,
  type CoreCryptoPort,
  type CoreModulePort,
  type CoreArchivePort,
  type CoreAudioMetadataPort,
  type CoreFtpPort,
  type CoreTextPort
} from '../core/ports/index.ts'

const nodeRequire = nodeCreateRequire(import.meta.url)

function lazyLoad<T>(loader: () => T): () => T {
  let cached: T | undefined
  let loaded = false
  return () => {
    if (!loaded) {
      cached = loader()
      loaded = true
    }
    return cached as T
  }
}

export function createNodeCorePorts(): CorePorts {
  const fsPromisesPort: CoreFsPromisesPort = nodeFsPromises as unknown as CoreFsPromisesPort
  const fsPort: CoreFsPort = nodeFs as unknown as CoreFsPort
  const streamPort: CoreStreamPort = {
    Readable: nodeStream.Readable as unknown as CoreStreamPort['Readable'],
    Writable: nodeStream.Writable as unknown as CoreStreamPort['Writable'],
    PassThrough: nodeStream.PassThrough as unknown as CoreStreamPort['PassThrough'],
    Transform: nodeStream.Transform as unknown as CoreStreamPort['Transform'],
    Duplex: nodeStream.Duplex as unknown as CoreStreamPort['Duplex'],
    pipeline: nodePipeline as unknown as CoreStreamPort['pipeline'],
    finished: nodeFinished as unknown as CoreStreamPort['finished']
  }
  const osPort: CoreOsPort = nodeOs as unknown as CoreOsPort
  const processPort: CoreProcessPort = process as unknown as CoreProcessPort
  const httpPort: CoreHttpPort = nodeHttp as unknown as CoreHttpPort
  const httpsPort: CoreHttpsPort = nodeHttps as unknown as CoreHttpsPort
  const netPort: CoreNetPort = nodeNet as unknown as CoreNetPort
  const dgramPort: CoreDgramPort = nodeDgram as unknown as CoreDgramPort
  const tlsPort: CoreTlsPort = nodeTls as unknown as CoreTlsPort
  const zlibPort: CoreZlibPort = nodeZlib as unknown as CoreZlibPort
  const cryptoPort: CoreCryptoPort = nodeCrypto as unknown as CoreCryptoPort
  const modulePort: CoreModulePort = {
    createRequire: nodeCreateRequire as unknown as CoreModulePort['createRequire']
  }

  const getYauzl = lazyLoad(() => {
    const mod = nodeRequire('yauzl')
    return (mod.default ?? mod) as CoreArchivePort['yauzl']
  })
  const getExtractZip = lazyLoad(() => {
    const mod = nodeRequire('extract-zip')
    return (mod.default ?? mod) as CoreArchivePort['extractZip']
  })
  const getCrc32 = lazyLoad(() => {
    const raw = nodeRequire('buffer-crc32')
    const crc32 = raw.default ?? raw
    return Object.assign(
      (buf: Uint8Array | string, partialCrc?: Uint8Array | number) =>
        crc32(
          typeof buf === 'string' || Buffer.isBuffer(buf)
            ? buf
            : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength),
          partialCrc
        ),
      {
        unsigned: (buf: Uint8Array | string, partialCrc?: number) =>
          crc32.unsigned(
            typeof buf === 'string' || Buffer.isBuffer(buf)
              ? buf
              : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength),
            partialCrc
          ),
        signed: (buf: Uint8Array | string, partialCrc?: number) =>
          crc32.signed(
            typeof buf === 'string' || Buffer.isBuffer(buf)
              ? buf
              : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength),
            partialCrc
          )
      }
    ) as unknown as CoreArchivePort['crc32']
  })

  const archivePort: CoreArchivePort = {
    get yauzl() {
      return getYauzl()
    },
    get extractZip() {
      return getExtractZip()
    },
    get crc32() {
      return getCrc32()
    }
  }

  const getMusicMetadata = lazyLoad(
    () => nodeRequire('music-metadata') as CoreAudioMetadataPort['musicMetadata']
  )
  const getStrtok3 = lazyLoad(() => nodeRequire('strtok3') as CoreAudioMetadataPort['strtok3'])
  const getTaglib = lazyLoad(() => {
    const mod = nodeRequire('node-taglib-sharp')
    return (mod.default ?? mod) as CoreAudioMetadataPort['taglib']
  })

  const audioMetadataPort: CoreAudioMetadataPort = {
    get musicMetadata() {
      return getMusicMetadata()
    },
    get strtok3() {
      return getStrtok3()
    },
    get taglib() {
      return getTaglib()
    }
  }

  const getBasicFtp = lazyLoad(() => nodeRequire('basic-ftp'))
  const ftpPort: CoreFtpPort = {
    get Client() {
      return getBasicFtp().Client as CoreFtpPort['Client']
    },
    get FileType() {
      return getBasicFtp().FileType as CoreFtpPort['FileType']
    }
  }

  const getXmlDomParser = lazyLoad(
    () => nodeRequire('@xmldom/xmldom').DOMParser as CoreTextPort['DOMParser']
  )
  const getIconv = lazyLoad(() => {
    const mod = nodeRequire('iconv-lite')
    return (mod.default ?? mod) as CoreTextPort['iconv']
  })
  const getOpenCC = lazyLoad(() => {
    const mod = nodeRequire('opencc-js')
    return (mod.default ?? mod) as CoreTextPort['opencc']
  })

  const textPort: CoreTextPort = {
    get DOMParser() {
      return getXmlDomParser()
    },
    get iconv() {
      return getIconv()
    },
    get opencc() {
      return getOpenCC()
    }
  }

  return {
    fs: fsPort,
    fsPromises: fsPromisesPort,
    stream: streamPort,
    os: osPort,
    process: processPort,
    http: httpPort,
    https: httpsPort,
    net: netPort,
    dgram: dgramPort,
    tls: tlsPort,
    zlib: zlibPort,
    crypto: cryptoPort,
    module: modulePort,
    archive: archivePort,
    audioMetadata: audioMetadataPort,
    ftp: ftpPort,
    text: textPort
  }
}

export const nodeCorePorts: CorePorts = createNodeCorePorts()
registerCorePorts(nodeCorePorts)
