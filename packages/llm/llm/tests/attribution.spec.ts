import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_IDENTITY, attributionHeaders, userAgent } from '@deepseek-ai/dsh-llm'
import type { AppIdentity } from '@deepseek-ai/dsh-llm'
import product from '../src/waibibabo-product.json' with { type: 'json' }

// The default identity must not depend on the developer's exported suffix.
beforeEach(() => { vi.stubEnv('DSH_USER_AGENT_SUFFIX', undefined) })
afterEach(() => { vi.unstubAllEnvs() })

/** A white-label identity exercising every override hook. */
const forkIdentity: AppIdentity = {
  product: 'fork-agent',
  version: '9.9.9',
  url: 'https://example.com/fork-agent',
}

describe('APP_IDENTITY', () => {
  it('shares the desktop product version', () => {
    expect(APP_IDENTITY.version).toBe(product.version)
  })

  it('carries only static public product facts', () => {
    expect(APP_IDENTITY).toEqual({
      product: 'wss',
      version: product.version,
      suffix: undefined,
    })
  })
})

describe('userAgent', () => {
  it('sends the WSS product version without a URL comment', () => {
    expect(userAgent()).toBe(`wss/${product.version}`)
  })

  it('renders a custom identity', () => {
    expect(userAgent(forkIdentity)).toBe('fork-agent/9.9.9 (+https://example.com/fork-agent)')
  })

  it('renders a custom identity without a URL', () => {
    expect(userAgent({ product: 'fork-agent', version: '9.9.9' })).toBe('fork-agent/9.9.9')
  })

  it('appends the identity suffix after the comment', () => {
    expect(userAgent({ ...forkIdentity, suffix: 'dsh-profile/web' })).toBe('fork-agent/9.9.9 (+https://example.com/fork-agent) dsh-profile/web')
  })
})

describe('DSH_USER_AGENT_SUFFIX', () => {
  it('appends the launch suffix to the default User-Agent when read', () => {
    vi.stubEnv('DSH_USER_AGENT_SUFFIX', 'dsh-profile/my%20web')
    expect(APP_IDENTITY.suffix).toBe('dsh-profile/my%20web')
    expect(userAgent()).toBe(`wss/${product.version} dsh-profile/my%20web`)
  })

  it.each(['', undefined])('omits the suffix when it is %j', (value) => {
    vi.stubEnv('DSH_USER_AGENT_SUFFIX', value)
    expect(APP_IDENTITY.suffix).toBeUndefined()
    expect(userAgent()).toBe(`wss/${product.version}`)
  })

  it.each(['dsh-profile/my web', 'dsh-profile/web\r\nx-injected: 1', 'dsh-profile/(web)', 'dsh-profile/a/b'])('rejects %j', (value) => {
    vi.stubEnv('DSH_USER_AGENT_SUFFIX', value)
    expect(() => userAgent()).toThrow('DSH_USER_AGENT_SUFFIX must be an RFC 9110 product token')
  })
})

describe('attributionHeaders', () => {
  it('defaults to the provider-neutral baseline: User-Agent and nothing else', () => {
    expect(attributionHeaders()).toEqual({ 'user-agent': `wss/${product.version}` })
  })

  it('maps a custom identity onto the User-Agent header only', () => {
    expect(attributionHeaders(forkIdentity)).toEqual({
      'user-agent': 'fork-agent/9.9.9 (+https://example.com/fork-agent)',
    })
  })
})
