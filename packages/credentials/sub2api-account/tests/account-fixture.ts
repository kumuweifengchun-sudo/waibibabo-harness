/** Real Loader composition against an isolated HTTP platform, without external credentials. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect } from 'vitest'
import { WebSocketServer } from 'ws'
import { boot } from '@deepseek-ai/dsh-app-boot'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import Account from '../src/index.ts'
import type { ModelProtocolChoice } from '../src/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

/** @returns isolated local platform and account Host, cleaned up after the owning test. */
export async function accountFixture(options: {
  issuerOrigin?: string
  accountOrigins?: string[]
  protocol?: ModelProtocolChoice
  responsesTransport?: 'auto' | 'sse'
  webSocket?: boolean
  models?: string[]
  groups?: Array<{ id: number; name: string; platform: string }>
  platform?: string
  feature?: (request: IncomingMessage, response: ServerResponse, body: Buffer) => boolean | Promise<boolean> } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'waibibabo-account-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const requests: Array<{
    path: string
    query: string
    authorization: string | undefined
    apiKey: string | string[] | undefined
    googleKey: string | string[] | undefined
    body: Record<string, unknown>
  }> = []
  let authorization: Record<string, string> = {}
  let tokenGeneration = 1
  let initialTokenLifetime = 600
  let twoFactor = false
  let holdExchange = false
  let rejectProfile = false
  let profileFailure = false
  let userId = 7
  let replyText = 'Platform model connected.'
  let usageFailure = 0
  let groups = options.groups ?? [{ id: 3, name: 'Standard', platform: options.platform ?? 'openai' }]
  const exchangeStarted = Promise.withResolvers<undefined>()
  const releaseExchange = Promise.withResolvers<undefined>()
  const response = (res: ServerResponse, data: unknown, envelope = true) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(envelope ? { code: 0, data } : data))
  }
  const tokens = () => ({ access_token: `desktop-access-${tokenGeneration}`, refresh_token: `desktop-refresh-${tokenGeneration}`, token_type: 'Bearer', scope: 'desktop', expires_in: tokenGeneration === 1 ? initialTokenLifetime : 600 })
  const responses = (body: Record<string, unknown>) => {
    const events: object[] = []
    const content = { type: 'output_text', text: replyText, annotations: [] }
    const item = { id: 'message-1', type: 'message', role: 'assistant', status: 'completed', content: [content] }
    const responseBody = { id: 'response-1', object: 'response', model: body.model, status: 'completed', output: [item],
      usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } }
    events.push({ type: 'response.created', response: { ...responseBody, status: 'in_progress', output: [] } })
    events.push({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
    events.push({ type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { ...content, text: '' } })
    events.push({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: replyText })
    events.push({ type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: replyText })
    events.push({ type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part: content })
    events.push({ type: 'response.output_item.done', output_index: 0, item })
    events.push({ type: 'response.completed', response: responseBody })
    return events
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.upgrade?.toLowerCase() === 'websocket') { res.writeHead(426).end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
    const raw = Buffer.concat(chunks)
    const text = raw.toString('utf8')
    const body: Record<string, unknown> = text === '' || req.headers['content-type']?.includes('multipart/form-data') ? {} : req.headers['content-type']?.includes('application/x-www-form-urlencoded')
      ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text) as Record<string, unknown>
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    requests.push({ path, query: url.search, authorization: req.headers.authorization,
      apiKey: req.headers['x-api-key'], googleKey: req.headers['x-goog-api-key'], body })
    if (await options.feature?.(req, res, raw)) return
    if (path === '/api/v1/desktop/oauth/configuration') {
      const issuer = options.issuerOrigin ?? origin
      response(res, { resource: issuer + '/api/v1/desktop', scope: 'desktop',
        authorization_endpoint: issuer + '/oauth/desktop/authorize', registration_endpoint: issuer + '/api/v1/desktop/oauth/register',
        token_endpoint: issuer + '/api/v1/desktop/oauth/token', revocation_endpoint: issuer + '/api/v1/desktop/oauth/revoke' }, false)
      return
    }
    if (path === '/api/v1/desktop/oauth/register') {  response(res, { client_id: 'registered-desktop' }, false); return }
    if (path === '/api/v1/auth/login') {  response(res, twoFactor ? { requires_2fa: true, temp_token: 'two-factor-session' } : { access_token: 'browser-login', refresh_token: 'browser-refresh' }); return }
    if (path === '/api/v1/auth/login/2fa') {  response(res, { access_token: 'browser-login', refresh_token: 'browser-refresh' }); return }
    if (path === '/api/v1/user/desktop/authorize') {
      authorization = body.authorization as Record<string, string>
      const url = new URL(authorization.redirect_uri!)
      url.searchParams.set('state', authorization.state!)
      url.searchParams.set('code', 'one-use-code')
      response(res, { redirect_url: url.toString() }); return
    }
    if (path === '/api/v1/desktop/oauth/token') {
      if (body.grant_type === 'authorization_code') {
        exchangeStarted.resolve(undefined)
        if (holdExchange) await releaseExchange.promise
        if (Object.keys(authorization).length) {
          expect(createHash('sha256').update(String(body.code_verifier)).digest('base64url')).toBe(authorization.code_challenge)
        }
      } else tokenGeneration++
      response(res, tokens(), false); return
    }
    if (path === '/api/v1/auth/logout') {  response(res, null); return }
    if (path === '/api/v1/desktop/oauth/revoke') { res.writeHead(200).end(); return }
    if (path === '/api/v1/desktop/profile') {
      if (rejectProfile || profileFailure) { res.statusCode = rejectProfile ? 401 : 503;  response(res, { error: 'unavailable' }, false); return }
      response(res, { id: userId, email: 'user@example.com', username: 'Platform user', balance: 12.5 }); return
    }
    if (path === '/api/v1/desktop/groups') { response(res, groups); return }
    if (path === '/api/v1/desktop/gateways') { response(res, { api_base_url: origin, custom_endpoints: [] }); return }
    if (path === '/api/v1/desktop/usage') {  response(res, { today_requests: 5, today_actual_cost: 0.25, total_requests: 50, total_actual_cost: 2.5 }); return }
    if (path.startsWith('/api/v1/desktop/usage/')) {
      if (usageFailure) { res.statusCode = usageFailure; response(res, { error: 'unavailable' }, false); return }
      if (path.endsWith('/stats')) {
        response(res, { total_requests: 21, total_tokens: 1000, total_actual_cost: 3.75 })
        return
      }
      const page = Number(url.searchParams.get('page') ?? 1)
      response(res, { page, page_size: 20, total: 21, pages: 2, items: [{
        id: 18 + page, created_at: '2026-11-12T08:00:00Z', request_id: 'request-19', model: 'gpt-5',
        group: { name: 'Standard' }, api_key: { name: 'Desktop', key: 'must-not-reach-client' },
        inbound_endpoint: '/v1/responses', input_tokens: 100, output_tokens: 50, cache_read_tokens: 30, cache_creation_tokens: 20,
        input_cost: 0.1, output_cost: 0.2, cache_read_cost: 0.01, cache_creation_cost: 0.02,
        total_cost: 0.33, actual_cost: 0.165, rate_multiplier: 0.5, duration_ms: 1500, first_token_ms: 250,
        stream: true, billing_type: 0, image_count: 0, account_id: 999, upstream_secret: 'must-not-reach-client',
      }] })
      return
    }
    if (path === '/api/v1/desktop/key') {  response(res, { id: 19, group_id: body.group_id, key: 'short-inference-key', expires_at: new Date(Date.now() + 600000).toISOString() }); return }
    if (path === '/v1/models') {
      response(res, { data: (options.models ?? ['relay-model']).map(id => ({ id, context_window: 32768, max_output_tokens: 4096 })) }, false)
      return
    }
    const event = (data: object) => { res.write(`data: ${JSON.stringify(data)}\n\n`) }
    if (path === '/v1/responses') {
      res.setHeader('Content-Type', 'text/event-stream')
      for (const value of responses(body)) event(value)
      res.end()
      return
    }
    if (path === '/v1/messages') {
      res.setHeader('Content-Type', 'text/event-stream')
      const events = [
        { type: 'message_start', message: { id: 'message-1', type: 'message', role: 'assistant', model: body.model,
          content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: replyText } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ]
      for (const entry of events) res.write(`event: ${entry.type}\ndata: ${JSON.stringify(entry)}\n\n`)
      res.end()
      return
    }
    if (path.startsWith('/v1beta/models/') && path.endsWith(':streamGenerateContent')) {
      res.setHeader('Content-Type', 'text/event-stream')
      event({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: replyText }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 } })
      res.end()
      return
    }
    if (path === '/v1/chat/completions') {
      res.setHeader('Content-Type', 'text/event-stream')
      for (const chunk of [
        { id: 'reply', object: 'chat.completion.chunk', model: 'relay-model', choices: [{ index: 0, delta: { role: 'assistant', content: replyText }, finish_reason: null }] },
        { id: 'reply', object: 'chat.completion.chunk', model: 'relay-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } },
      ]) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      res.end('data: [DONE]\n\n')
      return
    }
    res.writeHead(404).end()
  }
  const failures: unknown[] = []
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      failures.push(error)
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  cleanups.push(async () => {
    releaseExchange.resolve(undefined)
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
    expect(failures).toEqual([])
  })
  const wsRequests: Record<string, unknown>[] = []
  if (options.webSocket) {
    const websocket = new WebSocketServer({ server })
    websocket.on('connection', (socket, request) => {
      socket.on('message', (data) => {
        try {
          const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
          const body = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
          wsRequests.push(body)
          requests.push({ path: '/v1/responses', query: '', authorization: request.headers.authorization,
            apiKey: undefined, googleKey: undefined, body })
          for (const value of responses(body)) socket.send(JSON.stringify(value))
        } catch (error) { failures.push(error); socket.terminate() }
      })
    })
    cleanups.push(async () => {
      for (const socket of websocket.clients) socket.terminate()
      await new Promise<void>((resolve) => { websocket.close(() => { resolve() }) })
    })
  }
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'credentials', name: 'cordis:test-credentials', config: { path: join(home, 'credentials.yaml'), watch: false } },
    { id: 'web', name: 'cordis:test-web', config: { host: '127.0.0.1', port: 0 } },
    { id: 'llm', name: 'cordis:test-llm' },
    { id: 'account', name: 'cordis:test-account', config: { platformOrigin: options.issuerOrigin ?? origin,
      accountOrigins: options.accountOrigins ?? (options.issuerOrigin === undefined ? [] : [origin]), productName: 'Waibibabo',
      allowLoopbackHttp: true, protocol: options.protocol ?? 'openai-completions', responsesTransport: options.responsesTransport ?? 'auto' } },
  ]) + '\n')
  const context = await boot('sub2api-account-test', configPath, [], (host) => {
    host.loader.builtins['test-credentials'] = LocalCredentialProvider
    host.loader.builtins['test-web'] = WebServer
    host.loader.builtins['test-llm'] = LlmRuntime
    host.loader.builtins['test-account'] = Account
  })
  cleanups.push(async () => { releaseExchange.resolve(undefined); await context.fiber.dispose() })
  return { context, account: context.sub2apiAccount, home, origin, server, requests, wsRequests, exchangeStarted, releaseExchange,
    requireTwoFactor: () => { twoFactor = true }, holdExchange: () => { holdExchange = true },
    rejectProfile: () => { rejectProfile = true }, failProfile: () => { profileFailure = true },
    useOtherUser: () => { userId = 8 },
    expireInitialToken: () => { initialTokenLifetime = 1 },
    setReply: (reply: string) => { replyText = reply },
    setGroups: (values: typeof groups) => { groups = values },
    failUsage: (status: number) => { usageFailure = status },
    authorization: () => authorization,
  }
}
