import type { CoreParentMessage } from '../../shared/coreProcessProtocol.ts'
import type { ServiceMessagePort } from '../services/servicePort.ts'
import { initializeUtilityDiagnostics } from '../diagnostics/utility.ts'
import { createCoreHost } from '../composition/coreHost.ts'

const parent = (process as unknown as { parentPort?: ServiceMessagePort }).parentPort
if (!parent) throw new Error('Music Core must run in an Electron utility process')
initializeUtilityDiagnostics('twilight-core')
const host = createCoreHost((message) => parent.postMessage(message))
parent.on('message', (event) => host.handle(event.data as CoreParentMessage, event.ports))
parent.postMessage({ kind: 'core:booted' })
