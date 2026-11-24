import { createServer } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { checkoutRecord, pixel, invoiceFileId, invoiceInput, orderRecord, platformFixture } from './platform-fixture.ts'
import type { GatewayId, ImageReferenceId, InvoiceFileId, PaymentChannelId, PaymentOrderId, Sub2apiGroupId, SubscriptionPlanId } from '../src/types.ts'

import { accountFixture } from './account-fixture.ts'

const close: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of close.splice(0)) await stop() })

it('quotes, confirms, resumes and checks split payments using the desktop grant', async () => {
  const root = '/api/v1/desktop/payment'
  const offer = { amount_cents: 15_000, pay_cents: 15_000, credit_cents: 15_000, bonus_cents: 0, completion_bonus_cents: 0,
    channel_id: '31', channel_name: 'Alipay', parts: [{ pay_cents: 7_501 }, { pay_cents: 7_499 }], quote_token: 'price-token' }
  const progress = { ...offer, id: 41, status: 'OPEN', paid_cents: 0, credited_cents: 0, awarded_bonus_cents: 0,
    next_part: 1, can_continue: true, code_uncertain: false, payments: [], expires_at: '2099-01-01T00:00:00Z' }
  const f = await accountFixture({ feature: (req, res) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (!path.startsWith(root)) return false
    let result: object = progress
    if (path.endsWith('/quote')) result = offer
    else if (path.endsWith('/verify-alipay-ledger')) result = { ...orderRecord, status: 'PAID_EXPIRED' }
    else if (path.endsWith('/orders/19')) result = orderRecord
    else if (path.endsWith('/recharge-batches') && req.method === 'GET') result = [progress]
    else if (path.endsWith('/continue')) result = { ...progress, can_continue: false,
      payment: { order_id: 19, amount: 75.01, pay_amount: 75.01, expires_at: progress.expires_at, qr_code: 'https://pay.example/19' },
      payments: [{ order_id: 19, part: 1, status: 'PENDING' }] }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: result }))
    return true
  } })
  await f.account.signInWithPassword('user@example.com', 'password')
  const channelId = '31' as PaymentChannelId
  const quote = await f.account.quoteRechargeBatch(15_000, channelId)
  expect(quote).toMatchObject({ ok: true, data: { token: 'price-token', parts: [{ payCents: 7_501 }, { payCents: 7_499 }] } })
  const key = '11111111-1111-4111-8111-111111111111'
  const confirmed = await f.account.updateRechargeBatch({ kind: 'confirm', amountCents: 15_000, channelId, token: 'price-token', key })
  expect(confirmed).toMatchObject({ ok: true, data: { id: '41', canContinue: true } })
  if (!confirmed.ok) throw new Error('Missing batch')
  const continued = await f.account.updateRechargeBatch({ kind: 'continue', id: confirmed.data.id, part: 1 })
  expect(continued).toMatchObject({ ok: true, data: { payment: { id: '19' } } })
  if (!continued.ok) throw new Error('Missing payment')
  expect(continued.data.payment?.qrCode).toMatch(/^data:image\/png/u)
  expect(await f.account.getRechargeBatches()).toMatchObject({ ok: true, data: [{ id: '41' }] })
  expect(await f.account.getOrder('19' as PaymentOrderId, true, true)).toMatchObject({ ok: true, data: { status: 'PAID_EXPIRED' } })
  const calls = f.requests.filter(request => request.path.startsWith(root))
  expect(calls.every(request => request.authorization === 'Bearer desktop-access-1')).toBe(true)
  expect(calls.find(request => request.body.idempotency_key)?.body).toEqual({
    amount: 150, channel_id: '31', quote_token: 'price-token', idempotency_key: key,
  })
})

it('keeps account grants on the main origin and switches only approved inference endpoints', async () => {
  const calls: Array<{ path: string; authorization: string | undefined }> = []
  const relay = createServer((req, res) => {
    calls.push({ path: req.url ?? '', authorization: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'relay-claude' }] }))
  })
  await new Promise<void>(resolve => relay.listen(0, '127.0.0.1', resolve))
  close.push(() => new Promise<void>((resolve) => { relay.close(() =>{  resolve() }); relay.closeAllConnections() }))
  const address = relay.address()
  if (address === null || typeof address === 'string') throw new Error('relay missing')
  const origin = `http://127.0.0.1:${address.port}`
  const f = await platformFixture()
  f.setGateways([{ name: '备用线路', endpoint: origin + '/v1', description: 'test only' }])
  expect(await f.account.setGateway('https://unknown.example' as GatewayId, false)).toMatchObject({ ok: false, error: 'gateway-unavailable' })
  expect(await f.account.setGateway(origin as GatewayId, false)).toMatchObject({ ok: false, error: 'insecure-gateway' })
  expect(calls).toEqual([])
  expect(await f.account.setGateway(origin as GatewayId, true)).toMatchObject({ ok: true, data: { selected: origin } })
  expect(calls).toEqual([{ path: '/v1/models', authorization: 'Bearer short-group-3' }])
  expect((await f.account.getState()).platformOrigin).toBe(f.origin)
  expect(JSON.stringify(await f.account.getGateways())).not.toContain('desktop-access')
  f.setGateways([])
  await f.account.getGateways()
  expect((await f.account.refresh()).error).toBe('gateway-unavailable')
})

it('generates authorized images without changing the conversation group or exposing its lease', async () => {
  const f = await platformFixture()
  const input = { groupId: '4' as Sub2apiGroupId, model: 'gpt-image-2', prompt: 'A blue square', count: 1, size: '1024x1024' }
  expect(await f.account.getImageModels('4' as Sub2apiGroupId)).toMatchObject({ ok: true, data: ['relay-model'] })
  expect(f.requests.find(request => request.path === '/v1/models' && request.authorization === 'Bearer short-group-4')).toBeDefined()
  expect(await f.account.getImageModels('3' as Sub2apiGroupId)).toMatchObject({ ok: false, error: 'unavailable' })
  expect(await f.account.generateImages({ ...input, groupId: '3' as Sub2apiGroupId })).toMatchObject({ ok: false, error: 'unavailable' })
  const result = await f.account.generateImages(input)
  expect(result).toMatchObject({ ok: true, data: { images: [{ source: 'data:image/png;base64,' + pixel }] } })
  expect((await f.account.getState()).selectedGroup).toBe('3')
  expect(JSON.stringify(result)).not.toMatch(/short-group|desktop-access/)
  const requests = f.requests.filter(request => request.path === '/v1/images/generations')
  expect(requests).toHaveLength(1)
  expect(requests[0]?.body).toEqual({ model: 'gpt-image-2', prompt: 'A blue square', n: 1, size: '1024x1024' })
})

it('sends reference bytes to the editing endpoint with only the selected group lease', async () => {
  const f = await platformFixture()
  const references = ['first.png', 'second.png'].map(name => ({ id: name as ImageReferenceId, name, mime: 'image/png', base64: pixel }))
  const input = { groupId: '4' as Sub2apiGroupId, model: 'gpt-image-2', prompt: 'Combine the references', count: 2, size: '1024x1024', references }
  expect(await f.account.generateImages(input)).toMatchObject({ ok: true, data: { images: [{ source: 'data:image/png;base64,' + pixel }] } })
  const form = f.imageForms[0]!
  expect(Object.fromEntries(['model', 'prompt', 'n', 'size'].map(key => [key, form.get(key)]))).toEqual({
    model: input.model, prompt: input.prompt, n: '2', size: input.size,
  })
  const files = form.getAll('image[]')
  expect(files).toHaveLength(2)
  for (const [index, file] of files.entries()) {
    if (typeof file === 'string') throw new Error('Expected uploaded file')
    expect(file.name).toBe(references[index]?.name)
    expect(file.type).toBe('image/png')
    expect(Buffer.from(await file.arrayBuffer()).toString('base64')).toBe(pixel)
  }
  expect((await f.account.getState()).selectedGroup).toBe('3')
  expect(f.requests.filter(request => request.path === '/v1/images/generations')).toHaveLength(0)
  expect(await f.account.generateImages({ ...input, references: [{ ...references[0]!, mime: 'image/jpeg' }] })).toMatchObject({ ok: false, error: 'validation' })
  expect(await f.account.generateImages({ ...input, groupId: '3' as Sub2apiGroupId })).toMatchObject({ ok: false, error: 'unavailable' })
  expect(f.requests.filter(request => request.path === '/v1/images/edits')).toHaveLength(1)
  f.fail('/v1/images/edits', 500)
  expect(await f.account.generateImages(input)).toMatchObject({ ok: false, error: 'uncertain' })
  expect(f.requests.filter(request => request.path === '/v1/images/edits')).toHaveLength(2)
})

it('sends the selected Alipay channel for a native recharge and excludes exhausted channel capacity', async () => {
  const limits = { ...checkoutRecord.methods.alipay, sort_order: 1, daily_limit: 100, daily_remaining: 50, available: true }
  const checkout = { ...checkoutRecord, payment_channels: [
    { ...limits, channel_id: '7', channel_name: '停用渠道', daily_remaining: 0, available: false },
    { ...limits, channel_id: '9', channel_name: '支付宝二号' },
  ] }
  const f = await platformFixture(checkout)
  const result = await f.account.getCheckout()
  if (!result.ok) throw new Error('checkout unavailable')
  expect(result.data.methods).toMatchObject([{ channelId: '7', available: false }, { channelId: '9', available: true, maximum: 50 }])
  const selected = result.data.methods[1]!
  if (!selected.channelId) throw new Error('selected channel missing')
  const order = await f.account.createOrder({ kind: 'balance', amount: 12, method: selected.id, channelId: selected.channelId, planId: null })
  expect(order.ok).toBe(true)
  expect(f.requests.find(request => request.path === '/api/v1/desktop/payment/orders')?.body).not.toHaveProperty('return_url')
  expect(f.requests.find(request => request.path === '/api/v1/desktop/payment/orders')?.body).toMatchObject({
    order_type: 'balance', amount: 12, payment_type: 'alipay', channel_id: '9',
  })
})

it('uses the website checkout, owned order verification and supported payment destinations', async () => {
  const f = await platformFixture()
  expect(await f.account.getCheckout()).toMatchObject({ ok: true, data: { enabled: true, plans: [{ name: '标准套餐' }], methods: [{ name: '支付宝' }] } })
  const input = { amount: 10, method: 'alipay', kind: 'balance' as const, planId: null }
  expect(await f.account.createOrder(input)).toMatchObject({ ok: true, data: { id: '19', paymentUrl: 'https://pay.example/order/19', payAmount: 10.2 } })
  f.paymentMode('qr')
  const qr = await f.account.createOrder(input)
  expect(qr.ok && qr.data.qrCode?.startsWith('data:image/png;base64,')).toBe(true)
  f.paymentMode('stripe')
  const stripe = await f.account.createOrder(input)
  expect(JSON.stringify(stripe)).not.toContain('must-stay-on-host')
  expect(stripe.ok && stripe.data.paymentUrl).toBe(f.origin + '/payment/stripe?order_id=19&resume_token=order-resume-19')
  expect(await f.account.getOrder('19' as PaymentOrderId, true)).toMatchObject({ ok: true, data: { status: 'COMPLETED' } })
  expect(await f.account.cancelOrder('19' as PaymentOrderId)).toEqual({ ok: true, data: null })
  expect(await f.account.getOrders({ page: 1, pageSize: 20, status: '' })).toMatchObject({ ok: true, data: { total: 1 } })
  expect(await f.account.getSubscriptions()).toMatchObject({ ok: true, data: [
    { group: 'Images', daily: 25, weekly: null, monthly: 5, expiresAt: null },
    { group: 'Standard', daily: 0, weekly: null, monthly: null, expiresAt: '2099-01-01T00:00:00Z' },
  ] })
  expect(f.requests.filter(request => request.path.includes('/payment/')).every(request => request.authorization === 'Bearer desktop-access-1')).toBe(true)
})

it.each(['PAYMENT_GATEWAY_ERROR', 'WECHAT_H5_NOT_AUTHORIZED'])('reports a rejected subscription payment safely without retrying %s', async (reason) => {
  const f = await platformFixture()
  f.fail('/api/v1/desktop/payment/orders', 502, reason)
  const result = await f.account.createOrder({ amount: 20, kind: 'subscription', method: 'alipay', planId: '3' as SubscriptionPlanId })
  expect(result).toEqual({ ok: false, error: 'payment-gateway' })
  expect(f.requests.filter(request => request.path === '/api/v1/desktop/payment/orders')).toHaveLength(1)
  expect((await f.account.getState()).status).toBe('signed-in')
})

it('submits both evidence categories with the original retry key and downloads only an owned file', async () => {
  const f = await platformFixture()
  const input = invoiceInput()
  expect(await f.account.quoteInvoice('500')).toMatchObject({ ok: true, data: { feeCents: 3000, amountCents: 53000 } })
  expect(await f.account.saveInvoice(input)).toMatchObject({ ok: true, data: { id: '11', title: input.title } })
  expect(f.forms[0]?.getAll('files')).toHaveLength(1)
  expect(f.forms[0]?.getAll('fee_files')).toHaveLength(1)
  const formData = f.forms[0]?.get('data')
  if (typeof formData !== 'string') throw new Error('Missing invoice fields')
  expect(JSON.parse(formData)).toMatchObject({ request_key: input.requestKey, payment_amount: '500', retain_ids: [] })
  expect(await f.account.getInvoices({ page: 1, pageSize: 20, status: '' })).toMatchObject({ ok: true, data: { total: 1 } })
  expect(await f.account.getInvoice(f.invoiceId)).toMatchObject({ ok: true, data: { id: '11' } })
  expect(await f.account.getInvoiceFile(f.invoiceId, 'other-file' as InvoiceFileId)).toMatchObject({ ok: false, error: 'unavailable' })
  expect(await f.account.getInvoiceFile(f.invoiceId, invoiceFileId as InvoiceFileId)).toMatchObject({ ok: true, data: { name: 'proof.png', mime: 'image/png', base64: pixel } })
})

it('does not replay uncertain purchases or images and keeps the account for recoverable errors', async () => {
  const f = await platformFixture()
  f.fail('/api/v1/desktop/payment/orders', 500)
  expect(await f.account.createOrder({ amount: 10, kind: 'balance', method: 'alipay', planId: null })).toMatchObject({ ok: false, error: 'uncertain' })
  expect(f.requests.filter(request => request.path === '/api/v1/desktop/payment/orders')).toHaveLength(1)
  f.fail('/v1/images/generations', 500)
  expect(await f.account.generateImages({ groupId: '4' as Sub2apiGroupId, model: 'gpt-image-2', prompt: 'blue', count: 1, size: '' })).toMatchObject({ ok: false, error: 'uncertain' })
  expect(f.requests.filter(request => request.path === '/v1/images/generations')).toHaveLength(1)
  expect((await f.account.getState()).status).toBe('signed-in')
  f.fail('/api/v1/desktop/payment/config', 401)
  await f.account.getCheckout()
  expect((await f.account.getState()).status).toBe('signed-out')
})
