import type { CoreRequestEnvelope } from '../../shared/coreProtocol.ts'
import * as audio from './audio.ts'
import * as catalog from './catalog.ts'
import * as library from './library.ts'
import * as playback from './playback.ts'
import * as plugins from './plugins.ts'
import * as settings from './settings.ts'
import * as sources from './sources.ts'
import * as study from './study.ts'
import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'
import * as workspace from './workspace.ts'

// Registration narrows once after operation validation; individual handlers retain payload types.
function register<const Names extends readonly CoreRequestEnvelope['name'][]>(domain: {
  operations: Names
  handle(
    request: Extract<CoreRequestEnvelope, { name: Names[number] }>,
    context: CoreDispatchContext
  ): Promise<unknown>
}) {
  for (const name of domain.operations) {
    if (handlers.has(name)) throw new Error('Duplicate Core handler: ' + name)
    handlers.set(name, (request, context) =>
      domain.handle(request as Extract<CoreRequestEnvelope, { name: Names[number] }>, context)
    )
  }
}
const handlers = new Map<
  string,
  (request: CoreRequestEnvelope, context: CoreDispatchContext) => Promise<unknown>
>()
register(catalog)
register(playback)
register(workspace)
register(settings)
register(audio)
register(sources)
register(library)
register(plugins)
register(study)
export function dispatchCoreRequest(
  request: CoreRequestEnvelope,
  context: CoreDispatchContext
): Promise<unknown> {
  const handler = handlers.get(request.name)
  if (!handler) throw failure('FAILED', 'Unsupported Core operation')
  return handler(request, context)
}
export const registeredCoreOperations = Object.freeze([...handlers.keys()])
