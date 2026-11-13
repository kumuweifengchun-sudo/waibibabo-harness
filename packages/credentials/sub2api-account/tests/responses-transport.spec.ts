/** Loopback WS/SSE behavior, incremental history, uncertain outcomes and account ownership. */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { BlockAssembler, createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ResponsesTransport } from '../src/responses-transport.ts'
import { Config } from '../src/config.ts'
import { accountFixture } from './account-fixture.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })
type Frame = Record<string, unknown> & { input?: unknown[] }

function responseItem(id: string) {
  return { id: `msg_${id}`, type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'WS reply', annotations: [], logprobs: [] }] }
}

function complete(socket: WebSocket, id: string) {
  const item = responseItem(id)
  const content = item.content[0]
  socket.send(JSON.stringify({ type: 'response.created', response: { id, status: 'in_progress', output: [] } }))
  socket.send(JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }))
  socket.send(JSON.stringify({ type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0,
    part: { ...content, text: '' } }))
  socket.send(JSON.stringify({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'WS reply' }))
  socket.send(JSON.stringify({ type: 'response.output_item.done', output_index: 0, item }))
  socket.send(JSON.stringify({ type: 'response.completed', response: { id, status: 'completed', output: [responseItem(id)],
    usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 } } }))
}

function attach(server: Server, handle: (socket: WebSocket, body: Frame) => void) {
  const sockets: WebSocket[] = []
  const requests: IncomingMessage[] = []
  const frames: Frame[] = []
  const failures: unknown[] = []
  const ws = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    requests.push(request)
    ws.handleUpgrade(request, socket, head, (connection) => {
      sockets.push(connection)
      connection.on('message', (data) => {
        try {
          const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
          const body = JSON.parse(buffer.toString('utf8')) as Frame
          frames.push(body)
          handle(connection, body)
        } catch (error) { failures.push(error); connection.terminate() }
      })
    })
  })
  cleanups.push(async () => {
    for (const socket of sockets) socket.terminate()
    await new Promise<void>((resolve) => { ws.close(() => { resolve() }) })
    expect(failures).toEqual([])
  })
  return { sockets, requests, frames }
}

async function fixture(handle: (socket: WebSocket, body: Frame) => void = (socket) => { complete(socket, 'resp_one') },
  options: Partial<Config> = {}) {
  const posts: unknown[] = []
  const failures: unknown[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      posts.push(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: {"type":"http-fixture"}\n\n')
    })().catch((error: unknown) => { failures.push(error); response.destroy() })
  })
  cleanups.push(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
    expect(failures).toEqual([])
  })
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture did not bind')
  const baseURL = `http://127.0.0.1:${address.port}/v1`
  const transport = new ResponsesTransport(Config({ platformOrigin: baseURL, productName: 'WS fixture', ...options }), new AbortController().signal)
  const ws = attach(server, handle)
  cleanups.push(() => transport.dispose())
  const call = (body: object, session = 'session-one', signal?: AbortSignal, key = 'inference-lease') =>
    transport.fetchFor(baseURL, session)(baseURL + '/responses', { method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.1', stream: true, store: false, ...body }),
      ...signal === undefined ? {} : { signal } })
  return { ...ws, server, transport, posts, call }
}

it('reuses the connection and sends only new input after a matching completed response', async () => {
  const f = await fixture()
  const first = { role: 'user', content: 'a'.repeat(20000) }
  const next = { role: 'user', content: 'next' }
  await (await f.call({ input: [first] })).text()
  await (await f.call({ input: [first, responseItem('resp_one'), next] })).text()
  expect(f.requests).toHaveLength(1)
  expect(f.requests[0]?.headers.authorization).toBe('Bearer inference-lease')
  expect(f.frames[1]).toMatchObject({ type: 'response.create', previous_response_id: 'resp_one', input: [next], store: false })
  expect(f.frames[0]).not.toHaveProperty('stream')
  expect(JSON.stringify(f.frames[1]).length).toBeLessThan(JSON.stringify(f.frames[0]).length / 10)
  expect(f.posts).toEqual([])
})

it('sends complete input after compaction, changed options, another session or a rotated key', async () => {
  const f = await fixture()
  await (await f.call({ input: [{ role: 'user', content: 'old' }] })).text()
  await (await f.call({ input: [{ role: 'user', content: 'compacted' }] })).text()
  await (await f.call({ input: [{ role: 'user', content: 'compacted' }, responseItem('resp_one')], model: 'gpt-other' })).text()
  await (await f.call({ input: [] }, 'session-two')).text()
  await (await f.call({ input: [] }, 'session-two', undefined, 'new-lease')).text()
  expect(f.frames.every(body => body.previous_response_id === undefined)).toBe(true)
  expect(f.requests).toHaveLength(3)
})

it('replays full history once when the connection explicitly rejects a missing previous response', async () => {
  const f = await fixture((socket, body) => {
    if (body.previous_response_id) socket.send(JSON.stringify({ type: 'error', status: 400, error: { code: 'previous_response_not_found' } }))
    else complete(socket, 'resp_one')
  })
  const first = { role: 'user', content: 'hello' }
  await (await f.call({ input: [first] })).text()
  const input = [first, responseItem('resp_one'), { role: 'user', content: 'again' }]
  await (await f.call({ input })).text()
  expect(f.frames).toHaveLength(3)
  expect(f.frames[1]).toHaveProperty('previous_response_id', 'resp_one')
  expect(f.frames[2]).toMatchObject({ input })
  expect(f.frames[2]).not.toHaveProperty('previous_response_id')
  expect(f.posts).toEqual([])
})

it.each([404, 426, 502])('falls back before submission for handshake HTTP %s and caches the failure', async (status) => {
  const f = await fixture()
  f.server.removeAllListeners('upgrade')
  let upgrades = 0
  f.server.on('upgrade', (_request, socket) => {
    upgrades++
    socket.end(`HTTP/1.1 ${status} Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
  })
  const input = [{ role: 'user', content: 'hello' }]
  expect(await (await f.call({ input })).text()).toContain('http-fixture')
  await (await f.call({ input })).text()
  expect(upgrades).toBe(1)
  expect(f.posts).toEqual([{ model: 'gpt-5.1', stream: true, store: false, input }, { model: 'gpt-5.1', stream: true, store: false, input }])
})

it('does not retry an authentication rejection as HTTP', async () => {
  const f = await fixture()
  f.server.removeAllListeners('upgrade')
  f.server.on('upgrade', (_request, socket) => { socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n') })
  expect((await f.call({ input: [] })).status).toBe(401)
  expect(f.posts).toEqual([])
})

it('does not replay an uncertain request when the socket closes after submission', async () => {
  const f = await fixture((socket) => { socket.terminate() })
  await expect((await f.call({ input: [] })).text()).rejects.toThrow('无法确认是否完成')
  expect(f.frames).toHaveLength(1)
  expect(f.posts).toEqual([])
})

it('cancels an active stream and closes all connections on disposal', async () => {
  const received = Promise.withResolvers<undefined>()
  const f = await fixture((socket) => { socket.send(JSON.stringify({ type: 'response.created' })); received.resolve(undefined) })
  const abort = new AbortController()
  const body = await f.call({ input: [] }, 'session-one', abort.signal)
  const rejected = expect(body.text()).rejects.toMatchObject({ name: 'AbortError' })
  await received.promise
  abort.abort()
  await rejected
  await f.transport.dispose()
  expect(f.posts).toEqual([])
  await expect(f.call({ input: [] })).rejects.toMatchObject({ name: 'AbortError' })
})

it('keeps concurrent requests on separate sockets and retires routes without interrupting accepted work', async () => {
  const received = Promise.withResolvers<undefined>()
  let count = 0
  const f = await fixture((socket) => {
    socket.send(JSON.stringify({ type: 'response.created' }))
    if (++count === 2) received.resolve(undefined)
  })
  const first = await f.call({ input: [] })
  const second = await f.call({ input: [] })
  const reads = Promise.all([first.text(), second.text()])
  await received.promise
  expect(f.sockets).toHaveLength(2)
  f.transport.clear()
  for (const socket of f.sockets) complete(socket, 'resp_parallel')
  expect(await reads).toHaveLength(2)
  await f.transport.dispose()
  expect(f.posts).toEqual([])
})

it('honors an explicit HTTP setting without opening a socket', async () => {
  const f = await fixture(undefined, { responsesTransport: 'sse' })
  await (await f.call({ input: [] })).text()
  expect(f.requests).toEqual([])
  expect(f.posts).toHaveLength(1)
})

it('uses full HTTP input when the gateway explicitly confirms it has not forwarded the WS request', async () => {
  const f = await fixture((socket) => {
    socket.send(JSON.stringify({ type: 'error', status: 503, error: { code: 'websocket_unavailable', http_fallback: true } }))
  })
  const input = [{ role: 'user', content: 'hello' }]
  expect(await (await f.call({ input })).text()).toContain('http-fixture')
  expect(f.posts).toEqual([{ model: 'gpt-5.1', stream: true, store: false, input }])
  expect(f.requests[0]?.headers['x-wss-transport-fallback']).toBe('sse')
})

it('does not accept a fallback permission after the server starts a response', async () => {
  const f = await fixture((socket) => {
    socket.send(JSON.stringify({ type: 'response.created' }))
    socket.send(JSON.stringify({ type: 'error', error: { code: 'websocket_unavailable', http_fallback: true } }))
  })
  expect(await (await f.call({ input: [] })).text()).toContain('websocket_unavailable')
  expect(f.posts).toEqual([])
})

it('uses leased credentials, decodes Responses through the SDK and preserves continuation through real account composition', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'] })
  const ws = attach(f.server, (socket) => { complete(socket, 'resp_one') })
  await f.account.signInWithPassword('user@example.com', 'fake-password')
  const run = async (messages: readonly Message[]) => {
    const assembler = new BlockAssembler()
    for await (const chunk of f.context.llm.stream({ provider: 'sub2api-u7-g3', model: 'gpt-5.1',
      sessionId: SessionId('ws-account'), messages: [...messages] })) assembler.push(chunk)
    return assembler
  }
  const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] })
  const first = await run([input])
  expect(first.finish, JSON.stringify(first.finish)).toMatchObject({ kind: 'stop' })
  expect(first.usage).toMatchObject({ inputTokens: 9, outputTokens: 2 })
  const assistant = first.message({ provider: 'sub2api-u7-g3', model: 'gpt-5.1',
    ...first.replayState === undefined ? {} : { replayState: first.replayState } })
  const next = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] })
  expect((await run([input, assistant, next])).finish).toMatchObject({ kind: 'stop' })
  expect(ws.requests).toHaveLength(1)
  expect(ws.frames[1]).toMatchObject({ previous_response_id: 'resp_one', input: [{ role: 'user' }] })
  expect(ws.requests[0]?.headers.authorization).toBe('Bearer short-inference-key')
  expect(f.requests.filter(request => request.path === '/v1/responses')).toEqual([])
  await f.account.signOut()
})

it('reports a submitted WS interruption as a non-retryable SDK outcome', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'] })
  const ws = attach(f.server, (socket) => { socket.terminate() })
  await f.account.signInWithPassword('user@example.com', 'fake-password')
  const assembler = new BlockAssembler()
  for await (const chunk of f.context.llm.stream({ provider: 'sub2api-u7-g3', model: 'gpt-5.1', messages: [] })) assembler.push(chunk)
  expect(assembler.finish).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
  expect(JSON.stringify(assembler.finish)).toContain('无法确认是否完成')
  expect(ws.frames).toHaveLength(1)
  expect(f.requests.filter(request => request.path === '/v1/responses')).toEqual([])
})

it('falls back when a gateway never completes its WS handshake', async () => {
  const f = await fixture(undefined, { connectionProbeTimeoutMs: 100 })
  f.server.removeAllListeners('upgrade')
  f.server.on('upgrade', (_request, socket) => {
    socket.on('error', () => {})
    socket.on('end', () => { socket.destroy() })
    cleanups.push(async () => { socket.destroy() })
    socket.resume()
  })
  expect(await (await f.call({ input: [] })).text()).toContain('http-fixture')
  expect(f.posts).toHaveLength(1)
})

it('reports malformed WS events without replaying the request', async () => {
  const f = await fixture((socket) => { socket.send('invalid-json') })
  await expect((await f.call({ input: [] })).text()).rejects.toThrow('无法识别的数据')
  expect(f.posts).toEqual([])
})

it('continues with tool results after the SDK omits output status and normalizes argument whitespace', async () => {
  const item = { type: 'function_call', id: 'fc_one', call_id: 'call_one', name: 'read_file', status: 'completed', arguments: '{ "path": "a.txt" }' }
  const f = await fixture((socket) => {
    socket.send(JSON.stringify({ type: 'response.completed', response: { id: 'resp_tool', output: [item] } }))
  })
  const input = { role: 'user', content: 'read a file' }
  await (await f.call({ input: [input] })).text()
  const { status: _status, ...replay } = item
  const result = { type: 'function_call_output', call_id: item.call_id, output: 'contents' }
  await (await f.call({ input: [input, { ...replay, arguments: '{"path":"a.txt"}' }, result] })).text()
  expect(f.frames[1]).toMatchObject({ previous_response_id: 'resp_tool', input: [result] })
})
