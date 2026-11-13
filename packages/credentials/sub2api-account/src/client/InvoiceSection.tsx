/** Native invoice applications with separate purchase and fee evidence. */
import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvidenceFile } from '../platform-types.ts'
import type { AccountKey } from './locales.ts'
import { PlatformLogin, PlatformNotice, PlatformPagination, type PlatformProps } from './PlatformCommon.tsx'
import css from './Platform.module.css'

const states: Readonly<Record<string, AccountKey>> = { pending: 'invoicePending', issued: 'invoiceIssued', voided: 'invoiceVoided',
  unsent: 'invoiceEmailUnsent', sending: 'invoiceEmailSending', sent: 'invoiceEmailSent', failed: 'invoiceEmailFailed', unknown: 'invoiceEmailUnknown' }
const money = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function evidence(file: File, kind: EvidenceFile['kind']): Promise<EvidenceFile> {
  if (file.size === 0 || file.size > 20 * 1024 * 1024 || !/\.(?:png|jpe?g)$/iu.test(file.name)) throw new Error('invalid evidence')
  const mime = file.type || (/\.png$/iu.test(file.name) ? 'image/png' : 'image/jpeg')
  if (mime !== 'image/png' && mime !== 'image/jpeg') throw new Error('invalid evidence')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(new Error('file read failed')) }
    reader.onload = () => { if (typeof reader.result === 'string') resolve(reader.result.slice(reader.result.indexOf(',') + 1)); else reject(new Error('file read failed')) }
    reader.readAsDataURL(file)
  })
  return { name: file.name, mime, base64, kind }
}

/** @param props - Account-bound invoice queries and draft actions. @returns the invoice settings page. */
export function InvoiceSection(props: PlatformProps) {
  const profile = props.useAccount(value => value.view?.profile)
  return profile ? <InvoiceContent key={profile.id} {...props} /> : <PlatformLogin {...props} />
}

function InvoiceContent(props: PlatformProps) {
  const profile = props.useAccount(value => value.view?.profile)
  const state = props.usePlatform(value => value)
  const { t, loadInvoices } = props
  const [fileBusy, setFileBusy] = useState(false)
  const [fileError, setFileError] = useState(false)
  useEffect(() => { void loadInvoices() }, [loadInvoices])
  const label = (value: string) => { const key = states[value]; return key ? t(key) : value }
  const draft = state.invoiceDraft
  const current = state.invoice
  const busy = state.loading.invoices || fileBusy
  const uncertain = state.invoiceUncertain
  const editable = current === null || current.status === 'pending'
  const update = (patch: Partial<typeof draft>) => { if (profile) props.updateInvoiceDraft(patch, profile.id) }
  const addFiles = async (files: File[], kind: EvidenceFile['kind']) => {
    const owner = profile?.id
    if (owner === undefined) return
    setFileBusy(true); setFileError(false)
    try {
      if (draft.retained.length + draft.files.length + files.length > 10) throw new Error('too many files')
      const added = await Promise.all(files.map(file => evidence(file, kind)))
      props.updateInvoiceDraft({ files: [...draft.files, ...added] }, owner)
    } catch { setFileError(true) }
    finally { setFileBusy(false) }
  }
  return <section className={css.section}>
    <div className={css.header}><h2>{t('invoiceTitle')}</h2><Button variant="outline" disabled={busy} onClick={() => { void loadInvoices() }}>{t('invoiceRefresh')}</Button></div>
    <p className={css.muted}>{t('invoiceDescription')}</p>
    <div><Button variant="primary" disabled={busy} onClick={() => { void props.openInvoice(null) }}>{t('invoiceApply')}</Button></div>
    {!state.invoiceOpen && <PlatformNotice t={t} loading={state.loading.invoices} error={state.errors.invoices} />}
    {state.invoiceSaved && <p role="status">{t('invoiceSaved')}</p>}
    <label className={css.form}>{t('billingStatus')}<select value={state.invoiceQuery.status} disabled={busy}
      onChange={(event) => { void loadInvoices({ ...state.invoiceQuery, page: 1, status: event.target.value }) }}>
      <option value="">{t('billingAll')}</option>{['pending', 'issued', 'voided'].map(status => <option key={status} value={status}>{label(status)}</option>)}
    </select></label>
    {state.invoices !== null && (state.invoices.items.length === 0 ? <p className={css.muted}>{t('invoiceEmpty')}</p> : <div className={css.table}>
      <table><thead><tr><th>{t('invoiceHeading')}</th><th>{t('invoiceAmount')}</th><th>{t('billingStatus')}</th><th>{t('invoiceDelivery')}</th><th>{t('usageDetails')}</th></tr></thead>
        <tbody>{state.invoices.items.map(invoice => <tr key={invoice.id}><td>{invoice.title}<small>#{invoice.id}</small></td>
          <td>{money(invoice.amountCents)}</td><td>{label(invoice.status)}</td><td>{label(invoice.emailStatus)}</td>
          <td><Button variant="ghost" disabled={busy} onClick={() => { void props.openInvoice(invoice.id) }}>{t('usageDetails')}</Button></td></tr>)}</tbody>
      </table></div>)}
    {state.invoices !== null && <PlatformPagination {...state.invoiceQuery} total={state.invoices.total} busy={busy} t={t}
      onPage={(page) => { void loadInvoices({ ...state.invoiceQuery, page }) }} />}
    <Modal open={state.invoiceOpen} title={t(current === null ? 'invoiceApply' : 'invoiceDetail')} closeLabel={t('close')}
      onClose={() => { if (!fileBusy) props.closeInvoice() }} className={css.invoiceDialog ?? ''}>
      <div className={css.section}>
        <PlatformNotice t={t} loading={busy} error={state.errors.invoices} />
        {uncertain && state.errors.invoices !== 'uncertain' && <p className={css.error} role="alert">{t('uncertain')}</p>}
        {fileError && <p className={css.error} role="alert">{t('invoiceFileHint')}</p>}
        {current && <p>{t('billingStatus')}：{label(current.status)} · {t('invoiceDelivery')}：{label(current.emailStatus)}</p>}
        {current?.note && <p className={css.error}>{t('invoiceNote')}：{current.note}</p>}
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); if (state.quote !== null) void props.submitInvoice() }}>
          <fieldset className={css.form} disabled={busy || !editable || uncertain}>
            <p className={css.muted}>{t('invoiceProcessing')}</p>
            <label>{t('invoiceKind')}<select value={draft.kind} onChange={(event) => { update({ kind: event.target.value === 'company' ? 'company' : 'personal' }) }}>
              <option value="personal">{t('invoicePersonal')}</option><option value="company">{t('invoiceCompany')}</option>
            </select></label>
            <label>{t('invoiceHeading')}<Input value={draft.title} required maxLength={200} onChange={(event) => { update({ title: event.target.value }) }} /></label>
            {draft.kind === 'company' && <label>{t('invoiceTaxId')}<Input value={draft.taxId} required maxLength={64} onChange={(event) => { update({ taxId: event.target.value }) }} /></label>}
            <div className={css.grid}><label>{t('invoicePaymentAmount')}<Input value={draft.paymentAmount} required inputMode="decimal" maxLength={14}
              onChange={(event) => { update({ paymentAmount: event.target.value }) }} /></label>
            <label>{t('invoiceEmail')}<Input type="email" value={draft.email} required maxLength={254} onChange={(event) => { update({ email: event.target.value }) }} /></label></div>
            <div><Button variant="outline" disabled={!draft.paymentAmount} onClick={() => { void props.quoteInvoice() }}>{t('invoiceCalculate')}</Button></div>
            {state.quote !== null && <dl className={css.details}><dt>{t('invoiceFee')}</dt><dd>{money(state.quote.feeCents)}</dd>
              <dt>{t('invoiceAmount')}</dt><dd>{money(state.quote.amountCents)}</dd></dl>}
            {editable && <><p className={css.muted}>{t('invoiceFileHint')}</p>{(['payment', 'fee_payment'] as const).map(kind => <label key={kind}>
              {t(kind === 'payment' ? 'invoicePaymentProof' : 'invoiceFeeProof')}
              <input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => {
                const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files, kind)
              }} />
            </label>)}</>}
            {draft.files.map((file, index) => <div className={css.header} key={`${file.kind}:${file.name}:${index}`}><span>{file.name} · {t(file.kind === 'payment' ? 'invoicePaymentProof' : 'invoiceFeeProof')}</span>
              <Button variant="ghost" onClick={() => { update({ files: draft.files.filter((_, position) => position !== index) }) }}>{t('invoiceRemoveFile')}</Button></div>)}
          </fieldset>
          {editable && <><p className={css.muted}>{t('invoiceQuoteRequired')}</p>
            <div><Button type="submit" variant="primary" disabled={busy || state.quote === null}>{t(uncertain ? 'invoiceRetry' : 'invoiceSubmit')}</Button></div></>}
        </form>
        {current && <><h3>{t('invoiceFiles')}</h3>{current.files.map(file => <div className={css.header} key={file.id}>
          <span>{file.name} · {t(file.kind === 'payment' ? 'invoicePaymentProof' : file.kind === 'fee_payment' ? 'invoiceFeeProof' : 'invoiceIssued')}</span>
          <div className={css.actions}><Button variant="outline" disabled={busy} onClick={() => { void props.downloadInvoice(current.id, file.id) }}>{t('invoiceDownload')}</Button>
            {editable && file.kind !== 'invoice' && <label className={css.check}><input type="checkbox" checked={draft.retained.includes(file.id)} disabled={busy || uncertain}
              onChange={(event) => { update({ retained: event.target.checked ? [...draft.retained, file.id] : draft.retained.filter(id => id !== file.id) }) }} />{t('invoiceRetainedFile')}</label>}</div>
        </div>)}</>}
      </div>
    </Modal>
  </section>
}
