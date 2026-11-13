/** Platform checkout and order projections, keeping provider secrets on the Host. */
import { z } from 'zod'
import QRCode from 'qrcode'
import { AccountError, parse } from './http.ts'
import type { CheckoutView, OrderPage, OrderRequest, PaymentLaunch, PaymentOrder, PaymentOrderId,
  PlatformPageQuery, SubscriptionPlanId, SubscriptionView } from './platform-types.ts'

const id = z.number().int().positive()
const money = z.number().nonnegative()
const method = z.object({ currency: z.string().optional(), display_name: z.string().optional(),
  single_min: money, single_max: money, fee_rate: money })
const plan = z.object({ id, name: z.string(), description: z.string(), price: money, currency: z.string().optional(),
  validity_days: z.number().int().positive(), validity_unit: z.string(), group_name: z.string().optional(), features: z.array(z.string()) })
const checkout = z.object({ methods: z.record(z.string(), method), plans: z.array(plan), balance_disabled: z.boolean(),
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
  return { enabled: parse(z.object({ enabled: z.boolean() }), config).enabled,
    balanceDisabled: data.balance_disabled, balanceMultiplier: data.balance_recharge_multiplier,
    subscriptionExchangeRate: data.subscription_usd_to_cny_rate, bonusMode: data.recharge_bonus_mode ?? 'bonus',
    bonusTiers: (data.recharge_bonus_tiers ?? []).map(tier => ({ minimum: tier.min_amount, percent: tier.bonus_percent })),
    notice: data.recharge_bonus_notice ?? '', help: data.help_text ?? '',
    methods: Object.entries(data.methods).map(([key, value]) => ({ id: key, name: value.display_name || key,
      currency: value.currency ?? '', minimum: value.single_min, maximum: value.single_max, feeRate: value.fee_rate, available: true })),
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
    planId: z.string().regex(/^[1-9]\d*$/u).nullable() }).safeParse(value)
  if (!checked.success || value.kind === 'subscription' && value.planId === null) throw new AccountError('validation')
  return { amount: value.amount, payment_type: value.method, order_type: value.kind,
    ...(value.planId === null ? {} : { plan_id: Number(value.planId) }), is_mobile: false,
    payment_source: 'hosted_redirect', return_url: origin + '/payment/result' }
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
    currency: data.currency ?? '', expiresAt: data.expires_at, paymentUrl, qrCode }
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
