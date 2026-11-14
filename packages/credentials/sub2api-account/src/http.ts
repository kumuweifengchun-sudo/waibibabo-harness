/** Platform HTTP parsing and redacted failure classification. */
import { z } from 'zod'
import type { AccountFailure } from './types.ts'

/** Host-owned request controls; callers pass only issuer-relative API paths. */
export interface PlatformRequestOptions {
  method?: string
  token?: string
  body?: object | URLSearchParams | FormData
  signal?: AbortSignal
  empty?: boolean
  timeoutMs?: number
  maxBytes?: number
}

/** Trusted account transports; manual selection never races another origin. */
export interface AccountConnections {
  readonly origins: readonly string[]
  readonly timeoutMs: number
  readonly selected?: string | null
  readonly changed?: () => void
}

/** A safe error category; response bodies and credentials never enter its message. */
export class AccountError extends Error {
  /** @param code - category displayed by the client. */
  constructor(readonly code: AccountFailure) { super(`sub2api-account: ${code}`) }
}

/** Validates refreshable OAuth credentials returned by the desktop endpoints. */
export const tokenResponse = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive(),
  token_type: z.literal('Bearer'), scope: z.literal('desktop'),
})

/** Parses one untrusted JSON value with a safe failure.
 * @param schema - accepted platform response fields.
 * @param value - decoded remote JSON.
 * @returns validated fields only.
 */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AccountError('protocol')
  return result.data
}

/** HTTP client bound to one OAuth issuer and explicitly configured transport origins; redirects never forward tokens. */
export class PlatformClient {
  private connectedOrigin: string | undefined
  private connectionFlight: Promise<string> | undefined

  /** @param origin - validated issuer origin. @param timeoutMs - request deadline. @param lifetime - owning plugin lifetime.
   * @param connections - Validated account origins and the deadline for public identity probes; omitted for inference-only clients.
   */
  constructor(readonly origin: string, private readonly timeoutMs: number, private readonly lifetime: AbortSignal,
    private readonly connections?: AccountConnections) {}

  /** Last selected transport, or null before detection and after a connection failure. */
  get activeOrigin(): string | null { return this.connectedOrigin ?? null }

  /** Select an account API origin using public metadata before sending credentials.
   * @returns a configured origin advertising this client's unchanged OAuth resource.
   */
  async connectionOrigin(): Promise<string> {
    if (this.connections?.selected && ![this.origin, ...this.connections.origins].includes(this.connections.selected)) {
      throw new AccountError('account-line-unavailable')
    }
    if (this.connectedOrigin !== undefined) return this.connectedOrigin
    if (this.connections === undefined || this.connections.origins.length === 0 && !this.connections.selected) {
      this.connectedOrigin = this.origin
      this.connections?.changed?.()
      return this.origin
    }
    if (this.connectionFlight !== undefined) return this.connectionFlight
    const flight = this.selectConnection(this.connections)
    this.connectionFlight = flight
    try { return await flight } finally { if (this.connectionFlight === flight) this.connectionFlight = undefined }
  }

  private async selectConnection(connections: AccountConnections): Promise<string> {
    const controller = new AbortController()
    const signal = AbortSignal.any([this.lifetime, controller.signal, AbortSignal.timeout(connections.timeoutMs)])
    const origins = connections.selected ? [connections.selected] : [...new Set([this.origin, ...connections.origins])]
    const attempts = origins.map(async (origin) => {
      let response: Response
      try { response = await fetch(new URL('/api/v1/desktop/oauth/configuration', origin), { redirect: 'error', signal }) }
      catch (error) { throw networkFailure(error, signal) }
      if (!response.ok) { await response.body?.cancel(); throw new AccountError(response.status >= 500 ? 'server' : 'protocol') }
      const bytes = await readPlatformBody(response, 16 * 1024)
      let value: unknown
      try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new AccountError('protocol') }
      parse(z.object({ resource: z.literal(this.origin + '/api/v1/desktop'), scope: z.literal('desktop'),
        authorization_endpoint: z.literal(this.origin + '/oauth/desktop/authorize'),
        registration_endpoint: z.literal(this.origin + '/api/v1/desktop/oauth/register'),
        token_endpoint: z.literal(this.origin + '/api/v1/desktop/oauth/token'),
        revocation_endpoint: z.literal(this.origin + '/api/v1/desktop/oauth/revoke') }), value)
      return origin
    })
    try {
      const selected = await Promise.any(attempts)
      this.lifetime.throwIfAborted()
      this.connectedOrigin = selected
      connections.changed?.()
      return selected
    } catch (error) {
      if (error instanceof AggregateError) {
        const failures: unknown[] = error.errors
        if (failures.every(failure => failure instanceof AccountError && failure.code === 'protocol')) throw new AccountError('protocol')
        if (failures.every(failure => failure instanceof AccountError && failure.code === 'server')) throw new AccountError('server')
        if (failures.some(failure => failure instanceof AccountError && failure.code === 'timeout')) throw new AccountError('timeout')
      }
      throw new AccountError('network')
    } finally {
      controller.abort()
      await Promise.allSettled(attempts)
    }
  }

  /** Request JSON or a form from an issuer-relative API path.
   * @param path - absolute API path on the configured origin.
   * @param options - method, secret header, body and operation cancellation.
   * @returns JSON, unwrapping the platform's standard data envelope.
   */
  async request(path: string, options: PlatformRequestOptions = {}): Promise<unknown> {
    const response = await this.fetch(path, options)
    if (response.ok && options.empty) { await response.body?.cancel(); return null }
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      if (!response.ok) throw platformFailure(response.status, null)
      return null
    }
    const bytes = await readPlatformBody(response, options.maxBytes ?? 16 * 1024 * 1024)
    let data: unknown
    try { data = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new AccountError(response.status >= 500 ? 'server' : 'protocol') }
    if (!response.ok) throw platformFailure(response.status, data)
    const envelope = z.object({ code: z.number(), data: z.unknown() }).safeParse(data)
    if (envelope.success) {
      if (envelope.data.code !== 0) throw new AccountError('protocol')
      return envelope.data.data
    }
    return data
  }

  /** Read an authenticated file with a bounded response and no forwarded redirects.
   * @param path - Issuer-relative download route.
   * @param options - Authentication, cancellation and size limit.
   * @returns bytes and the server's media type.
   */
  async file(path: string, options: PlatformRequestOptions): Promise<{ bytes: Uint8Array; mime: string }> {
    const response = await this.fetch(path, options)
    const bytes = await readPlatformBody(response, options.maxBytes ?? 20 * 1024 * 1024)
    if (!response.ok) {
      let data: unknown
      try { data = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new AccountError(response.status >= 500 ? 'server' : 'protocol') }
      throw platformFailure(response.status, data)
    }
    return { bytes, mime: (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '' }
  }

  private async fetch(path: string, options: PlatformRequestOptions): Promise<Response> {
    const url = new URL(path, this.origin)
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/v1/') && !['/v1/models', '/v1/images/generations', '/v1/images/edits'].includes(url.pathname)) throw new AccountError('protocol')
    const headers = new Headers({ Accept: 'application/json', 'Accept-Language': 'zh-CN' })
    if (options.token !== undefined) headers.set('Authorization', `Bearer ${options.token}`)
    let body: string | FormData | undefined
    if (options.body !== undefined) {
      if (options.body instanceof FormData) body = options.body
      else {
        const form = options.body instanceof URLSearchParams
        headers.set('Content-Type', form ? 'application/x-www-form-urlencoded' : 'application/json')
        body = options.body instanceof URLSearchParams ? options.body.toString() : JSON.stringify(options.body)
      }
    }
    const signals = [this.lifetime, AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)]
    if (options.signal !== undefined) signals.push(options.signal)
    const signal = AbortSignal.any(signals)
    const origin = await this.connectionOrigin()
    const destination = new URL(url.pathname + url.search, origin)
    let response: Response
    try {
      response = await fetch(destination, { method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers, redirect: 'error', signal, ...body === undefined ? {} : { body } })
    } catch (error) {
      if (this.connectedOrigin === origin) { this.connectedOrigin = undefined; this.connections?.changed?.() }
      throw networkFailure(error, signal)
    }
    const capabilities = ['gateways', 'usage/records', 'usage/stats', 'payment/config', 'payment/checkout-info',
      'payment/orders', 'payment/orders/my', 'payment/orders/verify', 'invoices', 'invoices/quote']
    const missingFeature = response.status === 404 && capabilities.some(path => url.pathname === `/api/v1/desktop/${path}`)
    if (response.status === 401 || missingFeature) {
      await response.body?.cancel()
      throw new AccountError(response.status === 401 ? 'authorization' : 'upgrade-required')
    }
    return response
  }
}

function platformFailure(status: number, data: unknown): AccountError {
  const failure = z.object({
    error: z.union([z.string(), z.object({ code: z.string().optional(), type: z.string().optional() })]).optional(),
    reason: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional() }).safeParse(data)
  const value = failure.success ? failure.data : undefined
  const code = String(value?.reason ?? (typeof value?.error === 'string' ? value.error : value?.error?.code ?? value?.error?.type) ?? value?.code ?? '')
  if (code === 'invalid_grant') return new AccountError('authorization')
  if (code === 'PAYMENT_GATEWAY_ERROR' || code === 'WECHAT_H5_NOT_AUTHORIZED') return new AccountError('payment-gateway')
  if (status >= 500) return new AccountError('server')
  if (/captcha|turnstile/iu.test(code)) return new AccountError('captcha')
  if (/INVOICE_EVIDENCE/iu.test(code)) return new AccountError('invoice-evidence')
  if (status === 409) return new AccountError('conflict')
  if (status === 404) return new AccountError('unavailable')
  if (/insufficient|balance_not_enough|quota_exceeded/iu.test(code) || status === 402) return new AccountError('balance')
  if (/disabled|not_available|not_allowed/iu.test(code)) return new AccountError('unavailable')
  if (/INVOICE_INVALID|INVOICE_MINIMUM|INVALID_AMOUNT|INVALID_PAYMENT|INVALID_PLAN/iu.test(code) || status === 413 || status === 422) return new AccountError('validation')
  return new AccountError(status === 400 || status === 403 ? 'credentials' : 'network')
}

function networkFailure(error: unknown, signal?: AbortSignal): AccountError {
  const cause: unknown = error instanceof Error ? error.cause : undefined
  const timeout = error instanceof Error && error.name === 'TimeoutError'
    || signal?.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    || cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'UND_ERR_CONNECT_TIMEOUT'
  return new AccountError(timeout ? 'timeout' : 'network')
}

/** Bound streamed platform responses before parsing or returning them.
 * @param response - Fetch response owned by this operation.
 * @param maximum - Maximum accepted response bytes.
 * @returns the complete bounded body.
 */
export async function readPlatformBody(response: Response, maximum: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (reader === undefined) return new Uint8Array()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > maximum) { await reader.cancel(); throw new AccountError('protocol') }
      parts.push(part.value)
    }
    return Buffer.concat(parts, length)
  } catch (error) { throw error instanceof AccountError ? error : networkFailure(error) }
  finally { reader.releaseLock() }
}
