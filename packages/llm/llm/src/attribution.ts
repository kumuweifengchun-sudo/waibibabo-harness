/**
 * Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
 * adapters from drifting. See
 * `docs/subsystems/llm-streaming.md#appidentity--app-attribution`.
 *
 * App-attribution vocabulary for provider requests.
 * @module @deepseek-ai/dsh-llm/attribution
 */

import product from './waibibabo-product.json' with { type: 'json' }

/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
export interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from product metadata, never hand-copied. */
  version: string
  /** Optional public URL included as a `User-Agent` comment. */
  url?: string
  /** RFC 9110 product token appended after the comment, such as `dsh-profile/web`. */
  suffix?: string | undefined
}

// RFC 9110 §10.1.5 `product = token ["/" product-version]`.
const PRODUCT = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\/[!#$%&'*+.^_`|~0-9A-Za-z-]+)?$/

/**
 * Read the launching application's `User-Agent` suffix on each use, so a launcher may set it after this module loads.
 * It is a process environment value rather than plugin `Config` because {@link attributionHeaders} runs without a
 * plugin context.
 * @returns the validated `DSH_USER_AGENT_SUFFIX`, or undefined when unset or empty.
 * @throws Error when the value is not an RFC 9110 product token.
 */
function launchSuffix(): string | undefined {
  const value = process.env.DSH_USER_AGENT_SUFFIX
  if (value === undefined || value === '') return undefined
  if (!PRODUCT.test(value)) throw new Error(`DSH_USER_AGENT_SUFFIX must be an RFC 9110 product token; got ${JSON.stringify(value)}`)
  return value
}

/**
 * The harness's own identity: the default every adapter sends. Its `suffix`
 * reads `DSH_USER_AGENT_SUFFIX`. Deployments
 * that need a white-label identity pass their own {@link AppIdentity} to
 * {@link attributionHeaders} — omission falls back to this default; nothing
 * can suppress attribution entirely.
 */
export const APP_IDENTITY: AppIdentity = {
  product: product.userAgentProduct,
  version: product.version,
  get suffix() { return launchSuffix() },
}

/**
 * The standard `User-Agent` value: `product/version`, with an optional
 * `(+url)` comment for identities that declare a public URL.
 * @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
 * @returns the ready-to-send header value.
 */
export function userAgent(identity: AppIdentity = APP_IDENTITY): string {
  const base = `${identity.product}/${identity.version}${identity.url === undefined ? '' : ` (+${identity.url})`}`
  return identity.suffix === undefined ? base : `${base} ${identity.suffix}`
}

/**
 * Build the attribution headers an adapter must send on every provider
 * request. Header names are lowercase (HTTP field names are case-insensitive
 * on the wire).
 * @param identity - the identity to send; defaults to {@link APP_IDENTITY} — omission cannot suppress attribution.
 * @returns headers to merge into the provider request (currently just `user-agent`).
 */
export function attributionHeaders(
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return { 'user-agent': userAgent(identity) }
}
