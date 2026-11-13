/** Automatic balance reads retain known values on failure and stop after sign-out. */
import { expect, it, vi } from 'vitest'
import { accountFixture } from './account-fixture.ts'

it('refreshes quota without reloading model catalogs and marks retained values stale on failure', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let balance = 12.5
  let failed = false
  const f = await accountFixture({ feature: (req, res) => {
    if (req.url !== '/api/v1/desktop/profile') return false
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = failed ? 503 : 200
    res.end(JSON.stringify(failed ? { error: 'unavailable' } : { code: 0, data: {
      id: 7, email: 'user@example.com', username: 'Platform user', balance,
    } }))
    return true
  } })
  try {
    await f.account.signInWithPassword('user@example.com', 'password')
    const models = f.requests.filter(request => request.path === '/v1/models').length
    balance = 9.25
    await vi.advanceTimersByTimeAsync(60000)
    await expect.poll(async () => (await f.account.getState()).profile?.balance).toBe(9.25)
    expect(f.requests.filter(request => request.path === '/v1/models')).toHaveLength(models)
    failed = true
    await vi.advanceTimersByTimeAsync(60000)
    await expect.poll(async () => (await f.account.getState()).balanceStale).toBe(true)
    expect((await f.account.getState()).profile?.balance).toBe(9.25)
    await f.account.signOut()
    const requests = f.requests.length
    await vi.advanceTimersByTimeAsync(120000)
    expect(f.requests).toHaveLength(requests)
  } finally {
    await f.context.fiber.dispose()
    vi.useRealTimers()
  }
})
