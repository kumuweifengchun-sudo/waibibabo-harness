/** Browser recharge entry, native subscription selection and owned payment history. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrderRequest } from '../platform-types.ts'
import type { AccountKey } from './locales.ts'
import { PlatformLogin, PlatformNotice, PlatformPagination, type PlatformProps } from './PlatformCommon.tsx'
import css from './Platform.module.css'

const statuses: Readonly<Record<string, AccountKey>> = { PENDING: 'statusPending', PAID: 'statusPaid', RECHARGING: 'statusRecharging',
  COMPLETED: 'statusCompleted', EXPIRED: 'statusExpired', CANCELLED: 'statusCancelled', FAILED: 'statusFailed', REFUND_REQUESTED: 'statusRefundRequested',
  REFUNDING: 'statusRefunding', REFUND_PENDING: 'statusRefundPending', PARTIALLY_REFUNDED: 'statusPartiallyRefunded', REFUNDED: 'statusRefunded', REFUND_FAILED: 'statusRefundFailed',
  active: 'statusActive', expired: 'statusExpired', cancelled: 'statusCancelled', inactive: 'statusInactive' }
const money = (value: number, currency = '') => `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${currency}`.trim()
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const validityKey = (unit: string): AccountKey => {
  const normalized = unit.trim().toLowerCase().replace(/s$/u, '')
  return normalized === 'month' ? 'billingMonths' : normalized === 'week' ? 'billingWeeks' : 'billingDays'
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
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const paymentPanel = useRef<HTMLElement>(null)
  const focusNextPayment = useRef(false)
  const markdownLabels = useMemo(() => ({ code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') },
    footnotes: t('markdownFootnotes') }), [t])
  useEffect(() => { void loadBilling() }, [loadBilling])
  useEffect(() => {
    if (state.payment !== null && focusNextPayment.current) {
      focusNextPayment.current = false
      paymentPanel.current?.scrollIntoView({ block: 'nearest' })
      paymentPanel.current?.focus({ preventScroll: true })
    }
  }, [state.payment])
  const create = async (input: OrderRequest) => {
    focusNextPayment.current = true
    setActiveForm(input.planId ?? 'balance')
    setCreating(true)
    try { if (!await props.createPayment(input)) focusNextPayment.current = false }
    finally {
      setCreating(false)
    }
  }
  const checkout = state.checkout
  const methods = checkout?.methods.filter(value => value.available) ?? []
  const method = methods.find(value => value.id === methodId) ?? methods[0]
  const busy = state.loading.billing
  const blocked = busy || state.orderUncertain || method === undefined || checkout?.enabled !== true
  const paymentState = state.paymentState?.id === state.payment?.id ? state.paymentState : null
  const payable = state.payment !== null && (paymentState === null || paymentState.status === 'PENDING')
    && Date.parse(state.payment.expiresAt) > Date.now()
  const status = (value: string) => { const key = statuses[value]; return key === undefined ? value : t(key) }
  const feedback = (form: string) => activeForm === form && <>
    <PlatformNotice t={t} loading={creating} error={state.errors.billing} />
    {state.orderUncertain && <p className={css.error}>{t('billingUnknown')}</p>}
    {!creating && state.errors.billing === null && state.payment !== null && <p role="status">{t('billingCreatedNotice')}</p>}
  </>
  return <section className={css.section}>
    <div className={css.header}><h2>{t('billingTitle')}</h2><Button variant="outline" disabled={busy} onClick={() => { setActiveForm(null); void loadBilling() }}>{t('billingRefresh')}</Button></div>
    <div><Button variant="primary" disabled={platformOrigin === undefined} onClick={() => {
      if (platformOrigin !== undefined) window.open(new URL('/purchase', platformOrigin).href, '_blank', 'noopener,noreferrer')
    }}>{t('billingWebRecharge')}</Button></div>
    <PlatformNotice t={t} loading={busy && !creating} error={activeForm === null ? state.errors.billing : null} />
    {activeForm === null && state.orderUncertain && <p className={css.error}>{t('billingUnknown')}</p>}
    {checkout !== null && <>
      {!checkout.enabled && <p>{t('billingDisabled')}</p>}
      {checkout.notice && <MarkdownText text={checkout.notice} labels={markdownLabels} variant="compact" omitHtml />}
      <h3>{t('billingPlans')}</h3>
      {checkout.enabled && checkout.plans.length > 0 && <>
        {methods.length > 1 && <label className={css.form}>{t('billingMethod')}<select value={method?.id ?? ''} disabled={busy} onChange={(event) => { setMethod(event.target.value) }}>
          {methods.map(value => <option key={value.id} value={value.id}>{value.name}{value.currency ? ` · ${value.currency}` : ''}</option>)}
        </select></label>}
        {method === undefined && <p className={css.muted}>{t('billingNoMethod')}</p>}
      </>}
      {!checkout.plans.length ? <p className={css.muted}>{t('billingNoPlans')}</p> : <div className={css.cards}>{checkout.plans.map(plan => <article key={plan.id}>
        <div className={css.header}><h4>{plan.name}</h4><strong>{money(plan.price, plan.currency)}</strong></div>
        {plan.description && <MarkdownText text={plan.description} labels={markdownLabels} variant="compact" omitHtml />}<p className={css.muted}>{plan.group}</p>
        <p>{t('billingValidity', { value: `${plan.validity} ${t(validityKey(plan.validityUnit))}` })}</p>
        {plan.features.length > 0 && <ul>{plan.features.map(feature => <li key={feature}><MarkdownText text={feature} labels={markdownLabels} variant="compact" omitHtml /></li>)}</ul>}
        <Button variant="outline" disabled={blocked} onClick={() => {
          if (method !== undefined) void create({ amount: plan.price, method: method.id, kind: 'subscription', planId: plan.id })
        }}>{t(creating && activeForm === plan.id ? 'billingCreating' : 'billingSubscribe')}</Button>
        {feedback(plan.id)}
      </article>)}</div>}
      {checkout.help && <MarkdownText text={checkout.help} labels={markdownLabels} variant="compact" omitHtml />}
    </>}
    {state.payment !== null && <section ref={paymentPanel} tabIndex={-1} aria-label={t('billingPayment')} className={css.payment}>
      <h3>{t('billingPayment')} #{state.payment.id}</h3>
      <p>{t('billingPayAmount')}：<strong>{money(state.payment.payAmount, state.payment.currency)}</strong></p>
      <p>{t('billingExpires')}：{date(state.payment.expiresAt)}</p>
      {paymentState !== null && <p role="status">{t('billingStatus')}：{status(paymentState.status)}</p>}
      {payable && state.payment.qrCode && <div><img className={css.qrcode} src={state.payment.qrCode} alt={t('billingScan')} /><p>{t('billingScan')}</p></div>}
      <div className={css.actions}>{payable && state.payment.paymentUrl && <a href={state.payment.paymentUrl} target="_blank" rel="noopener noreferrer">{t('billingOpenPayment')}</a>}
        <Button variant="outline" disabled={busy} onClick={() => { setActiveForm(null); if (state.payment) void props.refreshPayment(state.payment.id) }}>{t('billingCheckPayment')}</Button></div>
      {payable && !state.payment.paymentUrl && !state.payment.qrCode && <p className={css.error}>{t('billingPaymentMissing')}</p>}
    </section>}
    <h3>{t('billingSubscriptions')}</h3>
    {state.subscriptions.length === 0 ? <p className={css.muted}>{t('billingNoSubscriptions')}</p> : <div className={css.cards}>
      {state.subscriptions.map(subscription => <article key={`${subscription.group}:${subscription.expiresAt}`}>
        <div className={css.header}><h4>{subscription.group}</h4><span>{status(subscription.status)}</span></div>
        <p>{t('billingExpires')}：{subscription.expiresAt ? date(subscription.expiresAt) : '—'}</p>
        <p>{t('billingProgress')}：{[subscription.daily, subscription.weekly, subscription.monthly].map(value => value === null ? '—' : `${value.toFixed(1)}%`).join(' / ')}</p>
      </article>)}
    </div>}
    <h3>{t('billingOrders')}</h3>
    <label className={css.form}>{t('billingStatus')}<select value={state.orderQuery.status} disabled={busy}
      onChange={(event) => { setActiveForm(null); void loadBilling({ ...state.orderQuery, page: 1, status: event.target.value }) }}>
      <option value="">{t('billingAll')}</option>{Object.keys(statuses).filter(value => value === value.toUpperCase()).map(value => <option key={value} value={value}>{status(value)}</option>)}
    </select></label>
    {state.orders !== null && (state.orders.items.length === 0 ? <p className={css.muted}>{t('billingEmpty')}</p> : <div className={css.table}>
      <table><thead><tr><th>{t('billingOrderNumber')}</th><th>{t('billingPayAmount')}</th><th>{t('billingStatus')}</th><th>{t('billingCreated')}</th><th>{t('usageDetails')}</th></tr></thead>
        <tbody>{state.orders.items.map(order => <tr key={order.id}><td>{order.number}<small>{t(order.kind === 'subscription' ? 'billingSubscription' : 'billingRecharge')}</small></td>
          <td>{money(order.payAmount, order.currency)}</td><td>{status(order.status)}</td><td>{date(order.createdAt)}</td>
          <td><Button variant="ghost" disabled={busy} onClick={() => { setActiveForm(null); void props.refreshPayment(order.id) }}>{t('billingCheck')}</Button>
            {order.status === 'PENDING' && <Button variant="ghost" disabled={busy} onClick={() => { setActiveForm(null); void props.cancelPayment(order.id) }}>{t('billingCancel')}</Button>}</td></tr>)}</tbody>
      </table></div>)}
    {state.orders !== null && <PlatformPagination {...state.orders} busy={busy} t={t}
      onPage={(page) => { setActiveForm(null); void loadBilling({ ...state.orderQuery, page }) }} />}
  </section>
}
