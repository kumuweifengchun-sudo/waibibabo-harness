/** Native balance and subscription checkout with owned payment history. */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Button, HoverCard, IconInfoOutlineRegular, Input, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CheckoutView, OrderRequest, PaymentLaunch, PaymentMethod, PaymentOrder, SubscriptionPlanId } from '../platform-types.ts'
import type { AccountFailure } from '../types.ts'
import type { AccountKey } from './locales.ts'
import { PlatformLogin, PlatformNotice, PlatformPagination, PlatformPanel, type PlatformProps } from './PlatformCommon.tsx'
import css from './Platform.module.css'

const statuses: Readonly<Record<string, AccountKey>> = { PENDING: 'statusPending', PAID: 'statusPaid', RECHARGING: 'statusRecharging',
  COMPLETED: 'statusCompleted', EXPIRED: 'statusExpired', PAID_EXPIRED: 'statusPaidExpired', CANCELLED: 'statusCancelled', FAILED: 'statusFailed', REFUND_REQUESTED: 'statusRefundRequested',
  REFUNDING: 'statusRefunding', REFUND_PENDING: 'statusRefundPending', PARTIALLY_REFUNDED: 'statusPartiallyRefunded', REFUNDED: 'statusRefunded', REFUND_FAILED: 'statusRefundFailed',
  active: 'statusActive', expired: 'statusExpired', cancelled: 'statusCancelled', inactive: 'statusInactive' }
const money = (value: number, currency = '') => `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${currency}`.trim()
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const methodKey = (value: PaymentMethod) => value.channelId ? `${value.id}:${value.channelId}` : value.id
function statusLabel(value: string, t: PlatformProps['t']) {
  const key = statuses[value]
  return key === undefined ? value : t(key)
}
function rechargePayAmount(amount: number, method: PaymentMethod, checkout: CheckoutView) {
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
  return method.channelId ? (Math.round(base * scale) + Math.ceil(base * method.feeRate * scale / 100)) / scale : base
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

function OrderPaymentDialog({ order, launch, awaitingCheck, busy, error, t, onClose, onCheck, onLedger, onCancel }: Pick<PlatformProps, 't'> & {
  order: PaymentOrder | PaymentLaunch
  launch: PaymentLaunch | null
  awaitingCheck: boolean
  busy: boolean
  error: AccountFailure | null
  onClose: () => void
  onCheck: () => void
  onLedger?: () => void
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
      {onLedger && <Button variant="outline" disabled={busy || awaitingCheck} onClick={onLedger}>{t('billingLedgerCheck')}</Button>}
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
      {status === 'PAID_EXPIRED' && <p role="status">{t('billingPaidExpiredDetail')}</p>}
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
  const { t, loadBilling, loadRechargeBatches } = props
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
  const pay = checkout && method ? rechargePayAmount(recharge, method, checkout) : 0
  const exceedsGlobal = !!checkout?.rechargeMaximum && recharge > checkout.rechargeMaximum
  const aboveMinimum = recharge >= (checkout?.rechargeMinimum ?? 0)
  const fits = !!method && aboveMinimum && !exceedsGlobal && pay >= method.minimum && (method.maximum === 0 || pay <= method.maximum)
  const splitChannel = method?.splitRecharge && aboveMinimum && (exceedsGlobal || (method.maximum > 0 && pay > method.maximum))
    ? method.channelId : undefined
  const busy = state.loading.billing
  const blocked = busy || state.orderUncertain || method === undefined || checkout?.enabled !== true
  const launch = state.paymentDialog === 'current' ? state.payment : null
  const order = state.paymentDialog === 'current' ? state.paymentState ?? launch : state.paymentDialog
  const orderMethod = order?.method
  const batchSupported = checkout?.desktopPaymentExtensions === true
  const canCheckLedger = batchSupported && order !== null && (orderMethod === 'alipay' || orderMethod === 'alipay_direct')
    && (!('status' in order) || ['PENDING', 'EXPIRED', 'CANCELLED'].includes(order.status))
  useEffect(() => { if (batchSupported) void loadRechargeBatches() }, [batchSupported, loadRechargeBatches])
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
          if (blocked || !validAmount) return
          if (splitChannel !== undefined) {
            setNoticeTarget('balance')
            void props.quoteRecharge(Math.round(recharge * 100), splitChannel)
          } else if (fits) void create({ amount: recharge, method: method.id, ...channel, kind: 'balance', planId: null })
        }}>
          <div className={css.purchaseRow}>
            <label>{t('billingAmount')}{method?.currency && `（${method.currency}）`}<Input type="number" inputMode="decimal" min="0.01" step="0.01"
              value={amount} onChange={(event) => { setAmount(event.target.value) }} required disabled={busy || !method} /></label>
            <Button type="submit" variant="primary" aria-haspopup="dialog" disabled={blocked || !validAmount || (!fits && splitChannel === undefined)}>
              {t(busy && noticeTarget === 'balance' ? 'billingCreating' : splitChannel !== undefined ? 'rechargePreview' : 'billingCreateRecharge')}</Button>
          </div>
          {method && validAmount && !fits && splitChannel === undefined && <p role="alert">{t('billingMethodLimits', {
            min: money(!aboveMinimum ? checkout.rechargeMinimum ?? method.minimum : method.minimum, method.currency),
            max: exceedsGlobal && checkout.rechargeMaximum ? money(checkout.rechargeMaximum, method.currency)
              : method.maximum ? money(method.maximum, method.currency) : t('billingUnlimited'),
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
    {batchSupported && <RechargeBatches {...props} />}
    {order && <OrderPaymentDialog key={order.id} order={order} launch={launch} t={t}
      awaitingCheck={state.pendingCancellationChecks.includes(order.id)} busy={busy}
      error={noticeTarget === 'dialog' ? state.errors.billing : null} onClose={props.closePayment}
      onCheck={() => { setNoticeTarget('dialog'); void props.refreshPayment(order.id) }}
      {...canCheckLedger ? { onLedger: () => { setNoticeTarget('dialog'); void props.checkAlipayPayment(order.id) } } : {}}
      onCancel={() => { setNoticeTarget('dialog'); void props.cancelPayment(order.id) }} />}
  </section>
}

function RechargeBatches(props: PlatformProps) {
  const { t, usePlatform, loadRechargeBatches, updateRecharge, confirmRecharge, closeRecharge, checkAlipayPayment } = props
  const { rechargeOffer: offer, rechargeBatch: batch, rechargeBatches: batches, loading, errors } = usePlatform(value => value)
  const busy = loading.billing
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [now, setNow] = useState(Date.now)
  const quote = offer ?? batch
  const payment = batch?.payment
  const pendingOrder = batch?.payments.find(item => item.part === batch.nextPart && item.status === 'PENDING')
  const deadline = payment == null ? 0 : Date.parse(payment.expiresAt)
  const showPayment = payment != null && deadline > now
  useEffect(() => {
    if (deadline <= now) return
    const timer = setTimeout(() => { setNow(Date.now()) }, Math.min(2_147_483_647, Math.max(0, deadline - Date.now())))
    return () => { clearTimeout(timer) }
  }, [deadline, now])
  const last = batches.at(-1)
  const currency = (cents: number) => money(cents / 100, 'CNY')
  return <PlatformPanel title={t('rechargeBatches')} actions={<div className={css.actions}>
    <Button variant="outline" size="sm" disabled={busy} onClick={() => { void loadRechargeBatches() }}>{t('billingRefresh')}</Button>
    {batches.length === 20 && last && <Button variant="outline" size="sm" disabled={busy}
      onClick={() => { void loadRechargeBatches(last.id) }}>{t('rechargeOlder')}</Button>}
  </div>}>
    {quote === null && <PlatformNotice t={t} loading={false} error={errors.billing} />}
    {batches.length === 0 ? <p className={css.muted}>{t('billingEmpty')}</p> : <div className={css.table}>
      <table aria-label={t('rechargeBatches')}><thead><tr><th>{t('billingMethod')}</th><th>{t('billingPayAmount')}</th>
        <th>{t('billingStatus')}</th><th>{t('usageDetails')}</th></tr></thead>
      <tbody>{batches.map(item => <tr key={item.id}>
        <td>{item.channelName}</td><td>{currency(item.paidCents)} / {currency(item.payCents)}</td>
        <td>{item.status === 'OPEN' ? t('rechargeOpen') : statusLabel(item.status, t)}</td>
        <td><Button variant="ghost" disabled={busy} aria-haspopup="dialog" onClick={() => {
          setConfirmCancel(false)
          void updateRecharge({ kind: 'refresh', id: item.id })
        }}>{t('usageDetails')}</Button></td></tr>)}</tbody>
      </table>
    </div>}
    {quote !== null && <Modal open title={t(offer ? 'rechargePreview' : 'rechargeBatches')} closeLabel={t('close')}
      onClose={closeRecharge} className={css.paymentDialog ?? ''} contentClassName={css.scrollContent ?? ''}
      footer={<div className={css.paymentActions}>
        {offer && <Button variant="primary" disabled={busy} onClick={() => { void confirmRecharge() }}>{t('rechargeConfirm')}</Button>}
        {batch && <>
          {batch.canContinue && batch.nextPart !== null && <Button variant="primary" disabled={busy} onClick={() => {
            if (batch.nextPart !== null) void updateRecharge({ kind: 'continue', id: batch.id, part: batch.nextPart })
          }}>{t('rechargePayPart', { part: batch.nextPart })}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { void updateRecharge({ kind: 'refresh', id: batch.id }) }}>{t('billingRefresh')}</Button>
          {pendingOrder && <Button variant="outline" disabled={busy} onClick={() => {
            void checkAlipayPayment(pendingOrder.orderId, batch.id)
          }}>{t('billingLedgerCheck')}</Button>}
          {batch.status === 'OPEN' && <Button variant="outline" disabled={busy} onClick={() => {
            if (confirmCancel) { setConfirmCancel(false); void updateRecharge({ kind: 'cancel', id: batch.id }) }
            else setConfirmCancel(true)
          }}>{t(confirmCancel ? 'rechargeConfirmCancel' : 'rechargeCancel')}</Button>}
        </>}
      </div>}>
      <div className={css.section} aria-busy={busy}>
        <dl className={css.paymentDetails}>
          <dt>{t('billingMethod')}</dt><dd>{quote.channelName}</dd>
          <dt>{t('billingPayAmount')}</dt><dd>{currency(quote.payCents)}</dd>
          <dt>{t('rechargeCredit')}</dt><dd>{currency(batch?.creditedCents ?? quote.creditCents)}</dd>
          <dt>{t('rechargeBonus')}</dt><dd>{currency(batch?.awardedBonusCents ?? quote.bonusCents)}</dd>
          {batch && <><dt>{t('rechargePaid')}</dt><dd>{currency(batch.paidCents)}</dd>
            <dt>{t('billingStatus')}</dt><dd>{batch.status === 'OPEN' ? t('rechargeOpen') : statusLabel(batch.status, t)}</dd>
            <dt>{t('billingExpires')}</dt><dd>{date(batch.expiresAt)}</dd></>}
        </dl>
        <ol>{quote.parts.map((part, index) => {
          const record = batch?.payments.find(item => item.part === index + 1)
          return <li key={index}>{currency(part.payCents)}{record && ` · ${statusLabel(record.status, t)}`}</li>
        })}</ol>
        {showPayment && payment.qrCode && <img className={css.qrcode} src={payment.qrCode} alt={t('billingScan')} />}
        {showPayment && payment.paymentUrl && <a className={css.paymentLink} href={payment.paymentUrl} target="_blank" rel="noopener noreferrer">{t('billingOpenPayment')}</a>}
        {batch?.codeUncertain && <p role="status">{t('rechargeCodeUncertain')}</p>}
        {confirmCancel && <p role="status">{t('rechargeCancelNotice')}</p>}
        <PlatformNotice t={t} loading={busy} error={errors.billing} />
      </div>
    </Modal>}
  </PlatformPanel>
}
