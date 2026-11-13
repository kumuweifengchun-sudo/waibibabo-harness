/** Shared compact status and login states for native platform pages. */
import { Button, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountFailure } from '../types.ts'
import type { PlatformInjected } from './platform-state.ts'
import { failureKeys } from './errors.ts'
import css from './Platform.module.css'

/** Framework-derived account, platform state and localized actions. */
export type PlatformProps = PropsLocale<'sub2api.account'> & InjectFace<PlatformInjected>

/** @param props - Loading and surface-local error. @returns one compact operation status. */
export function PlatformNotice({ loading, error, t }: PropsLocale<'sub2api.account'> & { loading: boolean; error: AccountFailure | null }) {
  return <>{loading && <div className={css.loading} role="status" aria-label={t('loading')}><IconLoadingOutlineRegular className={css.spin} /></div>}
    {error !== null && <p className={css.error} role="alert">{t(failureKeys[error])}</p>}</>
}

/** @param props - Account login action. @returns a consistent signed-out notice. */
export function PlatformLogin({ t, showLogin }: Pick<PlatformProps, 't' | 'showLogin'>) {
  return <div className={css.section}><p>{t('platformLoginRequired')}</p><Button variant="primary" onClick={() => { showLogin(true) }}>{t('openLogin')}</Button></div>
}

/** @param props - Server pagination and explicit page action. @returns bounded previous and next controls. */
export function PlatformPagination({ page, pageSize, total, busy, onPage, t }: PropsLocale<'sub2api.account'> & {
  page: number
  pageSize: number
  total: number
  busy: boolean
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className={css.actions}><Button variant="outline" disabled={busy || page <= 1} onClick={() => { onPage(page - 1) }}>{t('usagePrevious')}</Button>
    <span>{t('usagePage', { page: String(page), pages: String(pages), total: String(total) })}</span>
    <Button variant="outline" disabled={busy || page >= pages} onClick={() => { onPage(page + 1) }}>{t('usageNext')}</Button></div>
}
