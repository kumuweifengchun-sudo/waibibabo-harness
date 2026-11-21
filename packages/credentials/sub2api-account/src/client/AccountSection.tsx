/** Account forms and balance views rendered from the Host's safe snapshot. */
import { useId, useState } from 'react'
import { Button, Input, Modal, IconUserOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf, HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountConnectionView, AccountView, ModelLimits, ModelProtocolChoice, ModelTransport, Sub2apiGroupId, UsageQuery } from '../types.ts'
import type { PlatformResult, RegistrationId, RegistrationInput, RegistrationOptions } from '../types.ts'
import { RegistrationForm } from './RegistrationForm.tsx'
import { PlatformHelp, PlatformPanel } from './PlatformCommon.tsx'
import { failureKeys } from './errors.ts'
import type { UsageState } from './usage-state.ts'
import css from './AccountSection.module.css'

/** Apply-owned state shared by the sidebar, settings page and sign-in dialog. */
export interface ClientAccountState {
  readonly view: AccountView | undefined
  readonly busy: boolean
  readonly failed: boolean
  readonly loginVisible: boolean
  readonly usageVisible: boolean
}

/** Plain account actions and a framework-bound observable. */
export interface AccountInjected {
  hooks: { account: HostObservable<ClientAccountState>; usage: HostObservable<UsageState> }
  registrationOptions: () => Promise<PlatformResult<RegistrationOptions>>
  sendRegistrationCode: (id: RegistrationId, email: string, code: string) => Promise<PlatformResult<number>>
  registerAccount: (input: RegistrationInput) => Promise<PlatformResult<null>>
  signIn: (email: string, password: string) => Promise<void>
  start: () => Promise<void>
  verify: (code: string) => Promise<void>
  cancel: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  setAccountOrigin: (origin: string | null) => Promise<void>
  selectGroup: (group: Sub2apiGroupId) => Promise<void>
  showLogin: (visible: boolean) => void
  showUsage: (visible: boolean) => void
  loadUsage: (query: UsageQuery) => Promise<void>
  setProtocol: (group: Sub2apiGroupId, model: string, protocol: ModelProtocolChoice) => Promise<void>
  setTransport: (group: Sub2apiGroupId, model: string, transport: ModelTransport) => Promise<void>
  setModelLimits: (limits: ModelLimits) => Promise<void>
  setModelLimitOverride: (group: Sub2apiGroupId, model: string, limits: ModelLimits | null) => Promise<void>
}

type SharedProps = PropsLocale<'sub2api.account'> & InjectFace<AccountInjected>

function AccountConnection({ view, busy, t, setAccountOrigin }: Pick<SharedProps, 't' | 'setAccountOrigin'> & {
  view: AccountConnectionView
  busy: boolean
}) {
  const [selected, setSelected] = useState(view.selected ?? '')
  const missing = selected !== '' && !view.origins.includes(selected)
  const active = t('lineActive', { value: view.active ?? t('lineUnresolved') })
  return <PlatformPanel title={t('accountLine')} help={
    <PlatformHelp t={t} topic={t('accountLine')} text={t('accountLineHint') + '\n' + active} />
  }>
    <form className={css.connection} onSubmit={(event) => { event.preventDefault(); void setAccountOrigin(selected || null) }}>
      <select aria-label={t('accountLine')} value={selected} disabled={busy} onChange={(event) => { setSelected(event.target.value) }}>
        <option value="">{t('lineAuto')}</option>
        {missing && <option value={selected} disabled>{t('accountLineUnavailable')}</option>}
        {view.origins.map(origin => <option key={origin} value={origin}>{origin}</option>)}
      </select>
      <Button type="submit" variant="outline" disabled={busy || missing}>{t(selected === '' ? 'lineDetect' : 'gatewayApply')}</Button>
    </form>
    {selected !== view.active && <p className={css.muted}>{active}</p>}
  </PlatformPanel>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Product artwork shared by the account page and sign-in dialog. */
    'sub2api.account.brand': { kind: 'single'; scope: 'root'; owner: { size: number } }
  }
  interface SlotFactoryMap {
    /** Account content reused without duplicating its branding declaration. */
    'sub2api.account.content': {
      scope: 'root'
      props: { openBilling?: () => void }
      inject: AccountInjected
      locale: 'sub2api.account'
      children: { 'sub2api.account.brand': { kind: 'single'; scope: 'root' } }
    }
  }
}

/** @param props - Account state, actions and product artwork renderer. @returns the sign-in form or account overview. */
export function AccountContent({ t, useAccount, signIn, start, verify, cancel, refresh, signOut, setAccountOrigin,
  openBilling, renderSlot, registrationOptions, sendRegistrationCode, registerAccount }: FactoryComponentPropsOf<'sub2api.account.content'>) {
  const snapshot = useAccount(value => value)
  const { view, busy, failed } = snapshot
  const emailId = useId()
  const passwordId = useId()
  const otpId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const submitPassword = () => {
    const submitted = password
    setPassword('')
    void signIn(email, submitted)
  }
  const error = failed ? 'network' : view?.error === null || view?.error === undefined
    || ['no-models', 'gateway-unavailable', 'insecure-gateway'].includes(view.error) ? null : failureKeys[view.error]
  if (view === undefined) return <div className={css.section} role={failed ? 'alert' : 'status'}>{t(failed ? 'network' : 'loading')}</div>
  const signedIn = view.status === 'signed-in'
  const signingIn = view.status === 'signing-in'
  const twoFactor = view.status === 'two-factor'
  const quota = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <section className={css.section} aria-label={t('nav')}>
    <header className={css.brand}>
      {renderSlot('sub2api.account.brand', { size: 48 })}
      <div className={css.brandText}>
        <h2>{view.productName}</h2>
        <a href={view.platformOrigin} target="_blank" rel="noopener noreferrer">{new URL(view.platformOrigin).host}</a>
      </div>
    </header>
    {!registering && error !== null && <p className={css.error} role="alert">{t(error)}</p>}
    {!signedIn && registering && <RegistrationForm t={t} origin={view.platformOrigin} initialEmail={email} busy={busy}
      registrationOptions={registrationOptions} sendRegistrationCode={sendRegistrationCode} registerAccount={registerAccount}
      back={(address) => { setRegistering(false); if (address) { setRegistered(true); setEmail(address) } }} />}
    {!signedIn && !registering && <PlatformPanel title={t('title')}
      help={<PlatformHelp t={t} topic={t('title')} text={t('description') + '\n' + t('alternativeSignIn')} />}>
      {registered && <p role="status">{t('registrationReturned')}</p>}
      {twoFactor ? <form className={css.loginForm} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); const submitted = code; setCode(''); void verify(submitted) }}>
        <div className={css.field}><label htmlFor={otpId}>{t('twoFactor')}</label>
          <Input id={otpId} data-modal-autofocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) =>{ setCode(event.target.value) }} disabled={busy} required /></div>
        <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>{t(busy ? 'signingIn' : 'verify')}</Button>
      </form> : <form className={css.loginForm} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); submitPassword() }}>
        <div className={css.field}><label htmlFor={emailId}>{t('email')}</label>
          <Input id={emailId} data-modal-autofocus type="email" autoComplete="username" value={email} onChange={(event) =>{ setEmail(event.target.value) }} disabled={busy || signingIn} required /></div>
        <div className={css.field}><label htmlFor={passwordId}>{t('password')}</label>
          <Input id={passwordId} type="password" autoComplete="current-password" value={password} onChange={(event) =>{ setPassword(event.target.value) }} disabled={busy || signingIn} required /></div>
        <Button type="submit" variant="primary" disabled={busy || signingIn || !email || !password}>{t(busy ? 'signingIn' : 'passwordSignIn')}</Button>
        <div className={css.loginAlternatives}>
          <Button type="button" variant="outline" disabled={busy || signingIn} onClick={() => {
            setPassword(''); setRegistered(false); setRegistering(true)
          }}>{t('registerAccount')}</Button>
          <Button type="button" variant="outline" onClick={() => { void start() }} disabled={busy || signingIn}>{t('browserSignIn')}</Button>
        </div>
      </form>}
      {view.authorizationUrl !== null && <div className={css.notice}>
        <p role="status">{t('waiting')}</p>
        <a href={view.authorizationUrl} target="_blank" rel="noopener noreferrer">{t('openBrowser')}</a>
      </div>}
      {(signingIn || twoFactor) && <Button onClick={() => { void cancel() }} disabled={busy}>{t('cancel')}</Button>}
    </PlatformPanel>}
    {signedIn && <PlatformPanel title={t('accountOverview')}
      help={<PlatformHelp t={t} topic={t('accountOverview')} text={t('balanceAutoRefresh')} />}
      actions={<Button variant="ghost" size="sm" onClick={() => { void refresh() }} disabled={busy}>{t(busy ? 'accountProcessing' : 'refresh')}</Button>}>
      {view.profile !== null && <div className={css.profile}>
        <div className={css.avatar}><IconUserOutlineMedium /></div>
        <div className={css.identity}>
          <strong>{view.profile.name}</strong>
          {view.profile.name !== view.profile.email && <span className={css.muted}>{view.profile.email}</span>}
        </div>
        <span className={css.status}>{t('signedIn')}</span>
      </div>}
      <div className={css.metrics}>
        <div><span>{t('balance')}</span><strong>{view.profile === null ? '—' : quota(view.profile.balance)}</strong></div>
        <div><span>{t('todayCost')}</span><strong>{view.usage === null ? '—' : quota(view.usage.todayCost)}</strong></div>
        <div><span>{t('todayRequests')}</span><strong>{view.usage === null ? '—' : view.usage.todayRequests.toLocaleString('zh-CN')}</strong></div>
        <div><span>{t('totalCost')}</span><strong>{view.usage === null ? '—' : quota(view.usage.totalCost)}</strong></div>
      </div>
      {view.balanceStale && <p className={css.error} role="status">{t('balanceStale')}</p>}
      {view.usageError && <p className={css.muted} role="status">{t('usageSummaryUnavailable')}</p>}
      <nav className={css.accountLinks} aria-label={t('accountActions')}>
        {openBilling && <Button variant="primary" onClick={openBilling}>{t('billingBuy')}</Button>}
        <a href={view.platformOrigin + '/dashboard'} target="_blank" rel="noopener noreferrer">{t('platform')}</a>
        <a href={view.platformOrigin + '/settings/desktop'} target="_blank" rel="noopener noreferrer">{t('devices')}</a>
        <SignOutButton key={view.profile?.id} busy={busy} t={t} signOut={signOut} />
      </nav>
    </PlatformPanel>}
    {!registering && view.connection && <AccountConnection key={view.connection.selected ?? 'auto'} view={view.connection}
      busy={busy || signingIn || twoFactor} t={t} setAccountOrigin={setAccountOrigin} />}
  </section>
}

function SignOutButton({ busy, t, signOut }: Pick<SharedProps, 't' | 'signOut'> & { busy: boolean }) {
  const [open, setOpen] = useState(false)
  const close = () => { setOpen(false) }
  return <>
    <Button variant="primary" className={css.signOut} aria-haspopup="dialog" disabled={busy}
      onClick={() => { setOpen(true) }}>{t('signOut')}</Button>
    <Modal open={open} onClose={close} closeLabel={t('close')} title={t('signOutTitle')} description={t('signOutDescription')}
      footer={<>
        <Button variant="outline" data-modal-autofocus onClick={close}>{t('cancel')}</Button>
        <Button variant="primary" className={css.signOut} disabled={busy}
          onClick={() => { close(); void signOut() }}>{t('signOutConfirm')}</Button>
      </>} />
  </>
}

/** Account settings page props assembled by the renderer. */
export type AccountSectionProps = PropsRuntime<'settings.section'> & PropsRenderFactories
/** @param props - Renderer for the shared account content. @returns the account settings page. */
export function AccountSection({ renderFactorySlot, selectSection }: AccountSectionProps) {
  return renderFactorySlot('sub2api.account.content', selectSection ? { openBilling: () => { selectSection('sub2api-billing') } } : {})
}

/** @param props - sidebar owner actions and account state. @returns the platform account launcher. */
export function AccountLauncher(props: PropsRuntime<'settings.launcher'> & SharedProps) {
  const view = props.useAccount(value => value.view)
  const signedIn = view?.status === 'signed-in'
  const label = signedIn ? view.profile?.name ?? view.productName : props.t('sidebarSignIn')
  const balance = signedIn ? view.profile?.balance : undefined
  const quota = balance === undefined ? '' : props.t('sidebarQuota', { value: balance.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
  const accessibleName = quota ? `${label} · ${quota}` : label
  const title = signedIn ? `${accessibleName} · ${props.t(view.balanceStale ? 'balanceStale' : 'balanceAutoRefresh')}` : label
  const open = () => {
    if (signedIn) props.openSettings()
    else props.showLogin(true)
  }
  return <Button className={css.launcher} data-sign-in={props.wide && !signedIn || undefined} aria-haspopup="dialog"
    aria-label={accessibleName} title={title} onClick={open} icon={<IconUserOutlineMedium />}>
    {props.wide && <span className={css.launcherText}><span className={css.launcherName}>{label}</span>
      {quota && <span className={css.launcherQuota}>{quota}{view?.balanceStale && ' *'}</span>}</span>}
  </Button>
}

/** @param props - safe account state and dialog actions. @returns first-run sign-in or nothing after authentication. */
export function AccountGate(props: PropsRuntime<'shell.overlay'> & SharedProps & PropsRenderFactories) {
  const snapshot = props.useAccount(value => value)
  const open = snapshot.loginVisible && snapshot.view !== undefined
    && snapshot.view.status !== 'signed-in'
  return <Modal open={open} title={props.t('nav')} closeLabel={props.t('close')} contentClassName={css.dialogContent ?? ''} onClose={() => {
    if (snapshot.busy) return
    props.showLogin(false)
    void props.cancel()
  }} className={css.dialog ?? ''}>
    {open && props.renderFactorySlot('sub2api.account.content', {})}
  </Modal>
}
