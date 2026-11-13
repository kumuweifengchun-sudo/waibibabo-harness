import { describe, expect, it } from 'vitest'
import { APP_IDENTITY, attributionHeaders, userAgent } from '@deepseek-ai/dsh-llm'
import type { AppIdentity } from '@deepseek-ai/dsh-llm'
import product from '../src/waibibabo-product.json' with { type: 'json' }

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
