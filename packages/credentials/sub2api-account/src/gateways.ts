/** Administrator-owned inference address discovery and normalization. */
import { z } from 'zod'
import { AccountError, PlatformClient, parse } from './http.ts'
import { platformModelsResponse, type PlatformModelCatalog } from './model-capabilities.ts'
import type { GatewayEndpoint, GatewayId } from './platform-types.ts'

const gateways = z.object({ api_base_url: z.string(), custom_endpoints: z.array(z.object({
  name: z.string(), endpoint: z.string(), description: z.string().optional(),
})).nullable() })

/** Normalize an API origin, accepting the conventional optional /v1 suffix.
 * @param value - Administrator-advertised API URL.
 * @returns a canonical HTTP(S) origin with no credentials or query.
 */
export function gatewayOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new AccountError('protocol') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !['/', '/v1', '/v1/'].includes(url.pathname)) throw new AccountError('protocol')
  return url.origin
}

/** Project only validated platform-advertised addresses, keeping the main origin available.
 * @param value - Desktop gateways response.
 * @param mainOrigin - Configured OAuth issuer and fallback inference address.
 * @returns distinct gateway addresses in platform order.
 */
export function gatewayEndpoints(value: unknown, mainOrigin: string): readonly GatewayEndpoint[] {
  const input = parse(gateways, value)
  const candidates = [{ name: '', endpoint: input.api_base_url || mainOrigin, description: '' },
    ...(input.custom_endpoints ?? []), { name: '', endpoint: mainOrigin, description: '' }]
  const result = new Map<string, GatewayEndpoint>()
  for (const item of candidates) {
    const origin = gatewayOrigin(item.endpoint)
    if (!result.has(origin)) result.set(origin, { id: origin as GatewayId, name: item.name, origin,
      description: item.description ?? '', insecure: origin.startsWith('http:') })
  }
  return [...result.values()]
}

/** A selected inference client and any model catalog obtained while detecting it. */
export interface GatewayRoute { readonly client: PlatformClient; readonly catalog?: PlatformModelCatalog }

/** Detect an inference endpoint using only a group's short-lived key and read-only model requests.
 * @param origins - Validated inference origins allowed for automatic detection.
 * @param token - Group-scoped inference lease; never an account token.
 * @param timeoutMs - Detection deadline for the complete parallel race.
 * @param lifetime - Owning account lifetime.
 * @param requestTimeoutMs - Deadline used by the selected client after detection.
 * @returns the first route with a nonempty, valid model catalog; failed probes are cancelled and settled.
 */
export async function detectGateway(origins: readonly string[], token: string, timeoutMs: number,
  lifetime: AbortSignal, requestTimeoutMs: number): Promise<GatewayRoute> {
  if (origins.length === 0) throw new AccountError('gateway-unavailable')
  const controller = new AbortController()
  const signal = AbortSignal.any([lifetime, controller.signal, AbortSignal.timeout(timeoutMs)])
  const attempts = origins.map(async (origin) => {
    const client = new PlatformClient(origin, requestTimeoutMs, lifetime)
    const catalog = parse(platformModelsResponse, await client.request('/v1/models', { token, signal })).data
    if (catalog.length === 0) throw new AccountError('no-models')
    return { client, catalog }
  })
  try { return await Promise.any(attempts) }
  catch { throw new AccountError('gateway-unavailable') }
  finally { controller.abort(); await Promise.allSettled(attempts) }
}
