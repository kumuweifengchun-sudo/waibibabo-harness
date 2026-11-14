/** Sub2API account operations and group-scoped model registration for a local Host. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LlmError, resolveImageAttachmentAccess, type AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai/config'
import { authContextFrom, credentialStoreFrom } from '@deepseek-ai/dsh-llm-pi-ai/auth'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { z } from 'zod'
import { Config, platformOrigin } from './config.ts'
import { AccountError, PlatformClient, parse, tokenResponse, type PlatformRequestOptions } from './http.ts'
import { createAttempt, type SignInAttempt } from './sign-in.ts'
import { modelProtocol, protocolBaseURL } from './model-protocol.ts'
import { platformModelsResponse as modelsResponse, withModelCapabilities, type PlatformModelCatalog as ModelCatalog } from './model-capabilities.ts'
import { effectiveContextWindow, modelLimitsSchema, parseModelLimits } from './model-limits.ts'
import { usagePage, usageParameters } from './usage.ts'
import { detectGateway, gatewayEndpoints, type GatewayRoute } from './gateways.ts'
import { ResponsesTransport } from './responses-transport.ts'
import { imageRequest, imageResult } from './images.ts'
import { checkoutView, orderPage, orderRequest, paymentLaunch, paymentOrder, platformId, platformPageQuery, subscriptions } from './commerce.ts'
import { invoiceAmount, invoiceDownload, invoiceForm, invoicePage, invoiceQuote, invoiceView } from './invoices.ts'
import type { CheckoutView, GatewayEndpoint, GatewayId, GatewayView, ImageRequest, ImageResult, InvoiceFileId, InvoiceId, InvoicePage,
  InvoiceQuote, InvoiceRequest, InvoiceView, OrderPage, OrderRequest, PaymentLaunch, PaymentOrder, PaymentOrderId, PlatformFile,
  PlatformPageQuery, PlatformResult, SubscriptionView } from './platform-types.ts'
import type { AccountConnectionView, AccountFailure, AccountView, ModelLimits, ModelProtocolChoice, ModelTransport, Sub2apiGroupId, Sub2apiUserId, UsageQuery, UsageResult } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { sub2apiAccount: Sub2apiAccount }
}

const RECORD = brandString<CredentialKey>('sub2api-account/desktop')
const CONNECTION_RECORD = brandString<CredentialKey>('sub2api-account/connection')
const storedConnection = z.object({ issuer: z.string(), origin: z.string().nullable() })
const protocolSchema = z.enum(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
const transportSchema = z.enum(['sse', 'websocket'])
const storedSession = z.object({
  issuer: z.string(), clientId: z.string().min(1), accessToken: z.string().min(1), refreshToken: z.string().min(1),
  expiresAt: z.number(), groupId: z.string().regex(/^[1-9]\d*$/).nullable(),
  protocolOverrides: z.record(z.string(), z.record(z.string(), protocolSchema)).optional(),
  modelTransportOverrides: z.record(z.string(), z.record(z.string(), transportSchema)).optional(),
  modelLimits: modelLimitsSchema.optional(),
  modelLimitOverrides: z.record(z.string(), z.record(z.string(), modelLimitsSchema)).optional(),
  gatewayOrigin: z.string().optional(), gatewayInsecureAllowed: z.boolean().optional(),
})
type StoredSession = z.infer<typeof storedSession>
const storedRecord = z.union([storedSession, z.object({ issuer: z.string(), signedOut: z.literal(true) })])
const profileResponse = z.object({
  id: z.number().int().positive(), email: z.string(), username: z.string().optional(), balance: z.number(),
})
const groupsResponse = z.array(z.object({ id: z.number().int().positive(), name: z.string(), platform: z.string(),
  allow_image_generation: z.boolean().optional() }))
const usageResponse = z.object({
  today_requests: z.number(), today_actual_cost: z.number(), total_requests: z.number(), total_actual_cost: z.number(),
})
const leaseResponse = z.object({
  id: z.number().int().positive(), key: z.string().min(1),
  group_id: z.number().int().positive(), expires_at: z.iso.datetime({ offset: true }),
})
const passwordResponse = z.union([
  z.object({ requires_2fa: z.literal(true), temp_token: z.string().min(1) }),
  z.object({ access_token: z.string().min(1), refresh_token: z.string().optional() }),
])

function settled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason
  return result.value
}

/** Owns account credentials, browser attempts and the model routes they authorize. */
export class Sub2apiAccount extends TypertRemoteService {
  static inject = ['credentials', 'webServer', 'llm']
  static Config = Config
  private readonly options: ReturnType<typeof Config>
  private http: PlatformClient
  private readonly issuer: string
  private readonly accountOrigins: readonly string[]
  private accountOrigin: string | null = null
  private connectionChanging = false
  private readonly defaultModelLimits: ModelLimits
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly adapter: PiAiAdapter
  private readonly responses: ResponsesTransport
  private readonly owner: Context
  private profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  private catalog: ModelCatalog = []
  private registration: AdapterRegistrationHandle | undefined
  private session: StoredSession | undefined
  private attempt: SignInAttempt | undefined
  private revision = 0
  private selectionRevision = 0
  private tokenFlight: Promise<string> | undefined
  private readonly leaseFlights = new Map<Sub2apiGroupId, Promise<string>>()
  private readonly leases = new Map<Sub2apiGroupId, { key: string; expiresAt: number }>()
  private gateways: readonly GatewayEndpoint[] | undefined
  private readonly modelGateways = new Map<Sub2apiGroupId, PlatformClient>()
  private readonly gatewayFlights = new Map<Sub2apiGroupId, Promise<GatewayRoute>>()
  private imageCreating = false
  private refreshingBalance = false
  private orderCreating = false
  private view: AccountView
  private initialization: Promise<void> | undefined

  /** @param ctx - local Host with credentials, HTTP callbacks and model registration. @param config - public deployment settings. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sub2apiAccount')
    this.owner = ctx
    this.options = Config(config)
    this.defaultModelLimits = parseModelLimits({ contextWindow: this.options.defaultContextWindow,
      maxOutputTokens: this.options.defaultMaxTokens,
      maxInputTokens: config.defaultMaxInputTokens ?? this.options.defaultContextWindow - this.options.defaultMaxTokens })
    this.issuer = platformOrigin(this.options.platformOrigin, this.options.allowLoopbackHttp)
    this.accountOrigins = [...new Set([this.issuer,
      ...this.options.accountOrigins.map(value => platformOrigin(value, this.options.allowLoopbackHttp))])]
    this.http = this.accountClient()
    this.view = { productName: this.options.productName, platformOrigin: this.issuer, connection: this.connectionView(), status: 'signed-out', authorizationUrl: null,
      profile: null, groups: [], selectedGroup: null, models: [], modelProtocols: [],
      modelLimits: this.defaultModelLimits, modelLimitOverrides: {}, balanceStale: false, usage: null, usageError: null, error: null }
    this.responses = new ResponsesTransport(this.options, this.lifetime.signal)
    this.adapter = new PiAiAdapter({
      profiles: () => this.profiles,
      responsesFetch: (request, reportFailure) => this.responses.fetchFor(request.baseURL, request.sessionId, reportFailure,
        this.modelTransport(request.model)),
      resolveApiKey: async (provider) => {
        if (this.lifetime.signal.aborted || this.session === undefined || provider !== this.provider()) {
          throw new LlmError('请登录平台账号并选择模型分组', 'MISSING_CREDENTIAL')
        }
        try { return await this.key() } catch { throw new LlmError('请刷新平台账号后重试模型请求', 'MISSING_CREDENTIAL') }
      },
      auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, path => ctx.get('fs')?.processPathFromHostPath(path), ref),
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      this.attempt?.close()
      this.changed()
      await this.responses.dispose()
      await Promise.allSettled([...this.operations])
      this.registration?.()
    }, 'sub2api-account: request and model lifetime')
    ctx.effect(() => {
      const timer = setInterval(() => { void this.track(this.refreshBalance()) }, this.options.accountRefreshIntervalMs)
      timer.unref()
      return () => { clearInterval(timer) }
    }, 'sub2api-account: automatic balance refresh')
  }

  [Service.init](): Promise<void> {
    this.initialization = this.track(this.restore())
    return this.initialization
  }

  private async restore(): Promise<void> {
    const [connection, record] = await this.storage(() => Promise.all([
      this.ctx.credentials.readRecord(CONNECTION_RECORD), this.ctx.credentials.readRecord(RECORD),
    ]))
    if (this.lifetime.signal.aborted) return
    if (connection !== undefined) {
      if (connection.kind !== 'grant') throw new AccountError('storage')
      const selected = parse(storedConnection, connection.payload)
      if (selected.issuer === this.issuer) {
        this.accountOrigin = selected.origin
        this.http = this.accountClient()
        this.publish({ connection: this.connectionView() })
      }
    }
    if (record === undefined) return
    if (record.kind !== 'grant') throw new AccountError('storage')
    const session = parse(storedRecord, record.payload)
    if ('signedOut' in session) return
    if (session.issuer !== this.http.origin) {
      await this.clearRecord(session.clientId)
      return
    }
    this.session = session
    this.publish({ status: 'signed-in', selectedGroup: session.groupId as Sub2apiGroupId | null })
  }

  private connectionView(): AccountConnectionView {
    return { origins: this.accountOrigins, selected: this.accountOrigin, active: this.http.activeOrigin }
  }

  private accountClient(): PlatformClient {
    const client = new PlatformClient(this.issuer, this.options.requestTimeoutMs, this.lifetime.signal, {
      origins: this.accountOrigins.filter(origin => origin !== this.issuer), selected: this.accountOrigin,
      timeoutMs: this.options.connectionProbeTimeoutMs,
      changed: () => { if (this.http === client) this.publish({ connection: this.connectionView() }) },
    })
    return client
  }

  /** Save the device's account connection independently of model routes and login credentials.
   * @param origin - A configured account origin, or null for automatic detection.
   * @returns updated routing state; an unavailable manual selection stays saved for explicit repair.
   */
  @Remote
  setAccountOrigin(origin: string | null): Promise<AccountView> {
    return this.report(async () => {
      if (this.attempt !== undefined || this.connectionChanging) throw new AccountError('busy')
      if (origin !== null && !this.accountOrigins.includes(origin)) throw new AccountError('account-line-unavailable')
      this.connectionChanging = true
      try {
        await this.storage(() => this.ctx.credentials.modifyRecord(CONNECTION_RECORD, () => Promise.resolve({
          kind: 'grant', payload: { issuer: this.issuer, origin },
        })))
        this.accountOrigin = origin
        this.http = this.accountClient()
        this.publish({ connection: this.connectionView(), error: null })
        await this.http.connectionOrigin()
        if (this.session !== undefined) await this.refreshData()
      } finally { this.connectionChanging = false }
    })
  }

  private publish(patch: Partial<AccountView>): void {
    const group = patch.selectedGroup === undefined ? this.view.selectedGroup : patch.selectedGroup
    this.view = { ...this.view, ...patch, modelLimits: this.session?.modelLimits ?? this.defaultModelLimits,
      modelLimitOverrides: this.session?.modelLimitOverrides?.[group ?? ''] ?? {} }
    this.changed()
  }

  private async storage<T>(action: () => Promise<T>): Promise<T> {
    try { return await action() } catch (error) {
      if (error instanceof AccountError) throw error
      throw new AccountError('storage')
    }
  }

  private changed(): void { for (const notify of this.listeners) notify() }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation))
    return operation
  }

  private async report(action: () => Promise<void>): Promise<AccountView> {
    const revision = this.revision
    try { await this.initialization; await this.track(action()) } catch (error) {
      if (!this.lifetime.signal.aborted && revision === this.revision) {
        this.publish({ error: error instanceof AccountError ? error.code : 'network' })
      }
    }
    return this.view
  }

  private provider(): string | undefined {
    if (this.view.profile === null || this.view.selectedGroup === null) return undefined
    return `sub2api-u${this.view.profile.id}-g${this.view.selectedGroup}`
  }

  private clearModels(): void {
    this.responses.clear()
    this.catalog = []
    this.profiles = new Map()
    this.registration?.replace([])
    this.leases.clear()
    this.leaseFlights.clear()
    this.modelGateways.clear()
    this.gatewayFlights.clear()
    this.publish({ models: [], modelProtocols: [] })
  }

  private async save(session: StoredSession): Promise<void> {
    const revision = this.revision
    const record = await this.storage(() => this.ctx.credentials.modifyRecord(RECORD, (previous) => {
      if (revision !== this.revision || this.lifetime.signal.aborted) throw new AccountError('authorization')
      if (previous !== undefined) {
        if (previous.kind !== 'grant') throw new AccountError('storage')
        const stored = parse(storedRecord, previous.payload)
        if (!('signedOut' in stored)) {
          if (stored.clientId !== session.clientId || stored.issuer !== session.issuer) throw new AccountError('busy')
          return Promise.resolve({ kind: 'grant', payload: { ...stored, groupId: session.groupId } })
        }
      }
      return Promise.resolve({ kind: 'grant', payload: { ...session } })
    }))
    if (revision !== this.revision) throw new AccountError('authorization')
    if (record?.kind !== 'grant') throw new AccountError('storage')
    this.session = parse(storedSession, record.payload)
  }

  private async clearRecord(clientId: string | undefined): Promise<void> {
    await this.storage(() => this.ctx.credentials.modifyRecord(RECORD, (previous) => {
      if (previous === undefined) return Promise.resolve(undefined)
      if (previous.kind !== 'grant') throw new AccountError('storage')
      const current = parse(storedRecord, previous.payload)
      if ('signedOut' in current || current.clientId !== clientId) return Promise.resolve(undefined)
      return Promise.resolve({ kind: 'grant', payload: { issuer: current.issuer, signedOut: true } })
    }))
  }

  private async invalidate(current: StoredSession): Promise<void> {
    if (this.session?.clientId !== current.clientId) return
    this.revision++
    this.session = undefined
    this.clearModels()
    this.publish({ status: 'signed-out', profile: null, groups: [], selectedGroup: null, usage: null, usageError: null, error: 'authorization' })
    await this.clearRecord(current.clientId)
  }

  private async access(): Promise<string> {
    await this.initialization
    const current = this.session
    if (current === undefined) throw new AccountError('authorization')
    if (current.expiresAt - Date.now() > this.options.refreshLeewayMs) return current.accessToken
    if (this.tokenFlight !== undefined) return this.tokenFlight
    const revision = this.revision
    const flight = this.track((async () => {
      // The credential store serializes refresh rotation across Host processes.
      const record = await this.storage(() => this.ctx.credentials.modifyRecord(RECORD, async (previous) => {
        if (revision !== this.revision || previous?.kind !== 'grant') throw new AccountError('authorization')
        const latest = parse(storedRecord, previous.payload)
        if ('signedOut' in latest) throw new AccountError('authorization')
        if (latest.issuer !== current.issuer || latest.clientId !== current.clientId) throw new AccountError('authorization')
        if (latest.expiresAt - Date.now() > this.options.refreshLeewayMs) return undefined
        const result = parse(tokenResponse, await this.http.request('/api/v1/desktop/oauth/token', { body: new URLSearchParams({
          grant_type: 'refresh_token', client_id: latest.clientId, refresh_token: latest.refreshToken,
          resource: this.http.origin + '/api/v1/desktop', scope: 'desktop',
        }) }))
        if (revision !== this.revision) throw new AccountError('authorization')
        return { kind: 'grant', payload: { ...latest, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000 } }
      }))
      if (revision !== this.revision || record?.kind !== 'grant') throw new AccountError('authorization')
      const next = parse(storedSession, record.payload)
      this.session = next
      return next.accessToken
    })())
    this.tokenFlight = flight
    try { return await flight } catch (error) {
      if (error instanceof AccountError && error.code === 'authorization' && revision === this.revision) await this.invalidate(current)
      throw error
    } finally { if (this.tokenFlight === flight) this.tokenFlight = undefined }
  }

  private async withAccess<T>(operation: (token: string) => Promise<T>): Promise<T> {
    const revision = this.revision
    const token = await this.access()
    try {
      const result = await operation(token)
      if (revision !== this.revision) throw new AccountError('authorization')
      return result
    } catch (error) {
      if (error instanceof AccountError && error.code === 'authorization' && revision === this.revision && this.session?.accessToken === token) {
        await this.invalidate(this.session)
      }
      throw error
    }
  }

  private authenticated(path: string, body?: object, signal?: AbortSignal,
    options: Pick<PlatformRequestOptions, 'method' | 'timeoutMs' | 'empty'> = {}): Promise<unknown> {
    return this.withAccess(token => this.http.request(path, { ...options, token,
      ...body === undefined ? {} : { body }, ...signal === undefined ? {} : { signal } }))
  }

  private async key(groupId: Sub2apiGroupId | null = this.view.selectedGroup): Promise<string> {
    if (groupId === null || this.session === undefined || !this.view.groups.some(group => group.id === groupId)) throw new AccountError('authorization')
    const lease = this.leases.get(groupId)
    if (lease !== undefined && lease.expiresAt - Date.now() > this.options.refreshLeewayMs) return lease.key
    const pending = this.leaseFlights.get(groupId)
    if (pending !== undefined) return pending
    const revision = this.revision
    const flight = this.track((async () => {
      const result = parse(leaseResponse, await this.authenticated('/api/v1/desktop/key', { group_id: Number(groupId) }))
      if (revision !== this.revision || String(result.group_id) !== groupId) throw new AccountError('authorization')
      this.leases.set(groupId, { key: result.key, expiresAt: Date.parse(result.expires_at) })
      return result.key
    })())
    this.leaseFlights.set(groupId, flight)
    try { return await flight } finally { if (this.leaseFlights.get(groupId) === flight) this.leaseFlights.delete(groupId) }
  }

  private async loadModels(cached?: ModelCatalog): Promise<void> {
    const revision = this.revision
    const selectionRevision = this.selectionRevision
    const provider = this.provider()
    const groupId = this.view.selectedGroup
    if (provider === undefined || groupId === null) { this.clearModels(); return }
    const { client: gateway, catalog } = await this.modelCatalog(groupId, cached)
    const result = { data: catalog }
    if (revision !== this.revision || selectionRevision !== this.selectionRevision || provider !== this.provider()) return
    const firstModel = result.data[0]
    if (firstModel === undefined) { this.clearModels(); throw new AccountError('no-models') }
    const group = this.view.groups.find(value => value.id === this.view.selectedGroup)
    const overrides = this.session?.protocolOverrides?.[this.view.selectedGroup ?? '']
    const protocols = result.data.map((model) => {
      const choice: ModelProtocolChoice = overrides !== undefined && Object.hasOwn(overrides, model.id)
        ? overrides[model.id] ?? 'auto' : 'auto'
      return { source: model, choice,
        effective: modelProtocol(model.id, group?.platform ?? '', model.supported_endpoints ?? [],
          choice === 'auto' ? this.options.protocol : choice) }
    })
    const limits = this.session?.modelLimits ?? this.defaultModelLimits
    const inferenceOrigin = await gateway.connectionOrigin()
    const profiles = resolveProfiles({ [provider]: {
      displayName: `${this.options.productName} · ${group?.name ?? this.view.selectedGroup}`,
      defaultContextWindow: effectiveContextWindow(limits), defaultMaxTokens: limits.maxOutputTokens,
      models: protocols.map(({ source: model, effective }) => {
        const choices = this.session?.modelLimitOverrides?.[this.view.selectedGroup ?? '']
        const budget = choices !== undefined && Object.hasOwn(choices, model.id) ? choices[model.id] ?? limits : limits
        return { id: model.id, api: effective, baseURL: protocolBaseURL(inferenceOrigin, effective),
          input: ['text', 'image'], contextWindow: effectiveContextWindow(budget), maxTokens: budget.maxOutputTokens }
      }),
    } })
    this.catalog = result.data
    this.profiles = new Map([...profiles].map(([id, profile]) => [id, withModelCapabilities(profile, result.data)]))
    if (this.registration === undefined) this.registration = this.owner.llm.registerAdapter([provider], this.adapter)
    else this.registration.replace([provider])
    this.ctx.emit('llm/models-updated', provider)
    const defaults = this.ctx.get('agentDefaultModel')
    if (defaults !== undefined) {
      const current = defaults.currentSelection()
      if (current.provider !== provider || !result.data.some(model => model.id === current.model)) {
        await defaults.saveSelection({ provider, model: firstModel.id })
      }
    }
    if (revision === this.revision && selectionRevision === this.selectionRevision && provider === this.provider()) {
      this.publish({ models: result.data.map(model => model.id),
        modelProtocols: protocols.map(({ source, choice, effective }) => ({ model: source.id, choice, effective,
          transport: effective === 'openai-responses' ? this.modelTransport(source.id) : null })) })
    }
  }

  private modelTransport(model: string): ModelTransport {
    const overrides = this.session?.modelTransportOverrides?.[this.view.selectedGroup ?? '']
    const selected = overrides !== undefined && Object.hasOwn(overrides, model) ? overrides[model] : undefined
    return selected ?? (this.options.responsesTransport === 'sse' ? 'sse' : 'websocket')
  }

  private async refreshBalance(): Promise<void> {
    const owner = this.view.profile?.id
    const revision = this.revision
    const current = () => revision === this.revision && !this.lifetime.signal.aborted
    if (this.session === undefined || owner === undefined || this.refreshingBalance || !current()) return
    this.refreshingBalance = true
    try {
      const profile = parse(profileResponse, await this.authenticated('/api/v1/desktop/profile'))
      if (current() && owner === String(profile.id)) {
        this.publish({ profile: { id: owner, name: profile.username || profile.email, email: profile.email,
          balance: profile.balance }, balanceStale: false })
      }
    } catch {
      if (current()) this.publish({ balanceStale: true })
    } finally { this.refreshingBalance = false }
  }

  private async refreshData(): Promise<void> {
    if (this.session === undefined) return
    const revision = this.revision
    const selectionRevision = this.selectionRevision
    const results = await Promise.allSettled([
      this.authenticated('/api/v1/desktop/profile').then(value => parse(profileResponse, value)),
      this.authenticated('/api/v1/desktop/groups').then(value => parse(groupsResponse, value)),
      this.authenticated('/api/v1/desktop/usage').then(value => parse(usageResponse, value)),
    ])
    const profile = settled(results[0])
    const groups = settled(results[1])
    const usageResult = results[2]
    const usage = usageResult.status === 'fulfilled' ? usageResult.value : undefined
    if (revision !== this.revision || selectionRevision !== this.selectionRevision) return
    const visible = groups.map(group => ({ id: String(group.id) as Sub2apiGroupId, name: group.name, platform: group.platform,
      imageGeneration: group.allow_image_generation === true }))
    const selected = visible.find(group => group.id === this.session?.groupId)?.id ?? visible[0]?.id ?? null
    this.publish({ status: 'signed-in', error: null, balanceStale: false,
      profile: { id: String(profile.id) as Sub2apiUserId,
        name: profile.username || profile.email, email: profile.email, balance: profile.balance },
      groups: visible, selectedGroup: selected,
      usage: usage === undefined ? this.view.usage : { todayRequests: usage.today_requests, todayCost: usage.today_actual_cost,
        totalRequests: usage.total_requests, totalCost: usage.total_actual_cost },
      usageError: usageResult.status === 'fulfilled' ? null
        : usageResult.reason instanceof AccountError ? usageResult.reason.code : 'network',
    })
    await this.save({ ...this.session, groupId: selected })
    await this.loadModels()
  }

  /** Read account state and restore available models after a Host restart.
   * @returns display-safe account state; query failures retain the stored login.
   */
  @Remote
  getState(): Promise<AccountView> {
    return this.report(async () => { if (this.session !== undefined && this.view.profile === null) await this.refreshData() })
  }

  /** Refresh profile, allowed groups, account usage and the selected model catalog.
   * @returns updated state, retaining previous details on transient failure.
   */
  @Remote
  refresh(): Promise<AccountView> { return this.report(() => this.refreshData()) }

  /** Select one server-authorized group; its credential never enters the client.
   * @param groupId - group from the current account snapshot.
   * @returns state after model discovery or its explicit failure.
   */
  @Remote
  selectGroup(groupId: Sub2apiGroupId): Promise<AccountView> {
    return this.report(async () => {
      if (this.session === undefined || !this.view.groups.some(group => group.id === groupId)) throw new AccountError('authorization')
      const selectionRevision = ++this.selectionRevision
      const session = { ...this.session, groupId }
      await this.save(session)
      if (selectionRevision !== this.selectionRevision) return
      this.clearModels()
      this.publish({ selectedGroup: groupId, error: null })
      await this.loadModels()
    })
  }

  /** Set or remove the protocol override for a model in the current account's selected group.
   * @param groupId - Group shown when the client rendered the control.
   * @param model - Exact id from the current group's model catalog.
   * @param protocol - Selected wire protocol, or auto to remove the override.
   * @returns state after durable storage and model registration; already prepared requests keep their original protocol.
   */
  @Remote
  setModelProtocol(groupId: Sub2apiGroupId, model: string, protocol: ModelProtocolChoice): Promise<AccountView> {
    return this.report(async () => {
      const current = this.session
      if (current === undefined) throw new AccountError('authorization')
      if (groupId !== this.view.selectedGroup || !this.catalog.some(value => value.id === model)) throw new AccountError('busy')
      const choice = protocol === 'auto' ? protocol : parse(protocolSchema, protocol)
      await this.updateModelSettings((latest) => {
        const previousChoices = latest.protocolOverrides?.[groupId] ?? {}
        const group = choice === 'auto'
          ? Object.fromEntries(Object.entries(previousChoices).filter(([id]) => id !== model)) : { ...previousChoices, [model]: choice }
        return { ...latest, protocolOverrides: { ...latest.protocolOverrides, [groupId]: group } }
      })
    })
  }

  /** Save the Responses transport for a model in the selected group.
   * @param groupId - Group shown when the client rendered the control.
   * @param model - Exact id of a current-group model using Responses.
   * @param transport - HTTP streaming or WebSocket with safe HTTP fallback.
   * @returns state after persistence; subsequent requests use the selection and active requests may finish.
   */
  @Remote
  setModelTransport(groupId: Sub2apiGroupId, model: string, transport: ModelTransport): Promise<AccountView> {
    return this.report(async () => {
      if (this.session === undefined) throw new AccountError('authorization')
      if (groupId !== this.view.selectedGroup || !this.catalog.some(value => value.id === model)) throw new AccountError('busy')
      if (!this.view.modelProtocols.some(value => value.model === model && value.effective === 'openai-responses')) {
        throw new AccountError('validation')
      }
      const choice = parse(transportSchema, transport)
      await this.updateModelSettings(latest => ({ ...latest, modelTransportOverrides: {
        ...latest.modelTransportOverrides, [groupId]: { ...latest.modelTransportOverrides?.[groupId], [model]: choice },
      } }))
    })
  }

  /** Save the allocation inherited by models without an override.
   * @param limits - Context budget and disjoint input/output caps.
   * @returns account state after persistence and model-registration refresh.
   */
  @Remote
  setModelLimits(limits: ModelLimits): Promise<AccountView> {
    return this.report(async () => {
      const chosen = parseModelLimits(limits)
      await this.updateModelSettings(latest => ({ ...latest, modelLimits: chosen }))
    })
  }

  /** Set an individual allocation or restore inheritance for one current-group model.
   * @param groupId - Group shown when the client rendered the control.
   * @param model - Exact model id from that group's catalog.
   * @param limits - Explicit budgets, or null to inherit the account defaults.
   * @returns account state after saving and refreshing model metadata.
   */
  @Remote
  setModelLimitOverride(groupId: Sub2apiGroupId, model: string, limits: ModelLimits | null): Promise<AccountView> {
    return this.report(async () => {
      if (groupId !== this.view.selectedGroup || !this.catalog.some(value => value.id === model)) throw new AccountError('busy')
      const chosen = limits === null ? null : parseModelLimits(limits)
      await this.updateModelSettings((latest) => {
        const previous = latest.modelLimitOverrides?.[groupId] ?? {}
        const group = chosen === null ? Object.fromEntries(Object.entries(previous).filter(([id]) => id !== model))
          : { ...previous, [model]: chosen }
        return { ...latest, modelLimitOverrides: { ...latest.modelLimitOverrides, [groupId]: group } }
      })
    })
  }

  private async updateModelSettings(change: (latest: StoredSession) => StoredSession): Promise<void> {
    const current = this.session
    if (current === undefined) throw new AccountError('authorization')
    const revision = this.revision
    const selectionRevision = ++this.selectionRevision
    const catalog = this.catalog
    const record = await this.storage(() => this.ctx.credentials.modifyRecord(RECORD, (previous) => {
      if (previous?.kind !== 'grant' || revision !== this.revision) throw new AccountError('authorization')
      const latest = parse(storedSession, previous.payload)
      if (latest.clientId !== current.clientId || latest.issuer !== current.issuer) throw new AccountError('authorization')
      if (selectionRevision !== this.selectionRevision || latest.groupId !== current.groupId) throw new AccountError('busy')
      return Promise.resolve({ kind: 'grant', payload: change(latest) })
    }))
    if (revision !== this.revision || selectionRevision !== this.selectionRevision || record?.kind !== 'grant') return
    this.session = parse(storedSession, record.payload)
    if (catalog.length > 0) await this.loadModels(catalog)
    this.publish({ error: null })
  }

  private async feature<T>(action: () => Promise<T>, mutation = false): Promise<PlatformResult<T>> {
    const revision = this.revision
    try {
      await this.initialization
      if (this.session === undefined) throw new AccountError('authorization')
      const data = await this.track(action())
      if (revision !== this.revision || this.lifetime.signal.aborted) throw new AccountError('authorization')
      return { ok: true, data }
    } catch (error) {
      const code = error instanceof AccountError ? error.code : 'network'
      return { ok: false, error: mutation && ['network', 'timeout', 'server', 'protocol'].includes(code) ? 'uncertain'
        : code === 'credentials' ? 'validation' : code }
    }
  }

  private async readGateways(signal?: AbortSignal): Promise<GatewayView> {
    const values = gatewayEndpoints(await this.authenticated('/api/v1/desktop/gateways', undefined, signal), this.http.origin)
    this.gateways = values
    return this.gatewayView(values)
  }

  private gatewayView(endpoints: readonly GatewayEndpoint[]): GatewayView {
    const selected = this.session?.gatewayOrigin as GatewayId | undefined
    const group = this.view.selectedGroup
    const active = (group === null ? undefined : this.modelGateways.get(group)?.origin) as GatewayId | undefined
    return { endpoints, selected: selected ?? null, active: active ?? null }
  }

  private async gatewayRoute(groupId: Sub2apiGroupId): Promise<GatewayRoute> {
    if (this.session === undefined) throw new AccountError('authorization')
    const endpoints = this.gateways ?? (await this.readGateways()).endpoints
    if (this.session.gatewayOrigin !== undefined) {
      const chosen = endpoints.find(endpoint => endpoint.origin === this.session?.gatewayOrigin)
      if (chosen === undefined) throw new AccountError('gateway-unavailable')
      if (chosen.insecure && chosen.origin !== this.issuer && this.session.gatewayInsecureAllowed !== true) throw new AccountError('insecure-gateway')
      return { client: new PlatformClient(chosen.origin, this.options.requestTimeoutMs, this.lifetime.signal) }
    }
    const cached = this.modelGateways.get(groupId)
    if (cached !== undefined && endpoints.some(endpoint => endpoint.origin === cached.origin)) return { client: cached }
    const pending = this.gatewayFlights.get(groupId)
    if (pending !== undefined) return pending
    const revision = this.revision
    const selectionRevision = this.selectionRevision
    const origins = endpoints.filter(endpoint => !endpoint.insecure || this.options.allowLoopbackHttp
      && ['127.0.0.1', '[::1]'].includes(new URL(endpoint.origin).hostname)).map(endpoint => endpoint.origin)
    const flight = this.track((async () => {
      const route = await detectGateway(origins, await this.key(groupId), this.options.connectionProbeTimeoutMs,
        this.lifetime.signal, this.options.requestTimeoutMs)
      if (revision !== this.revision || selectionRevision !== this.selectionRevision) throw new AccountError('busy')
      this.modelGateways.set(groupId, route.client)
      return route
    })())
    this.gatewayFlights.set(groupId, flight)
    try { return await flight } finally { if (this.gatewayFlights.get(groupId) === flight) this.gatewayFlights.delete(groupId) }
  }

  private async modelCatalog(groupId: Sub2apiGroupId, cached?: ModelCatalog,
    signal?: AbortSignal): Promise<{ client: PlatformClient; catalog: ModelCatalog }> {
    const revision = this.revision
    const selectionRevision = this.selectionRevision
    const route = await this.gatewayRoute(groupId)
    try {
      const catalog = cached ?? route.catalog ?? parse(modelsResponse, await route.client.request('/v1/models', {
        token: await this.key(groupId), ...signal === undefined ? {} : { signal },
      })).data
      if (revision !== this.revision || selectionRevision !== this.selectionRevision) throw new AccountError('busy')
      this.modelGateways.set(groupId, route.client)
      return { client: route.client, catalog }
    } catch (error) {
      if (this.modelGateways.get(groupId) === route.client) this.modelGateways.delete(groupId)
      throw error
    }
  }

  /** Read advertised inference addresses and routing choices, independently of the account connection.
   * @param signal - Request cancellation.
   * @returns available gateways and the saved selection.
   */
  @Remote
  getGateways(signal?: AbortSignal): Promise<PlatformResult<GatewayView>> {
    return this.feature(() => this.readGateways(signal))
  }

  /** Save an administrator-advertised inference address for subsequent model and image requests.
   * @param id - Address id from the latest platform list, or null to detect an inference route automatically.
   * @param allowInsecure - Explicit acknowledgement that HTTP sends inference keys and prompts without encryption.
   * @returns current addresses after durable selection and model refresh.
   */
  @Remote
  setGateway(id: GatewayId | null, allowInsecure: boolean): Promise<PlatformResult<GatewayView>> {
    return this.feature(async () => {
      const current = this.session
      if (current === undefined) throw new AccountError('authorization')
      const revision = this.revision
      const listed = await this.readGateways()
      const chosen = id === null ? undefined : listed.endpoints.find(value => value.id === id)
      if (id !== null && chosen === undefined) throw new AccountError('gateway-unavailable')
      if (chosen?.insecure && chosen.origin !== this.http.origin && !allowInsecure) throw new AccountError('insecure-gateway')
      const selectionRevision = ++this.selectionRevision
      const record = await this.storage(() => this.ctx.credentials.modifyRecord(RECORD, (previous) => {
        if (previous?.kind !== 'grant' || revision !== this.revision) throw new AccountError('authorization')
        const latest = parse(storedSession, previous.payload)
        if (latest.clientId !== current.clientId || latest.issuer !== current.issuer) throw new AccountError('authorization')
        const { gatewayOrigin: _origin, gatewayInsecureAllowed: _consent, ...rest } = latest
        return Promise.resolve({ kind: 'grant', payload: chosen === undefined ? rest
          : { ...rest, gatewayOrigin: chosen.origin, gatewayInsecureAllowed: allowInsecure } })
      }))
      if (record?.kind !== 'grant' || revision !== this.revision || selectionRevision !== this.selectionRevision) throw new AccountError('busy')
      this.session = parse(storedSession, record.payload)
      this.clearModels()
      await this.loadModels()
      this.publish({ error: null })
      return this.gatewayView(listed.endpoints)
    })
  }

  /** List an image group's models independently of the conversation group.
   * @param groupId - An image-enabled group belonging to the current account.
   * @param signal - Client cancellation.
   * @returns model ids advertised for this group's inference credential.
   */
  @Remote
  getImageModels(groupId: Sub2apiGroupId, signal?: AbortSignal): Promise<PlatformResult<readonly string[]>> {
    return this.feature(async () => {
      if (!this.view.groups.some(group => group.id === groupId && group.imageGeneration)) throw new AccountError('unavailable')
      const { catalog } = await this.modelCatalog(groupId, undefined, signal)
      return [...new Set(catalog.map(model => model.id))]
    })
  }

  /** Generate images through one authorized group without changing the conversation model.
   * @param input - Explicit user prompt and image options.
   * @param signal - User cancellation; cancellation does not reverse possible upstream billing.
   * @returns image previews or an explicit failure, with no automatic request replay.
   */
  @Remote
  generateImages(input: ImageRequest, signal?: AbortSignal): Promise<PlatformResult<ImageResult>> {
    return this.feature(async () => {
      if (this.imageCreating) throw new AccountError('busy')
      const body = imageRequest(input)
      if (!this.view.groups.some(group => group.id === input.groupId && group.imageGeneration)) throw new AccountError('unavailable')
      this.imageCreating = true
      try {
        const { client: gateway } = await this.gatewayRoute(input.groupId)
        const data = await gateway.request('/v1/images/generations', { body, token: await this.key(input.groupId),
          timeoutMs: this.options.imageTimeoutMs, maxBytes: this.options.imageResponseLimitBytes,
          ...signal === undefined ? {} : { signal } })
        return imageResult(data)
      } catch (error) {
        if (error instanceof AccountError && error.code === 'authorization') this.leases.delete(input.groupId)
        throw error
      } finally { this.imageCreating = false }
    }, true)
  }

  /** Read native checkout prices, subscription plans and method availability.
   * @param signal - Client cancellation.
   * @returns platform checkout data without provider secrets.
   */
  @Remote
  getCheckout(signal?: AbortSignal): Promise<PlatformResult<CheckoutView>> {
    return this.feature(async () => {
      const result = await Promise.allSettled([
        this.authenticated('/api/v1/desktop/payment/checkout-info', undefined, signal),
        this.authenticated('/api/v1/desktop/payment/config', undefined, signal),
      ])
      return checkoutView(settled(result[0]), settled(result[1]))
    })
  }

  /** Read subscription status and remaining-period progress for the current account.
   * @param signal - Client cancellation.
   * @returns user-owned subscriptions.
   */
  @Remote
  getSubscriptions(signal?: AbortSignal): Promise<PlatformResult<readonly SubscriptionView[]>> {
    return this.feature(async () => subscriptions(await this.authenticated('/api/v1/desktop/subscriptions', undefined, signal)))
  }

  /** Create one order after the user selects a recharge amount or subscription.
   * @param input - Explicit purchase selection.
   * @returns order amounts and a payment page or QR code; uncertain results must be checked in order history.
   */
  @Remote
  createOrder(input: OrderRequest): Promise<PlatformResult<PaymentLaunch>> {
    return this.feature(async () => {
      if (this.orderCreating) throw new AccountError('busy')
      const body = orderRequest(input, this.http.origin)
      this.orderCreating = true
      try { return await paymentLaunch(await this.authenticated('/api/v1/desktop/payment/orders', body), this.http.origin) }
      finally { this.orderCreating = false }
    }, true)
  }

  /** Read only the current account's payment orders.
   * @param query - Bounded pagination and status.
   * @param signal - Client cancellation.
   * @returns user-owned orders and totals.
   */
  @Remote
  getOrders(query: PlatformPageQuery, signal?: AbortSignal): Promise<PlatformResult<OrderPage>> {
    return this.feature(async () => orderPage(await this.authenticated('/api/v1/desktop/payment/orders/my?' + platformPageQuery(query), undefined, signal)))
  }

  /** Refresh one order and optionally ask its provider to verify payment.
   * @param id - Owned order identifier.
   * @param verify - Query the payment provider through the platform.
   * @returns authoritative order state; a browser return alone never marks payment successful.
   */
  @Remote
  getOrder(id: PaymentOrderId, verify: boolean): Promise<PlatformResult<PaymentOrder>> {
    return this.feature(async () => {
      const order = paymentOrder(await this.authenticated('/api/v1/desktop/payment/orders/' + platformId(id)))
      return verify ? paymentOrder(await this.authenticated('/api/v1/desktop/payment/orders/verify', { out_trade_no: order.number })) : order
    })
  }

  /** Cancel an owned pending payment order through the platform's existing rules.
   * @param id - Owned order identifier.
   * @returns acknowledgement only after the platform confirms cancellation.
   */
  @Remote
  cancelOrder(id: PaymentOrderId): Promise<PlatformResult<null>> {
    return this.feature(async () => { await this.authenticated('/api/v1/desktop/payment/orders/' + platformId(id) + '/cancel', {}); return null }, true)
  }

  /** List user-owned invoice applications.
   * @param query - Pagination and status.
   * @param signal - Client cancellation.
   * @returns invoice summaries and attachment metadata.
   */
  @Remote
  getInvoices(query: PlatformPageQuery, signal?: AbortSignal): Promise<PlatformResult<InvoicePage>> {
    return this.feature(async () => invoicePage(await this.authenticated('/api/v1/desktop/invoices?' + platformPageQuery(query), undefined, signal)))
  }

  /** Read one owned invoice, including current version and issued files.
   * @param id - Invoice id from the account's list.
   * @returns the current application.
   */
  @Remote
  getInvoice(id: InvoiceId): Promise<PlatformResult<InvoiceView>> {
    return this.feature(async () => invoiceView(await this.authenticated('/api/v1/desktop/invoices/' + platformId(id))))
  }

  /** Calculate invoice fees on the server before submitting evidence.
   * @param paymentAmount - Actual payment amount in CNY.
   * @returns server-calculated amounts in integer cents.
   */
  @Remote
  quoteInvoice(paymentAmount: string): Promise<PlatformResult<InvoiceQuote>> {
    return this.feature(async () => invoiceQuote(await this.authenticated('/api/v1/desktop/invoices/quote?payment_amount=' + invoiceAmount(paymentAmount))))
  }

  /** Submit or edit an application with the website's evidence and version checks.
   * @param input - Fields, screenshots and stable retry key.
   * @returns the saved application; uncertain retries must retain the same key and fields.
   */
  @Remote
  saveInvoice(input: InvoiceRequest): Promise<PlatformResult<InvoiceView>> {
    return this.feature(async () => {
      const body = invoiceForm(input)
      const path = '/api/v1/desktop/invoices' + (input.id === null ? '' : '/' + platformId(input.id))
      return invoiceView(await this.authenticated(path, body, undefined, {
        method: input.id === null ? 'POST' : 'PUT', timeoutMs: this.options.invoiceTimeoutMs,
      }))
    }, true)
  }

  /** Download a file from the latest owned invoice without exposing authentication headers.
   * @param id - Invoice identifier.
   * @param fileId - File identifier present in that invoice.
   * @returns verified PNG, JPEG or PDF content for a user-initiated save.
   */
  @Remote
  getInvoiceFile(id: InvoiceId, fileId: InvoiceFileId): Promise<PlatformResult<PlatformFile>> {
    return this.feature(async () => {
      const path = '/api/v1/desktop/invoices/' + platformId(id)
      const current = invoiceView(await this.authenticated(path))
      const file = current.files.find(value => value.id === fileId)
      if (file === undefined) throw new AccountError('unavailable')
      const data = await this.withAccess(token => this.http.file(path + '/files/' + encodeURIComponent(file.id),
        { token, timeoutMs: this.options.invoiceTimeoutMs, maxBytes: 20 * 1024 * 1024 }))
      return invoiceDownload(file, data.bytes, data.mime)
    })
  }

  /** Query the signed-in user's platform usage records and totals for identical filters.
   * @param query - Date range, model, group, request mode and pagination; user identity always comes from the stored grant.
   * @param signal - Cancellation owned by the requesting client view.
   * @returns display-safe usage or an explicit query failure; no request bodies or credentials are retained.
   */
  @Remote
  async getUsage(query: UsageQuery, signal?: AbortSignal): Promise<UsageResult> {
    try {
      const parameters = usageParameters(query)
      const revision = this.revision
      const values = await this.track(Promise.allSettled([
        this.authenticated('/api/v1/desktop/usage/records?' + parameters, undefined, signal),
        this.authenticated('/api/v1/desktop/usage/stats?' + parameters, undefined, signal),
      ]))
      if (revision !== this.revision) throw new AccountError('authorization')
      const records = settled(values[0])
      const statistics = values[1]
      return { ok: true, data: statistics.status === 'fulfilled' ? usagePage(records, statistics.value)
        : usagePage(records, undefined, statistics.reason instanceof AccountError ? statistics.reason.code : 'network') }
    } catch (error) {
      return { ok: false, error: error instanceof AccountError ? error.code : 'network' }
    }
  }

  private async prepareSignIn(): Promise<SignInAttempt> {
    if (this.session !== undefined || this.attempt !== undefined || this.connectionChanging) throw new AccountError('busy')
    const revision = this.revision
    const attempt = createAttempt(this.owner, this.http, this.options, {
      complete: (active, code) => this.track(this.complete(active, code)),
      failed: (active, error) => { if (this.attempt === active) this.endAttempt(error) },
    })
    this.attempt = attempt
    this.publish({ status: 'signing-in', authorizationUrl: null, error: null })
    try {
      await attempt.initialize()
      if (revision !== this.revision || this.attempt !== attempt) throw new AccountError('authorization')
      return attempt
    } catch (error) {
      if (this.attempt === attempt) this.endAttempt(error instanceof AccountError ? error.code : 'network')
      throw error
    }
  }

  private endAttempt(error: AccountFailure | null): void {
    if (this.attempt === undefined) return
    this.attempt.close()
    this.attempt = undefined
    this.publish({ status: this.session === undefined ? 'signed-out' : 'signed-in', authorizationUrl: null, error })
  }

  private async complete(attempt: SignInAttempt, code: string): Promise<void> {
    if (this.attempt !== attempt) throw new AccountError('authorization')
    const result = parse(tokenResponse, await this.http.request('/api/v1/desktop/oauth/token', {
      signal: attempt.signal,
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: attempt.clientId,
        code, redirect_uri: attempt.redirectUri, code_verifier: attempt.verifier, resource: this.http.origin + '/api/v1/desktop', scope: 'desktop' }),
    }))
    if (this.attempt !== attempt || attempt.signal.aborted) throw new AccountError('authorization')
    attempt.committing = true
    try {
      await this.save({ issuer: this.http.origin, clientId: attempt.clientId, accessToken: result.access_token,
        refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000, groupId: null })
    } catch {
      try { await this.http.request('/api/v1/desktop/oauth/revoke', { body: new URLSearchParams({ client_id: attempt.clientId, token: result.refresh_token }), empty: true }) }
      catch { this.ctx.logger.warn('sub2api-account: unsaved authorization could not be revoked') }
      throw new AccountError('storage')
    }
    this.endAttempt(null)
    this.publish({ status: 'signed-in' })
    await this.report(() => this.refreshData())
  }

  /** Start system-browser authorization with a loopback callback and PKCE.
   * @returns the platform authorization URL and pending account state.
   */
  @Remote
  startSignIn(): Promise<AccountView> {
    return this.report(async () => {
      if (this.attempt !== undefined && this.view.authorizationUrl !== null) return
      const attempt = await this.prepareSignIn()
      this.publish({ authorizationUrl: attempt.authorizationUrl })
    })
  }

  /** Verify platform credentials without persisting the password or browser session.
   * @param email - existing platform email account.
   * @param password - password used only for the current authentication request.
   * @returns signed-in, two-factor-required, or failed state.
   */
  @Remote
  signInWithPassword(email: string, password: string): Promise<AccountView> {
    return this.report(async () => {
      const attempt = await this.prepareSignIn()
      try {
        const result = parse(passwordResponse, await this.http.request('/api/v1/auth/login', { body: { email, password }, signal: attempt.signal }))
        if (this.attempt !== attempt) return
        if ('requires_2fa' in result) {
          attempt.tempToken = result.temp_token
          this.publish({ status: 'two-factor' })
          return
        }
        await this.authorizePassword(attempt, result)
      } catch (error) {
        if (this.attempt === attempt) this.endAttempt(error instanceof AccountError && error.code !== 'authorization' ? error.code : 'credentials')
      }
    })
  }

  private async authorizePassword(
    attempt: SignInAttempt, login: { access_token: string; refresh_token?: string | undefined },
  ): Promise<void> {
    try {
      const result = parse(z.object({ redirect_url: z.string() }), await this.http.request('/api/v1/user/desktop/authorize', {
        token: login.access_token, signal: attempt.signal,
        body: { authorization: attempt.authorization, approved: true, scope: 'desktop', read_only: false },
      }))
      await attempt.accept(new URL(result.redirect_url))
    } finally {
      if (login.refresh_token !== undefined) {
        try { await this.http.request('/api/v1/auth/logout', { body: { refresh_token: login.refresh_token } }) }
        catch { this.ctx.logger.warn('sub2api-account: the temporary browser-session revocation failed') }
      }
    }
  }

  /** Complete the current password login's platform two-factor challenge.
   * @param code - six-digit authenticator code.
   * @returns signed-in state or a retryable two-factor failure.
   */
  @Remote
  finishTwoFactor(code: string): Promise<AccountView> {
    return this.report(async () => {
      const attempt = this.attempt
      if (attempt?.tempToken === undefined || !/^\d{6}$/.test(code)) throw new AccountError('two-factor')
      const result = parse(z.object({ access_token: z.string().min(1), refresh_token: z.string().optional() }),
        await this.http.request('/api/v1/auth/login/2fa', { body: { temp_token: attempt.tempToken, totp_code: code }, signal: attempt.signal }))
      if (this.attempt === attempt) await this.authorizePassword(attempt, result)
    })
  }

  /** Cancel a pending authorization; an admitted credential commit finishes first.
   * @returns settled account state, excluding late callbacks.
   */
  @Remote
  async cancelSignIn(): Promise<AccountView> {
    if (this.attempt?.committing) await this.attempt.running
    else this.endAttempt(null)
    return this.view
  }

  /** Remove local login and revoke the device grant and associated inference leases.
   * @returns signed-out state; a remote cleanup failure remains visible.
   */
  @Remote
  async signOut(): Promise<AccountView> {
    await this.initialization
    await this.cancelSignIn()
    const session = this.session
    this.revision++
    return this.report(async () => {
      await this.clearRecord(session?.clientId)
      this.session = undefined
      this.tokenFlight = undefined
      this.clearModels()
      this.publish({ status: 'signed-out', profile: null, groups: [], selectedGroup: null, usage: null, usageError: null, error: null })
      if (session === undefined) return
      try {
        await this.http.request('/api/v1/desktop/oauth/revoke', { body: new URLSearchParams({ client_id: session.clientId, token: session.refreshToken }), empty: true })
      } catch { throw new AccountError('revocation') }
    })
  }

  /** Observe initial state and later committed account changes.
   * @param signal - Remote subscription lifetime; ending it does not cancel login.
   * @returns sanitized snapshots with no passwords, tokens or API keys.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    await this.initialization
    let pending = true
    let wake: (() => void) | undefined
    const notify = (): void => { pending = true; wake?.() }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted && !this.lifetime.signal.aborted) {
        if (pending) { pending = false; yield this.view; continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }
}

export default Sub2apiAccount
