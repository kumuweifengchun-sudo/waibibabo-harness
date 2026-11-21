/** Native balance and subscription checkout with owned payment history. */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Button, HoverCard, IconInfoOutlineRegular, Input, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CheckoutView, OrderRequest, PaymentLaunch, PaymentMethod, PaymentOrder, SubscriptionPlanId } from '../platform-types.ts'
import type { AccountFailure } from '../types.ts'
import type { AccountKey } from './locales.ts'
import { PlatformLogin, PlatformNotice, PlatformPagination, PlatformPanel, type PlatformProps } from './PlatformCommon.tsx'
import css from './Platform.module.css'

const statuses: Readonly<Record<string, AccountKey>> = { PENDING: 'statusPending', PAID: 'statusPaid', RECHARGING: 'statusRecharging',
  COMPLETED: 'statusCompleted', EXPIRED: 'statusExpired', CANCELLED: 'statusCancelled', FAILED: 'statusFailed', REFUND_REQUESTED: 'statusRefundRequested',
  REFUNDING: 'statusRefunding', REFUND_PENDING: 'statusRefundPending', PARTIALLY_REFUNDED: 'statusPartiallyRefunded', REFUNDED: 'statusRefunded', REFUND_FAILED: 'statusRefundFailed',
  active: 'statusActive', expired: 'statusExpired', cancelled: 'statusCancelled', inactive: 'statusInactive' }
const money = (value: number, currency = '') => `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${currency}`.trim()
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const methodKey = (value: PaymentMethod) => value.channelId ? `${value.id}:${value.channelId}` : value.id
function statusLabel(value: string, t: PlatformProps['t']) {
  const key = statuses[value]
  return key === undefined ? value : t(key)
}
function rechargeWithinLimits(amount: number, method: PaymentMethod, checkout: CheckoutView) {
  const currency = method.currency || 'CNY'
  const digits = /^[A-Z]{3}$/u.test(currency)
    ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 : 2
  const scale = 10 ** digits
  let base = amount
  if (checkout.bonusMode === 'discount') {
    const tier = checkout.bonusTiers.filter(value => value.minimum <= amount).sort((a, b) => b.minimum - a.minimum)[0]
    if (tier && tier.percent > 0 && tier.percent < 100) {
      const discounted = Math.round((amount * (100 - tier.percent) / 100 + Number.EPSILON) * scale) / scale
      if (discounted > 0) base = discounted
    }
  }
  const limited = method.channelId ? (Math.round(base * scale) + Math.ceil(base * method.feeRate * scale / 100)) / scale : base
  return limited >= method.minimum && (method.maximum === 0 || limited <= method.maximum)
}
const validityKey = (unit: string): AccountKey => {
  const normalized = unit.trim().toLowerCase().replace(/s$/u, '')
  return normalized === 'month' ? 'billingMonths' : normalized === 'week' ? 'billingWeeks' : 'billingDays'
}

function BillingHelp({ label, closeLabel, children }: { label: string; closeLabel: string; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return <>
    <HoverCard inline disabled={open} openDelayMs={250} anchor={
      <Button type="button" variant="ghost" size="sm" className={css.helpButton} aria-label={label}
        aria-haspopup="dialog" aria-describedby={id} onClick={() => { setOpen(true) }}><IconInfoOutlineRegular size={16} /></Button>
    } content={<div id={id} role="tooltip" className={css.richHelp}>{children}</div>} />
    <Modal open={open} title={label} closeLabel={closeLabel} onClose={() => { setOpen(false) }}
      className={css.helpDialog ?? ''} contentClassName={css.scrollContent ?? ''}>
      <div className={css.richHelp}>{children}</div>
    </Modal>
  </>
}

function OrderPaymentDialog({ order, launch, awaitingCheck, busy, error, t, onClose, onCheck, onCancel }: Pick<PlatformProps, 't'> & {
  order: PaymentOrder | PaymentLaunch
  launch: PaymentLaunch | null
  awaitingCheck: boolean
  busy: boolean
  error: AccountFailure | null
  onClose: () => void
  onCheck: () => void
  onCancel: () => void
}) {
  const [now, setNow] = useState(Date.now)
  const status = 'status' in order ? order.status : 'PENDING'
  const pending = status === 'PENDING' && !awaitingCheck
  const deadline = Date.parse(order.expiresAt)
  const payable = launch !== null && pending && deadline > now
  useEffect(() => {
    if (!payable) return
    const timer = setTimeout(() => { setNow(Date.now()) }, Math.min(2_147_483_647, Math.max(0, deadline - Date.now())))
    return () => { clearTimeout(timer) }
  }, [deadline, now, payable])
  return <Modal open title={t('billingOrderDetail', { id: order.id })} closeLabel={t('close')} onClose={onClose}
    className={css.paymentDialog ?? ''} contentClassName={css.scrollContent ?? ''} footer={<div className={css.paymentActions}>
      <Button variant="primary" disabled={busy} onClick={onCheck}>
        {t(busy ? 'accountProcessing' : payable ? 'billingCheckPayment' : 'billingCheck')}</Button>
      {pending && (launch === null || payable) && <Button variant="outline" disabled={busy} onClick={onCancel}>{t('billingCancel')}</Button>}
    </div>}>
    <div className={css.section} aria-busy={busy}>
      <dl className={css.paymentDetails}>
        <dt>{t('billingPayAmount')}</dt><dd className={css.paymentAmount}>{money(order.payAmount, order.currency || launch?.currency)}</dd>
        <dt>{t('billingStatus')}</dt><dd role="status">{awaitingCheck ? t('billingAwaitingCheck') : statusLabel(status, t)}</dd>
        <dt>{t('billingExpires')}</dt><dd>{date(order.expiresAt)}</dd>
        {'number' in order && order.number && <><dt>{t('billingOrderNumber')}</dt><dd>{order.number}</dd></>}
      </dl>
      {payable && launch.qrCode && <img className={css.qrcode} src={launch.qrCode} alt={t('billingScan')} />}
      {payable && launch.paymentUrl && <a className={css.paymentLink} href={launch.paymentUrl} target="_blank" rel="noopener noreferrer">{t('billingOpenPayment')}</a>}
      {payable && !launch.qrCode && !launch.paymentUrl && <p className={css.error} role="alert">{t('billingPaymentMissing')}</p>}
      {launch && pending && deadline <= now && <p className={css.muted}>{t('billingPaymentExpired')}</p>}
      <PlatformNotice t={t} loading={false} error={error} />
    </div>
  </Modal>
}

/** @param props - Platform billing state and user-triggered operations. @returns native billing settings. */
export function BillingSection(props: PlatformProps) {
  const profile = props.useAccount(value => value.view?.profile)
  return profile ? <BillingContent key={profile.id} {...props} /> : <PlatformLogin {...props} />
}

function BillingContent(props: PlatformProps) {
  const state = props.usePlatform(value => value)
  const platformOrigin = props.useAccount(value => value.view?.platformOrigin)
  const { t, loadBilling } = props
  const [methodId, setMethod] = useState('')
  const [amount, setAmount] = useState('')
  const [noticeTarget, setNoticeTarget] = useState<'page' | 'dialog' | 'balance' | SubscriptionPlanId>(
    state.paymentDialog === null ? 'page' : 'dialog')
  const markdownLabels = useMemo(() => ({ code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') },
    footnotes: t('markdownFootnotes') }), [t])
  useEffect(() => { void loadBilling() }, [loadBilling])
  const create = async (input: OrderRequest) => {
    setNoticeTarget(input.planId ?? 'balance')
    if (await props.createPayment(input)) setNoticeTarget('dialog')
  }
  const openPayment = (order?: PaymentOrder) => {
    setNoticeTarget('dialog')
    props.openPayment(order)
  }
  const checkout = state.checkout
  const methods = checkout?.methods.filter(value => value.available) ?? []
  const method = methods.find(value => methodKey(value) === methodId) ?? methods[0]
  const channel = method?.channelId ? { channelId: method.channelId } : {}
  const recharge = Number(amount)
  const validAmount = Number.isFinite(recharge) && recharge > 0 && /^\d+(?:\.\d{1,2})?$/u.test(amount)
  const fits = checkout !== null && method !== undefined && rechargeWithinLimits(recharge, method, checkout)
  const busy = state.loading.billing
  const blocked = busy || state.orderUncertain || method === undefined || checkout?.enabled !== true
  const launch = state.paymentDialog === 'current' ? state.payment : null
  const order = state.paymentDialog === 'current' ? state.paymentState ?? launch : state.paymentDialog
  const feedback = (form: 'balance' | SubscriptionPlanId) => noticeTarget === form && state.paymentDialog === null && <>
    <PlatformNotice t={t} loading={false} error={state.errors.billing} />
    {state.orderUncertain && <p className={css.error}>{t('billingUnknown')}</p>}
  </>
  return <section className={css.section}>
    <header className={css.header}>
      <div className={css.titleGroup}>
        <h2>{t('billingTitle')}</h2>
        {checkout && (checkout.notice || checkout.help) && <BillingHelp label={t('helpFor', { topic: t('billingHelp') })} closeLabel={t('close')}>
          {checkout.notice && <MarkdownText text={checkout.notice} labels={markdownLabels} variant="compact" omitHtml />}
          {checkout.help && <MarkdownText text={checkout.help} labels={markdownLabels} variant="compact" omitHtml />}
        </BillingHelp>}
      </div>
      <div className={css.actions}>
        {platformOrigin && <a href={new URL('/purchase', platformOrigin).href} target="_blank" rel="noopener noreferrer">{t('billingWebRecharge')}</a>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setNoticeTarget('page'); void loadBilling() }}>{t('billingRefresh')}</Button>
      </div>
    </header>
    {noticeTarget === 'page' && state.paymentDialog === null && <PlatformNotice t={t} loading={busy} error={state.errors.billing} />}
    {state.orderUncertain && (noticeTarget === 'page' || noticeTarget === 'dialog') && <p className={css.error} role="alert">{t('billingUnknown')}</p>}
    {checkout !== null && <>
      {!checkout.enabled && <p>{t('billingDisabled')}</p>}
      {checkout.enabled && (!checkout.balanceDisabled || checkout.plans.length > 0) && <div className={css.methodBar}>
        {methods.length > 1 && <label className={css.inlineField}>{t('billingMethod')}<select value={method && methodKey(method)} disabled={busy} onChange={(event) => { setMethod(event.target.value) }}>
          {methods.map(value => <option key={methodKey(value)} value={methodKey(value)}>{value.name}{value.currency ? ` · ${value.currency}` : ''}</option>)}
        </select></label>}
        {methods.length === 1 && method && <><span className={css.muted}>{t('billingMethod')}</span><strong>{method.name}</strong></>}
        {method === undefined && <p className={css.muted}>{t('billingNoMethod')}</p>}
      </div>}
      {checkout.enabled && !checkout.balanceDisabled && <PlatformPanel title={t('billingRecharge')}>
        <form className={css.form} aria-label={t('billingRecharge')} onSubmit={(event) => {
          event.preventDefault()
          if (!blocked && validAmount && fits) void create({ amount: recharge, method: method.id, ...channel, kind: 'balance', planId: null })
        }}>
          <div className={css.purchaseRow}>
            <label>{t('billingAmount')}{method?.currency && `（${method.currency}）`}<Input type="number" inputMode="decimal" min="0.01" step="0.01"
              value={amount} onChange={(event) => { setAmount(event.target.value) }} required disabled={busy || !method} /></label>
            <Button type="submit" variant="primary" aria-haspopup="dialog" disabled={blocked || !validAmount || !fits}>
              {t(busy && noticeTarget === 'balance' ? 'billingCreating' : 'billingCreateRecharge')}</Button>
          </div>
          {method && validAmount && !fits && <p role="alert">{t('billingMethodLimits', {
            min: money(method.minimum, method.currency), max: method.maximum ? money(method.maximum, method.currency) : t('billingUnlimited'),
          })}</p>}
          {feedback('balance')}
        </form>
      </PlatformPanel>}
      <PlatformPanel title={t('billingPlans')}>
        {!checkout.plans.length ? <p className={css.muted}>{t('billingNoPlans')}</p> : <div className={css.cards}>{checkout.plans.map(plan => <article key={plan.id}>
          <div className={css.header}><div className={css.titleGroup}><h4>{plan.name}</h4>
            {(plan.description || plan.features.length > 0) && <BillingHelp label={t('helpFor', { topic: plan.name })} closeLabel={t('close')}>
              {plan.description && <MarkdownText text={plan.description} labels={markdownLabels} variant="compact" omitHtml />}
              {plan.features.length > 0 && <ul>{plan.features.map(feature => <li key={feature}><MarkdownText text={feature} labels={markdownLabels} variant="compact" omitHtml /></li>)}</ul>}
            </BillingHelp>}
          </div><strong>{money(plan.price, plan.currency)}</strong></div>
          <p className={css.muted}>{plan.group}</p>
          <p>{t('billingValidity', { value: `${plan.validity} ${t(validityKey(plan.validityUnit))}` })}</p>
          <Button variant="outline" aria-haspopup="dialog" disabled={blocked} onClick={() => {
            if (method !== undefined) void create({ amount: plan.price, method: method.id, ...channel, kind: 'subscription', planId: plan.id })
          }}>{t(busy && noticeTarget === plan.id ? 'billingCreating' : 'billingSubscribe')}</Button>
          {feedback(plan.id)}
        </article>)}</div>}
      </PlatformPanel>
    </>}
    <PlatformPanel title={t('billingSubscriptions')}>
      {state.subscriptions.length === 0 ? <p className={css.muted}>{t('billingNoSubscriptions')}</p> : <div className={css.cards}>
        {state.subscriptions.map(subscription => <article key={`${subscription.group}:${subscription.expiresAt}`}>
          <div className={css.header}><h4>{subscription.group}</h4><span>{statusLabel(subscription.status, t)}</span></div>
          <p>{t('billingExpires')}：{subscription.expiresAt ? date(subscription.expiresAt) : '—'}</p>
          <p>{t('billingProgress')}：{[subscription.daily, subscription.weekly, subscription.monthly].map(value => value === null ? '—' : `${value.toFixed(1)}%`).join(' / ')}</p>
        </article>)}
      </div>}
    </PlatformPanel>
    <PlatformPanel title={t('billingOrders')} actions={<div className={css.actions}>
      <label className={css.inlineField}>{t('billingStatus')}<select value={state.orderQuery.status} disabled={busy}
        onChange={(event) => { setNoticeTarget('page'); void loadBilling({ ...state.orderQuery, page: 1, status: event.target.value }) }}>
        <option value="">{t('billingAll')}</option>{Object.keys(statuses).filter(value => value === value.toUpperCase()).map(value => <option key={value} value={value}>{statusLabel(value, t)}</option>)}
      </select></label>
      <Button variant="outline" size="sm" aria-haspopup="dialog" disabled={!state.payment || busy} onClick={() => { openPayment() }}>{t('billingPayment')}</Button>
    </div>}>
      {state.orders !== null && (state.orders.items.length === 0 ? <p className={css.muted}>{t('billingEmpty')}</p> : <div className={css.table}>
        <table aria-label={t('billingOrders')}><thead><tr><th>{t('billingOrderNumber')}</th><th>{t('billingPayAmount')}</th><th>{t('billingStatus')}</th><th>{t('billingCreated')}</th><th>{t('usageDetails')}</th></tr></thead>
          <tbody>{state.orders.items.map(order => <tr key={order.id}><td>{order.number}<small>{t(order.kind === 'subscription' ? 'billingSubscription' : 'billingRecharge')}</small></td>
            <td>{money(order.payAmount, order.currency)}</td><td>{statusLabel(order.status, t)}</td><td>{date(order.createdAt)}</td>
            <td><Button variant="ghost" aria-haspopup="dialog" disabled={busy} onClick={() => { openPayment(order) }}>{t('usageDetails')}</Button></td></tr>)}</tbody>
        </table></div>)}
      {state.orders !== null && <PlatformPagination page={state.orders.page} pages={Math.ceil(state.orders.total / state.orders.pageSize)}
        total={state.orders.total} busy={busy} t={t}
        onPage={(page) => { setNoticeTarget('page'); void loadBilling({ ...state.orderQuery, page }) }} />}
    </PlatformPanel>
    {order && <OrderPaymentDialog key={order.id} order={order} launch={launch} t={t}
      awaitingCheck={state.pendingCancellationChecks.includes(order.id)} busy={busy}
      error={noticeTarget === 'dialog' ? state.errors.billing : null} onClose={props.closePayment}
      onCheck={() => { setNoticeTarget('dialog'); void props.refreshPayment(order.id) }}
      onCancel={() => { setNoticeTarget('dialog'); void props.cancelPayment(order.id) }} />}
  </section>
}
