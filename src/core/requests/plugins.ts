import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { executePluginOperation, failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'providers.call',
  'extensions.experiences',
  'extensions.resource',
  'extensions.stylesheet',
  'extensions.preferences',
  'extensions.preferences.edit',
  'extensions.document',
  'extensions.document.edit',
  'extensions.music',
  'extensions.export',
  'comments.read',
  'comments.edit',
  'comments.account',
  'comments.publish',
  'extensions.pluginRequest',
  'plugins.installSource',
  'plugins.index.list',
  'plugins.index.refresh',
  'plugins.index.status',
  'plugins.index.install',
  'plugins.list',
  'providers.list',
  'extensions.list',
  'plugins.enable',
  'plugins.disable',
  'plugins.uninstall',
  'plugins.install',
  'plugins.dspParameters',
  'plugins.log',
  'plugins.showLog',
  'extensions.execute'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal } = context
  switch (request.name) {
    case 'providers.call': {
      if (!context.dependencies.plugins) throw failure('FAILED', 'Provider runtime unavailable')
      const { providerId, method, args, idempotencyKey } = request.payload
      if (providerId === 'ncm' && method === 'logout')
        await context.dependencies.cloudTransfers?.observeAccount(null)
      const result = await context.dependencies.plugins.callProvider(providerId, method, args, {
        signal,
        idempotencyKey
      })
      if (
        providerId === 'ncm' &&
        ['checkLogin', 'openOfficialLogin', 'getProfile'].includes(method)
      ) {
        const value = result as {
          loggedIn?: boolean
          profile?: {
            userId?: number
          }
          userId?: number
        } | null
        const userId =
          method === 'getProfile' ? value?.userId : value?.loggedIn ? value.profile?.userId : null
        if (userId === null || typeof userId === 'number')
          await context.dependencies.cloudTransfers?.observeAccount(userId)
      }
      return result
    }
    case 'extensions.experiences':
    case 'extensions.resource':
    case 'extensions.stylesheet':
    case 'extensions.preferences':
    case 'extensions.preferences.edit':
    case 'extensions.document':
    case 'extensions.document.edit':
    case 'extensions.music':
    case 'extensions.export': {
      const experiences = context.dependencies.pluginExperiences
      if (!experiences) throw failure('FAILED', 'Plugin experiences unavailable')
      switch (request.name) {
        case 'extensions.experiences':
          return experiences.list()
        case 'extensions.resource':
          return experiences.resource(request.payload.url)
        case 'extensions.stylesheet':
          return experiences.stylesheet(request.payload.pluginId, request.payload.themeId)
        case 'extensions.preferences':
          return experiences.preferences(request.payload.id)
        case 'extensions.preferences.edit':
          return experiences.preferences(request.payload.id, request.payload.value)
        case 'extensions.document':
          return experiences.document(request.payload.id)
        case 'extensions.document.edit':
          return experiences.document(request.payload.id, request.payload.update)
        case 'extensions.music':
          return experiences.music(
            request.payload.id,
            request.payload.operation,
            request.payload.args
          )
        case 'extensions.export':
          return experiences.export(
            request.payload.id,
            request.payload.name,
            request.payload.content
          )
      }
      break
    }
    case 'comments.read':
    case 'comments.edit': {
      if (!context.dependencies.comments)
        throw Object.assign(new Error('评论服务不可用'), { code: 'UNSUPPORTED' })
      return context.dependencies.comments.request(request.payload, signal)
    }
    case 'comments.account':
    case 'comments.publish': {
      if (!context.dependencies.comments)
        throw Object.assign(new Error('评论服务不可用'), { code: 'UNSUPPORTED' })
      return request.name === 'comments.account'
        ? context.dependencies.comments.account(signal)
        : context.dependencies.comments.publish(request.payload, signal)
    }
    case 'extensions.pluginRequest': {
      if (!context.dependencies.plugins) throw failure('FAILED', 'Plugin runtime unavailable')
      const { id, request: pluginRequest } = request.payload
      if (typeof id !== 'string' || !id || id.length > 128)
        throw failure('INVALID_REQUEST', 'Invalid plugin id')
      if (pluginRequest === undefined || typeof pluginRequest !== 'object')
        throw failure('INVALID_REQUEST', 'Invalid plugin request')
      return context.dependencies.plugins.callExperienceRequest(id, pluginRequest)
    }
    case 'plugins.installSource':
      if (!context.dependencies.plugins) throw failure('FAILED', 'Plugin runtime unavailable')
      return context.dependencies.plugins.installFromPath(request.payload.path)
    case 'plugins.index.list':
    case 'plugins.index.refresh':
      if (!context.dependencies.pluginMarketplace)
        throw failure('FAILED', 'Plugin market unavailable')
      return context.dependencies.pluginMarketplace.list(request.name === 'plugins.index.refresh')
    case 'plugins.index.status':
      if (!context.dependencies.pluginMarketplace)
        throw failure('FAILED', 'Plugin market unavailable')
      return context.dependencies.pluginMarketplace.status()
    case 'plugins.index.install':
      if (!context.dependencies.pluginMarketplace)
        throw failure('FAILED', 'Plugin market unavailable')
      return context.dependencies.pluginMarketplace.install(request.payload.id)
    case 'plugins.list':
      return context.dependencies.plugins?.list() ?? []
    case 'providers.list':
      return context.dependencies.plugins?.listProviders() ?? []
    case 'extensions.list':
      return context.dependencies.plugins?.listExtensions() ?? []
    case 'plugins.enable':
    case 'plugins.disable':
    case 'plugins.uninstall':
    case 'plugins.install':
    case 'plugins.dspParameters':
    case 'plugins.log':
    case 'plugins.showLog':
    case 'extensions.execute': {
      const plugins = context.dependencies.plugins
      if (!plugins) throw failure('FAILED', 'Plugin runtime unavailable')
      return executePluginOperation(plugins, request)
    }
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
