/** Paginated platform usage and cost details, rendered without browser credentials. */
import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Sub2apiGroupId, UsageRecord } from '../types.ts'
import type { AccountInjected } from './AccountSection.tsx'
import css from './AccountSection.module.css'
import { failureKeys } from './errors.ts'

type SharedProps = PropsLocale<'sub2api.account'> & InjectFace<AccountInjected>
const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function UsageContent(props: SharedProps) {
  const { t, useUsage, useAccount, loadUsage } = props
  const account = useAccount(value => value.view)
  const state = useUsage(value => value)
  const [filters, setFilters] = useState(state.query)
  const [initialQuery] = useState(state.query)
  const [selected, setSelected] = useState<UsageRecord | null>(null)
  useEffect(() => { void loadUsage(initialQuery) }, [initialQuery, loadUsage])
  const page = state.data
  const duration = (value: number | null) => value === null ? '—' : t('usageUnitMs', { value: value.toLocaleString('zh-CN') })
  const error = state.error === null ? 'network' : failureKeys[state.error]
  return <div className={css.section}>
    <h2>{t('usageTitle')}</h2><p className={css.muted}>{t('usageDescription')}</p>
    <form className={css.usageFilters} onSubmit={(event) => { event.preventDefault(); void loadUsage({ ...filters, page: 1 }) }}>
      <label>{t('usageStart')}<Input type="date" value={filters.startDate} max={filters.endDate} required disabled={state.loading}
        onChange={(event) => { setFilters({ ...filters, startDate: event.target.value }) }} /></label>
      <label>{t('usageEnd')}<Input type="date" value={filters.endDate} min={filters.startDate} required disabled={state.loading}
        onChange={(event) => { setFilters({ ...filters, endDate: event.target.value }) }} /></label>
      <label>{t('usageModel')}<Input value={filters.model} placeholder={t('usageModelPlaceholder')} disabled={state.loading}
        onChange={(event) => { setFilters({ ...filters, model: event.target.value }) }} /></label>
      <label>{t('usageGroup')}<select value={filters.groupId ?? ''} disabled={state.loading} onChange={(event) => {
        setFilters({ ...filters, groupId: event.target.value === '' ? null : event.target.value as Sub2apiGroupId })
      }}><option value="">{t('usageAll')}</option>{account?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>{t('usageMode')}<select value={filters.stream === null ? '' : String(filters.stream)} disabled={state.loading}
        onChange={(event) => { setFilters({ ...filters, stream: event.target.value === '' ? null : event.target.value === 'true' }) }}>
        <option value="">{t('usageAll')}</option><option value="true">{t('usageStream')}</option><option value="false">{t('usageNonStream')}</option>
      </select></label>
      <label>{t('usagePageSize')}<select value={filters.pageSize} disabled={state.loading}
        onChange={(event) => { setFilters({ ...filters, pageSize: Number(event.target.value) }) }}>
        {[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <div className={css.actions}><Button variant="primary" type="submit" disabled={state.loading}>{t('usageSearch')}</Button>
        <Button variant="outline" disabled={state.loading} onClick={() => { void loadUsage(state.query) }}>{t('usageRefresh')}</Button></div>
    </form>
    {state.error !== null && <div role="alert" className={css.error}><p>{t(error)}</p>{page !== null && <p>{t('usageRetained')}</p>}</div>}
    {state.loading && <p role="status">{t('usageLoading')}</p>}
    {page !== null && <>
      <p className={css.muted}>{t('usageRange', { start: state.query.startDate, end: state.query.endDate })}</p>
      {page.statisticsError !== undefined && <p role="alert" className={css.error}>{t('usageStatsUnavailable')}</p>}
      <div className={css.usageMetrics}>
        <div><span>{t('usageRequests')}</span><strong>{page.requests?.toLocaleString('zh-CN') ?? '—'}</strong></div>
        <div><span>{t('usageTokens')}</span><strong>{page.tokens?.toLocaleString('zh-CN') ?? '—'}</strong></div>
        <div><span>{t('usageCost')}</span><strong>{page.cost === null ? '—' : money(page.cost)}</strong></div>
      </div>
      {page.items.length === 0 ? <p>{t('usageEmpty')}</p> : <div className={css.usageTable}>
        <table aria-label={t('usageTitle')} aria-busy={state.loading}><thead><tr>
          <th>{t('usageTime')}</th><th>{t('usageModel')}</th><th>{t('usageTokenColumn')}</th><th>{t('usageCost')}</th>
          <th>{t('usageDuration')}</th><th>{t('usageDetails')}</th>
        </tr></thead><tbody>{page.items.map(record => <tr key={record.id}>
          <td>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
          <td><span>{record.model}</span><small>{record.group ?? '—'}</small></td>
          <td>{record.inputTokens.toLocaleString('zh-CN')} / {record.outputTokens.toLocaleString('zh-CN')}</td>
          <td>{money(record.actualCost)}</td><td>{duration(record.durationMs)}</td>
          <td><Button variant="ghost" onClick={() => { setSelected(record) }}>{t('usageDetails')}</Button></td>
        </tr>)}</tbody></table>
      </div>}
      <div className={css.pagination}>
        <Button variant="outline" disabled={state.loading || page.page <= 1}
          onClick={() => { void loadUsage({ ...state.query, page: page.page - 1 }) }}>{t('usagePrevious')}</Button>
        <span>{t('usagePage', { page: String(page.page), pages: String(Math.max(1, page.totalPages)), total: String(page.total) })}</span>
        <Button variant="outline" disabled={state.loading || page.page >= page.totalPages}
          onClick={() => { void loadUsage({ ...state.query, page: page.page + 1 }) }}>{t('usageNext')}</Button>
      </div>
    </>}
    <Modal open={selected !== null} title={t('usageDetails')} closeLabel={t('close')} onClose={() => { setSelected(null) }} className={css.usageDialog ?? ''}>
      {selected !== null && <dl className={css.usageDetails}>
        <dt>{t('usageTime')}</dt><dd>{new Date(selected.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd>
        <dt>{t('usageRequestId')}</dt><dd>{selected.requestId || '—'}</dd>
        <dt>{t('usageModel')}</dt><dd>{selected.model}</dd>
        <dt>{t('usageGroup')}</dt><dd>{selected.group ?? '—'}</dd>
        <dt>{t('usageKey')}</dt><dd>{selected.apiKey ?? '—'}</dd>
        <dt>{t('usageEndpoint')}</dt><dd>{selected.endpoint ?? '—'}</dd>
        <dt>{t('usageMode')}</dt><dd>{t(selected.stream ? 'usageStream' : 'usageNonStream')}</dd>
        <dt>{t('usageBilling')}</dt><dd>{t(selected.billingType === 0 ? 'usageBalanceBilling' : selected.billingType === 1 ? 'usageSubscriptionBilling' : 'usageOtherBilling')}</dd>
        <dt>{t('usageInput')}</dt><dd>{selected.inputTokens.toLocaleString('zh-CN')}</dd>
        <dt>{t('usageOutput')}</dt><dd>{selected.outputTokens.toLocaleString('zh-CN')}</dd>
        <dt>{t('usageCacheRead')}</dt><dd>{selected.cacheReadTokens.toLocaleString('zh-CN')}</dd>
        <dt>{t('usageCacheWrite')}</dt><dd>{selected.cacheWriteTokens.toLocaleString('zh-CN')}</dd>
        <dt>{t('usageInputCost')}</dt><dd>{money(selected.inputCost)}</dd>
        <dt>{t('usageOutputCost')}</dt><dd>{money(selected.outputCost)}</dd>
        <dt>{t('usageCacheReadCost')}</dt><dd>{money(selected.cacheReadCost)}</dd>
        <dt>{t('usageCacheWriteCost')}</dt><dd>{money(selected.cacheWriteCost)}</dd>
        <dt>{t('usageStandardCost')}</dt><dd>{money(selected.totalCost)}</dd>
        <dt>{t('usageMultiplier')}</dt><dd>{selected.multiplier}</dd>
        <dt>{t('usageCost')}</dt><dd>{money(selected.actualCost)}</dd>
        <dt>{t('usageFirstToken')}</dt><dd>{duration(selected.firstTokenMs)}</dd>
        <dt>{t('usageDuration')}</dt><dd>{duration(selected.durationMs)}</dd>
        <dt>{t('usageImages')}</dt><dd>{selected.imageCount}</dd>
      </dl>}
    </Modal>
  </div>
}

/** @param props - Usage actions and live account state. @returns the signed-in usage page or a login notice. */
export function UsageSection(props: PropsRuntime<'settings.section'> & SharedProps) {
  const profile = props.useAccount(value => value.view?.status === 'signed-in' ? value.view.profile : null)
  return profile ? <UsageContent key={profile.id} {...props} /> : <p>{props.t('usageLogin')}</p>
}

/** @param props - Usage overlay state and actions. @returns the account's expanded usage view. */
export function UsageOverlay(props: PropsRuntime<'shell.overlay'> & SharedProps) {
  const account = props.useAccount(value => value)
  const open = account.usageVisible && account.view?.status === 'signed-in'
  return <Modal open={open} title={props.t('usageTitle')} closeLabel={props.t('close')} onClose={() => { props.showUsage(false) }} className={css.usageDialog ?? ''}>
    {open && <UsageContent key={account.view.profile?.id} {...props} />}
  </Modal>
}
