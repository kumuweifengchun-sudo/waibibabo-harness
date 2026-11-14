/** Recorded-session fixture with real Responses sockets and an isolated gateway. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { WebSocketServer } from 'ws'
import { Config } from '../../src/config.ts'
import { ResponsesTransport } from '../../src/responses-transport.ts'

export const name = 'snapshot-sub2api-responses-recovery'
export const inject = ['llm']

/** Verify the account transport before the recorded model response enters the Session. */
export function apply(ctx: Context): void {
  ctx.on('llm/stream', async function* (_request, next) {
    const frames: Record<string, unknown>[] = []
    const posts: unknown[] = []
    const failures: unknown[] = []
    const terminal = JSON.stringify({ type: 'response.completed', response: { id: 'resp_fixture', output: [] } })
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          const bytes: unknown = chunk
          assert.ok(Buffer.isBuffer(bytes))
          chunks.push(bytes)
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        posts.push(body)
        response.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${terminal}\n\n`)
      })().catch((error: unknown) => { failures.push(error); response.destroy() })
    })
    const sockets = new WebSocketServer({ server })
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        try {
          const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
          const body = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
          frames.push(body)
          if (body.previous_response_id !== undefined || frames.length === 3) {
            socket.close(1011, 'upstream websocket proxy failed')
          } else socket.send(terminal)
        } catch (error) { failures.push(error); socket.terminate() }
      })
    })
    let transport: ResponsesTransport | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      const address = server.address()
      assert.ok(address !== null && typeof address !== 'string')
      const origin = `http://127.0.0.1:${address.port}`
      transport = new ResponsesTransport(Config({ platformOrigin: origin, productName: 'Snapshot', allowLoopbackHttp: true }),
        AbortSignal.timeout(5000))
      const firstInput = [{ role: 'user', content: 'default SSE' }]
      const firstBody = { model: 'fixture', stream: true, store: false, input: firstInput }
      const defaultFetch = transport.fetchFor(origin + '/v1', 'snapshot-session')
      const first = await defaultFetch(origin + '/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(firstBody) })
      assert.match(await first.text(), /response.completed/u)
      assert.deepEqual(posts, [firstBody])
      assert.equal(frames.length, 0)
      const reported: LlmError[] = []
      const fetch = transport.fetchFor(origin + '/v1', 'snapshot-session', (failure) => { reported.push(failure) }, 'websocket')
      const input: Array<{ role: string; content: string }> = []
      const call = () => fetch(origin + '/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'fixture', stream: true, store: false, input }) })
      input.push({ role: 'user', content: 'first' })
      assert.match(await (await call()).text(), /response.completed/u)
      input.push({ role: 'user', content: 'second' })
      assert.match(await (await call()).text(), /response.completed/u)
      assert.deepEqual(frames[1]?.input, input)
      assert.equal(frames[1]?.previous_response_id, undefined)
      input.push({ role: 'user', content: 'interrupted' })
      await assert.rejects((await call()).text(), (error: unknown) => error instanceof LlmError && error.code === 'TRANSPORT')
      assert.equal(reported.length, 1)
      assert.match(reported[0]!.message, /1011: upstream websocket proxy failed/u)
      assert.equal(posts.length, 1)
      input.push({ role: 'user', content: 'continue' })
      assert.match(await (await call()).text(), /response.completed/u)
      assert.equal(frames.length, 3)
      assert.deepEqual(posts, [firstBody, { model: 'fixture', stream: true, store: false, input }])
      assert.deepEqual(failures, [])
    } finally {
      await transport?.dispose()
      for (const socket of sockets.clients) socket.terminate()
      await new Promise<void>((resolve) => { sockets.close(() => { resolve() }) })
      server.closeAllConnections()
      if (server.listening) {
        await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
      }
    }
    yield* next()
  })
}
