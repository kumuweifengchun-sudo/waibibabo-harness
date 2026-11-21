/** Sections, contextual help and status controls shared by the platform settings. */
import { useId, type ReactNode } from 'react'
import { Button, IconLoadingOutlineRegular, InfoTip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountFailure } from '../types.ts'
import type { PlatformInjected } from './platform-state.ts'
import { failureKeys } from './errors.ts'
import css from './Platform.module.css'

/** Framework-derived account, platform state and localized actions. */
export type PlatformProps = PropsLocale<'sub2api.account'> & InjectFace<PlatformInjected>

/** @param props - Section title, adjacent controls and contents. @returns a named settings region. */
export function PlatformPanel({ title, help, actions, children }: {
  title: string
  help?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return <section className={css.panel} aria-labelledby={id}>
    <header className={css.header}>
      <div className={css.titleGroup}><h3 id={id}>{title}</h3>{help}</div>
      {actions}
    </header>
    {children}
  </section>
}

/** @param props - Field or section name and its explanation. @returns a focusable, tap-to-pin information icon. */
export function PlatformHelp({ t, topic, text }: PropsLocale<'sub2api.account'> & { topic: string; text: string }) {
  return <InfoTip label={t('helpFor', { topic })} text={text} />
}

/** @param props - Loading and surface-local error. @returns one compact operation status. */
export function PlatformNotice({ loading, error, t }: PropsLocale<'sub2api.account'> & { loading: boolean; error: AccountFailure | null }) {
  return <>{loading && <div className={css.loading} role="status" aria-label={t('loading')}><IconLoadingOutlineRegular className={css.spin} /></div>}
    {error !== null && <p className={css.error} role="alert">{t(failureKeys[error])}</p>}</>
}

/** @param props - Account login action. @returns a consistent signed-out notice. */
export function PlatformLogin({ t, showLogin }: Pick<PlatformProps, 't' | 'showLogin'>) {
  return <div className={css.section}><p>{t('platformLoginRequired')}</p><Button variant="primary" onClick={() => { showLogin(true) }}>{t('openLogin')}</Button></div>
}

/** @param props - Result counts and page action. @returns navigation for multiple pages or the single-page record count. */
export function PlatformPagination({ page, pages, total, busy, onPage, t }: PropsLocale<'sub2api.account'> & {
  page: number
  pages: number
  total: number
  busy: boolean
  onPage: (page: number) => void
}) {
  if (pages <= 1 && page === 1) return total > 0 ? <span className={css.metadata}>{t('recordCount', { total: String(total) })}</span> : null
  return <div className={css.pagination}><Button variant="outline" size="sm" disabled={busy || page <= 1} onClick={() => { onPage(page - 1) }}>{t('usagePrevious')}</Button>
    <span>{t('usagePage', { page: String(page), pages: String(Math.max(1, pages)), total: String(total) })}</span>
    <Button variant="outline" size="sm" disabled={busy || page >= pages} onClick={() => { onPage(page + 1) }}>{t('usageNext')}</Button></div>
}
