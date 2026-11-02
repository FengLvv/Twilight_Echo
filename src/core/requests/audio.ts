import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { projectCoreError } from '.././projections.ts'

import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'automix.install.start',
  'automix.install.cancel',
  'automix.install.status',
  'analysis.request',
  'analysis.cache.clear',
  'analysis.cache.size',
  'analysis.loudness.status',
  'automix.capabilities',
  'audio.recovery',
  'audio.recovery.start',
  'audio.outputTest',
  'audio.outputTest.play',
  'audio.outputTest.stop',
  'audio.audition',
  'audio.audition.measure',
  'audio.audition.select',
  'audio.audition.end',
  'audio.dsp',
  'audio.dsp.status',
  'audio.dsp.assets',
  'audio.dsp.correction',
  'audio.dsp.edit',
  'audio.dsp.import',
  'audio.dsp.export',
  'audio.dsp.assetRemove',
  'audio.vst3',
  'audio.vst3.parameters',
  'audio.vst3.edit',
  'audio.vst3.chooseDirectory',
  'audio.output',
  'audio.profiles',
  'audio.output.edit',
  'audio.profiles.edit',
  'audio.diagnostics'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  switch (request.name) {
    case 'automix.install.start':
    case 'automix.install.cancel':
    case 'automix.install.status': {
      const installer = context.dependencies.modelPack
      if (!installer) throw failure('FAILED', 'AutoMix model installation unavailable')
      if (request.kind === 'command' && identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Model installation requires the desktop window')
      return request.name === 'automix.install.start'
        ? installer.start(request.payload.enableAfterInstall)
        : request.name === 'automix.install.cancel'
          ? installer.cancel()
          : installer.state()
    }
    case 'analysis.request':
    case 'analysis.cache.clear':
    case 'analysis.cache.size':
    case 'analysis.loudness.status': {
      const analysis = context.dependencies.analysis
      if (!analysis) throw failure('FAILED', 'Audio analysis unavailable')
      if (
        (request.name === 'analysis.request' || request.name === 'analysis.cache.clear') &&
        identity.role !== 'desktop'
      )
        throw failure('FORBIDDEN', 'Audio analysis changes require the desktop window')
      switch (request.name) {
        case 'analysis.request': {
          const result = await analysis.request(request.payload)
          return 'reason' in result
            ? { ...result, reason: projectCoreError(result.reason) }
            : result
        }
        case 'analysis.cache.clear':
          return analysis.clearCache(request.payload.kind)
        case 'analysis.cache.size':
          return analysis.cacheSize(request.payload.kind)
        case 'analysis.loudness.status':
          return analysis.status()
      }
      break
    }
    case 'automix.capabilities':
      if (!context.dependencies.autoMix) throw failure('FAILED', 'AutoMix is unavailable')
      return context.dependencies.autoMix.capabilities(request.payload.refresh === true)
    case 'audio.recovery':
    case 'audio.recovery.start': {
      const recovery = context.dependencies.audioRecovery
      if (!recovery) throw failure('NOT_READY', 'Audio recovery is unavailable')
      if (request.name === 'audio.recovery') return recovery.state()
      if (identity.role !== 'desktop' || !identity.permissions.includes('playback:write'))
        throw failure('FORBIDDEN', 'Audio recovery requires the desktop playback controller')
      return recovery.start(request.payload.kind)
    }
    case 'audio.outputTest':
    case 'audio.outputTest.play':
    case 'audio.outputTest.stop': {
      const test = context.dependencies.outputTest
      if (!test) throw failure('FAILED', 'Output test runtime unavailable')
      if (request.name === 'audio.outputTest') return test.state()
      if (identity.role !== 'desktop') throw failure('FORBIDDEN', '试听仅可从主窗口发起')
      if (request.name === 'audio.outputTest.stop') return test.stop()
      return test.play(request.payload.revision, request.payload.exclusive, signal)
    }
    case 'audio.audition':
    case 'audio.audition.measure':
    case 'audio.audition.select':
    case 'audio.audition.end': {
      const audition = context.dependencies.audition
      if (!audition) throw failure('FAILED', 'DSP audition runtime unavailable')
      switch (request.name) {
        case 'audio.audition':
          return audition.state()
        case 'audio.audition.measure':
          return audition.measure(request.payload, signal)
        case 'audio.audition.select':
          return audition.select(
            request.payload.revision,
            request.payload.id,
            request.payload.side,
            signal
          )
        case 'audio.audition.end':
          return audition.end(request.payload.revision, signal)
      }
      break
    }
    case 'audio.dsp':
    case 'audio.dsp.status':
    case 'audio.dsp.assets':
    case 'audio.dsp.correction':
    case 'audio.dsp.edit':
    case 'audio.dsp.import':
    case 'audio.dsp.export':
    case 'audio.dsp.assetRemove':
    case 'audio.vst3':
    case 'audio.vst3.parameters':
    case 'audio.vst3.edit':
    case 'audio.vst3.chooseDirectory': {
      const dsp = context.dependencies.dsp
      if (!dsp) throw failure('FAILED', 'DSP runtime unavailable')
      switch (request.name) {
        case 'audio.dsp':
          return dsp.state()
        case 'audio.dsp.status':
          return dsp.status()
        case 'audio.dsp.assets':
          return dsp.assets(request.payload.offset, request.payload.limit)
        case 'audio.dsp.correction':
          return dsp.correction(request.payload.id)
        case 'audio.dsp.edit':
          return dsp.edit(request.payload, signal)
        case 'audio.dsp.import':
          return dsp.import(request.payload, signal)
        case 'audio.dsp.export':
          return dsp.export(request.payload.revision, request.payload.name, signal)
        case 'audio.dsp.assetRemove':
          return dsp.removeAsset(request.payload.revision, request.payload.id, signal)
        case 'audio.vst3':
          return dsp.vst3(request.payload.offset, request.payload.limit)
        case 'audio.vst3.parameters':
          return dsp.parameters(
            request.payload.id,
            request.payload.revision,
            request.payload.offset,
            request.payload.limit
          )
        case 'audio.vst3.edit':
          return dsp.editVst3(request.payload, signal)
        case 'audio.vst3.chooseDirectory':
          return dsp.chooseDirectory(signal)
      }
      break
    }
    case 'audio.output':
    case 'audio.profiles':
    case 'audio.output.edit':
    case 'audio.profiles.edit': {
      const output = context.dependencies.output
      if (!output) throw failure('FAILED', 'Audio output runtime unavailable')
      switch (request.name) {
        case 'audio.output':
          return output.state()
        case 'audio.profiles':
          return output.profiles()
        case 'audio.output.edit':
          return output.edit(request.payload, signal)
        case 'audio.profiles.edit':
          return output.editProfiles(request.payload, signal)
      }
      break
    }
    case 'audio.diagnostics':
      if (!context.dependencies.diagnostics)
        throw failure('NOT_READY', 'Audio diagnostics are unavailable')
      return context.dependencies.diagnostics.report(request.payload.locale)
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
