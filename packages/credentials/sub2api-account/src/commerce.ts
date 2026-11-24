/** Platform checkout and order projections, keeping provider secrets on the Host. */
import { z } from 'zod'
import QRCode from 'qrcode'
import { AccountError, parse } from './http.ts'
import type { CheckoutView, OrderPage, OrderRequest, PaymentChannelId, PaymentLaunch, PaymentMethod, PaymentOrder, PaymentOrderId,
  PlatformPageQuery, RechargeBatch, RechargeBatchAction, RechargeBatchId, RechargeOffer, RechargeQuote, SubscriptionPlanId, SubscriptionView } from './platform-types.ts'

const id = z.number().int().positive()
const money = z.number().nonnegative()
const method = z.object({ currency: z.string().optional(), display_name: z.string().optional(),
  single_min: money, single_max: money, fee_rate: money, available: z.boolean().optional() })
const channelId = z.string().regex(/^[1-9]\d{0,18}$/u)
const channel = method.extend({ payment_type: z.string(), channel_id: channelId, channel_name: z.string(),
  sort_order: z.number(), daily_limit: money, daily_remaining: z.number(), split_recharge: z.boolean().optional() })
const plan = z.object({ id, name: z.string(), description: z.string(), price: money, currency: z.string().optional(),
  validity_days: z.number().int().positive(), validity_unit: z.string(), group_name: z.string().optional(), features: z.array(z.string()) })
const checkout = z.object({ methods: z.record(z.string(), method), plans: z.array(plan), balance_disabled: z.boolean(),
  payment_channels: z.array(channel).optional(), recharge_fee_rate: money.optional(),
  desktop_payment_extensions: z.boolean().optional(), recharge_min_amount: money.optional(), recharge_max_amount: money.optional(),
  balance_recharge_multiplier: money, subscription_usd_to_cny_rate: money,
  recharge_bonus_tiers: z.array(z.object({ min_amount: money, bonus_percent: money })).nullish(),
  recharge_bonus_mode: z.string().optional(), recharge_bonus_notice: z.string().optional(), help_text: z.string().optional() })
const order = z.object({ id, out_trade_no: z.string(), amount: money, pay_amount: money, currency: z.string().optional(),
  status: z.string(), order_type: z.string(), payment_type: z.string(), created_at: z.string(), expires_at: z.string() })
const launch = z.object({ order_id: id, amount: money, pay_amount: money, currency: z.string().optional(), expires_at: z.string(),
  pay_url: z.string().optional(), qr_code: z.string().optional(), client_secret: z.string().optional(), intent_id: z.string().optional(),
  resume_token: z.string().optional(), out_trade_no: z.string().optional(), payment_type: z.string().optional() })
const query = z.object({ page: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(100),
  status: z.string().max(40) })

/** Read the checkout configuration and its global enable switch.
 * @param value - Checkout-info response.
 * @param config - Payment configuration response.
 * @returns user-visible prices, methods and platform limits.
 */
export function checkoutView(value: unknown, config: unknown): CheckoutView {
  const data = parse(checkout, value)
  const channels = (data.payment_channels ?? []).filter(value => value.payment_type === 'alipay')
    .sort((a, b) => a.sort_order - b.sort_order)
  const methods: PaymentMethod[] = channels.map(value => ({
    id: value.payment_type, channelId: value.channel_id as PaymentChannelId,
    name: value.channel_name || value.display_name || value.payment_type,
    currency: value.currency ?? '', minimum: value.single_min, maximum: value.daily_limit > 0
      ? Math.min(value.daily_remaining, value.single_max || Infinity) : value.single_max,
    feeRate: data.recharge_fee_rate ?? value.fee_rate,
    splitRecharge: data.desktop_payment_extensions === true && value.split_recharge === true,
    available: value.available !== false && (value.daily_limit === 0 || value.daily_remaining > 0),
  }))
  for (const [key, value] of Object.entries(data.methods)) {
    const id = key === 'alipay_direct' ? 'alipay' : key === 'wxpay_direct' ? 'wxpay' : key
    if (id === 'alipay' && channels.length > 0 || id !== key && Object.hasOwn(data.methods, id)) continue
    methods.push({ id, name: value.display_name || id, currency: value.currency ?? '', minimum: value.single_min,
      maximum: value.single_max, feeRate: data.recharge_fee_rate ?? value.fee_rate, available: value.available !== false })
  }
  return { enabled: parse(z.object({ enabled: z.boolean() }), config).enabled,
    desktopPaymentExtensions: data.desktop_payment_extensions ?? false,
    rechargeMinimum: data.recharge_min_amount ?? 0, rechargeMaximum: data.recharge_max_amount ?? 0,
    balanceDisabled: data.balance_disabled, balanceMultiplier: data.balance_recharge_multiplier,
    subscriptionExchangeRate: data.subscription_usd_to_cny_rate, bonusMode: data.recharge_bonus_mode ?? 'bonus',
    bonusTiers: (data.recharge_bonus_tiers ?? []).map(tier => ({ minimum: tier.min_amount, percent: tier.bonus_percent })),
    notice: data.recharge_bonus_notice ?? '', help: data.help_text ?? '',
    methods,
    plans: data.plans.map(value => ({ id: String(value.id) as SubscriptionPlanId, name: value.name, description: value.description,
      price: value.price, currency: value.currency ?? '', validity: value.validity_days, validityUnit: value.validity_unit,
      group: value.group_name ?? '', features: value.features })),
  }
}

/** Validate checkout input before creating one billable order; no automatic retry is permitted.
 * @param value - Explicit checkout selection.
 * @param origin - Trusted account origin used for the payment return page.
 * @returns platform order body.
 */
export function orderRequest(value: OrderRequest, origin: string): object {
  const checked = z.object({ amount: money.positive(), method: z.string().min(1).max(100), kind: z.enum(['balance', 'subscription']),
    channelId: channelId.optional(), planId: z.string().regex(/^[1-9]\d*$/u).nullable() }).safeParse(value)
  if (!checked.success || (value.kind === 'subscription') !== (value.planId !== null)
    || value.channelId !== undefined && value.method !== 'alipay') throw new AccountError('validation')
  return { amount: value.amount, payment_type: value.method, order_type: value.kind,
    ...(value.planId === null ? {} : { plan_id: Number(value.planId) }),
    ...(value.channelId === undefined ? {} : { channel_id: value.channelId }), is_mobile: false,
    payment_source: 'hosted_redirect', ...(value.channelId === undefined ? { return_url: origin + '/payment/result' } : {}) }
}

/** Project a newly created order into a payment page or locally rendered QR image.
 * @param value - Platform create-order response.
 * @param origin - Trusted origin of the platform's hosted payment pages.
 * @returns display-safe order and payment targets, without provider client secrets.
 */
export async function paymentLaunch(value: unknown, origin: string): Promise<PaymentLaunch> {
  const data = parse(launch, value)
  let paymentUrl: string | null = null
  if (data.client_secret) {
    if (!data.resume_token) throw new AccountError('protocol')
    const url = new URL(data.intent_id ? '/payment/airwallex' : '/payment/stripe', origin)
    url.searchParams.set('order_id', String(data.order_id))
    url.searchParams.set('resume_token', data.resume_token)
    if (data.intent_id && data.out_trade_no) url.searchParams.set('out_trade_no', data.out_trade_no)
    paymentUrl = url.href
  } else if (data.pay_url) {
    let url: URL
    try { url = new URL(data.pay_url) } catch { throw new AccountError('protocol') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new AccountError('protocol')
    paymentUrl = url.href
  }
  if (data.qr_code !== undefined && data.qr_code.length > 4096) throw new AccountError('protocol')
  const qrCode = data.qr_code ? await QRCode.toDataURL(data.qr_code, { width: 256, margin: 2 }) : null
  return { id: String(data.order_id) as PaymentOrderId, amount: data.amount, payAmount: data.pay_amount,
    currency: data.currency ?? '', expiresAt: data.expires_at, paymentUrl, qrCode,
    ...data.payment_type === undefined ? {} : { method: data.payment_type } }
}

/** Encode bounded pagination and status without accepting an account id.
 * @param value - User-visible paging filters.
 * @returns encoded query parameters.
 */
export function platformPageQuery(value: PlatformPageQuery): string {
  const result = query.safeParse(value)
  if (!result.success) throw new AccountError('validation')
  return new URLSearchParams({ page: String(value.page), page_size: String(value.pageSize), status: value.status }).toString()
}

/** Validate an opaque positive numeric platform id.
 * @param value - Account-scoped object id.
 * @returns the safe path segment.
 */
export function platformId(value: string): string {
  if (!/^[1-9]\d{0,15}$/u.test(value)) throw new AccountError('validation')
  return value
}

/** Project one owned order without user or payment-provider configuration.
 * @param value - Platform order response.
 * @returns order fields used by the native UI.
 */
export function paymentOrder(value: unknown): PaymentOrder {
  const data = parse(order, value)
  return { id: String(data.id) as PaymentOrderId, number: data.out_trade_no, amount: data.amount, payAmount: data.pay_amount,
    currency: data.currency ?? '', status: data.status, kind: data.order_type, method: data.payment_type, createdAt: data.created_at, expiresAt: data.expires_at }
}

/** Project paginated owned orders.
 * @param value - Platform order list.
 * @returns records and server pagination totals.
 */
export function orderPage(value: unknown): OrderPage {
  const data = parse(z.object({ items: z.array(order), total: z.number().int().nonnegative(), page: id, page_size: id }), value)
  return { items: data.items.map(paymentOrder), total: data.total, page: data.page, pageSize: data.page_size }
}

const cents = z.number().int().nonnegative()
const partNumber = z.number().int().min(1).max(10)
const rechargeQuote = z.object({
  amount_cents: id, pay_cents: id, credit_cents: cents, bonus_cents: cents, completion_bonus_cents: cents,
  channel_id: channelId, channel_name: z.string(), parts: z.array(z.object({ pay_cents: id })).min(1).max(10),
})
const rechargeToken = z.string().min(1).max(512)
const rechargeOffer = rechargeQuote.extend({ quote_token: rechargeToken })
const rechargeProgress = rechargeQuote.extend({
  id, status: z.string(), expires_at: z.string(), paid_cents: cents, credited_cents: cents, awarded_bonus_cents: cents,
  next_part: partNumber.optional(), can_continue: z.boolean(), code_uncertain: z.boolean(), payment: launch.optional(),
  payments: z.array(z.object({ order_id: id, part: partNumber, status: z.string() })),
})

function rechargeSummary(data: z.infer<typeof rechargeQuote>): RechargeQuote {
  return { amountCents: data.amount_cents, payCents: data.pay_cents, creditCents: data.credit_cents,
    bonusCents: data.bonus_cents, completionBonusCents: data.completion_bonus_cents,
    channelId: data.channel_id as PaymentChannelId, channelName: data.channel_name,
    parts: data.parts.map(part => ({ payCents: part.pay_cents })) }
}

/** Parse an offered batch before confirmation.
 * @param value - Payment API quote.
 * @returns the confirmation token and server-priced parts.
 */
export function rechargeBatchOffer(value: unknown): RechargeOffer {
  const data = parse(rechargeOffer, value)
  return { ...rechargeSummary(data), token: data.quote_token }
}

async function rechargeBatchView(data: z.infer<typeof rechargeProgress>, origin: string): Promise<RechargeBatch> {
  return { ...rechargeSummary(data), id: String(data.id) as RechargeBatchId, status: data.status, expiresAt: data.expires_at,
    paidCents: data.paid_cents, creditedCents: data.credited_cents, awardedBonusCents: data.awarded_bonus_cents,
    nextPart: data.next_part ?? null, canContinue: data.can_continue, codeUncertain: data.code_uncertain,
    payment: data.payment === undefined ? null : await paymentLaunch(data.payment, origin),
    payments: data.payments.map(value => ({ orderId: String(value.order_id) as PaymentOrderId, part: value.part, status: value.status })) }
}

/** Parse the batch with its current payment target, if present.
 * @param value - Payment API batch.
 * @param origin - Hosted payment origin.
 * @returns account-owned progress.
 */
export function rechargeBatch(value: unknown, origin: string): Promise<RechargeBatch> {
  return rechargeBatchView(parse(rechargeProgress, value), origin)
}

/** Parse the page of restartable recharge batches.
 * @param value - Payment API batch list.
 * @param origin - Hosted payment origin.
 * @returns account-owned batches.
 */
export function rechargeBatches(value: unknown, origin: string): Promise<readonly RechargeBatch[]> {
  return Promise.all(parse(z.array(rechargeProgress), value).map(batch => rechargeBatchView(batch, origin)))
}

/** Build the quote request shared by preview and confirmation.
 * @param amountCents - Requested recharge in minor units.
 * @param channel - Selected checkout channel.
 * @returns the validated payment API quote body.
 */
export function rechargeQuoteBody(amountCents: number, channel: PaymentChannelId): { amount: number; channel_id: string } {
  const amount = id.safeParse(amountCents)
  const selected = channelId.safeParse(channel)
  if (!amount.success || !selected.success) throw new AccountError('validation')
  return { amount: amount.data / 100, channel_id: selected.data }
}

/** Build an owned batch request for the desktop payment API.
 * @param action - Owned recharge action.
 * @returns validated path suffix and optional POST body.
 */
export function rechargeBatchRequest(action: RechargeBatchAction): { suffix: string; body?: object } {
  if (action.kind === 'confirm') {
    if (!rechargeToken.safeParse(action.token).success || !z.uuid().safeParse(action.key).success) throw new AccountError('validation')
    return { suffix: '', body: { ...rechargeQuoteBody(action.amountCents, action.channelId), quote_token: action.token, idempotency_key: action.key } }
  }
  const path = '/' + platformId(action.id)
  if (action.kind === 'refresh') return { suffix: path }
  if (action.kind === 'cancel') return { suffix: path + '/cancel', body: {} }
  if (!partNumber.safeParse(action.part).success) throw new AccountError('validation')
  return { suffix: path + '/continue', body: { part: action.part, is_mobile: false } }
}

/** Read the current account's subscription progress from the existing dashboard API.
 * @param value - Subscription summary.
 * @returns group names, expiry and progress values.
 */
export function subscriptions(value: unknown): readonly SubscriptionView[] {
  const data = parse(z.object({ subscriptions: z.array(z.object({ group_name: z.string(), status: z.string(),
    expires_at: z.string().optional(), daily_used_usd: money.optional(), daily_limit_usd: money.optional(),
    weekly_used_usd: money.optional(), weekly_limit_usd: money.optional(),
    monthly_used_usd: money.optional(), monthly_limit_usd: money.optional() })) }), value)
  const progress = (used: number | undefined, limit: number | undefined) => limit === undefined || limit <= 0
    ? null : (used ?? 0) / limit * 100
  return data.subscriptions.map(row => ({ group: row.group_name, status: row.status, expiresAt: row.expires_at ?? null,
    daily: progress(row.daily_used_usd, row.daily_limit_usd), weekly: progress(row.weekly_used_usd, row.weekly_limit_usd),
    monthly: progress(row.monthly_used_usd, row.monthly_limit_usd) }))
}
