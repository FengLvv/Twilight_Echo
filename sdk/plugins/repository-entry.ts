import { mobileRepositoryRequest } from '../../src/core/plugins/mobileRepository.ts'
;(globalThis as any).__TWILIGHT_PLUGIN_REPOSITORY__ = (json: string) => {
  try { return JSON.stringify({ ok: true, value: mobileRepositoryRequest(JSON.parse(json)) }) }
  catch (e) { return JSON.stringify({ ok: false, error: (e as Error).message }) }
}
