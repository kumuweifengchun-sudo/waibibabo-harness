/** Native signup form driven by the platform's current public settings. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AccountFailure, RegistrationId, RegistrationOptions } from '../types.ts'
import type { AccountInjected } from './AccountSection.tsx'
import { PlatformHelp, PlatformPanel } from './PlatformCommon.tsx'
import { failureKeys } from './errors.ts'
import css from './AccountSection.module.css'

type Props = PropsLocale<'sub2api.account'> & Pick<AccountInjected, 'registrationOptions' | 'sendRegistrationCode' | 'registerAccount'> & {
  origin: string
  busy: boolean
  initialEmail: string
  back: (registeredEmail?: string) => void
}

/** @param props - Public signup actions and return-to-login callback. @returns signup policy, fields and verification state. */
export function RegistrationForm({ t, origin, initialEmail, busy, registrationOptions,
  sendRegistrationCode, registerAccount, back }: Props) {
  const [options, setOptions] = useState<RegistrationOptions>()
  const [error, setError] = useState<AccountFailure | null>(null)
  const [reload, setReload] = useState(0)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [registrationCode, setCode] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [affiliate, setAffiliate] = useState('')
  const [promo, setPromo] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [id, setId] = useState(() => randomUUID() as RegistrationId)
  const [sent, setSent] = useState(false)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    let active = true
    void registrationOptions().then((result) => {
      if (!active) return
      if (result.ok) setOptions(result.data)
      else setError(result.error)
    })
    return () => { active = false }
  }, [registrationOptions, reload])
  useEffect(() => {
    if (!seconds) return
    const timer = setTimeout(() => { setSeconds(seconds - 1) }, 1000)
    return () => { clearTimeout(timer) }
  }, [seconds])
  const ready = options?.enabled && !busy && email.trim().length > 0 && (!options.registrationCode || registrationCode.trim().length > 0)
    && (options.agreements.length === 0 || agreed)
  const mismatch = !!confirmation && password !== confirmation
  const submitReady = ready && password.length >= 6 && password === confirmation && error !== 'registration-unknown'
    && (!options.emailVerification || sent && !!emailCode.trim())
  const send = async () => {
    setError(null)
    const result = await sendRegistrationCode(id, email.trim(), registrationCode.trim())
    if (result.ok) { setSent(true); setSeconds(result.data) }
    else setError(result.error)
  }
  const submit = async () => {
    if (!submitReady) return
    setError(null)
    const result = await registerAccount({ id, email: email.trim(), registrationCode: registrationCode.trim(), password,
      emailCode: emailCode.trim(), affiliate: affiliate.trim(), promo: promo.trim() })
    if (result.ok) back(email.trim())
    else setError(result.error)
  }
  return <PlatformPanel title={t('registerAccount')} help={options?.enabled && !options.captcha && options.notice &&
    <PlatformHelp t={t} topic={t('signupNotice')} text={options.notice} />}>
    <form className={css.loginForm} aria-label={t('registerAccount')} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {!options && !error && <p role="status">{t('signupLoading')}</p>}
      {error && <p role="alert" className={css.error}>{t(failureKeys[error])}</p>}
      {!options && error && <Button onClick={() => { setError(null); setReload(reload + 1) }}>{t('signupRetry')}</Button>}
      {options && !options.enabled && <p>{t('signupDisabled')}</p>}
      {options?.enabled && (options.captcha ? <>
        <p>{t('signupCaptcha')}</p><a href={origin + '/register'} target="_blank" rel="noopener noreferrer">{t('registerOnWebsite')}</a>
      </> : <>
        <label className={css.field}>{t('email')}<Input type="email" autoComplete="email" required value={email} disabled={busy || sent}
          onChange={(event) => { setEmail(event.target.value); setId(randomUUID() as RegistrationId) }} /></label>
        <label className={css.field}>{t('signupPassword')}<Input type="password" autoComplete="new-password" required minLength={6}
          disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value) }} /></label>
        <label className={css.field}>{t('signupConfirm')}<Input type="password" autoComplete="new-password" required disabled={busy}
          value={confirmation} onChange={(event) => { setConfirmation(event.target.value) }} /></label>
        {mismatch && <p role="alert">{t('signupMismatch')}</p>}
        {options.registrationCode && <label className={css.field}>{t('signupRegistrationCode')}<Input required value={registrationCode}
          disabled={busy || sent} onChange={(event) => { setCode(event.target.value); setId(randomUUID() as RegistrationId) }} /></label>}
        {options.affiliate && <label className={css.field}>{t('signupAffiliate')}<Input value={affiliate}
          disabled={busy} onChange={(event) => { setAffiliate(event.target.value) }} /></label>}
        {options.promo && <label className={css.field}>{t('signupPromo')}<Input value={promo}
          disabled={busy} onChange={(event) => { setPromo(event.target.value) }} /></label>}
        {!!options.agreements.length && <div className={css.field}>
          <label><input type="checkbox" required checked={agreed} disabled={busy}
            onChange={(event) => { setAgreed(event.target.checked) }} /> {t('signupAgree')}</label>
          {options.agreements.map(doc => <a key={doc.id || doc.title} target="_blank" rel="noopener noreferrer"
            href={origin + '/legal/' + encodeURIComponent(doc.id || doc.title)}>{doc.title}</a>)}
        </div>}
        {options.emailVerification && <div className={css.field}>
          <label>{t('signupEmailCode')}<Input autoComplete="one-time-code" inputMode="numeric" required value={emailCode}
            disabled={busy} onChange={(event) => { setEmailCode(event.target.value) }} /></label>
          <Button type="button" variant="outline" disabled={!ready || seconds > 0} onClick={() => { void send() }}>
            {seconds > 0 ? t('signupResend', { seconds: String(seconds) }) : t('signupSend')}</Button>
          {sent && <p role="status">{t('signupSent')}</p>}
        </div>}
        <Button type="submit" variant="primary" disabled={!submitReady}>{t(busy ? 'signupPending' : 'signupSubmit')}</Button>
      </>)}
      <Button type="button" disabled={busy} onClick={() => { back() }}>{t('backToLogin')}</Button>
    </form>
  </PlatformPanel>
}
