/** Generated-Remote operations and account-bound lifetimes for native platform pages. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/client'
import type {} from '@deepseek-ai/dsh-sub2api-account/remote'
import type { InvoiceRequestKey, PlatformResult } from '../platform-types.ts'
import type { AccountInjected } from './AccountSection.tsx'
import { initialPlatformState, newInvoiceDraft, type PlatformChannel, type PlatformInjected, type PlatformState } from './platform-state.ts'

type Outcome<T> = { readonly ok: true; readonly value: PlatformResult<T> } | { readonly ok: false }

/** Generated operations needed by the native pages; account login remains owned by its original controller. */
export type PlatformRemote = Pick<Context['remote']['sub2apiAccount'], 'getGateways' | 'setGateway' | 'generateImages' | 'getImageModels'
  | 'getCheckout' | 'getSubscriptions' | 'getOrders' | 'createOrder' | 'getOrder' | 'cancelOrder'
  | 'getInvoices' | 'getInvoice' | 'quoteInvoice' | 'saveInvoice' | 'getInvoiceFile'>

/** Bind account-scoped native operations without exposing the Remote or credentials to components.
 * @param remote - Generated account Remote in the plugin's injected scope.
 * @param account - Account snapshot and user actions owned by the same scope.
 * @param files - Shared native/browser download service with owned cleanup.
 * @returns page injection plus account-reset and teardown controls.
 */
export function createPlatformClient(remote: PlatformRemote, account: AccountInjected, files: Pick<FileActions, 'save'>): {
  readonly injected: PlatformInjected
  reset: () => void
  dispose: () => void
} {
  let state = initialPlatformState()
  let revision = 0
  let disposed = false
  const listeners = new Set<() => void>()
  const flights = new Map<PlatformChannel, AbortController>()
  const publish = (patch: Partial<PlatformState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const reset = () => {
    revision++
    for (const controller of flights.values()) controller.abort()
    flights.clear()
    publish(initialPlatformState())
  }
  const run = async <T>(channel: PlatformChannel, request: (signal: AbortSignal) => Promise<Outcome<T>>,
    accept: (value: T) => void | Promise<void>, mutation = false): Promise<boolean> => {
    if (disposed || flights.has(channel)) return false
    const owner = account.hooks.account.getSnapshot().view?.profile?.id
    if (owner === undefined) return false
    const version = revision
    const controller = new AbortController()
    flights.set(channel, controller)
    const current = () => !disposed && version === revision && !controller.signal.aborted
      && account.hooks.account.getSnapshot().view?.profile?.id === owner
    publish({ loading: { ...state.loading, [channel]: true }, errors: { ...state.errors, [channel]: null } })
    try {
      const response = await request(controller.signal)
      if (!current()) return false
      const result = response.ok ? response.value : { ok: false as const, error: mutation ? 'uncertain' as const : 'network' as const }
      if (!result.ok) { publish({ errors: { ...state.errors, [channel]: result.error } }); return false }
      await accept(result.data)
      return true
    } catch {
      if (current()) publish({ errors: { ...state.errors, [channel]: mutation ? 'uncertain' : 'network' } })
      return false
    } finally {
      if (flights.get(channel) === controller) {
        controller.abort()
        flights.delete(channel)
        publish({ loading: { ...state.loading, [channel]: false } })
      }
    }
  }
  const injected: PlatformInjected = {
    hooks: { account: account.hooks.account, platform: { getSnapshot: () => state, subscribe: (listener) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    } } },
    selectGroup: account.selectGroup, setProtocol: account.setProtocol, setTransport: account.setTransport,
    setModelLimits: account.setModelLimits,
    setModelLimitOverride: account.setModelLimitOverride,
    showLogin: account.showLogin, refresh: account.refresh,
    loadGateways: async () => { await run('gateways', signal => remote.getGateways(signal), (gateways) => { publish({ gateways }) }) },
    selectGateway: async (id, allowInsecure) => {
      const succeeded = await run('gateways', () => remote.setGateway(id, allowInsecure), (gateways) => { publish({ gateways }) })
      if (!succeeded) {
        const error = state.errors.gateways
        await run('gateways', signal => remote.getGateways(signal), (gateways) => {
          publish({ gateways, errors: { ...state.errors, gateways: error } })
        })
      }
    },
    updateImageDraft: (patch) => { publish({ imageDraft: { ...state.imageDraft, ...patch } }) },
    loadImageModels: async (group) => {
      flights.get('imageModels')?.abort()
      flights.delete('imageModels')
      publish({ imageModelsGroup: group, imageModels: [] })
      await run('imageModels', signal => remote.getImageModels(group, signal), (imageModels) => { publish({ imageModels }) })
    },
    generate: async (input) => {
      publish({ imageDraft: input })
      await run('images', signal => remote.generateImages(input, signal), (imageResult) => { publish({ imageResult, imageSaves: {} }) }, true)
    },
    saveImage: async (id) => {
      const image = state.imageResult?.images.find(value => value.id === id)
      if (image === undefined || state.imageSaves[id]?.status === 'saving') return
      const version = revision
      const current = () => !disposed && version === revision && state.imageResult?.images.some(value => value.id === id)
      publish({ imageSaves: { ...state.imageSaves, [id]: { status: 'saving' } } })
      try {
        const extension = image.source.startsWith('data:image/jpeg') ? 'jpg' : image.source.startsWith('data:image/webp') ? 'webp' : 'png'
        const result = await files.save({ url: image.source, name: `waibibabo-${id}.${extension}` }, 'download')
        if (current()) publish({ imageSaves: { ...state.imageSaves, [id]: result } })
      } catch {
        if (current()) publish({ imageSaves: { ...state.imageSaves, [id]: { status: 'failed' } } })
      }
    },
    loadBilling: async (query = state.orderQuery) => {
      await run('billing', async (signal) => {
        const [checkout, subscriptions, orders] = await Promise.all([
          remote.getCheckout(signal), remote.getSubscriptions(signal), remote.getOrders(query, signal),
        ])
        if (!checkout.ok || !subscriptions.ok || !orders.ok) return { ok: false }
        if (!checkout.value.ok) return { ok: true, value: checkout.value }
        if (!subscriptions.value.ok) return { ok: true, value: subscriptions.value }
        if (!orders.value.ok) return { ok: true, value: orders.value }
        return { ok: true, value: { ok: true, data: {
          checkout: checkout.value.data, subscriptions: subscriptions.value.data, orders: orders.value.data,
        } } }
      }, (data) => { publish({ ...data, orderQuery: query, orderUncertain: false,
        paymentState: data.orders.items.find(order => order.id === state.payment?.id) ?? state.paymentState }) })
    },
    createPayment: async (input) => {
      if (state.orderUncertain) return false
      const succeeded = await run('billing', () => remote.createOrder(input), (payment) => { publish({ payment, paymentState: null }) }, true)
      if (!succeeded && state.errors.billing === 'uncertain') publish({ orderUncertain: true })
      return succeeded
    },
    refreshPayment: async (id) => {
      const succeeded = await run('billing', () => remote.getOrder(id, true), (paymentState) => {
        publish({ paymentState: state.payment?.id === id ? paymentState : state.paymentState,
          orders: state.orders === null ? null : { ...state.orders,
            items: state.orders.items.map(item => item.id === id ? paymentState : item) } })
      })
      if (succeeded && state.paymentState?.status === 'COMPLETED') { await account.refresh(); await injected.loadBilling() }
    },
    cancelPayment: async (id) => {
      if (await run('billing', () => remote.cancelOrder(id), () => {}, true)) await injected.loadBilling()
    },
    loadInvoices: async (query = state.invoiceQuery) => {
      await run('invoices', signal => remote.getInvoices(query, signal), (invoices) => { publish({ invoices, invoiceQuery: query }) })
    },
    openInvoice: async (id) => {
      if (state.loading.invoices) return
      if (state.invoiceUncertain) { publish({ invoiceOpen: true }); return }
      if (id === null) {
        publish({ invoiceOpen: true, invoice: null, invoiceDraft: newInvoiceDraft(account.hooks.account.getSnapshot().view?.profile?.email),
          quote: null, invoiceSaved: false })
        return
      }
      await run('invoices', () => remote.getInvoice(id), (invoice) => {
        publish({ invoiceOpen: true, invoice,
          quote: { paymentAmountCents: invoice.paymentAmountCents, feeCents: invoice.feeCents, amountCents: invoice.amountCents },
          invoiceDraft: { ...newInvoiceDraft(invoice.email), id: invoice.id, kind: invoice.kind, title: invoice.title, taxId: invoice.taxId,
            paymentAmount: (invoice.paymentAmountCents / 100).toFixed(2), version: invoice.version,
            retained: invoice.files.filter(file => file.kind === 'payment' || file.kind === 'fee_payment').map(file => file.id) }, invoiceSaved: false })
      })
    },
    closeInvoice: () => { if (!state.loading.invoices) publish({ invoiceOpen: false }) },
    updateInvoiceDraft: (patch, owner) => {
      if (state.loading.invoices || state.invoiceUncertain || account.hooks.account.getSnapshot().view?.profile?.id !== owner) return
      publish({ invoiceDraft: { ...state.invoiceDraft, ...patch, requestKey: randomUUID() as InvoiceRequestKey },
        ...(patch.paymentAmount === undefined ? {} : { quote: null }), invoiceSaved: false })
    },
    quoteInvoice: async () => { await run('invoices', () => remote.quoteInvoice(state.invoiceDraft.paymentAmount), (quote) => { publish({ quote }) }) },
    submitInvoice: async () => {
      const succeeded = await run('invoices', () => remote.saveInvoice(state.invoiceDraft), (invoice) => {
        publish({ invoice, invoiceOpen: false, invoiceDraft: newInvoiceDraft(), quote: null, invoiceSaved: true, invoiceUncertain: false })
      }, true)
      if (succeeded) await injected.loadInvoices()
      else if (state.errors.invoices === 'uncertain') publish({ invoiceUncertain: true })
    },
    downloadInvoice: async (id, file) => {
      await run('invoices', () => remote.getInvoiceFile(id, file), async (value) => {
        await files.save({ url: `data:${value.mime};base64,${value.base64}`, name: value.name, mediaType: value.mime }, 'download')
      })
    },
  }
  return { injected, reset, dispose: () => { reset(); disposed = true; listeners.clear() } }
}
