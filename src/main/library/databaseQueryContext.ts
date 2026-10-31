import { AsyncLocalStorage } from 'node:async_hooks'

const queries = new AsyncLocalStorage<{ signal: AbortSignal; active: boolean }>()
export function withDatabaseQuery<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  const context = { signal, active: true }
  return queries.run(context, read).finally(() => {
    context.active = false
  })
}
export function databaseQuerySignal(): AbortSignal | undefined {
  const context = queries.getStore()
  return context?.active ? context.signal : undefined
}
