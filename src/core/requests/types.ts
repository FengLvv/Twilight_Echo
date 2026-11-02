import type { CoreClientIdentity, CoreSnapshot } from '../../shared/coreProtocol.ts'
import type { CoreApplicationDependencies } from '../application.ts'
export interface CoreDispatchContext {
  dependencies: CoreApplicationDependencies
  signal: AbortSignal
  identity: CoreClientIdentity
  changed(): void
  snapshot(identity?: CoreClientIdentity): CoreSnapshot
  checkReady(): Promise<void>
  migration: { required: boolean }
}
