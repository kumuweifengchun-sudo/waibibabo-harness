/** Account lifecycle through real Loader composition and an isolated HTTP platform. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Sub2apiGroupId } from '../src/types.ts'
import { authorizationPage } from '../src/authorization-page.ts'
import { accountFixture as fixture } from './account-fixture.ts'

describe('Sub2API account through Loader', () => {
  it('keeps login and models usable when statistics fail and clears the warning on recovery', async () => {
    let unavailable = true
    const f = await fixture({ feature: (request, response) => {
      if (!unavailable || request.url !== '/api/v1/desktop/usage') return false
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 503 }))
      return true
    } })
    expect(await f.account.signInWithPassword('user@example.com', 'password')).toMatchObject({
      status: 'signed-in', profile: { name: 'Platform user' }, models: ['relay-model'], usage: null, usageError: 'server', error: null,
    })
    unavailable = false
    expect(await f.account.refresh()).toMatchObject({ usage: { todayRequests: 5 }, usageError: null, error: null })
  })

  it('selects the first group on login and preserves later choices across refresh and restart', async () => {
    const groups = [{ id: 8, name: 'First group', platform: 'openai' }, { id: 3, name: 'Other group', platform: 'openai' }]
    const f = await fixture({ groups })
    const initial = await f.account.signInWithPassword('user@example.com', 'password')
    expect(initial.selectedGroup).toBe('8')
    expect(initial.models).toEqual(['relay-model'])
    await f.account.selectGroup('3' as Sub2apiGroupId)
    expect((await f.account.refresh()).selectedGroup).toBe('3')
    const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
    await entry.update({ disabled: true })
    await entry.update({ disabled: false })
    expect((await f.context.sub2apiAccount.getState()).selectedGroup).toBe('3')
    f.setGroups(groups.slice(0, 1))
    expect((await f.context.sub2apiAccount.refresh()).selectedGroup).toBe('8')
    f.setGroups([])
    expect(await f.context.sub2apiAccount.refresh()).toMatchObject({ status: 'signed-in', selectedGroup: null, models: [] })
    expect(f.context.llm.listProviders()).toEqual([])
  })

  it('escapes a configured product name in authorization result markup', () => {
    const page = authorizationPage('<WSS & "test">', true)
    expect(page).toContain('&lt;WSS &amp; &quot;test&quot;&gt;')
    expect(page).not.toContain('<WSS')
  })

  it('reports local credential storage failure without claiming a completed sign-out', async () => {
    const f = await fixture()
    await f.account.signInWithPassword('user@example.com', 'password')
    const failure = vi.spyOn(f.context.credentials, 'modifyRecord').mockRejectedValueOnce(new Error('file unavailable'))
    try {
      const result = await f.account.signOut()
      expect(result.error).toBe('storage')
      expect(result.status).toBe('signed-in')
      expect(f.requests.filter(request => request.path.endsWith('/oauth/revoke'))).toHaveLength(0)
    } finally { failure.mockRestore() }
  })

  it('shares one token refresh across concurrent requests and restores the rotated grant after reload', async () => {
    const f = await fixture()
    f.expireInitialToken()
    const state = await f.account.signInWithPassword('user@example.com', 'password')
    expect(state.status).toBe('signed-in')
    expect(f.requests.filter(request => request.body.grant_type === 'refresh_token')).toHaveLength(1)
    const stored = await readFile(join(f.home, 'credentials.yaml'), 'utf8')
    expect(stored).toContain('desktop-refresh-2')
    expect(stored).not.toContain('desktop-refresh-1')
    const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
    await entry.update({ disabled: true })
    await entry.update({ disabled: false })
    const restored = await f.context.sub2apiAccount.getState()
    expect(restored.models).toEqual(['relay-model'])
    expect(restored.selectedGroup).toBe('3')
    expect(f.requests.filter(request => request.body.grant_type === 'refresh_token')).toHaveLength(1)
  })

  it('signs in, lists allowed models and sends inference with a separate leased credential', async () => {
    const f = await fixture()
    const state = await f.account.signInWithPassword('user@example.com', 'password-not-stored')
    expect(state.error).toBeNull()
    expect(state.status).toBe('signed-in')
    expect(state.profile?.balance).toBe(12.5)
    expect(state.usage?.todayCost).toBe(0.25)
    expect(state.models).toEqual(['relay-model'])
    expect(state.selectedGroup).toBe('3')
    expect(f.context.llm.listProviders().map(provider => provider.id)).toEqual(['sub2api-u7-g3'])
    expect((await f.context.llm.listModels('sub2api-u7-g3')).map(model => model.id)).toEqual(['relay-model'])
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model: 'relay-model' })
    const chunks = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk)
    expect(JSON.stringify(chunks)).toContain('Platform model connected.')
    const inference = f.requests.find(request => request.path === '/v1/chat/completions')
    expect(inference?.authorization).toBe('Bearer short-inference-key')
    expect(f.requests.find(request => request.path === '/api/v1/user/desktop/authorize')?.authorization).toBe('Bearer browser-login')
    expect(f.requests.find(request => request.path === '/api/v1/desktop/profile')?.authorization).toBe('Bearer desktop-access-1')
    const stored = await readFile(join(f.home, 'credentials.yaml'), 'utf8')
    expect(stored).not.toContain('password-not-stored')
    expect(stored).not.toContain('browser-login')
    expect(stored).not.toContain('short-inference-key')
    expect(JSON.stringify(state)).not.toMatch(/desktop-access|desktop-refresh|short-inference-key|browser-login/)
    expect(f.requests.some(request => request.path === '/api/v1/auth/logout')).toBe(true)
  })

  it('uses the platform two-factor challenge before creating desktop authorization', async () => {
    const f = await fixture()
    f.requireTwoFactor()
    const first = await f.account.signInWithPassword('user@example.com', 'password-not-stored')
    expect(first.status).toBe('two-factor')
    expect(JSON.stringify(first)).not.toContain('two-factor-session')
    expect(f.requests.some(request => request.path === '/api/v1/user/desktop/authorize')).toBe(false)
    const finished = await f.account.finishTwoFactor('123456')
    expect(finished.status).toBe('signed-in')
    expect(f.requests.find(request => request.path.endsWith('/login/2fa'))?.body).toEqual({ temp_token: 'two-factor-session', totp_code: '123456' })
  })

  it('accepts only the active browser callback and rejects replay after completion', async () => {
    const f = await fixture({ groups: [{ id: 8, name: 'First', platform: 'openai' }, { id: 3, name: 'Second', platform: 'openai' }] })
    const state = await f.account.startSignIn()
    expect(state.authorizationUrl).not.toBeNull()
    const authorization = new URL(state.authorizationUrl!)
    expect(authorization.origin).toBe(f.origin)
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'one-use-code')
    callback.searchParams.set('state', 'wrong-state')
    expect((await fetch(callback)).status).toBe(400)
    expect((await f.account.getState()).status).toBe('signing-in')
    callback.searchParams.set('state', authorization.searchParams.get('state')!)
    const success = await fetch(callback)
    expect(success.status).toBe(200)
    expect(success.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(success.headers.get('content-security-policy')).toContain("default-src 'none'")
    const page = await success.text()
    expect(page).not.toContain('one-use-code')
    expect(page).not.toContain(authorization.searchParams.get('state'))
    await expect(page + '\n').toMatchFileSnapshot('./expected/authorization-success.html')
    expect(await f.account.getState()).toMatchObject({ status: 'signed-in', selectedGroup: '8', models: ['relay-model'] })
    expect((await fetch(callback)).status).toBe(404)
  })

  it('cancels an exchanging attempt without admitting its late token response', async () => {
    const f = await fixture()
    f.holdExchange()
    const state = await f.account.startSignIn()
    const authorization = new URL(state.authorizationUrl!)
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'one-use-code')
    callback.searchParams.set('state', authorization.searchParams.get('state')!)
    const returning = fetch(callback)
    await f.exchangeStarted.promise
    expect((await f.account.cancelSignIn()).status).toBe('signed-out')
    f.releaseExchange.resolve(undefined)
    expect((await returning).status).toBe(400)
    expect((await f.account.getState()).status).toBe('signed-out')
    expect(f.context.llm.listProviders()).toEqual([])
  })

  it('renders a denied authorization as a failure without exchanging a code', async () => {
    const f = await fixture()
    const pending = await f.account.startSignIn()
    const authorize = new URL(pending.authorizationUrl!)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('error', 'access_denied')
    const response = await fetch(callback)
    expect(response.status).toBe(400)
    const page = await response.text()
    expect(page).toContain('授权未完成')
    expect(page).not.toContain('登录成功')
    expect((await f.account.getState()).status).toBe('signed-out')
    expect(f.requests.some(request => request.path.endsWith('/oauth/token'))).toBe(false)
  })

  it('retains a login on transient profile failure and removes it after explicit rejection', async () => {
    const f = await fixture()
    await f.account.signInWithPassword('user@example.com', 'password')
    f.failProfile()
    const failed = await f.account.refresh()
    expect(failed.status).toBe('signed-in')
    expect(failed.profile?.balance).toBe(12.5)
    f.rejectProfile()
    const expired = await f.account.refresh()
    expect(expired.status).toBe('signed-out')
    expect(expired.profile).toBeNull()
    expect(f.context.llm.listProviders()).toEqual([])
    expect(await readFile(join(f.home, 'credentials.yaml'), 'utf8')).not.toContain('desktop-refresh')
  })

  it('clears credentials and withdraws old-account model routes on sign-out', async () => {
    const f = await fixture()
    await f.account.signInWithPassword('user@example.com', 'password')
    const signedOut = await f.account.signOut()
    expect(signedOut.error).toBeNull()
    expect(signedOut.status).toBe('signed-out')
    expect(f.context.llm.listProviders()).toEqual([])
    expect(await readFile(join(f.home, 'credentials.yaml'), 'utf8')).not.toContain('desktop-refresh')
    f.useOtherUser()
    await f.account.signInWithPassword('other@example.com', 'password')
    expect(f.context.llm.listProviders().map(provider => provider.id)).toEqual(['sub2api-u8-g3'])
    const invalid = await f.account.selectGroup('999' as Sub2apiGroupId)
    expect(invalid.error).toBe('authorization')
    expect(invalid.selectedGroup).toBe('3')
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u8-g3', model: 'relay-model' })
    const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
    await entry.update({ disabled: true })
    expect(f.context.llm.listProviders()).toEqual([])
    const chunks = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk)
    expect(chunks.find(chunk => chunk.type === 'finish')).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
    expect(f.requests.filter(request => request.path === '/v1/chat/completions')).toHaveLength(0)
  })
})
