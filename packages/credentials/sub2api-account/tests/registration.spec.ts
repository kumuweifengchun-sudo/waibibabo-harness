import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { accountFixture } from './account-fixture.ts'
import type { RegistrationId } from '../src/types.ts'

it('registers with one email-bound attempt and keeps website credentials on the Host', async () => {
  const f = await accountFixture({ feature: (req, res) => {
    let data: object
    switch (req.url) {
      case '/api/v1/settings/public': data = { registration_enabled: true, email_verify_enabled: true,
        registration_code_enabled: true, affiliate_enabled: true, login_agreement_enabled: true,
        login_agreement_documents: [{ id: 'terms', title: 'Terms' }] }; break
      case '/api/v1/auth/registration-attempts': data = { attempt_token: 'platform-attempt' }; break
      case '/api/v1/auth/send-verify-code': data = { countdown: 60 }; break
      case '/api/v1/auth/register': data = { access_token: 'website-only', refresh_token: 'revoke-me' }; break
      case '/api/v1/auth/logout': data = {}; break
      default: return false
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 0, data }))
    return true
  } })
  const id = randomUUID() as RegistrationId
  const email = 'new@example.com'
  const policy = await f.account.getRegistrationOptions()
  expect(policy).toMatchObject({ ok: true, data: { emailVerification: true, registrationCode: true, affiliate: true,
    captcha: false, agreements: [{ id: 'terms', title: 'Terms' }] } })
  expect(await f.account.sendRegistrationCode(id, email, 'reg')).toEqual({ ok: true, data: 60 })
  expect(await f.account.registerAccount({ id, email, password: 'example-password', registrationCode: 'reg',
    affiliate: 'friend', promo: '', emailCode: '123456' })).toEqual({ ok: true, data: null })
  expect(f.requests.filter(row => row.path.endsWith('/registration-attempts'))).toHaveLength(1)
  expect(f.requests.find(row => row.path === '/api/v1/auth/register')?.body).toMatchObject({
    email, registration_code: 'reg', verify_code: '123456', aff_code: 'friend', registration_attempt_token: 'platform-attempt',
  })
  expect(f.requests.find(row => row.path === '/api/v1/auth/logout')?.body).toEqual({ refresh_token: 'revoke-me' })
})
