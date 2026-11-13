/** Account transport discovery preserves issuer identity and never replays credential mutations. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { PlatformClient } from '../src/http.ts'
import { accountFixture } from './account-fixture.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

async function endpoint(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const requests: Array<{ path: string; authorization: string | undefined }> = []
  const server = createServer((request, response) => {
    requests.push({ path: request.url ?? '', authorization: request.headers.authorization })
    handle(request, response)
  })
  cleanups.push(() => new Promise((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture did not bind')
  return { origin: `http://127.0.0.1:${address.port}`, requests }
}

function metadata(issuer: string) {
  return { resource: issuer + '/api/v1/desktop', scope: 'desktop',
    authorization_endpoint: issuer + '/oauth/desktop/authorize', registration_endpoint: issuer + '/api/v1/desktop/oauth/register',
    token_endpoint: issuer + '/api/v1/desktop/oauth/token', revocation_endpoint: issuer + '/api/v1/desktop/oauth/revoke' }
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

it('logs in and completes inference through a configured alternate while the issuer is unreachable', async () => {
  const issuer = await endpoint((_request, response) => { json(response, {}, 503) })
  const f = await accountFixture({ issuerOrigin: issuer.origin })
  const state = await f.account.signInWithPassword('user@example.com', 'private-password')
  expect(state).toMatchObject({ status: 'signed-in', platformOrigin: issuer.origin, selectedGroup: '3', models: ['relay-model'], error: null })
  const provider = f.context.llm.listProviders()[0]!.id
  const prepared = await f.context.llm.prepareCall({ provider, model: 'relay-model' })
  const chunks = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('Platform model connected.')
  expect(f.requests.find(request => request.path.endsWith('/oauth/token'))?.body.resource).toBe(issuer.origin + '/api/v1/desktop')
  expect(f.requests.filter(request => request.path.endsWith('/oauth/configuration'))).toHaveLength(1)
  expect(issuer.requests).toEqual([
    { path: '/api/v1/desktop/oauth/configuration', authorization: undefined },
    { path: '/v1/models', authorization: 'Bearer short-inference-key' },
  ])
})

it('rejects mismatched discovery identities without sending passwords or tokens', async () => {
  const issuer = await endpoint((_request, response) => { json(response, {}, 404) })
  const alternate = await endpoint((_request, response) => { json(response, metadata('https://different.example')) })
  const client = new PlatformClient(issuer.origin, 1000, new AbortController().signal, { origins: [alternate.origin], timeoutMs: 1000 })
  await expect(client.request('/api/v1/auth/login', { token: 'secret-token', body: { password: 'secret-password' } })).rejects.toMatchObject({ code: 'protocol' })
  expect([...issuer.requests, ...alternate.requests]).toEqual([
    { path: '/api/v1/desktop/oauth/configuration', authorization: undefined },
    { path: '/api/v1/desktop/oauth/configuration', authorization: undefined },
  ])
})

it('does not replay a failed POST and selects a healthy route for the next explicit request', async () => {
  let failed = false
  const issuer = await endpoint((request, response) => {
    if (request.url?.endsWith('/configuration')) { json(response, metadata(issuer.origin), failed ? 503 : 200); return }
    failed = true
    request.socket.destroy()
  })
  const alternate = await endpoint((request, response) => {
    if (request.url?.endsWith('/configuration')) { json(response, metadata(issuer.origin), failed ? 200 : 503); return }
    json(response, { code: 0, data: { recovered: true } })
  })
  const client = new PlatformClient(issuer.origin, 1000, new AbortController().signal, { origins: [alternate.origin], timeoutMs: 1000 })
  await expect(client.request('/api/v1/auth/login', { body: { password: 'secret-password' } })).rejects.toMatchObject({ code: 'network' })
  expect(issuer.requests.filter(request => request.path === '/api/v1/auth/login')).toHaveLength(1)
  expect(alternate.requests.every(request => request.path.endsWith('/configuration'))).toBe(true)
  await expect(client.request('/api/v1/desktop/profile', { token: 'desktop-token' })).resolves.toEqual({ recovered: true })
  expect(alternate.requests.at(-1)?.authorization).toBe('Bearer desktop-token')
})

it('bounds discovery and reports a timeout before any authenticated request is sent', async () => {
  const issuer = await endpoint(() => {})
  const alternate = await endpoint(() => {})
  const client = new PlatformClient(issuer.origin, 1000, new AbortController().signal, { origins: [alternate.origin], timeoutMs: 50 })
  await expect(client.request('/api/v1/auth/login', { body: { password: 'secret-password' } })).rejects.toMatchObject({ code: 'timeout' })
  expect([...issuer.requests, ...alternate.requests].every(request => request.path.endsWith('/configuration'))).toBe(true)
})

it('aborts pending connection probes when the account lifetime ends', async () => {
  const started = Promise.withResolvers<undefined>()
  const issuer = await endpoint(() => { started.resolve(undefined) })
  const lifetime = new AbortController()
  const client = new PlatformClient(issuer.origin, 1000, lifetime.signal, { origins: [issuer.origin], timeoutMs: 1000 })
  const request = expect(client.request('/api/v1/desktop/profile', { token: 'secret' })).rejects.toMatchObject({ code: 'network' })
  await started.promise
  lifetime.abort()
  await request
  expect(issuer.requests.every(value => value.authorization === undefined)).toBe(true)
})

it.each([500, 503])('reports HTTP %s as a server failure rather than a connectivity failure', async (status) => {
  const issuer = await endpoint((_request, response) => { json(response, { code: status }, status) })
  const client = new PlatformClient(issuer.origin, 1000, new AbortController().signal)
  await expect(client.request('/api/v1/desktop/profile')).rejects.toMatchObject({ code: 'server' })
})
