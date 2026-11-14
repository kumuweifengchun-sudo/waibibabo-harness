/** Account-owned Responses sockets with HTTP recovery and structured model-request failures. */
import { createHash, randomUUID } from 'node:crypto'
import type { ClientRequest, IncomingMessage } from 'node:http'
import WebSocket from 'ws'
import { z } from 'zod'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.ts'
import type { ModelTransport } from './types.ts'

type Options = Required<Pick<Config, 'responsesTransport' | 'responsesIncrementalHistory' | 'connectionProbeTimeoutMs' | 'responsesSocketIdleMs'
  | 'responsesSocketLimit' | 'responsesFallbackCooldownMs'>>
const requestBody = z.looseObject({ input: z.array(z.unknown()), stream: z.literal(true) })
// Local tool calls execute only after the agent accepts a complete model response.
const replayableRequest = z.object({
  tools: z.array(z.looseObject({ type: z.enum(['function', 'custom']) })).optional(),
  background: z.literal(false).optional(),
  previous_response_id: z.null().optional(),
})
const eventBody = z.looseObject({ type: z.string(),
  error: z.looseObject({ code: z.string().optional(), http_fallback: z.boolean().optional() }).optional(),
  response: z.looseObject({ id: z.string().optional(), output: z.array(z.unknown()).optional() }).optional() })
type Body = z.infer<typeof requestBody>
interface Continuation { id: string; parameters: string; inputs: readonly string[] }
interface Connection {
  socket: WebSocket
  closed: Promise<void>
  key: string | undefined
  busy: boolean
  retired: boolean
  idle?: NodeJS.Timeout
  continuation?: Continuation
}

class HandshakeFailure extends Error {
  constructor(readonly status?: number) { super('Responses WebSocket handshake failed') }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]))
  }
  return value
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function inputDigest(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return digest(value)
  const item: Record<string, unknown> = { ...value }
  if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
    if (item.phase === null) delete item.phase
    item.content = item.content.map((part: unknown) => {
      if (part === null || typeof part !== 'object' || !('type' in part) || part.type !== 'output_text') return part
      const content: Record<string, unknown> = { ...part }
      // Token probabilities are response diagnostics, omitted by the SDK's replay messages.
      delete content.logprobs
      return content
    })
  }
  if (item.type === 'function_call' || item.type === 'custom_tool_call') {
    // The SDK replays tool calls without their server execution status.
    delete item.status
    if (item.type === 'function_call' && typeof item.arguments === 'string') {
      try { const parsed: unknown = JSON.parse(item.arguments); item.arguments = parsed } catch (error) {
        // Invalid arguments cannot be normalized; their original bytes still participate in matching.
        if (!(error instanceof SyntaxError)) throw error
      }
    }
  }
  return digest(item)
}

function parameters(body: Body): string {
  const { input: _input, stream: _stream, background: _background, previous_response_id: _previous, ...rest } = body
  return digest(rest)
}

function frame(body: Body, continuation?: Continuation): { text: string; incremental: boolean } {
  const { stream: _stream, background: _background, ...payload } = body
  const prefix = continuation?.inputs
  const incremental = body.previous_response_id === undefined && continuation !== undefined && prefix !== undefined
    && parameters(body) === continuation.parameters && body.input.length >= prefix.length
    && prefix.every((value, index) => value === inputDigest(body.input[index]))
  return { incremental, text: JSON.stringify({ ...payload, type: 'response.create',
    ...incremental ? { previous_response_id: continuation.id, input: body.input.slice(prefix.length) } : {} }) }
}

/** Owns reusable sockets and endpoint cooldowns for one account service; no credentials or history are persisted. */
export class ResponsesTransport {
  private readonly connections = new Set<Connection>()
  private readonly pool = new Map<string, Connection>()
  private readonly cooldowns = new Map<string, number>()
  private disposed = false

  /** @param options - Validated transport limits. @param lifetime - Account service lifetime. */
  constructor(private readonly options: Options, private readonly lifetime: AbortSignal) {}

  private assertActive(signal: AbortSignal): void {
    signal.throwIfAborted()
    if (this.disposed) throw new DOMException('Account transport disposed', 'AbortError')
  }

  /** Bind an SDK fetch to its selected route and Session.
   * @param baseURL - Prepared model endpoint; no account origin fallback is used.
   * @param session - Session identity; omitted requests never retain a socket.
   * @param reportFailure - Optional per-attempt observer preserving typed failures across SDK error flattening; must not throw.
   *   Omission leaves failures on the response stream.
   * @param transport - Model preference captured for this request; omission uses the deployment default.
   * @returns transport accepting the SDK's ordinary Responses payload and returning its existing SSE event format.
   */
  fetchFor(baseURL: string, session: string | undefined, reportFailure?: (failure: LlmError) => void,
    transport: ModelTransport = this.options.responsesTransport === 'sse' ? 'sse' : 'websocket'): typeof globalThis.fetch {
    return async (input, init) => {
      const request = new Request(input, init)
      const signal = AbortSignal.any([request.signal, this.lifetime])
      this.assertActive(signal)
      const url = new URL(request.url)
      const target = new URL(baseURL.replace(/\/$/u, '') + '/responses')
      if (transport === 'sse' || url.href !== target.href || request.method !== 'POST') return fetch(request, { signal })
      const body = requestBody.parse(JSON.parse(await request.clone().text()))
      const headers = new Headers(request.headers)
      for (const name of ['content-length', 'content-type', 'connection', 'upgrade', 'accept-encoding']) headers.delete(name)
      headers.set('OpenAI-Beta', 'responses_websockets=2026-02-06')
      headers.set('x-wss-transport-fallback', 'sse')
      const route = digest([url.href, [...headers]])
      const cooldown = this.cooldowns.get(route)
      if (cooldown !== undefined && cooldown > Date.now()) return fetch(request, { signal })
      this.cooldowns.delete(route)
      const unavailable = () => {
        if (this.cooldowns.size >= this.options.responsesSocketLimit) {
          const oldest = this.cooldowns.keys().next().value
          if (oldest !== undefined) this.cooldowns.delete(oldest)
        }
        this.cooldowns.set(route, Date.now() + this.options.responsesFallbackCooldownMs)
      }
      const fallback = () => {
        unavailable()
        return fetch(request, { signal })
      }
      const key = session === undefined ? undefined : digest([session, route])
      let connection: Connection
      try { connection = await this.acquire(url, headers, key, signal) } catch (error) {
        this.assertActive(signal)
        if (!(error instanceof HandshakeFailure)) throw error
        if (error.status !== undefined && ![200, 400, 404, 405, 426, 500, 501, 502, 503, 504].includes(error.status)) {
          return Response.json({ error: { message: 'WS 授权或配额检查未通过，请检查平台账号与使用限制' } }, { status: error.status })
        }
        return fallback()
      }
      return this.response(connection, body, signal, fallback, unavailable, reportFailure)
    }
  }

  /** Retire cached routes on account/group changes; already submitted requests may finish. */
  clear(): void {
    this.pool.clear()
    this.cooldowns.clear()
    for (const connection of this.connections) {
      connection.retired = true
      if (!connection.busy) connection.socket.terminate()
    }
  }

  /** Cancel active requests and wait for every socket to close before the account service releases its dependencies. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.clear()
    const closing = [...this.connections]
    for (const connection of closing) connection.socket.terminate()
    await Promise.all(closing.map(connection => connection.closed))
  }

  private async acquire(url: URL, headers: Headers, key: string | undefined, signal: AbortSignal): Promise<Connection> {
    this.assertActive(signal)
    const cached = key === undefined ? undefined : this.pool.get(key)
    if (cached !== undefined && !cached.busy && cached.socket.readyState === WebSocket.OPEN) {
      cached.busy = true
      clearTimeout(cached.idle)
      try {
        await this.probe(cached.socket, signal)
        this.assertActive(signal)
      } catch (error) { this.release(cached, false); throw error }
      return cached
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { headers: Object.fromEntries(headers), followRedirects: false,
      handshakeTimeout: this.options.connectionProbeTimeoutMs })
    const closed = Promise.withResolvers<void>()
    const connection: Connection = { socket, closed: closed.promise, key, busy: true, retired: cached?.busy === true }
    this.connections.add(connection)
    socket.on('error', () => {
      // Active operations own diagnostics; idle errors only invalidate the connection.
      if (!connection.busy) socket.terminate()
    })
    socket.once('close', () => {
      clearTimeout(connection.idle)
      this.connections.delete(connection)
      if (key !== undefined && this.pool.get(key) === connection) this.pool.delete(key)
      closed.resolve()
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.off('open', opened); socket.off('error', failed); socket.off('close', failed)
          socket.off('unexpected-response', rejected); signal.removeEventListener('abort', aborted)
        }
        const opened = () => { cleanup(); resolve() }
        const failed = () => { cleanup(); reject(new HandshakeFailure()) }
        const aborted = () => { cleanup(); reject(new DOMException('Request aborted', 'AbortError')); socket.terminate() }
        const rejected = (_request: ClientRequest, response: IncomingMessage) => {
          cleanup(); response.resume(); reject(new HandshakeFailure(response.statusCode)); socket.terminate()
        }
        socket.once('open', opened); socket.once('error', failed); socket.once('close', failed)
        socket.once('unexpected-response', rejected); signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
      })
      this.assertActive(signal)
    } catch (error) { socket.terminate(); throw error }
    if (key !== undefined && this.pool.has(key)) connection.retired = true
    if (key !== undefined && !connection.retired) {
      if (this.pool.size >= this.options.responsesSocketLimit) {
        const idle = [...this.pool.values()].find(value => !value.busy)
        if (idle?.key !== undefined) { this.pool.delete(idle.key); idle.retired = true; idle.socket.terminate() }
      }
      if (this.pool.size < this.options.responsesSocketLimit) this.pool.set(key, connection)
      else connection.retired = true
    }
    return connection
  }

  /** Verify that a retained connection responds before submitting another model request. */
  private probe(socket: WebSocket, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const payload = Buffer.from(randomUUID())
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('pong', pong); socket.off('close', failed); socket.off('error', failed)
        signal.removeEventListener('abort', aborted)
      }
      const failed = () => { cleanup(); reject(new HandshakeFailure()) }
      const aborted = () => { cleanup(); reject(new DOMException('Request aborted', 'AbortError')) }
      const pong = (received: Buffer) => { if (received.equals(payload)) { cleanup(); resolve() } }
      const timer = setTimeout(failed, this.options.connectionProbeTimeoutMs)
      timer.unref()
      socket.on('pong', pong); socket.once('close', failed); socket.once('error', failed)
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
      else if (socket.readyState !== WebSocket.OPEN) failed()
      else {
        socket.resume()
        try { socket.ping(payload, true, (error?: Error) => { if (error) failed() }) } catch { failed() }
      }
    })
  }

  private release(connection: Connection, success: boolean): void {
    connection.busy = false
    if (!success || connection.retired || connection.key === undefined || this.disposed
      || connection.socket.readyState !== WebSocket.OPEN) { connection.socket.terminate(); return }
    connection.idle = setTimeout(() => { connection.socket.terminate() }, this.options.responsesSocketIdleMs)
    connection.idle.unref()
  }

  private async response(connection: Connection, body: Body, signal: AbortSignal,
    fallback: () => Promise<Response>, unavailable: () => void, reportFailure?: (failure: LlmError) => void): Promise<Response> {
    const socket = connection.socket
    const ready = Promise.withResolvers<'ws' | 'http'>()
    let cancel = () => { this.release(connection, false) }
    const initial = frame(body, this.options.responsesIncrementalHistory ? connection.continuation : undefined)
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let settled = false
        let observed = false
        let recovered = false
        const finish = (error?: Error, outcome: 'complete' | 'error' | 'cancelled' | 'fallback' = 'error') => {
          if (settled) return
          settled = true
          socket.off('message', message); socket.off('close', closed); socket.off('error', lost)
          signal.removeEventListener('abort', aborted)
          if (outcome !== 'cancelled') { if (error) controller.error(error); else controller.close() }
          this.release(connection, outcome === 'complete')
          ready.resolve(outcome === 'fallback' ? 'http' : 'ws')
        }
        const aborted = () => { finish(new DOMException('Request aborted', 'AbortError')) }
        const interrupted = (detail: string, transient = true) => {
          if (settled) return
          if (signal.aborted || this.disposed) { aborted(); return }
          unavailable()
          const failure = transient && replayableRequest.safeParse(body).success
            ? new LlmError(`WS 连接中断（${detail}）；可重试当前模型请求，上游生成和计费状态未知`, 'TRANSPORT')
            : LlmError.fromFailure({ message: `WS 请求已提交，但无法确认是否完成（${detail}）；请查看平台使用日志后重试`, code: 'RESPONSES_OUTCOME_UNKNOWN' })
          reportFailure?.(failure)
          finish(failure)
        }
        const closed = (code: number, reason: Buffer) => {
          const detail = reason.toString('utf8').replace(/[\r\n\t]/gu, ' ').trim()
          interrupted(detail ? `${code}: ${detail}` : String(code), [1000, 1001, 1005, 1006, 1011, 1012, 1013].includes(code))
        }
        const lost = (error: unknown) => { interrupted(error instanceof Error ? error.message : '连接中断') }
        const send = (text: string) => {
          if (socket.readyState !== WebSocket.OPEN) { finish(undefined, 'fallback'); return }
          try { socket.send(text, (error) => { if (error) lost(error) }) } catch (error) {
            // A synchronous send failure cannot establish whether any request bytes reached the gateway.
            lost(error)
          }
        }
        const message = (data: WebSocket.RawData, binary: boolean) => {
          if (settled) return
          let value: unknown
          try {
            const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
            value = binary ? undefined : JSON.parse(buffer.toString('utf8'))
          } catch (error) {
            if (!(error instanceof SyntaxError)) { finish(new Error('WS 响应无法读取')); return }
          }
          const parsed = eventBody.safeParse(value)
          if (!parsed.success) { finish(new Error('WS 返回了无法识别的数据，请检查平台使用日志后重试')); return }
          try {
            const event = parsed.data
            if (!observed && event.type === 'error' && event.error?.code === 'websocket_unavailable' && event.error.http_fallback === true) {
              finish(undefined, 'fallback')
              return
            }
            if (!observed && event.type === 'error' && event.error?.code === 'websocket_connection_limit_reached') {
              finish(undefined, 'fallback')
              return
            }
            if (event.type === 'error' && event.error?.code === 'previous_response_not_found'
              && initial.incremental && !observed && !recovered) {
              recovered = true
              delete connection.continuation
              send(frame(body).text)
              return
            }
            observed = true
            ready.resolve('ws')
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
            if (event.type === 'response.completed') {
              const result = event.response
              if (this.options.responsesIncrementalHistory && result?.id !== undefined && result.output !== undefined) {
                connection.continuation = { id: result.id, parameters: parameters(body),
                  inputs: [...body.input, ...result.output].map(inputDigest) }
              } else delete connection.continuation
              finish(undefined, 'complete')
            } else if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) finish()
            else if ((controller.desiredSize ?? 1) <= 0) socket.pause()
          } catch { finish(new Error('WS 响应无法处理，请检查平台使用日志后重试')) }
        }
        cancel = () => { finish(undefined, 'cancelled') }
        socket.on('message', message); socket.on('close', closed); socket.on('error', lost)
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
        else send(initial.text)
      },
      pull: () => { socket.resume() },
      cancel: () => { cancel() },
    })
    const mode = await ready.promise
    return mode === 'http' ? fallback() : new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}
