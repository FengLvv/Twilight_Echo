import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { coreOperation, listCoreOperations } from '../../shared/coreProtocol.ts'

export interface AgentBridgeOptions {
  profile: string
  version: string
  executable: string
  manifest: { operations: Array<{ name: string; [key: string]: unknown }> }
  request(name: string, payload: Record<string, unknown>): Promise<unknown>
  snapshot(): unknown
  custom?: Record<string, { kind: 'query' | 'command'; description: string; inputSchema: unknown; run(payload: Record<string, unknown>): Promise<unknown> }>
}

const failure = (code: string, message: string) => Object.assign(new Error(message), { code })
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function validCustomInput(value: unknown, schema: unknown): boolean {
  if (!object(schema)) return true
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  if (schema.type === 'string' && typeof value !== 'string') return false
  if (schema.type === 'array' && (!Array.isArray(value) || value.length > 1000 || value.some(item=>!validCustomInput(item,schema.items)))) return false
  if (schema.type === 'object') {
    if (!object(value)) return false
    const properties = object(schema.properties) ? schema.properties : {}
    if (Array.isArray(schema.required) && schema.required.some(key=>typeof key !== 'string' || !(key in value))) return false
    if (schema.additionalProperties === false && Object.keys(value).some(key=>!(key in properties))) return false
    return Object.entries(value).every(([key,item])=>validCustomInput(item,properties[key]))
  }
  return true
}

/** An authenticated local client of the real Core, independent of renderer ownership. */
export async function startAgentBridge(options: AgentBridgeOptions) {
  const token = randomBytes(32).toString('hex')
  const instance = randomBytes(16).toString('hex')
  const discovery = join(options.profile, 'agent-endpoint.json')
  const known = new Map(options.manifest.operations.map(operation => [operation.name, operation]))
  const operations = () => [
    ...listCoreOperations().map(operation => ({ ...known.get(operation.name), ...operation })),
    ...Object.entries(options.custom ?? {}).map(([name, entry]) => ({ name, domain: name.split('.')[0], kind: entry.kind, description: entry.description, inputSchema: entry.inputSchema }))
  ]
  const requests = new Map<string, { fingerprint: string; result: Promise<unknown>; settled: boolean }>()
  let stopping = false
  const server: Server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const reply = (status: number, value: unknown) => { response.writeHead(status); response.end(JSON.stringify(value)) }
    try {
      if (stopping) throw failure('UNAVAILABLE', 'Application is stopping')
      if (request.headers.origin || request.headers['sec-fetch-site']) throw failure('FORBIDDEN', 'Browser-origin requests are not accepted')
      const authorization = request.headers.authorization ?? ''
      const actual = Buffer.from(authorization), expected = Buffer.from('Bearer ' + token)
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw failure('UNAUTHORIZED', 'Invalid agent credential')
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/status')
        return reply(200, { ok: true, value: { software: 'TwilightEcho', version: options.version, protocolVersion: 1, instance, pid: process.pid, snapshot: options.snapshot() } })
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
        const domain = url.searchParams.get('domain')
        return reply(200, { ok: true, value: { protocolVersion: 1, software: 'TwilightEcho', operations: operations().filter(operation => !domain || operation.name.split('.')[0] === domain) } })
      }
      if (request.method === 'GET' && url.pathname === '/v1/describe') {
        const operation = operations().find(operation => operation.name === url.searchParams.get('name'))
        if (!operation) throw failure('NOT_FOUND', 'Unknown operation')
        return reply(200, { ok: true, value: operation })
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/rpc') throw failure('NOT_FOUND', 'Unknown agent endpoint')
      if (!request.headers['content-type']?.startsWith('application/json')) throw failure('INVALID_REQUEST', 'Expected application/json')
      let bytes = 0, body = ''
      request.setEncoding('utf8')
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 16 * 1024 * 1024) throw failure('TOO_LARGE', 'Agent request exceeds 16 MiB')
        body += chunk
      }
      let envelope: unknown
      try { envelope = JSON.parse(body) } catch { throw failure('INVALID_REQUEST', 'Invalid JSON request') }
      if (!object(envelope) || Object.keys(envelope).some(key => !['id', 'operation', 'payload'].includes(key)) ||
          typeof envelope.id !== 'string' || !envelope.id.length || envelope.id.length > 128 ||
          typeof envelope.operation !== 'string' || !object(envelope.payload))
        throw failure('INVALID_REQUEST', 'Expected id, operation and object payload')
      const custom = options.custom && Object.hasOwn(options.custom,envelope.operation) ? options.custom[envelope.operation] : undefined
      const operation = custom ?? coreOperation(envelope.operation)
      if (!operation) throw failure('NOT_FOUND', 'Unknown Core operation: ' + envelope.operation)
      const name = envelope.operation, payload = envelope.payload
      if (!custom && known.get(name)?.interactive && process.argv.includes('--agent-headless') && !(name === 'study.export' && payload.outputDirectory))
        throw failure('INTERACTIVE_REQUIRED','This operation uses a native dialog. Start app --visible, or use an explicit-path agent operation from capabilities --domain agent.')
      if (custom && !validCustomInput(payload,custom.inputSchema)) throw failure('INVALID_INPUT','Payload does not match '+name+' input schema')
      const execute = () => custom ? custom.run(payload) : options.request(name, payload)
      let result: Promise<unknown>
      if (operation.kind === 'command') {
        const fingerprint = createHash('sha256').update(JSON.stringify([name, payload])).digest('hex')
        const previous = requests.get(envelope.id)
        if (previous && previous.fingerprint !== fingerprint) throw failure('CONFLICT', 'Request id was already used for another command')
        if (previous) result = previous.result
        else {
          for (const [id, value] of requests) if (requests.size >= 256 && value.settled) requests.delete(id)
          if (requests.size >= 256) throw failure('BUSY', 'Too many in-flight agent commands')
          const entry = { fingerprint, result: Promise.resolve().then(execute), settled: false }
          requests.set(envelope.id, entry)
          entry.result.then(() => { entry.settled = true }, () => { entry.settled = true })
          result = entry.result
        }
      } else result = Promise.resolve().then(execute)
      reply(200, { ok: true, id: envelope.id, value: (await result) ?? null })
    } catch (error) {
      const code = String((error as { code?: string }).code ?? 'INTERNAL_ERROR')
      const status = ({ UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, TOO_LARGE: 413, BUSY: 429, UNAVAILABLE: 503, NOT_READY: 503, INVALID_REQUEST: 400 } as Record<string, number>)[code] ?? 400
      if (!response.headersSent) reply(status, { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } })
      else response.destroy()
    }
  })
  server.maxConnections = 32
  server.headersTimeout = 10000
  server.requestTimeout = 60000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent listener did not bind')
  await mkdir(options.profile, { recursive: true })
  const temporary = discovery + '.' + instance + '.part'
  try {
    await writeFile(temporary, JSON.stringify({ protocolVersion: 1, software: 'TwilightEcho', instance, pid: process.pid, url: `http://127.0.0.1:${address.port}/v1`, token, executable: options.executable }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, discovery)
  } catch (error) { server.close(); await rm(temporary, { force: true }); throw error }
  return {
    discovery,
    async stop() {
      if (stopping) return
      stopping = true
      server.closeIdleConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      try {
        const current = JSON.parse(await readFile(discovery, 'utf8'))
        if (current.instance === instance) await rm(discovery, { force: true })
      } catch {}
    }
  }
}
