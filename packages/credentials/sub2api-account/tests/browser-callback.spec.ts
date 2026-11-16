/** Browser OAuth returns retain listener isolation and ordinary HTTP admission. */
import { request } from 'node:http'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it, onTestFinished } from 'vitest'
import { accountFixture } from './account-fixture.ts'

const browserHeaders = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }

function callbackUrl(authorizationUrl: string): URL {
  const authorization = new URL(authorizationUrl)
  const callback = new URL(authorization.searchParams.get('redirect_uri')!)
  callback.searchParams.set('state', authorization.searchParams.get('state')!)
  callback.searchParams.set('code', 'one-use-code')
  return callback
}

function statusWithHost(url: URL, host: string, path?: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const options = { agent: false as const, headers: { ...browserHeaders, host }, ...path === undefined ? {} : { path } }
    const outgoing = request(url, options, (response) => {
      response.on('error', reject)
      response.once('end', () => { resolve(response.statusCode) })
      response.resume()
    })
    const closed = new Promise<void>((resolve) => { outgoing.once('close', resolve) })
    onTestFinished(async () => { outgoing.destroy(); await closed })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

it('admits the OAuth return while retaining cross-site checks for unrelated anonymous routes', async () => {
  const f = await accountFixture()
  f.context.effect(() => f.context.webServer.register({
    kind: 'exact', path: '/public', auth: 'anonymous', handler: (_request, response) => { response.end('public') },
  }), 'test public route')
  const publicUrl = new URL('/public', f.context.webServer.getOrigin())
  expect((await fetch(publicUrl, { headers: browserHeaders })).status).toBe(403)
  expect(await (await fetch(publicUrl)).text()).toBe('public')

  const pending = await f.account.startSignIn()
  const callback = callbackUrl(pending.authorizationUrl!)
  expect((await fetch(callback, { method: 'POST', headers: browserHeaders })).status).toBe(405)
  expect(f.requests.filter(value => value.path.endsWith('/oauth/token'))).toHaveLength(0)
  const response = await fetch(callback, { headers: { ...browserHeaders, origin: f.origin } })
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('登录成功')
  expect((await f.account.getState()).status).toBe('signed-in')
  expect((await fetch(publicUrl, { headers: browserHeaders })).status).toBe(403)
})

it('leaves the attempt unconsumed for other authorities, paths and HTTP listeners', async () => {
  const f = await accountFixture()
  const pending = await f.account.startSignIn()
  const callback = callbackUrl(pending.authorizationUrl!)
  for (const host of ['untrusted.invalid', '127.0.0.1:1', '[invalid']) {
    expect(await statusWithHost(callback, host)).toBe(404)
  }
  expect(await statusWithHost(callback, callback.host, `/unrelated${callback.search}`)).toBe(404)
  expect(await statusWithHost(callback, callback.host, `http://untrusted.invalid${callback.pathname}${callback.search}`)).toBe(404)
  expect(await statusWithHost(callback, callback.host, 'http://[')).toBe(400)

  const isolated = f.context.isolate('webServer')
  await isolated.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
  isolated.effect(() => isolated.webServer.register({
    kind: 'exact', path: callback.pathname, auth: 'anonymous', handler: (_request, response) => { response.writeHead(204).end() },
  }), 'test isolated callback route')
  const other = new URL(callback.pathname + callback.search, isolated.webServer.getOrigin())
  expect(await statusWithHost(other, callback.host)).toBe(204)
  expect(f.requests.filter(value => value.path.endsWith('/oauth/token'))).toHaveLength(0)
  expect((await f.account.getState()).status).toBe('signing-in')
  expect((await fetch(callback, { headers: browserHeaders })).status).toBe(200)
})

it('rejects ambiguous authorization parameters without consuming the pending login', async () => {
  const f = await accountFixture()
  const pending = await f.account.startSignIn()
  const callback = callbackUrl(pending.authorizationUrl!)
  for (const extra of [`&state=${callback.searchParams.get('state')!}`, '&code=second', '&error=access_denied']) {
    expect((await fetch(callback.href + extra, { headers: browserHeaders })).status).toBe(400)
  }
  const missingCode = new URL(callback)
  missingCode.searchParams.delete('code')
  expect((await fetch(missingCode, { headers: browserHeaders })).status).toBe(400)
  expect(f.requests.filter(value => value.path.endsWith('/oauth/token'))).toHaveLength(0)
  expect((await f.account.getState()).status).toBe('signing-in')
  expect((await fetch(callback, { headers: browserHeaders })).status).toBe(200)
})

it('removes callback admission on cancellation and plugin disposal', async () => {
  const f = await accountFixture()
  const first = callbackUrl((await f.account.startSignIn()).authorizationUrl!)
  await f.account.cancelSignIn()
  expect((await fetch(first, { headers: browserHeaders })).status).toBe(404)
  const second = callbackUrl((await f.account.startSignIn()).authorizationUrl!)
  expect((await fetch(first, { headers: browserHeaders })).status).toBe(400)
  const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
  await entry.update({ disabled: true })
  expect((await fetch(second, { headers: browserHeaders })).status).toBe(404)
  expect(f.requests.filter(value => value.path.endsWith('/oauth/token'))).toHaveLength(0)
})
