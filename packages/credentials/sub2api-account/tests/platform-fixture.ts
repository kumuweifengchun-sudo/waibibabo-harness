/** Synthetic platform services used by native account tests; no payment provider or image model is contacted. */
import type { ServerResponse } from 'node:http'
import { expect } from 'vitest'
import { accountFixture } from './account-fixture.ts'
import type { InvoiceId, InvoiceRequest, InvoiceRequestKey, Sub2apiGroupId } from '../src/types.ts'

export const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlqI4sAAAAASUVORK5CYII='
export const invoiceFileId = '11111111-1111-4111-8111-111111111111'
export const invoiceRecord = { id: 11, user_id: 7, kind: 'personal', title: '测试发票', tax_id: '', email: 'user@example.com',
  amount_cents: 53000, payment_amount_cents: 50000, fee_cents: 3000, version: 1, status: 'pending', email_status: 'unsent',
  created_at: '2026-11-12T08:00:00Z', files: [{ id: invoiceFileId, name: 'proof.png', mime: 'image/png', size: Buffer.from(pixel, 'base64').length, kind: 'payment' }] }
export const orderRecord = { id: 19, user_id: 7, out_trade_no: 'fake-order-19', amount: 10, pay_amount: 10.2, currency: 'CNY',
  status: 'PENDING', order_type: 'balance', payment_type: 'alipay', created_at: '2026-11-12T08:00:00Z', expires_at: '2026-11-12T09:00:00Z' }
export const checkoutRecord = { methods: { alipay: { payment_type: 'alipay', currency: 'CNY', display_name: '支付宝',
  single_min: 1, single_max: 5000, daily_limit: 10000, fee_rate: 2 } },
plans: [{ id: 3, name: '标准套餐', description: '样例套餐', price: 20, currency: 'CNY', validity_days: 30, validity_unit: 'day', group_name: 'OpenAI', features: ['每日额度'] }],
balance_disabled: false, balance_recharge_multiplier: 1, subscription_usd_to_cny_rate: 0, recharge_bonus_tiers: [], help_text: '测试支付说明' }

/** @returns an application with independent screenshot evidence and one stable retry key. */
export function invoiceInput(): InvoiceRequest {
  return { id: null, kind: 'personal', title: '测试发票', taxId: '', email: 'user@example.com', paymentAmount: '500', version: 0,
    requestKey: 'native-invoice-request-01' as InvoiceRequestKey, retained: [], files: [
      { name: 'purchase.png', mime: 'image/png', base64: pixel, kind: 'payment' },
      { name: 'fee.png', mime: 'image/png', base64: Buffer.concat([Buffer.from(pixel, 'base64'), Buffer.from([0])]).toString('base64'), kind: 'fee_payment' },
    ] }
}

/** @returns a scoped account and synthetic feature controls, released by accountFixture. */
export async function platformFixture() {
  let gateways: Array<{ name: string; endpoint: string; description: string }> = []
  let failure: { path: string; status: number; reason: string } | undefined
  let paymentMode: 'url' | 'qr' | 'stripe' = 'url'
  const forms: FormData[] = []
  const imageForms: FormData[] = []
  const json = (res: ServerResponse, data: unknown, envelope = true) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(envelope ? { code: 0, data } : data))
  }
  const f = await accountFixture({ protocol: 'auto', feature: async (req, res, raw) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (failure?.path === path) { res.statusCode = failure.status; json(res, { reason: failure.reason, message: 'private upstream details' }, false); return true }
    if (path === '/api/v1/desktop/groups') {
      json(res, [{ id: 3, name: 'Claude', platform: 'anthropic', allow_image_generation: false },
        { id: 4, name: 'Images', platform: 'openai', allow_image_generation: true }]); return true
    }
    if (path === '/api/v1/desktop/gateways') { json(res, { api_base_url: `http://${req.headers.host}`, custom_endpoints: gateways }); return true }
    if (path === '/api/v1/desktop/key') {
      const body = JSON.parse(raw.toString()) as { group_id: number }
      json(res, { id: 19, group_id: body.group_id, key: `short-group-${body.group_id}`, expires_at: new Date(Date.now() + 600000).toISOString() }); return true
    }
    if (path === '/v1/images/generations') { expect(req.headers.authorization).toBe('Bearer short-group-4'); json(res, { data: [{ b64_json: pixel }] }, false); return true }
    if (path === '/v1/images/edits') {
      expect(req.headers.authorization).toBe('Bearer short-group-4')
      imageForms.push(await new Request('http://local', { method: 'POST',
        headers: { 'Content-Type': req.headers['content-type'] ?? '' }, body: new Uint8Array(raw) }).formData())
      json(res, { data: [{ b64_json: pixel }] }, false); return true
    }
    if (path === '/api/v1/desktop/payment/config') { json(res, { enabled: true }); return true }
    if (path === '/api/v1/desktop/payment/checkout-info') { json(res, checkoutRecord); return true }
    if (path === '/api/v1/desktop/subscriptions') {
      json(res, { subscriptions: [{ id: 5, group_id: 4, group_name: 'Images', status: 'active',
        daily_used_usd: 1, daily_limit_usd: 4, monthly_used_usd: 5, monthly_limit_usd: 100 },
      { id: 6, group_id: 3, group_name: 'Standard', status: 'active', daily_limit_usd: 10,
        expires_at: '2099-01-01T00:00:00Z' }] }); return true
    }
    if (path === '/api/v1/desktop/payment/orders') {
      json(res, { order_id: 19, amount: 10, pay_amount: 10.2, currency: 'CNY', expires_at: orderRecord.expires_at,
        ...(paymentMode === 'qr' ? { qr_code: 'weixin://wxpay/test-order' }
          : paymentMode === 'stripe' ? { client_secret: 'must-stay-on-host', resume_token: 'order-resume-19' } : { pay_url: 'https://pay.example/order/19' }) }); return true
    }
    if (path === '/api/v1/desktop/payment/orders/my') { json(res, { items: [orderRecord], total: 1, page: 1, page_size: 20 }); return true }
    if (path === '/api/v1/desktop/payment/orders/19') { json(res, orderRecord); return true }
    if (path === '/api/v1/desktop/payment/orders/verify') { json(res, { ...orderRecord, status: 'COMPLETED' }); return true }
    if (path === '/api/v1/desktop/payment/orders/19/cancel') { json(res, null); return true }
    if (path === '/api/v1/desktop/invoices/quote') { json(res, { payment_amount_cents: 50000, fee_cents: 3000, amount_cents: 53000 }); return true }
    if (path === `/api/v1/desktop/invoices/11/files/${invoiceFileId}`) {
      res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from(pixel, 'base64')); return true
    }
    if (path === '/api/v1/desktop/invoices' || path === '/api/v1/desktop/invoices/11') {
      if (req.method === 'POST' || req.method === 'PUT') {
        const request = new Request('http://local', { method: req.method,
          headers: { 'Content-Type': req.headers['content-type'] ?? '' }, body: new Uint8Array(raw) })
        forms.push(await request.formData()); json(res, invoiceRecord)
      } else json(res, path.endsWith('/11') ? invoiceRecord : { items: [invoiceRecord], total: 1 })
      return true
    }
    return false
  } })
  await f.account.signInWithPassword('user@example.com', 'password')
  await f.account.selectGroup('3' as Sub2apiGroupId)
  return { ...f, forms, imageForms, setGateways: (value: typeof gateways) => { gateways = value },
    fail: (path: string, status: number, reason = 'unavailable') => { failure = { path, status, reason } }, clearFailure: () => { failure = undefined },
    paymentMode: (value: typeof paymentMode) => { paymentMode = value }, invoiceId: '11' as InvoiceId }
}
