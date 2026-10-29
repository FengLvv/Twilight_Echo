import {
  buildPluginProxyEnv,
  detectProxy,
  installProxyFetch,
  type PluginProxySettings,
  type InstalledProxyFetch
} from '../plugins/proxyBootstrap.ts'

/** Reuse the application's proxy policy without changing Core's global fetch. */
export function commentsFetch(settings: () => PluginProxySettings): typeof fetch {
  let previous = ''
  let transport: Promise<InstalledProxyFetch | null> = Promise.resolve(null)
  return async (input, init) => {
    const current = settings()
    const key = JSON.stringify(current)
    if (key !== previous) {
      previous = key
      void transport.then((old) => old?.close()).catch(() => {})
      transport = detectProxy(current.proxyMode, {
        ...process.env,
        ...buildPluginProxyEnv(current)
      }).then((proxy) =>
        proxy ? installProxyFetch(proxy.url, fetch, current.proxyAllowDirectFallback) : null
      )
    }
    const selected = await transport
    init?.signal?.throwIfAborted()
    return (selected?.fetch ?? fetch)(input, init)
  }
}
