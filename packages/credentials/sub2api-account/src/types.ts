/** Display-safe account data shared by the Host and client. */
import type { Branded } from '@deepseek-ai/dsh-brand'
export type { GatewayId, PaymentOrderId, SubscriptionPlanId, InvoiceId, InvoiceFileId, ImageOutputId, InvoiceRequestKey, PlatformResult,
  GatewayEndpoint, GatewayView, ImageRequest, GeneratedImage, ImageResult, PaymentMethod, SubscriptionPlan,
  CheckoutView, OrderRequest, PaymentLaunch, PaymentOrder, OrderPage, PlatformPageQuery, SubscriptionView,
  InvoiceFile, InvoiceView, InvoicePage, InvoiceQuote, EvidenceFile, InvoiceRequest, PlatformFile } from './platform-types.ts'

/** Server group identifier represented without number coercion on Remote calls. */
export type Sub2apiGroupId = Branded<'Sub2apiGroupId'>
/** Stable server account identifier. */
export type Sub2apiUserId = Branded<'Sub2apiUserId'>
/** Failure categories localized by the account UI. */
export type AccountFailure = 'network' | 'timeout' | 'server' | 'authorization' | 'credentials' | 'captcha' | 'two-factor' | 'protocol' | 'storage' | 'expired' | 'busy' | 'no-models' | 'revocation' | 'upgrade-required' | 'usage-filter' | 'validation' | 'unavailable' | 'uncertain' | 'conflict' | 'invoice-evidence' | 'gateway-unavailable' | 'account-line-unavailable' | 'insecure-gateway' | 'balance' | 'model-limits' | 'payment-gateway'
/** Inference wire protocols implemented by the bundled adapter. */
export type ModelProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
/** A user override or automatic model-specific selection. */
export type ModelProtocolChoice = 'auto' | ModelProtocol
/** Shared defaults for all models and groups of the signed-in platform account. */
export interface ModelLimits {
  readonly contextWindow: number
  readonly maxInputTokens: number
  readonly maxOutputTokens: number
}
/** Protocol selected for one model in the active group. */
export interface ModelProtocolView {
  readonly model: string
  readonly choice: ModelProtocolChoice
  readonly effective: ModelProtocol
}
/** Account details exposed without login or inference credentials. */
export interface AccountProfile {
  readonly id: Sub2apiUserId
  readonly email: string
  readonly name: string
  readonly balance: number
}
/** One group the authenticated user can select. */
export interface AccountGroup {
  readonly id: Sub2apiGroupId
  readonly name: string
  readonly platform: string
  readonly imageGeneration: boolean
}
/** Authoritative account usage reported by the server. */
export interface AccountUsage {
  readonly todayRequests: number
  readonly todayCost: number
  readonly totalRequests: number
  readonly totalCost: number
}
/** Device-local account routing, independent of inference endpoints and sign-in credentials. */
export interface AccountConnectionView {
  readonly origins: readonly string[]
  /** Null selects the fastest verified account origin automatically. */
  readonly selected: string | null
  readonly active: string | null
}
/** Complete safe snapshot, including pending browser or two-factor sign-in. */
export interface AccountView {
  readonly productName: string
  readonly platformOrigin: string
  readonly connection?: AccountConnectionView
  readonly status: 'signed-out' | 'signing-in' | 'two-factor' | 'signed-in'
  readonly authorizationUrl: string | null
  readonly profile: AccountProfile | null
  readonly groups: readonly AccountGroup[]
  readonly selectedGroup: Sub2apiGroupId | null
  readonly models: readonly string[]
  readonly modelProtocols: readonly ModelProtocolView[]
  readonly modelLimits: ModelLimits
  /** Explicit allocations for models of the currently selected group; absent entries inherit modelLimits. */
  readonly modelLimitOverrides: Readonly<Record<string, ModelLimits>>
  /** Whether the last automatic balance refresh failed; retained amounts remain visible. */
  readonly balanceStale: boolean
  readonly usage: AccountUsage | null
  /** Statistics may be unavailable without preventing account and model access. */
  readonly usageError?: AccountFailure | null
  readonly error: AccountFailure | null
}

/** Identifier of one user-owned usage record. */
export type Sub2apiUsageId = Branded<'Sub2apiUsageId'>
/** Filters shared by the usage table and its server-calculated totals. */
export interface UsageQuery {
  readonly page: number
  readonly pageSize: number
  readonly startDate: string
  readonly endDate: string
  readonly timezone: string
  readonly model: string
  readonly groupId: Sub2apiGroupId | null
  readonly stream: boolean | null
}
/** User-visible usage fields; API credentials and upstream account details are excluded. */
export interface UsageRecord {
  readonly id: Sub2apiUsageId
  readonly createdAt: string
  readonly model: string
  readonly requestId: string
  readonly group: string | null
  readonly apiKey: string | null
  readonly endpoint: string | null
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly inputCost: number
  readonly outputCost: number
  readonly cacheReadCost: number
  readonly cacheWriteCost: number
  readonly totalCost: number
  readonly actualCost: number
  readonly multiplier: number
  readonly durationMs: number | null
  readonly firstTokenMs: number | null
  readonly stream: boolean
  readonly billingType: number
  readonly imageCount: number
}
/** One page plus totals for the entire selected date range and filters. */
export interface UsagePage {
  readonly items: readonly UsageRecord[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly totalPages: number
  readonly requests: number | null
  readonly tokens: number | null
  readonly cost: number | null
  readonly statisticsError?: AccountFailure
}
/** Query failure stays in the usage surface and never becomes an empty successful result. */
export type UsageResult = { readonly ok: true; readonly data: UsagePage } | { readonly ok: false; readonly error: AccountFailure }
