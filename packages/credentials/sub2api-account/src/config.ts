/** Deployment options for the account and its inference adapter. */
import z from '@deepseek-ai/schemastery'
import type { ModelProtocolChoice } from './types.ts'

/** Public deployment fields; credentials are stored separately on the Host. */
export interface Config {
  /** Platform HTTPS origin, without a path. */
  platformOrigin: string
  /** Additional trusted account API origins serving the same OAuth resource. */
  accountOrigins?: string[]
  /** Deadline for account metadata, model-list probes, and Responses socket handshakes and health checks, in milliseconds. */
  connectionProbeTimeoutMs?: number
  /** Default Responses transport before per-model overrides: HTTP streaming, or auto to prefer WebSocket with HTTP fallback. */
  responsesTransport?: 'auto' | 'sse'
  /** Enable automatic previous_response_id chaining only for gateways with verified incremental Responses support. */
  responsesIncrementalHistory?: boolean
  /** Idle lifetime of reusable Responses WebSocket connections, in milliseconds. */
  responsesSocketIdleMs?: number
  /** Maximum retained Responses connections; concurrent overflow requests use temporary connections. */
  responsesSocketLimit?: number
  /** Reprobe an unavailable Responses WebSocket endpoint after this interval, in milliseconds. */
  responsesFallbackCooldownMs?: number
  /** Product name shown in the account page and browser consent. */
  productName: string
  /** Permit plain HTTP only for numeric loopback development origins. */
  allowLoopbackHttp?: boolean
  /** Bound each platform request, in milliseconds. */
  requestTimeoutMs?: number
  /** Refresh the signed-in account balance at this interval, in milliseconds. */
  accountRefreshIntervalMs?: number
  /** Bound a user-triggered image generation request. */
  imageTimeoutMs?: number
  /** Bound invoice evidence uploads and downloads. */
  invoiceTimeoutMs?: number
  /** Maximum image gateway JSON body, including base64 output. */
  imageResponseLimitBytes?: number
  /** Maximum combined decoded reference-image bytes per request. */
  imageReferenceLimitBytes?: number
  /** Maximum number of reference images per request. */
  imageReferenceMaxCount?: number
  /** Absolute duration of a sign-in attempt, in milliseconds. */
  attemptTimeoutMs?: number
  /** Refresh access tokens and inference leases before this remaining lifetime. */
  refreshLeewayMs?: number
  /** Default selection before a per-model user override; auto follows model family and advertised endpoints. */
  protocol?: ModelProtocolChoice
  /** Default total token budget for every platform model. */
  defaultContextWindow?: number
  /** Default input capacity; omitted values use context minus the reserved output. */
  defaultMaxInputTokens?: number
  /** Default request output cap, including reasoning tokens counted by the selected protocol. */
  defaultMaxTokens?: number
}

/** Validated settings owned by one account plugin instance. */
export const Config = z.object({
  platformOrigin: z.string().required(),
  accountOrigins: z.array(z.string()).default([]),
  connectionProbeTimeoutMs: z.natural().min(100).default(5000),
  responsesTransport: z.union(['auto', 'sse']).default('sse'),
  responsesIncrementalHistory: z.boolean().default(false),
  responsesSocketIdleMs: z.natural().min(1000).default(120000),
  responsesSocketLimit: z.natural().min(1).default(16),
  responsesFallbackCooldownMs: z.natural().min(1000).default(60000),
  productName: z.string().required(),
  allowLoopbackHttp: z.boolean().default(false),
  requestTimeoutMs: z.natural().min(1000).default(30000),
  accountRefreshIntervalMs: z.natural().min(5000).default(60000),
  imageTimeoutMs: z.natural().min(1000).default(600000),
  invoiceTimeoutMs: z.natural().min(1000).default(300000),
  imageResponseLimitBytes: z.natural().min(1024).default(128 * 1024 * 1024),
  imageReferenceLimitBytes: z.natural().min(1).default(20 * 1024 * 1024),
  imageReferenceMaxCount: z.natural().min(1).default(16),
  attemptTimeoutMs: z.natural().min(1000).default(180000),
  refreshLeewayMs: z.natural().default(30000),
  protocol: z.union(['auto', 'openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']).default('auto'),
  defaultContextWindow: z.natural().min(1024).default(262144),
  defaultMaxInputTokens: z.natural().min(1),
  defaultMaxTokens: z.natural().min(1).default(32768),
})

/** Validate a configured origin before credentials can reach a request.
 * @param raw - deployment origin.
 * @param allowLoopbackHttp - explicit development allowance.
 * @returns normalized HTTP(S) origin.
 */
export function platformOrigin(raw: string, allowLoopbackHttp: boolean): string {
  const url = new URL(raw)
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(allowLoopbackHttp && loopback && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('sub2api-account: platformOrigin must be an HTTPS origin; numeric loopback HTTP requires allowLoopbackHttp')
  }
  return url.origin
}
