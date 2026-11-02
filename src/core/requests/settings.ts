import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'themes.list',
  'themes.bootstrap',
  'themes.edit',
  'themes.import',
  'themes.export',
  'themes.importAsset',
  'themes.validateAssets',
  'themes.copyAssets',
  'themes.reconcile',
  'settings.backup',
  'settings.restore',
  'backup.export',
  'backup.preview',
  'backup.recover',
  'backup.repreview',
  'backup.stage',
  'backup.chooseFolder',
  'settings.state',
  'settings.edit',
  'state.snapshot',
  'migration.status',
  'migration.begin',
  'migration.stage',
  'migration.commit',
  'migration.abort',
  'lifecycle.flush'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  const playback = context.dependencies.playback
  switch (request.name) {
    case 'themes.list':
    case 'themes.bootstrap':
    case 'themes.edit':
    case 'themes.import':
    case 'themes.export':
    case 'themes.importAsset':
    case 'themes.validateAssets':
    case 'themes.copyAssets':
    case 'themes.reconcile': {
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Theme management requires the desktop window')
      const themes = context.dependencies.themes
      if (!themes) throw failure('FAILED', 'Theme management unavailable')
      switch (request.name) {
        case 'themes.list':
          return themes.list()
        case 'themes.bootstrap':
          return themes.bootstrap()
        case 'themes.edit':
          return themes.edit(request.payload, signal)
        case 'themes.import':
          return themes.import(request.payload.revision, signal)
        case 'themes.export':
          return themes.export(request.payload.id, signal)
        case 'themes.importAsset':
          return themes.importAsset(request.payload.id, request.payload.type, signal)
        case 'themes.validateAssets':
          return themes.validateAssets(request.payload.id, request.payload.assets, signal)
        case 'themes.copyAssets':
          return themes.copyAssets(request.payload.sourceId, request.payload.targetId)
        case 'themes.reconcile':
          return themes.reconcile()
      }
      break
    }
    case 'settings.backup':
    case 'settings.restore': {
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Settings backup requires the desktop window')
      const backup = context.dependencies.settingsBackup
      if (!backup) throw failure('FAILED', 'Settings backup unavailable')
      return request.name === 'settings.backup'
        ? backup.export()
        : backup.import(request.payload, signal)
    }
    case 'backup.export':
    case 'backup.preview':
    case 'backup.recover':
    case 'backup.repreview':
    case 'backup.stage':
    case 'backup.chooseFolder': {
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Personal backup requires the desktop window')
      const backup = context.dependencies.personalBackup
      if (!backup) throw failure('FAILED', 'Personal backup unavailable')
      switch (request.name) {
        case 'backup.export':
          return backup.export(request.payload, signal)
        case 'backup.preview':
          return backup.preview(signal)
        case 'backup.recover':
          return backup.recoverPreview(signal)
        case 'backup.repreview':
          return backup.repreview(request.payload, signal)
        case 'backup.stage': {
          const result = await backup.stage(request.payload, signal)
          context.changed()
          return result
        }
        case 'backup.chooseFolder':
          return backup.chooseFolder(signal)
      }
      break
    }
    case 'settings.state':
    case 'settings.edit': {
      const settings = context.dependencies.settings
      if (!settings) throw failure('FAILED', 'Settings runtime unavailable')
      return request.name === 'settings.state'
        ? settings.state()
        : settings.edit(request.payload, signal)
    }
    case 'state.snapshot':
      return context.snapshot(identity)
    case 'migration.status':
      return context.dependencies.state.coreStateStatus()
    case 'migration.begin':
      return context.dependencies.state.coreMigrationBegin(
        request.payload.id,
        request.payload.manifest
      )
    case 'migration.stage':
      return context.dependencies.state.coreMigrationStage(
        request.payload.id,
        request.payload.batch,
        request.payload.domain,
        request.payload.rows
      )
    case 'migration.commit': {
      const result = await context.dependencies.state.coreMigrationCommit(request.payload.id)
      context.migration.required = !result.complete
      await context.checkReady()
      return result
    }
    case 'migration.abort':
      return context.dependencies.state.coreMigrationAbort(request.payload.id)
    case 'lifecycle.flush':
      await context.dependencies.pluginExperiences?.flush()
      await context.dependencies.sleepTimer?.flush()
      await context.dependencies.settings?.flush()
      await context.dependencies.dsp?.flush()
      await context.dependencies.output?.flush()
      await context.dependencies.cache?.flush()
      await context.dependencies.recordingVersions?.flush()
      await context.dependencies.playlists?.flush()
      await playback.flush()
      await context.dependencies.bookmarks?.flush()
      await context.dependencies.lyrics?.flush()
      await context.dependencies.workspace?.flush()
      await context.dependencies.streams?.flush()
      await context.dependencies.network?.flush()
      return context.dependencies.statistics.flush()
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
