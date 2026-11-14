/** One bounded PKCE attempt and its loopback callback registration. */
import { createHash, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'
import { AccountError, PlatformClient, parse } from './http.ts'
import type { Config } from './config.ts'
import type { AccountFailure } from './types.ts'
import { authorizationPage } from './authorization-page.ts'

/** Private attempt state; only authorizationUrl is sent to the renderer. */
export interface SignInAttempt {
  readonly signal: AbortSignal
  readonly verifier: string
  readonly redirectUri: string
  readonly clientId: string
  readonly authorizationUrl: string
  readonly authorization: Record<string, string>
  committing: boolean
  tempToken?: string
  running: Promise<void> | undefined
  /** Register the native public client at the configured issuer. */
  initialize(): Promise<void>
  /** Exchange the one callback admitted by this attempt. */
  accept(url: URL): Promise<void>
  /** Remove callbacks, timers and request authority. */
  close(): void
}

/** Create a deadline-bound authorization attempt before contacting the issuer.
 * @param ctx - Host owning the loopback HTTP route.
 * @param http - issuer-bound HTTP client.
 * @param config - validated client identity and deadline.
 * @param actions - credential commit and sanitized failure owners.
 * @returns the private attempt; its owner closes it on success, cancellation or disposal.
 */
export function createAttempt(ctx: Context, http: PlatformClient, config: ReturnType<typeof Config>, actions: {
  complete: (attempt: SignInAttempt, code: string) => Promise<void>
  failed: (attempt: SignInAttempt, error: AccountFailure) => void
}): SignInAttempt {
  const callback = new URL('/oauth/sub2api/callback', ctx.webServer.getOrigin())
  if (callback.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(callback.hostname) || !callback.port) throw new AccountError('protocol')
  const controller = new AbortController()
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  let clientId = ''
  let accepted = false
  const authorization = (): Record<string, string> => ({ response_type: 'code', client_id: clientId,
    redirect_uri: callback.toString(), scope: 'desktop', state, code_challenge: challenge, code_challenge_method: 'S256', resource: http.origin + '/api/v1/desktop' })
  const attempt: SignInAttempt = {
    signal: controller.signal, verifier, redirectUri: callback.toString(), committing: false, running: undefined,
    get clientId() { return clientId },
    get authorization() { return authorization() },
    get authorizationUrl() {
      const destination = new URL('/oauth/desktop/authorize', http.origin)
      destination.search = new URLSearchParams(authorization()).toString()
      return destination.toString()
    },
    async initialize() {
      const client = parse(z.object({ client_id: z.string().min(1).max(2048) }), await http.request('/api/v1/desktop/oauth/register', {
        body: { client_name: `${config.productName} · ${hostname()}`, redirect_uris: [callback.toString()], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }, signal: controller.signal,
      }))
      controller.signal.throwIfAborted()
      clientId = client.client_id
    },
    async accept(url) {
      if (controller.signal.aborted || accepted || clientId === '' || url.origin !== callback.origin || url.pathname !== callback.pathname
        || url.username || url.password || url.hash || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state
        || url.searchParams.getAll('code').length > 1 || url.searchParams.getAll('error').length > 1
        || url.searchParams.has('code') === url.searchParams.has('error')) throw new AccountError('protocol')
      if (url.searchParams.has('error')) { actions.failed(attempt, 'authorization'); throw new AccountError('authorization') }
      const code = url.searchParams.get('code')
      if (!code) throw new AccountError('protocol')
      accepted = true
      attempt.running = actions.complete(attempt, code)
      try { await attempt.running } catch (error) {
        actions.failed(attempt, error instanceof AccountError ? error.code : 'network')
        throw error
      }
    },
    close() {
      clearTimeout(timer)
      void Promise.resolve(remove()).catch(() => { ctx.logger.warn('sub2api-account: callback cleanup failed') })
      controller.abort()
    },
  }
  const remove = ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: callback.pathname, auth: 'anonymous', handler: async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (request.method !== 'GET') { response.writeHead(405).end(); return }
    try {
      await attempt.accept(new URL(request.url ?? '/', callback.origin))
      response.writeHead(200).end(authorizationPage(config.productName, true))
    } catch { response.writeHead(400).end(authorizationPage(config.productName, false)) }
  } }), 'sub2api-account: loopback callback')
  const timer = setTimeout(() => { if (!attempt.committing) actions.failed(attempt, 'expired') }, config.attemptTimeoutMs)
  timer.unref()
  return attempt
}
