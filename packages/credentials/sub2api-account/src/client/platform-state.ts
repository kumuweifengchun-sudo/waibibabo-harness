/** Client-memory state for the native platform pages; never written to browser storage. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AccountFailure, Sub2apiGroupId, Sub2apiUserId } from '../types.ts'
import type { CheckoutView, GatewayId, GatewayView, ImageRequest, ImageResult, InvoiceFileId, InvoiceId,
  InvoicePage, InvoiceQuote, InvoiceRequest, InvoiceRequestKey, InvoiceView, OrderPage, OrderRequest, PaymentLaunch, PaymentOrder,
  PaymentOrderId, PlatformPageQuery, SubscriptionView } from '../platform-types.ts'
import type { AccountInjected } from './AccountSection.tsx'

/** Independently serialized operations so a slow image does not block account queries. */
export type PlatformChannel = 'gateways' | 'images' | 'imageModels' | 'imageUploads' | 'billing' | 'invoices'
/** Per-image save feedback; native completion supplies the actual destination. */
export interface ImageSaveState { readonly status: 'saving' | 'saved' | 'requested' | 'cancelled' | 'failed'; readonly path?: string }
/** The image form may be empty until the user chooses an authorized group. */
export type ImageDraft = Omit<ImageRequest, 'groupId'> & { readonly groupId: Sub2apiGroupId | null }
/** Shared memory survives settings-page switches and is erased on account change. */
export interface PlatformState {
  readonly loading: Readonly<Record<PlatformChannel, boolean>>
  readonly errors: Readonly<Record<PlatformChannel, AccountFailure | null>>
  readonly gateways: GatewayView | null
  readonly imageDraft: ImageDraft
  readonly imageResult: ImageResult | null
  readonly imageModels: readonly string[]
  readonly imageModelsGroup: Sub2apiGroupId | null
  readonly imageSaves: Readonly<Record<string, ImageSaveState>>
  readonly checkout: CheckoutView | null
  readonly subscriptions: readonly SubscriptionView[]
  readonly orders: OrderPage | null
  readonly orderQuery: PlatformPageQuery
  readonly payment: PaymentLaunch | null
  readonly paymentState: PaymentOrder | null
  readonly orderUncertain: boolean
  readonly invoices: InvoicePage | null
  readonly invoiceQuery: PlatformPageQuery
  readonly invoiceOpen: boolean
  readonly invoice: InvoiceView | null
  readonly invoiceDraft: InvoiceRequest
  readonly quote: InvoiceQuote | null
  readonly invoiceSaved: boolean
  readonly invoiceUncertain: boolean
}

/** Empty invoice draft with one retry key.
 * @param email - Current account email, if available.
 * @returns an unsubmitted application.
 */
export function newInvoiceDraft(email = ''): InvoiceRequest {
  return { id: null, kind: 'personal', title: '', taxId: '', email, paymentAmount: '', version: 0,
    requestKey: randomUUID() as InvoiceRequestKey, retained: [], files: [] }
}

/** @returns empty, account-independent feature state. */
export function initialPlatformState(): PlatformState {
  return { loading: { gateways: false, images: false, imageModels: false, imageUploads: false, billing: false, invoices: false },
    errors: { gateways: null, images: null, imageModels: null, imageUploads: null, billing: null, invoices: null }, gateways: null,
    imageDraft: { groupId: null, model: '', prompt: '', count: 1, size: '', references: [] }, imageResult: null,
    imageModels: [], imageModelsGroup: null, imageSaves: {},
    checkout: null, subscriptions: [], orders: null, orderQuery: { page: 1, pageSize: 20, status: '' }, payment: null,
    paymentState: null, orderUncertain: false, invoices: null, invoiceQuery: { page: 1, pageSize: 20, status: '' },
    invoiceOpen: false, invoice: null, invoiceDraft: newInvoiceDraft(), quote: null, invoiceSaved: false, invoiceUncertain: false }
}

/** Plain actions supplied by the apply scope to native platform pages. */
export interface PlatformInjected {
  hooks: { account: AccountInjected['hooks']['account']; platform: HostObservable<PlatformState> }
  selectGroup: AccountInjected['selectGroup']
  setProtocol: AccountInjected['setProtocol']
  setTransport: AccountInjected['setTransport']
  setModelLimits: AccountInjected['setModelLimits']
  setModelLimitOverride: AccountInjected['setModelLimitOverride']
  showLogin: AccountInjected['showLogin']
  refresh: AccountInjected['refresh']
  loadGateways: () => Promise<void>
  selectGateway: (id: GatewayId | null, allowInsecure: boolean) => Promise<void>
  updateImageDraft: (patch: Partial<ImageDraft>) => void
  /** Append a validated selection atomically; failures retain the previous draft. */
  addImageReferences: (files: readonly File[]) => Promise<void>
  loadImageModels: (group: Sub2apiGroupId) => Promise<void>
  generate: (input: ImageRequest) => Promise<void>
  saveImage: (id: import('../platform-types.ts').ImageOutputId) => Promise<void>
  loadBilling: (query?: PlatformPageQuery) => Promise<void>
  createPayment: (input: OrderRequest) => Promise<boolean>
  refreshPayment: (id: PaymentOrderId) => Promise<void>
  cancelPayment: (id: PaymentOrderId) => Promise<void>
  loadInvoices: (query?: PlatformPageQuery) => Promise<void>
  openInvoice: (id: InvoiceId | null) => Promise<void>
  closeInvoice: () => void
  updateInvoiceDraft: (patch: Partial<InvoiceRequest>, owner: Sub2apiUserId) => void
  quoteInvoice: () => Promise<void>
  submitInvoice: () => Promise<void>
  downloadInvoice: (id: InvoiceId, file: InvoiceFileId) => Promise<void>
}
