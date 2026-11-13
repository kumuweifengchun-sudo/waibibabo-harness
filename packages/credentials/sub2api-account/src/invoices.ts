/** Native invoice form validation, multipart evidence and credential-free downloads. */
import { z } from 'zod'
import { AccountError, parse } from './http.ts'
import type { InvoiceFileId, InvoiceId, InvoicePage, InvoiceQuote, InvoiceRequest, InvoiceView, PlatformFile } from './platform-types.ts'

const positiveId = z.number().int().positive()
const cents = z.number().int().nonnegative()
const file = z.object({ id: z.uuid(), name: z.string(), mime: z.string(), size: cents, kind: z.string() })
const invoice = z.object({ id: positiveId, kind: z.enum(['personal', 'company']), title: z.string(), tax_id: z.string(), email: z.string(),
  amount_cents: cents, payment_amount_cents: cents, fee_cents: cents, version: positiveId, status: z.string(), email_status: z.string(),
  created_at: z.string(), void_note: z.string().optional(), files: z.array(file) })
const amount = z.string().regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/u)
const request = z.object({ id: z.string().regex(/^[1-9]\d*$/u).nullable(), kind: z.enum(['personal', 'company']),
  title: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/u), taxId: z.string().max(64).regex(/^[^\r\n]*$/u), email: z.email().max(254),
  paymentAmount: amount, version: z.number().int().nonnegative(), requestKey: z.string().regex(/^[a-zA-Z0-9_-]{16,64}$/u),
  retained: z.array(z.uuid()).max(10), files: z.array(z.object({ name: z.string().min(1).max(240).regex(/^[^/\\\r\n\0]+\.(?:png|jpe?g)$/iu),
    mime: z.enum(['image/png', 'image/jpeg']), base64: z.string().min(4).max(Math.ceil(20 * 1024 * 1024 / 3) * 4), kind: z.enum(['payment', 'fee_payment']) })).max(10) })

/** Encode the amount only; the server owns minimum amounts and fee rules.
 * @param value - Payment amount in CNY with at most two decimal places.
 * @returns the validated URL parameter.
 */
export function invoiceAmount(value: string): string {
  if (!amount.safeParse(value).success) throw new AccountError('validation')
  return encodeURIComponent(value)
}

/** Read authoritative CNY fee amounts.
 * @param value - Platform quote response.
 * @returns integer cents for the submitted payment amount.
 */
export function invoiceQuote(value: unknown): InvoiceQuote {
  const data = parse(z.object({ payment_amount_cents: cents, fee_cents: cents, amount_cents: cents }), value)
  return { paymentAmountCents: data.payment_amount_cents, feeCents: data.fee_cents, amountCents: data.amount_cents }
}

/** Build the same evidence upload used by the website, preserving the caller's retry key.
 * @param value - Application fields, retained server file ids and user-selected screenshots.
 * @returns multipart form owned by this request.
 */
export function invoiceForm(value: InvoiceRequest): FormData {
  const checked = request.safeParse(value)
  if (!checked.success || value.kind === 'company' && !value.taxId.trim()
    || value.retained.length + value.files.length > 10) throw new AccountError('validation')
  if (value.id === null && (!value.files.some(item => item.kind === 'payment') || !value.files.some(item => item.kind === 'fee_payment'))) {
    throw new AccountError('invoice-evidence')
  }
  const form = new FormData()
  form.append('data', JSON.stringify({ kind: value.kind, title: value.title.trim(), tax_id: value.taxId.trim(), email: value.email,
    payment_amount: value.paymentAmount, version: value.version, request_key: value.requestKey, retain_ids: value.retained }))
  for (const item of value.files) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(item.base64) || item.base64.length % 4 !== 0) throw new AccountError('validation')
    const data = Buffer.from(item.base64, 'base64')
    if (data.byteLength === 0 || data.byteLength > 20 * 1024 * 1024) throw new AccountError('validation')
    form.append(item.kind === 'payment' ? 'files' : 'fee_files', new Blob([data], { type: item.mime }), item.name)
  }
  return form
}

/** Project one user-owned application and its files.
 * @param value - Platform invoice response.
 * @returns fields shown by the native application.
 */
export function invoiceView(value: unknown): InvoiceView {
  const data = parse(invoice, value)
  return { id: String(data.id) as InvoiceId, kind: data.kind, title: data.title, taxId: data.tax_id, email: data.email,
    amountCents: data.amount_cents, paymentAmountCents: data.payment_amount_cents, feeCents: data.fee_cents, version: data.version,
    status: data.status, emailStatus: data.email_status, createdAt: data.created_at, note: data.void_note ?? '',
    files: data.files.map(row => ({ id: row.id as InvoiceFileId, name: row.name, mime: row.mime, size: row.size, kind: row.kind })) }
}

/** Project the account's invoice list.
 * @param value - Platform pagination result.
 * @returns invoices and server total.
 */
export function invoicePage(value: unknown): InvoicePage {
  const data = parse(z.object({ items: z.array(invoice), total: cents }), value)
  return { items: data.items.map(invoiceView), total: data.total }
}

/** Validate a download against the metadata retrieved from the owned invoice.
 * @param metadata - File selected from the latest invoice response.
 * @param bytes - Authenticated file response.
 * @param mime - Server media type.
 * @returns file content suitable for a user-initiated download.
 */
export function invoiceDownload(metadata: InvoiceView['files'][number], bytes: Uint8Array, mime: string): PlatformFile {
  if (!['image/png', 'image/jpeg', 'application/pdf'].includes(mime) || metadata.mime !== mime || metadata.size !== bytes.byteLength) {
    throw new AccountError('protocol')
  }
  const name = metadata.name.replace(/[/\\\r\n\0]/gu, '_')
  return { name, mime, base64: Buffer.from(bytes).toString('base64') }
}
