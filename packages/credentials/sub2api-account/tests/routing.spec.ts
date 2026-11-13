/** Independent account and inference choices through the real account composition. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { accountFixture } from './account-fixture.ts'
import type { GatewayId, Sub2apiGroupId } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

async function endpoint(handle: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void) {
  const calls: Array<{ path: string; authorization: string | undefined }> = []
  const errors: unknown[] = []
  const server = createServer((request, response) => {
    calls.push({ path: request.url ?? '', authorization: request.headers.authorization })
    void Promise.resolve().then(() => handle(request, response)).catch((error: unknown) => {
      errors.push(error)
      response.writeHead(500).end()
    })
  })
  cleanups.push(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
    expect(errors).toEqual([])
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture did not bind')
  return { origin: `http://127.0.0.1:${address.port}`, calls }
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

it('persists independent routes and keeps account tokens away from chat and image endpoints', async () => {
  let upstream = ''
  const accountLine = await endpoint(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
    const body = Buffer.concat(chunks)
    const headers = new Headers()
    if (request.headers.authorization) headers.set('authorization', request.headers.authorization)
    if (request.headers['content-type']) headers.set('content-type', request.headers['content-type'])
    const result = await fetch(upstream + request.url!, { method: request.method!, headers,
      ...(body.length ? { body } : {}), signal: AbortSignal.timeout(5000) })
    response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' })
    response.end(Buffer.from(await result.arrayBuffer()))
  })
  const modelLine = await endpoint((request, response) => {
    if (request.url === '/v1/models') { json(response, { data: [{ id: 'relay-model' }] }); return }
    if (request.url === '/v1/images/generations') { json(response, { data: [{ url: 'https://images.example/result.png' }] }); return }
    if (request.url === '/v1/chat/completions') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'reply', choices: [{ index: 0, delta: { content: 'Independent inference route.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'reply', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    response.writeHead(404).end()
  })
  const f = await accountFixture({ accountOrigins: [accountLine.origin], feature: (request, response) => {
    if (request.url === '/api/v1/desktop/groups') {
      json(response, { code: 0, data: [{ id: 3, name: 'Models', platform: 'openai', allow_image_generation: true }] }); return true
    }
    if (request.url === '/api/v1/desktop/gateways') {
      json(response, { code: 0, data: { api_base_url: modelLine.origin, custom_endpoints: [] } }); return true
    }
    if (request.url === '/v1/models') { json(response, { code: 503 }, 503); return true }
    return false
  } })
  upstream = f.origin
  expect((await f.account.getState()).connection?.selected).toBeNull()
  expect(await f.account.setAccountOrigin(accountLine.origin)).toMatchObject({
    status: 'signed-out', connection: { selected: accountLine.origin, active: accountLine.origin }, error: null,
  })
  expect(await f.account.signInWithPassword('user@example.com', 'fake-password')).toMatchObject({ status: 'signed-in', models: ['relay-model'], error: null })
  expect(await f.account.getGateways()).toMatchObject({ ok: true, data: { selected: null, active: modelLine.origin } })
  const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model: 'relay-model' })
  const chunks = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('Independent inference route.')
  expect(await f.account.generateImages({ groupId: '3' as Sub2apiGroupId, model: 'relay-model', prompt: 'blue', count: 1, size: '' })).toMatchObject({ ok: true })
  expect(accountLine.calls.some(call => call.path === '/api/v1/desktop/profile' && call.authorization === 'Bearer desktop-access-1')).toBe(true)
  expect(accountLine.calls.every(call => call.path.startsWith('/api/v1/'))).toBe(true)
  expect(modelLine.calls.every(call => call.authorization === 'Bearer short-inference-key')).toBe(true)
  expect(modelLine.calls.some(call => call.path === '/v1/chat/completions')).toBe(true)
  expect(modelLine.calls.some(call => call.path === '/v1/images/generations')).toBe(true)

  expect(await f.account.setGateway(modelLine.origin as GatewayId, true)).toMatchObject({ ok: true, data: { selected: modelLine.origin } })
  await f.account.setAccountOrigin(f.origin)
  expect(await f.account.getGateways()).toMatchObject({ ok: true, data: { selected: modelLine.origin, active: modelLine.origin } })
  await f.account.setAccountOrigin(accountLine.origin)
  const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
  await entry.update({ disabled: true })
  await entry.update({ disabled: false })
  const restored = f.context.sub2apiAccount
  expect(await restored.getState()).toMatchObject({ connection: { selected: accountLine.origin }, models: ['relay-model'] })
  expect(await restored.getGateways()).toMatchObject({ ok: true, data: { selected: modelLine.origin, active: modelLine.origin } })
  expect(await restored.setGateway(null, false)).toMatchObject({ ok: true, data: { selected: null, active: modelLine.origin } })
  await restored.signOut()
  expect(await restored.getState()).toMatchObject({ status: 'signed-out', connection: { selected: accountLine.origin } })
})

it('keeps an unavailable manual account route until the user restores automatic selection', async () => {
  const offline = await endpoint((_request, response) => { json(response, { code: 503 }, 503) })
  const f = await accountFixture({ accountOrigins: [offline.origin] })
  expect(await f.account.setAccountOrigin(offline.origin)).toMatchObject({ error: 'server', connection: { selected: offline.origin, active: null } })
  expect(await f.account.signInWithPassword('user@example.com', 'fake-password')).toMatchObject({ status: 'signed-out', error: 'server' })
  expect(f.requests.some(request => request.path === '/api/v1/auth/login')).toBe(false)
  expect(offline.calls.every(call => call.path === '/api/v1/desktop/oauth/configuration' && call.authorization === undefined)).toBe(true)
  expect(await f.account.setAccountOrigin(null)).toMatchObject({ error: null, connection: { selected: null, active: f.origin } })
  expect(await f.account.setAccountOrigin('https://unknown.example')).toMatchObject({ error: 'account-line-unavailable', connection: { selected: null } })
  expect(await f.account.signInWithPassword('user@example.com', 'fake-password')).toMatchObject({ status: 'signed-in', models: ['relay-model'] })
})

it('excludes unencrypted inference routes from automatic detection and keeps a failed manual choice', async () => {
  const unavailable = await endpoint((_request, response) => { json(response, {}, 503) })
  const manualOrigin = unavailable.origin.replace('127.0.0.1', 'localhost')
  const f = await accountFixture({ feature: (request, response) => {
    if (request.url !== '/api/v1/desktop/gateways') return false
    json(response, { code: 0, data: { api_base_url: `http://${request.headers.host}`,
      custom_endpoints: [{ name: 'Manual only', endpoint: manualOrigin }] } })
    return true
  } })
  await f.account.signInWithPassword('user@example.com', 'fake-password')
  expect(unavailable.calls).toEqual([])
  expect(await f.account.setGateway(manualOrigin as GatewayId, true)).toMatchObject({ ok: false, error: 'server' })
  expect(await f.account.getGateways()).toMatchObject({ ok: true, data: { selected: manualOrigin, active: null } })
  expect((await f.account.getState()).models).toEqual([])
  expect(await f.account.setGateway(null, false)).toMatchObject({ ok: true, data: { selected: null, active: f.origin } })
  expect(unavailable.calls).toHaveLength(1)
})
