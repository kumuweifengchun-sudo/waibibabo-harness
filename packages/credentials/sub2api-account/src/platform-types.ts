/** Credential-free native platform operations shared with the client. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AccountFailure, Sub2apiGroupId } from './types.ts'

/** Stable normalized address of an administrator-advertised inference gateway. */
export type GatewayId = Branded<'Sub2apiGatewayId'>
/** Platform order identifier. */
export type PaymentOrderId = Branded<'Sub2apiPaymentOrderId'>
/** Platform subscription plan identifier. */
export type SubscriptionPlanId = Branded<'Sub2apiSubscriptionPlanId'>
/** Platform invoice identifier. */
export type InvoiceId = Branded<'Sub2apiInvoiceId'>
/** Platform invoice attachment identifier. */
export type InvoiceFileId = Branded<'Sub2apiInvoiceFileId'>
/** Native image output identity within one generation result. */
export type ImageOutputId = Branded<'Sub2apiImageOutputId'>
/** Stable invoice submission idempotency key. */
export type InvoiceRequestKey = Branded<'Sub2apiInvoiceRequestKey'>
/** One native operation's explicit success or localized failure. */
export type PlatformResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: AccountFailure }
/** Inference-only address; account credentials are never sent here. */
export interface GatewayEndpoint {
  readonly id: GatewayId
  readonly name: string
  readonly origin: string
  readonly description: string
  readonly insecure: boolean
}
/** Available addresses and the account's saved selection. */
export interface GatewayView {
  readonly endpoints: readonly GatewayEndpoint[]
  /** Null enables automatic inference routing, independently of the account connection. */
  readonly selected: GatewayId | null
  /** Actual inference route for the selected conversation group, when resolved. */
  readonly active?: GatewayId | null
}
/** Native image generation input; its group can differ from the conversation's group. */
export interface ImageRequest {
  readonly groupId: Sub2apiGroupId
  readonly model: string
  readonly prompt: string
  readonly count: number
  readonly size: string
}
/** Validated image preview; only HTTP(S) image URLs or bounded image data URLs. */
export interface GeneratedImage { readonly id: ImageOutputId; readonly source: string; readonly revisedPrompt: string | null }
/** Native image generation output, held only in the current client's memory. */
export interface ImageResult { readonly images: readonly GeneratedImage[] }
/** Payment method and authoritative limits supplied by the platform. */
export interface PaymentMethod {
  readonly id: string
  readonly name: string
  readonly currency: string
  readonly minimum: number
  readonly maximum: number
  readonly feeRate: number
  readonly available: boolean
}
/** A purchasable subscription; prices retain the platform's currency. */
export interface SubscriptionPlan {
  readonly id: SubscriptionPlanId
  readonly name: string
  readonly description: string
  readonly price: number
  readonly currency: string
  readonly validity: number
  readonly validityUnit: string
  readonly group: string
  readonly features: readonly string[]
}
/** Account checkout configuration without payment secrets. */
export interface CheckoutView {
  readonly enabled: boolean
  readonly balanceDisabled: boolean
  readonly methods: readonly PaymentMethod[]
  readonly plans: readonly SubscriptionPlan[]
  readonly balanceMultiplier: number
  readonly subscriptionExchangeRate: number
  readonly bonusMode: string
  readonly bonusTiers: readonly { readonly minimum: number; readonly percent: number }[]
  readonly notice: string
  readonly help: string
}
/** Explicit checkout selection; payment is completed outside the client. */
export interface OrderRequest {
  readonly amount: number
  readonly method: string
  readonly kind: 'balance' | 'subscription'
  readonly planId: SubscriptionPlanId | null
}
/** Created order and the provider's permitted payment destination. */
export interface PaymentLaunch {
  readonly id: PaymentOrderId
  readonly amount: number
  readonly payAmount: number
  readonly currency: string
  readonly expiresAt: string
  readonly paymentUrl: string | null
  readonly qrCode: string | null
}
/** Display-safe platform order. */
export interface PaymentOrder {
  readonly id: PaymentOrderId
  readonly number: string
  readonly amount: number
  readonly payAmount: number
  readonly currency: string
  readonly status: string
  readonly kind: string
  readonly method: string
  readonly createdAt: string
  readonly expiresAt: string
}
/** Paginated account-owned orders. */
export interface OrderPage {
  readonly items: readonly PaymentOrder[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}
/** Pagination and optional server status filter. */
export interface PlatformPageQuery { readonly page: number; readonly pageSize: number; readonly status: string }
/** Subscription progress displayed with the platform's units and expiry. */
export interface SubscriptionView {
  readonly group: string
  readonly status: string
  readonly expiresAt: string | null
  readonly daily: number | null
  readonly weekly: number | null
  readonly monthly: number | null
}
/** One invoice file; the opaque id is required for authenticated download. */
export interface InvoiceFile {
  readonly id: InvoiceFileId
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly kind: string
}
/** An account-owned invoice application and its delivery state. */
export interface InvoiceView {
  readonly id: InvoiceId
  readonly kind: 'personal' | 'company'
  readonly title: string
  readonly taxId: string
  readonly email: string
  readonly amountCents: number
  readonly paymentAmountCents: number
  readonly feeCents: number
  readonly version: number
  readonly status: string
  readonly emailStatus: string
  readonly createdAt: string
  readonly note: string
  readonly files: readonly InvoiceFile[]
}
/** Paginated account-owned invoice applications. */
export interface InvoicePage { readonly items: readonly InvoiceView[]; readonly total: number }
/** Server-calculated invoice fee and total in CNY cents. */
export interface InvoiceQuote { readonly paymentAmountCents: number; readonly feeCents: number; readonly amountCents: number }
/** User-selected image evidence, carried to the Host without a local filesystem path. */
export interface EvidenceFile { readonly name: string; readonly mime: string; readonly base64: string; readonly kind: 'payment' | 'fee_payment' }
/** Invoice submission uses the same idempotency key when an uncertain request is retried. */
export interface InvoiceRequest {
  readonly id: InvoiceId | null
  readonly kind: 'personal' | 'company'
  readonly title: string
  readonly taxId: string
  readonly email: string
  readonly paymentAmount: string
  readonly version: number
  readonly requestKey: InvoiceRequestKey
  readonly retained: readonly InvoiceFileId[]
  readonly files: readonly EvidenceFile[]
}
/** Authenticated file content returned without exposing desktop credentials. */
export interface PlatformFile { readonly name: string; readonly mime: string; readonly base64: string }
