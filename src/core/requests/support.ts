import type { CorePlaylistPreviews } from '.././playlists/previews.ts'

import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import type { TwilightPluginManager } from '.././plugins/managerPort.ts'
export function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}
export function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw failure('INVALID_REQUEST', 'Expected a finite nonnegative number')
  return value
}
export function nonnegativeOptional(value: unknown): number | undefined {
  return value === undefined ? undefined : nonnegative(value)
}
export function executePluginOperation(
  plugins: TwilightPluginManager,
  request: Extract<
    CoreRequestEnvelope,
    {
      name:
        | 'plugins.enable'
        | 'plugins.disable'
        | 'plugins.uninstall'
        | 'plugins.install'
        | 'plugins.dspParameters'
        | 'plugins.log'
        | 'plugins.showLog'
        | 'extensions.execute'
    }
  >
): unknown {
  switch (request.name) {
    case 'plugins.enable':
      return plugins.enable(request.payload.id)
    case 'plugins.disable':
      return plugins.disable(request.payload.id)
    case 'plugins.uninstall':
      return plugins.uninstall(request.payload.id, { removeData: request.payload.removeData })
    case 'plugins.install':
      return plugins.chooseAndInstall(request.payload.kind)
    case 'plugins.dspParameters':
      return plugins.setNativeDspPluginParameters(request.payload.id, request.payload.parameters)
    case 'plugins.log':
      return plugins.getLog(request.payload.id)
    case 'plugins.showLog':
      return plugins.openLog(request.payload.id)
    case 'extensions.execute':
      return plugins.executeUiCommand(request.payload.command, request.payload.args)
  }
}
export function executePreviewOperation(
  previews: CorePlaylistPreviews,
  request: Extract<
    CoreRequestEnvelope,
    {
      name:
        | 'imports.previews'
        | 'imports.preview'
        | 'imports.previewPage'
        | 'imports.previewChoices'
        | 'imports.previewStart'
        | 'imports.previewFile'
        | 'imports.previewConfigure'
        | 'imports.previewSave'
        | 'imports.previewDiscard'
    }
  >,
  signal: AbortSignal
): unknown {
  switch (request.name) {
    case 'imports.previewChoices':
      return previews.choices(
        request.payload.id,
        request.payload.revision,
        request.payload.kind,
        request.payload.offset,
        request.payload.limit
      )
    case 'imports.previews':
      return previews.list(request.payload.offset, request.payload.limit)
    case 'imports.preview':
      return previews.status(request.payload.id)
    case 'imports.previewPage':
      return previews.page(
        request.payload.id,
        request.payload.revision,
        request.payload.offset,
        request.payload.limit
      )
    case 'imports.previewStart':
      return previews.start(request.payload.link, request.payload.credentials)
    case 'imports.previewFile':
      return previews.file(signal)
    case 'imports.previewConfigure':
      return previews.configure(request.payload)
    case 'imports.previewSave':
      return previews.save(request.payload, signal)
    case 'imports.previewDiscard':
      return previews.discard(request.payload.id, request.payload.revision)
  }
}
