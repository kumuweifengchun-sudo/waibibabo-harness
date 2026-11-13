/** The desktop product layer boots the real Web Host with its generated account Remote. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-client-modules'
import { launchWebScaffold } from './scaffold.ts'

it('mounts platform login and removes the upstream account from the product composition', async () => {
  const bundle = fileURLToPath(new URL('../../../packages/bundle/waibibabo/', import.meta.url))
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [bundle + '/package.json'],
    profile: { hmr: false, packages: [], bundles: ['@deepseek-ai/dsh-waibibabo'] },
  })
  try {
    expect(scaffold.ctx.get('deepseekAccount')).toBeUndefined()
    const plugins = [...scaffold.ctx.loader.entries()].filter(entry => !entry.options.disabled).map(entry => entry.options.id)
    expect(plugins).not.toContain('session-log-deepseek')
    expect(plugins).not.toContain('session-telemetry-otel')
    expect(plugins).not.toContain('ui-settings-session-log')
    expect(plugins).not.toContain('harness-dev-context')
    expect(plugins).toContain('waibibabo-brand')
    const graph = scaffold.ctx.clientModules.graph()
    const product = graph.entries.find(entry => entry.id === '@deepseek-ai/dsh-waibibabo')
    expect(product?.inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
    expect(product?.inject).toContain('@deepseek-ai/dsh-client-locale')
    const accountClient = graph.entries.find(entry => entry.id === '@deepseek-ai/dsh-sub2api-account')
    expect(accountClient?.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-settings-models', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-file-actions',
    ]))
    const response = await scaffold.hostFetch('/api/sub2apiAccount/getState', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'product-account', method: 'sub2apiAccount/getState', payload: { args: {} } }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: {
      status: 'signed-out', productName: 'Waibibabo Harnesss', platformOrigin: 'https://www.waibibabo.com',
    } } })
    for (const method of ['getGateways', 'getCheckout', 'getInvoices']) {
      const feature = await scaffold.hostFetch(`/api/sub2apiAccount/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `product-${method}`, method: `sub2apiAccount/${method}`,
          payload: { args: method === 'getInvoices' ? { query: { page: 1, pageSize: 20, status: '' } } : {} } }),
      })
      expect(feature.status).toBe(200)
      expect(await feature.json()).toMatchObject({ result: { ok: true, value: { ok: false, error: 'authorization' } } })
    }
  } finally { await scaffold.close() }
}, 60000)
