// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createPlatformClient, type PlatformRemote } from '../src/client/platform-client.ts'
import { ModelSection } from '../src/client/ModelSection.tsx'
import { ImagePanel } from '../src/client/ImagePanel.tsx'
import { BillingSection } from '../src/client/BillingSection.tsx'
import { InvoiceSection } from '../src/client/InvoiceSection.tsx'
import { initialUsageState } from '../src/client/usage-state.ts'
import type { AccountInjected, ClientAccountState } from '../src/client/AccountSection.tsx'
import type { PlatformProps } from '../src/client/PlatformCommon.tsx'
import type { AccountView, CheckoutView, GatewayId, ImageOutputId, InvoiceId, InvoiceRequest, PaymentOrderId,
  Sub2apiGroupId, Sub2apiUserId, SubscriptionPlanId } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

const releases: Array<() => void> = []
afterEach(() => { cleanup(); for (const release of releases.splice(0)) release(); vi.restoreAllMocks() })
const failure = () => Promise.resolve({ ok: true as const, value: { ok: false as const, error: 'network' as const } })
const gateways = { endpoints: [
  { id: 'https://platform.example' as GatewayId, origin: 'https://platform.example', name: '主站', description: '', insecure: false },
  { id: 'http://39.106.5.29' as GatewayId, origin: 'http://39.106.5.29', name: '专用线路', description: '', insecure: true },
], selected: 'https://platform.example' as GatewayId }
const invoice = { id: '11' as InvoiceId, kind: 'personal' as const, title: '样例发票', taxId: '', email: 'user@example.com',
  amountCents: 53000, paymentAmountCents: 50000, feeCents: 3000, version: 1, status: 'pending', emailStatus: 'unsent', createdAt: '', note: '', files: [] }

const testPlan = { id: '5' as SubscriptionPlanId, name: '测试订阅', description: '**套餐说明**', group: 'Standard', price: 10,
  currency: 'CNY', validity: 30, validityUnit: 'day', features: [] }

function fixture(plans: CheckoutView['plans'] = []) {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  releases.push(() => {
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })
  const view: AccountView = { productName: 'Waibibabo Harnesss', platformOrigin: 'https://platform.example', status: 'signed-in', authorizationUrl: null,
    profile: { id: '7' as Sub2apiUserId, email: 'user@example.com', name: 'Example', balance: 10 }, groups: [
      { id: '3' as Sub2apiGroupId, name: 'Standard', platform: 'openai', imageGeneration: true },
    ], selectedGroup: '3' as Sub2apiGroupId, models: ['gpt-5.1', 'gpt-image-2'],
    modelLimitOverrides: {}, balanceStale: false,
    modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 }, modelProtocols: [
      { model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses', transport: 'sse' },
    ], usage: null, error: null }
  const account = createSnapshotStore<ClientAccountState>({ view, busy: false, failed: false, loginVisible: false, usageVisible: false })
  const actions: AccountInjected = { hooks: { account, usage: createSnapshotStore(initialUsageState()) },
    signIn: vi.fn(async () => {}), start: vi.fn(async () => {}), verify: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}), refresh: vi.fn(async () => {}), selectGroup: vi.fn(async () => {}),
    setAccountOrigin: vi.fn(async () => {}),
    setProtocol: vi.fn(async () => {}), setTransport: vi.fn(async () => {}),
    setModelLimitOverride: vi.fn(async () => {}), setModelLimits: vi.fn(async () => {}),
    showLogin: vi.fn(), showUsage: vi.fn(), loadUsage: vi.fn(async () => {}) }
  const remote = {
    getGateways: vi.fn<PlatformRemote['getGateways']>(async () => ({ ok: true, value: { ok: true, data: gateways } })),
    setGateway: vi.fn<PlatformRemote['setGateway']>(async (id: GatewayId | null) => ({ ok: true, value: { ok: true, data: { ...gateways, selected: id } } })),
    generateImages: vi.fn<PlatformRemote['generateImages']>(failure),
    getImageModels: vi.fn<PlatformRemote['getImageModels']>(async () => ({ ok: true, value: { ok: true, data: ['gpt-image-2', 'flux-2'] } })),
    getCheckout: vi.fn<PlatformRemote['getCheckout']>(async () => ({ ok: true, value: { ok: true, data: { enabled: true, balanceDisabled: false,
      methods: [{ id: 'alipay', name: '支付宝', currency: 'CNY', minimum: 1, maximum: 5000, feeRate: 2, available: true }],
      plans, balanceMultiplier: 1, subscriptionExchangeRate: 0, bonusMode: 'bonus', bonusTiers: [], notice: '', help: '' } } })),
    getSubscriptions: vi.fn<PlatformRemote['getSubscriptions']>(async () => ({ ok: true, value: { ok: true, data: [] } })),
    getOrders: vi.fn<PlatformRemote['getOrders']>(async () => ({ ok: true, value: { ok: true, data: { items: [], total: 0, page: 1, pageSize: 20 } } })),
    createOrder: vi.fn<PlatformRemote['createOrder']>(failure), getOrder: vi.fn<PlatformRemote['getOrder']>(failure),
    cancelOrder: vi.fn<PlatformRemote['cancelOrder']>(failure),
    getInvoices: vi.fn<PlatformRemote['getInvoices']>(async () => ({ ok: true, value: { ok: true, data: { items: [], total: 0 } } })),
    getInvoice: vi.fn<PlatformRemote['getInvoice']>(failure),
    quoteInvoice: vi.fn<PlatformRemote['quoteInvoice']>(async () => ({ ok: true, value: { ok: true, data: { paymentAmountCents: 50000, feeCents: 3000, amountCents: 53000 } } })),
    saveInvoice: vi.fn<PlatformRemote['saveInvoice']>(failure), getInvoiceFile: vi.fn<PlatformRemote['getInvoiceFile']>(failure),
  }
  const files = { save: vi.fn<import('@deepseek-ai/dsh-client-ui-file-actions/client').FileActions['save']>(async () => ({ status: 'requested' })) }
  const platform = createPlatformClient(remote, actions, files)
  releases.push(platform.dispose)
  const props: PlatformProps = { ...platform.injected, useAccount: bindSnapshotSelector(account),
    usePlatform: bindSnapshotSelector(platform.injected.hooks.platform),
    t: (key, parameters) => {
      const copy = Object.hasOwn(zh, key) ? zh[key as keyof typeof zh] : key
      return copy.replace(/\{(\w+)\}/gu, (_match, name: string) => {
        const value = parameters?.[name]
        return typeof value === 'string' || typeof value === 'number' ? String(value) : name
      })
    } }
  return { account, actions, platform, remote, props, view, files }
}

it('places platform protocol controls in Models and requires consent for an HTTP gateway', async () => {
  const f = fixture()
  render(<ModelSection {...f.props} />)
  const protocol = screen.getByLabelText('gpt-5.1 · ' + zh.modelProtocol)
  expect(protocol.textContent).toContain('自动（Responses）')
  fireEvent.change(protocol, { target: { value: 'anthropic-messages' } })
  expect(f.actions.setProtocol).toHaveBeenCalledWith('3', 'gpt-5.1', 'anthropic-messages')
  const gateway = await screen.findByRole('combobox', { name: zh.gateways })
  fireEvent.change(gateway, { target: { value: 'http://39.106.5.29' } })
  expect(screen.getByRole('button', { name: zh.gatewayApply })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByLabelText(zh.gatewayConsent))
  await expect(`${document.body.textContent}\n`).toMatchFileSnapshot('./expected/platform-models.txt')
  fireEvent.click(screen.getByRole('button', { name: zh.gatewayApply }))
  await waitFor(() => { expect(f.remote.setGateway).toHaveBeenCalledWith('http://39.106.5.29', true) })
})

it('restores automatic model routing without changing the account connection', async () => {
  const f = fixture()
  render(<ModelSection {...f.props} />)
  const gateway = await screen.findByRole('combobox', { name: zh.gateways })
  fireEvent.change(gateway, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: zh.lineDetect }))
  await waitFor(() => { expect(f.remote.setGateway).toHaveBeenCalledWith(null, false) })
  expect(f.actions.setAccountOrigin).not.toHaveBeenCalled()
  expect(f.account.getSnapshot().view?.platformOrigin).toBe('https://platform.example')
})

it('explains both Responses transports, starts with SSE and saves the model choice', async () => {
  const f = fixture()
  render(<ModelSection {...f.props} />)
  await screen.findByRole('combobox', { name: zh.gateways })
  const transport = screen.getByRole('combobox', { name: 'gpt-5.1 · ' + zh.modelTransport })
  expect(transport).toHaveProperty('value', 'sse')
  expect(transport).toHaveProperty('disabled', false)
  expect(screen.getByText(zh.transportSseHint)).toBeTruthy()
  expect(screen.getByText(zh.transportWebSocketHint)).toBeTruthy()
  expect(document.getElementById(transport.getAttribute('aria-describedby') ?? '')?.textContent).toContain(zh.transportWebSocketHint)
  fireEvent.change(transport, { target: { value: 'websocket' } })
  expect(f.actions.setTransport).toHaveBeenCalledWith('3', 'gpt-5.1', 'websocket')
  expect(f.actions.setProtocol).not.toHaveBeenCalled()
  await act(async () => { f.account.set({ ...f.account.getSnapshot(), busy: true }) })
  expect(transport).toHaveProperty('disabled', true)
  await act(async () => { f.account.set({ ...f.account.getSnapshot(), busy: false, view: { ...f.view,
    modelProtocols: [{ model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses', transport: 'websocket' }] } }) })
  expect(transport).toHaveProperty('value', 'websocket')
  fireEvent.change(transport, { target: { value: 'sse' } })
  expect(f.actions.setTransport).toHaveBeenLastCalledWith('3', 'gpt-5.1', 'sse')
})

it('hides WebSocket choices for other protocols and retains the last selection on a save error', async () => {
  const f = fixture()
  render(<ModelSection {...f.props} />)
  await screen.findByRole('combobox', { name: zh.gateways })
  await act(async () => { f.account.set({ ...f.account.getSnapshot(), view: { ...f.view, error: 'storage' } }) })
  expect(screen.getByRole('alert').textContent).toBe(zh.storage)
  expect(screen.getByRole('combobox', { name: 'gpt-5.1 · ' + zh.modelTransport })).toHaveProperty('value', 'sse')
  await act(async () => { f.account.set({ ...f.account.getSnapshot(), view: { ...f.view,
    modelProtocols: [{ model: 'gpt-5.1', choice: 'openai-completions', effective: 'openai-completions', transport: null }] } }) })
  expect(screen.queryByRole('combobox', { name: 'gpt-5.1 · ' + zh.modelTransport })).toBeNull()
  expect(screen.queryByText(zh.transportWebSocketHint)).toBeNull()
})

it('submits images only on request and retains completed results across panel remount', async () => {
  const f = fixture()
  f.remote.generateImages.mockResolvedValue({ ok: true, value: { ok: true, data: { images: [{ id: 'image-1' as ImageOutputId,
    source: 'data:image/png;base64,iVBORw0KGgo=', revisedPrompt: null }] } } })
  const first = render(<ImagePanel {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.imageEnterModel }))
  fireEvent.change(screen.getByLabelText(zh.imageManualModel), { target: { value: 'gpt-image-2' } })
  fireEvent.change(screen.getByLabelText(zh.imagePrompt), { target: { value: '蓝色方块' } })
  expect(f.remote.generateImages).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.imageGenerate }))
  await screen.findByRole('img')
  expect(f.remote.generateImages.mock.calls[0]?.[0]).toMatchObject({ groupId: '3', prompt: '蓝色方块' })
  first.unmount()
  render(<ImagePanel {...f.props} />)
  expect(screen.getByRole('img')).toBeTruthy()
  expect(screen.getByLabelText(zh.imagePrompt)).toHaveProperty('value', '蓝色方块')
  fireEvent.click(screen.getByRole('button', { name: zh.imageDownload }))
  await waitFor(() => { expect(f.files.save).toHaveBeenCalledWith({ url: 'data:image/png;base64,iVBORw0KGgo=',
    name: 'waibibabo-image-1.png' }, 'download') })
})

it('shows a created order without opening payment automatically or marking it paid', async () => {
  const f = fixture([testPlan])
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  f.remote.createOrder.mockResolvedValue({ ok: true, value: { ok: true, data: { id: '19' as PaymentOrderId, amount: 10, payAmount: 10.2,
    currency: 'CNY', expiresAt: '2099-01-01T09:00:00Z', paymentUrl: 'https://pay.example/19', qrCode: null } } })
  render(<BillingSection {...f.props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.billingSubscribe }))
  const link = await screen.findByRole('link', { name: zh.billingOpenPayment })
  expect(link.getAttribute('href')).toBe('https://pay.example/19')
  expect(open).not.toHaveBeenCalled()
  await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('region', { name: zh.billingPayment })) })
  expect(f.platform.injected.hooks.platform.getSnapshot().paymentState).toBeNull()
  f.remote.getOrder.mockResolvedValueOnce({ ok: true, value: { ok: true, data: { id: '19' as PaymentOrderId,
    number: 'ORDER-19', amount: 10, payAmount: 10.2, currency: 'CNY', expiresAt: '2099-01-01T09:00:00Z',
    status: 'COMPLETED', kind: 'balance', method: 'alipay', createdAt: '2026-11-12T08:00:00Z' } } })
  fireEvent.click(screen.getByRole('button', { name: zh.billingCheckPayment }))
  await screen.findByText('状态：' + zh.statusCompleted)
  expect(screen.queryByRole('link', { name: zh.billingOpenPayment })).toBeNull()
  await waitFor(() => { expect(f.actions.refresh).toHaveBeenCalled() })
})

it('opens the platform recharge page without creating a desktop balance order', async () => {
  const f = fixture()
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<BillingSection {...f.props} />)
  await screen.findByText(zh.billingNoPlans)
  fireEvent.click(screen.getByRole('button', { name: zh.billingWebRecharge }))
  expect(open).toHaveBeenCalledWith('https://platform.example/purchase', '_blank', 'noopener,noreferrer')
  expect(screen.queryByRole('button', { name: '创建充值订单' })).toBeNull()
  expect(screen.queryByLabelText('充值金额（CNY）')).toBeNull()
  expect(screen.queryByRole('combobox', { name: zh.billingMethod })).toBeNull()
  expect(screen.queryByRole('heading', { name: zh.billingRecharge })).toBeNull()
  expect(document.body.textContent).not.toMatch(/充值在浏览器中完成|单笔范围|支付手续费率/u)
  expect(f.remote.createOrder).not.toHaveBeenCalled()
})

it('uses the only available subscription payment method without showing a selector', async () => {
  const f = fixture([testPlan])
  const initial = await f.remote.getCheckout()
  if (!initial.ok || !initial.value.ok) throw new Error('fixture checkout missing')
  f.remote.getCheckout.mockResolvedValue({ ok: true, value: { ok: true, data: { ...initial.value.data,
    methods: [{ id: 'disabled', name: '停用渠道', currency: 'CNY', minimum: 0, maximum: 0, feeRate: 0, available: false },
      ...initial.value.data.methods] } } })
  render(<BillingSection {...f.props} />)
  const subscribe = await screen.findByRole('button', { name: zh.billingSubscribe })
  expect(screen.queryByRole('combobox', { name: zh.billingMethod })).toBeNull()
  fireEvent.click(subscribe)
  await waitFor(() => { expect(f.remote.createOrder).toHaveBeenCalledWith({ amount: 10, method: 'alipay', kind: 'subscription', planId: '5' }) })
})

it('offers payment selection only when multiple channels can purchase a subscription', async () => {
  const f = fixture([testPlan])
  const initial = await f.remote.getCheckout()
  if (!initial.ok || !initial.value.ok) throw new Error('fixture checkout missing')
  f.remote.getCheckout.mockResolvedValue({ ok: true, value: { ok: true, data: { ...initial.value.data,
    methods: [...initial.value.data.methods,
      { id: 'wxpay', name: '微信支付', currency: 'CNY', minimum: 1, maximum: 5000, feeRate: 0, available: true }] } } })
  render(<BillingSection {...f.props} />)
  fireEvent.change(await screen.findByRole('combobox', { name: zh.billingMethod }), { target: { value: 'wxpay' } })
  fireEvent.click(screen.getByRole('button', { name: zh.billingSubscribe }))
  await waitFor(() => { expect(f.remote.createOrder).toHaveBeenCalledWith({ amount: 10, method: 'wxpay', kind: 'subscription', planId: '5' }) })
  const multiple = await f.remote.getCheckout()
  if (!multiple.ok || !multiple.value.ok) throw new Error('fixture checkout missing')
  f.remote.getCheckout.mockResolvedValue({ ok: true, value: { ok: true, data: { ...multiple.value.data, plans: [] } } })
  fireEvent.click(screen.getByRole('button', { name: zh.billingRefresh }))
  await screen.findByText(zh.billingNoPlans)
  expect(screen.queryByRole('combobox', { name: zh.billingMethod })).toBeNull()
})

it('explains unavailable subscription payment without showing an empty selector', async () => {
  const f = fixture([testPlan])
  const initial = await f.remote.getCheckout()
  if (!initial.ok || !initial.value.ok) throw new Error('fixture checkout missing')
  f.remote.getCheckout.mockResolvedValue({ ok: true, value: { ok: true, data: { ...initial.value.data, methods: [] } } })
  render(<BillingSection {...f.props} />)
  await screen.findByText(zh.billingNoMethod)
  expect(screen.queryByRole('combobox', { name: zh.billingMethod })).toBeNull()
  expect(screen.getByRole('button', { name: zh.billingSubscribe })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: zh.billingWebRecharge })).toHaveProperty('disabled', false)
})

it('renders platform Markdown headings, tables and emphasis without executing HTML', async () => {
  const f = fixture([testPlan])
  const response = await f.remote.getCheckout()
  if (!response.ok || !response.value.ok) throw new Error('fixture checkout missing')
  f.remote.getCheckout.mockResolvedValue({ ok: true, value: { ok: true, data: { ...response.value.data,
    notice: '### 充值活动\n\n| 金额 | 赠送 |\n| --- | --- |\n| 100 | **额外赠送** |\n\n<script>bad()</script>', help: '**支付说明**',
  } } })
  render(<BillingSection {...f.props} />)
  expect(await screen.findByRole('heading', { name: '充值活动' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '额外赠送' }).querySelector('strong')).toBeTruthy()
  expect(screen.getByText('套餐说明').tagName).toBe('STRONG')
  expect(document.querySelector('script')).toBeNull()
})

it('shows subscription creation progress and a channel failure beside its action', async () => {
  const f = fixture([testPlan])
  const pending = Promise.withResolvers<Awaited<ReturnType<PlatformRemote['createOrder']>>>()
  f.remote.createOrder.mockReturnValueOnce(pending.promise)
  render(<BillingSection {...f.props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.billingSubscribe }))
  expect(await screen.findByRole('button', { name: zh.billingCreating })).toHaveProperty('disabled', true)
  await act(async () => { pending.resolve({ ok: true, value: { ok: false, error: 'payment-gateway' } }); await pending.promise })
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh.paymentGatewayError)
  expect(screen.getByRole('button', { name: zh.billingSubscribe }).parentElement?.textContent).toContain(zh.paymentGatewayError)
})

it('saves preset model budgets and prevents an input/output allocation beyond its context', async () => {
  const f = fixture()
  render(<ModelSection {...f.props} />)
  expect(screen.getByLabelText(zh.modelContextWindow)).toHaveProperty('value', '262144')
  fireEvent.change(screen.getByLabelText(zh.modelContextPreset), { target: { value: '1048576' } })
  expect(screen.getByLabelText(zh.modelMaxInput)).toHaveProperty('value', '1015808')
  fireEvent.click(screen.getByRole('button', { name: zh.modelLimitsSave }))
  expect(f.actions.setModelLimits).toHaveBeenCalledWith({ contextWindow: 1048576, maxInputTokens: 1015808, maxOutputTokens: 32768 })
  fireEvent.change(screen.getByLabelText(zh.modelContextPreset), { target: { value: '486400' } })
  expect(screen.getByLabelText(zh.modelContextWindow)).toHaveProperty('value', '486400')
  fireEvent.change(screen.getByLabelText(zh.modelMaxInput), { target: { value: '486400' } })
  expect(screen.getByRole('button', { name: zh.modelLimitsSave })).toHaveProperty('disabled', true)
  expect(screen.getByRole('alert').textContent).toBe(zh.modelLimitsInvalid)
})

it('shows the platform subscription weeks and months and sends the chosen plan id', async () => {
  const f = fixture()
  const initial = await f.remote.getCheckout()
  if (!initial.ok || !initial.value.ok) throw new Error('fixture checkout missing')
  f.remote.getCheckout.mockResolvedValue({ ok: true, value: { ok: true, data: { ...initial.value.data,
    plans: [
      { id: '5' as SubscriptionPlanId, name: '季度套餐', description: '', group: 'Standard', price: 30,
        currency: 'USD', validity: 3, validityUnit: 'months', features: [] },
      { id: '6' as SubscriptionPlanId, name: '双周套餐', description: '', group: 'Standard', price: 5,
        currency: 'USD', validity: 2, validityUnit: 'weeks', features: [] },
    ] } } })
  render(<BillingSection {...f.props} />)
  await screen.findByText('有效期：3 月')
  expect(screen.getByText('有效期：2 周')).toBeTruthy()
  await expect(`${document.body.textContent}\n`).toMatchFileSnapshot('./expected/platform-billing.txt')
  fireEvent.click(screen.getAllByRole('button', { name: zh.billingSubscribe })[0]!)
  await waitFor(() => { expect(f.remote.createOrder).toHaveBeenCalledWith({ amount: 30, method: 'alipay', kind: 'subscription', planId: '5' }) })
})

it('keeps the invoice retry key and evidence unchanged after an uncertain result and list refresh', async () => {
  const f = fixture()
  await f.platform.injected.openInvoice(null)
  f.platform.injected.updateInvoiceDraft({ title: invoice.title, paymentAmount: '500' }, '7' as Sub2apiUserId)
  await f.platform.injected.quoteInvoice()
  const original = f.platform.injected.hooks.platform.getSnapshot().invoiceDraft
  f.remote.saveInvoice.mockResolvedValueOnce({ ok: true, value: { ok: false, error: 'uncertain' } })
  await f.platform.injected.submitInvoice()
  await f.platform.injected.loadInvoices()
  f.platform.injected.updateInvoiceDraft({ title: '不能覆盖未确认申请' }, '7' as Sub2apiUserId)
  await f.platform.injected.openInvoice(null)
  expect(f.platform.injected.hooks.platform.getSnapshot().invoiceDraft).toEqual(original)
  expect(f.platform.injected.hooks.platform.getSnapshot().invoiceUncertain).toBe(true)
  f.remote.saveInvoice.mockResolvedValueOnce({ ok: true, value: { ok: true, data: invoice } })
  await f.platform.injected.submitInvoice()
  expect(f.remote.saveInvoice.mock.calls.map((call: Parameters<PlatformRemote['saveInvoice']>) => call[0].requestKey))
    .toEqual([original.requestKey, original.requestKey])
  expect(f.platform.injected.hooks.platform.getSnapshot().invoiceUncertain).toBe(false)
})

it('shows the server invoice quote before submission', async () => {
  const f = fixture()
  render(<InvoiceSection {...f.props} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: zh.invoiceApply })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: zh.invoiceApply }))
  await screen.findByRole('dialog')
  fireEvent.change(screen.getByLabelText(zh.invoicePaymentAmount), { target: { value: '500' } })
  expect(screen.getByRole('button', { name: zh.invoiceSubmit })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: zh.invoiceCalculate }))
  await screen.findByText('530.00')
  await expect(`${screen.getByRole('dialog').textContent}\n`).toMatchFileSnapshot('./expected/platform-invoice.txt')
  expect(f.remote.quoteInvoice).toHaveBeenCalledWith('500')
  expect(f.remote.saveInvoice).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(zh.invoiceHeading), { target: { value: invoice.title } })
  fireEvent.change(screen.getByLabelText(zh.invoicePaymentProof), { target: {
    files: [new File(['purchase'], 'purchase.png', { type: 'image/png' })],
  } })
  await screen.findByText('purchase.png · ' + zh.invoicePaymentProof)
  fireEvent.change(screen.getByLabelText(zh.invoiceFeeProof), { target: {
    files: [new File(['fee'], 'fee.jpg', { type: 'image/jpeg' })],
  } })
  await screen.findByText('fee.jpg · ' + zh.invoiceFeeProof)
  f.remote.saveInvoice.mockResolvedValueOnce({ ok: true, value: { ok: true, data: invoice } })
  fireEvent.click(screen.getByRole('button', { name: zh.invoiceSubmit }))
  await screen.findByText(zh.invoiceSaved)
  expect(f.remote.saveInvoice.mock.calls[0]?.[0]).toMatchObject({ title: invoice.title, email: 'user@example.com',
    paymentAmount: '500', files: [
      { name: 'purchase.png', mime: 'image/png', base64: btoa('purchase'), kind: 'payment' },
      { name: 'fee.jpg', mime: 'image/jpeg', base64: btoa('fee'), kind: 'fee_payment' },
    ] })
})

it('discards delayed outputs and drafts after an account reset', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<Awaited<ReturnType<PlatformRemote['generateImages']>>>()
  f.remote.generateImages.mockReturnValueOnce(pending.promise)
  const task = f.platform.injected.generate({ groupId: '3' as Sub2apiGroupId, model: 'gpt-image-2', prompt: 'private draft', count: 1, size: '' })
  f.platform.reset()
  await act(async () => { f.account.set({ ...f.account.getSnapshot(), view: { ...f.view, status: 'signed-out', profile: null } }) })
  pending.resolve({ ok: true, value: { ok: true, data: { images: [{ id: 'old' as ImageOutputId, source: 'https://image.example/old.png', revisedPrompt: null }] } } })
  await task
  expect(f.platform.injected.hooks.platform.getSnapshot().imageResult).toBeNull()
  expect(JSON.stringify(f.platform.injected.hooks.platform.getSnapshot())).not.toContain('private draft')
  const late: Partial<InvoiceRequest> = { title: 'old attachment result' }
  f.platform.injected.updateInvoiceDraft(late, '7' as Sub2apiUserId)
  expect(f.platform.injected.hooks.platform.getSnapshot().invoiceDraft.title).toBe('')
})


it('loads image models by group and submits ratio or custom pixel sizes', async () => {
  const f = fixture()
  render(<ImagePanel {...f.props} />)
  await screen.findByRole('option', { name: 'gpt-image-2' })
  expect(f.remote.getImageModels).toHaveBeenCalledWith('3', expect.any(AbortSignal))
  fireEvent.change(screen.getByLabelText(zh.imageModel), { target: { value: 'gpt-image-2' } })
  expect(screen.getByLabelText(zh.imageModel)).toHaveProperty('value', 'gpt-image-2')
  fireEvent.change(screen.getByLabelText(zh.imagePrompt), { target: { value: '一只猫' } })
  fireEvent.change(screen.getByLabelText(zh.imageSize), { target: { value: '1536x864' } })
  fireEvent.click(screen.getByRole('button', { name: zh.imageGenerate }))
  await waitFor(() => { expect(f.remote.generateImages).toHaveBeenCalledTimes(1) })
  expect(f.remote.generateImages.mock.calls[0]?.[0].size).toBe('1536x864')
  await waitFor(() => { expect(screen.getByLabelText(zh.imageSize)).toHaveProperty('disabled', false) })
  fireEvent.change(screen.getByLabelText(zh.imageSize), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText(zh.imageWidth), { target: { value: '1200' } })
  fireEvent.change(screen.getByLabelText(zh.imageHeight), { target: { value: '800' } })
  fireEvent.click(screen.getByRole('button', { name: zh.imageEnterModel }))
  fireEvent.change(screen.getByLabelText(zh.imageManualModel), { target: { value: 'custom-image-model' } })
  fireEvent.click(screen.getByRole('button', { name: zh.imageGenerate }))
  await waitFor(() => { expect(f.remote.generateImages).toHaveBeenCalledTimes(2) })
  expect(f.remote.generateImages.mock.calls[1]?.[0]).toMatchObject({ model: 'custom-image-model', size: '1200x800' })
})

it('keeps a custom model and prompt when switching model entry modes or reopening the image page', async () => {
  const f = fixture()
  const first = render(<ImagePanel {...f.props} />)
  await screen.findByRole('option', { name: 'gpt-image-2' })
  const form = screen.getByRole('form', { name: zh.imageSettings })
  const result = screen.getByRole('region', { name: zh.imageResult })
  await expect(`${form.textContent}\n${result.textContent}\n`).toMatchFileSnapshot('./expected/platform-images.txt')
  expect(screen.queryByLabelText(zh.imageManualModel)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.imageEnterModel }))
  fireEvent.change(screen.getByLabelText(zh.imageManualModel), { target: { value: 'custom-model-with-a-long-name' } })
  fireEvent.change(screen.getByLabelText(zh.imagePrompt), { target: { value: '一座山' } })
  fireEvent.click(screen.getByRole('button', { name: zh.imageChooseModel }))
  expect(screen.getByLabelText(zh.imageModel)).toHaveProperty('value', 'custom-model-with-a-long-name')
  first.unmount()
  render(<ImagePanel {...f.props} />)
  expect(screen.getByLabelText(zh.imageManualModel)).toHaveProperty('value', 'custom-model-with-a-long-name')
  expect(screen.getByLabelText(zh.imagePrompt)).toHaveProperty('value', '一座山')
  expect(f.remote.generateImages).not.toHaveBeenCalled()
})

it('keeps the last image visible during generation and after a failed attempt', async () => {
  const f = fixture()
  f.remote.generateImages.mockResolvedValueOnce({ ok: true, value: { ok: true, data: {
    images: [{ id: 'previous' as ImageOutputId, source: 'https://image.example/previous.png', revisedPrompt: '蓝色天空' }],
  } } })
  await f.platform.injected.generate({ groupId: '3' as Sub2apiGroupId, model: 'gpt-image-2', prompt: 'sky', count: 1, size: '' })
  render(<ImagePanel {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.imageChooseModel }))
  await screen.findByRole('option', { name: 'gpt-image-2' })
  fireEvent.change(screen.getByLabelText(zh.imageModel), { target: { value: 'gpt-image-2' } })
  fireEvent.change(screen.getByLabelText(zh.imagePrompt), { target: { value: 'sea' } })
  const pending = Promise.withResolvers<Awaited<ReturnType<PlatformRemote['generateImages']>>>()
  f.remote.generateImages.mockReturnValueOnce(pending.promise)
  fireEvent.click(screen.getByRole('button', { name: zh.imageGenerate }))
  expect(screen.getByRole('button', { name: zh.imageGeneratingAction })).toHaveProperty('disabled', true)
  expect(screen.getByRole('status').textContent).toBe(zh.imageGenerating)
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://image.example/previous.png')
  await act(async () => { pending.resolve({ ok: true, value: { ok: false, error: 'network' } }) })
  expect(screen.getByRole('alert').textContent).toBe(zh.network)
  expect(screen.getByText(zh.imageRetained)).toBeTruthy()
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://image.example/previous.png')
  expect(screen.getByRole('button', { name: zh.imageGenerate })).toHaveProperty('disabled', false)
  expect(screen.getByText(zh.imageRevisedPrompt).closest('details')?.textContent).toContain('蓝色天空')
})

it('opens an enlarged preview and reports native download progress, completion and failures', async () => {
  const f = fixture()
  const id = 'download-image' as ImageOutputId
  f.remote.generateImages.mockResolvedValue({ ok: true, value: { ok: true, data: {
    images: [{ id, source: 'https://image.example/original.png', revisedPrompt: null }],
  } } })
  await f.platform.injected.generate({ groupId: '3' as Sub2apiGroupId, model: 'gpt-image-2', prompt: 'cat', count: 1, size: '' })
  render(<ImagePanel {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: '放大第 1 张图片' }))
  expect(within(await screen.findByRole('dialog')).getByRole('img').getAttribute('src')).toBe('https://image.example/original.png')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: zh.close }))
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof f.files.save>>>()
  f.files.save.mockReturnValueOnce(pending.promise)
  fireEvent.click(screen.getByRole('button', { name: zh.imageDownload }))
  expect(await screen.findByRole('progressbar')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.imageDownloading })).toHaveProperty('disabled', true)
  await act(async () => { pending.resolve({ status: 'saved', path: 'D:/Pictures/cat.png' }) })
  expect(await screen.findByText('已保存到：D:/Pictures/cat.png')).toBeTruthy()
  expect(screen.queryByRole('progressbar')).toBeNull()
  f.files.save.mockRejectedValueOnce(new Error('write failed'))
  fireEvent.click(screen.getByRole('button', { name: zh.imageDownload }))
  expect(await screen.findByText(zh.imageDownloadFailed)).toBeTruthy()
})

it('edits a single model allocation independently and can restore global inheritance', async () => {
  const f = fixture()
  const own = { contextWindow: 131072, maxInputTokens: 98304, maxOutputTokens: 32768 }
  f.account.set({ ...f.account.getSnapshot(), view: { ...f.view, modelLimitOverrides: { 'gpt-5.1': own } } })
  render(<ModelSection {...f.props} />)
  fireEvent.change(screen.getByLabelText(zh.modelOverrideTitle), { target: { value: 'gpt-5.1' } })
  const form = screen.getByRole('form', { name: 'gpt-5.1 · ' + zh.modelOverrideTitle })
  fireEvent.change(within(form).getByLabelText(zh.modelMaxOutput), { target: { value: '16384' } })
  fireEvent.click(within(form).getByRole('button', { name: zh.modelLimitsSave }))
  expect(f.actions.setModelLimitOverride).toHaveBeenCalledWith('3', 'gpt-5.1', { ...own, maxOutputTokens: 16384 })
  expect(f.actions.setModelLimits).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.modelRestoreGlobal }))
  expect(f.actions.setModelLimitOverride).toHaveBeenLastCalledWith('3', 'gpt-5.1', null)
})
