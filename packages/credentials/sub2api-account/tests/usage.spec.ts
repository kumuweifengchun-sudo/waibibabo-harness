/** Real account queries share website filters and discard credentials before Remote projection. */
import { expect, it } from 'vitest'
import type { Sub2apiGroupId, UsageQuery } from '../src/types.ts'
import { usageParameters } from '../src/usage.ts'
import { accountFixture } from './account-fixture.ts'

const query: UsageQuery = { page: 1, pageSize: 20, startDate: '2026-11-01', endDate: '2026-11-12',
  timezone: 'Asia/Shanghai', model: 'gpt-5', groupId: '3' as Sub2apiGroupId, stream: true }

it('keeps valid records visible when the independent summary endpoint fails', async () => {
  let unavailable = true
  const f = await accountFixture({ feature: (request, response) => {
    if (!unavailable || !request.url?.startsWith('/api/v1/desktop/usage/stats?')) return false
    response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 500, message: 'internal error' }))
    return true
  } })
  await f.account.signInWithPassword('user@example.com', 'password')
  expect(await f.account.getUsage(query)).toMatchObject({ ok: true, data: {
    items: [{ id: '19' }], total: 21, requests: null, tokens: null, cost: null, statisticsError: 'server',
  } })
  unavailable = false
  const recovered = await f.account.getUsage(query)
  expect(recovered).toMatchObject({ ok: true, data: { cost: 3.75 } })
  if (recovered.ok) expect(recovered.data.statisticsError).toBeUndefined()
})

it('reads user records and totals with identical encoded filters and no browser credentials', async () => {
  const f = await accountFixture()
  await f.account.signInWithPassword('user@example.com', 'password')
  const result = await f.account.getUsage(query)
  expect(result).toMatchObject({ ok: true, data: { total: 21, totalPages: 2, cost: 3.75,
    items: [{ id: '19', model: 'gpt-5', actualCost: 0.165, cacheReadTokens: 30, apiKey: 'Desktop' }] } })
  expect(JSON.stringify(result)).not.toMatch(/must-not-reach-client|account_id|desktop-access|short-inference-key/)
  const calls = f.requests.filter(value => value.path.startsWith('/api/v1/desktop/usage/'))
  expect(calls).toHaveLength(2)
  expect(calls[0]!.query).toBe(calls[1]!.query)
  expect(new URLSearchParams(calls[0]!.query).get('timezone')).toBe('Asia/Shanghai')
  expect(new URLSearchParams(calls[0]!.query).has('user_id')).toBe(false)
  expect(calls.every(value => value.authorization === 'Bearer desktop-access-1')).toBe(true)
  expect(await f.account.getUsage({ ...query, page: 2 })).toMatchObject({ ok: true, data: { page: 2, items: [{ id: '20' }] } })
})

it('rejects invalid ranges before requests and exposes missing server support without logging out', async () => {
  expect(() => usageParameters({ ...query, endDate: '2027-01-31' })).toThrow('usage-filter')
  expect(() => usageParameters({ ...query, startDate: '2026-02-30' })).toThrow('usage-filter')
  expect(() => usageParameters({ ...query, timezone: 'not-a-timezone' })).toThrow('usage-filter')
  const f = await accountFixture()
  await f.account.signInWithPassword('user@example.com', 'password')
  f.failUsage(404)
  expect(await f.account.getUsage(query)).toEqual({ ok: false, error: 'upgrade-required' })
  expect((await f.account.getState()).status).toBe('signed-in')
  f.failUsage(503)
  expect(await f.account.getUsage(query)).toEqual({ ok: false, error: 'server' })
  f.failUsage(401)
  expect(await f.account.getUsage(query)).toEqual({ ok: false, error: 'authorization' })
  expect((await f.account.getState()).status).toBe('signed-out')
})
