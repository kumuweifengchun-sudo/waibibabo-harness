/** Generated-Remote operations and account-bound lifetimes for native platform pages. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/client'
import type {} from '@deepseek-ai/dsh-sub2api-account/remote'
import type { InvoiceRequestKey, PaymentOrder, PlatformResult, RechargeBatch, RechargeBatchAction } from '../platform-types.ts'
import type { AccountInjected } from './AccountSection.tsx'
import { initialPlatformState, newInvoiceDraft, type PlatformChannel, type PlatformInjected, type PlatformState } from './platform-state.ts'
import { readImageReference } from './image-reference.ts'

type Outcome<T> = { readonly ok: true; readonly value: PlatformResult<T> } | { readonly ok: false }

/** Generated operations needed by the native pages; account login remains owned by its original controller. */
export type PlatformRemote = Pick<Context['remote']['sub2apiAccount'], 'getGateways' | 'setGateway' | 'generateImages' | 'getImageModels'
  | 'getCheckout' | 'getSubscriptions' | 'getOrders' | 'createOrder' | 'getOrder' | 'cancelOrder'
  | 'quoteRechargeBatch' | 'getRechargeBatches' | 'updateRechargeBatch'
  | 'getInvoices' | 'getInvoice' | 'quoteInvoice' | 'saveInvoice' | 'getInvoiceFile'>

/** Bind account-scoped native operations without exposing the Remote or credentials to components.
 * @param remote - Generated account Remote in the plugin's injected scope.
 * @param account - Account snapshot and user actions owned by the same scope.
 * @param files - Shared native/browser download service with owned cleanup.
 * @returns page injection plus account-reset and teardown controls.
 */
export function createPlatformClient(remote: PlatformRemote, account: AccountInjected, files: Pick<FileActions, 'save' | 'generatedImages'>): {
  readonly injected: PlatformInjected
  reset: () => void
  dispose: () => void
} {
  let state = initialPlatformState()
  let revision = 0
  let disposed = false
  let rechargeKey: string | undefined
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
    rechargeKey = undefined
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
  const applyOrder = (order: PaymentOrder) => {
    publish({ ...(state.payment?.id === order.id ? { paymentState: order } : {}),
      ...(state.paymentDialog !== 'current' && state.paymentDialog?.id === order.id ? { paymentDialog: order } : {}),
      pendingCancellationChecks: state.pendingCancellationChecks.filter(id => id !== order.id),
      orders: state.orders === null ? null : { ...state.orders,
        items: state.orders.items.map(item => item.id === order.id ? order : item) } })
  }
  const updatePayment = async (request: (signal: AbortSignal) => Promise<Outcome<PaymentOrder>>, cancelling: boolean) => {
    const version = revision
    let reloadBilling = cancelling
    const settled = await run('billing', request, async (order) => {
      applyOrder(order)
      if (order.status === 'COMPLETED') {
        reloadBilling = true
        await account.refresh()
      }
    }, cancelling)
    if (settled && reloadBilling && version === revision) await injected.loadBilling()
    return settled && version === revision
  }
  const applyBatch = async (batch: RechargeBatch) => {
    const previous = state.rechargeBatches.find(item => item.id === batch.id)
    const batches = previous === undefined ? [batch, ...state.rechargeBatches]
      : state.rechargeBatches.map(item => item.id === batch.id ? batch : item)
    publish({ rechargeOffer: null, rechargeBatch: batch, rechargeBatches: batches })
    if (batch.creditedCents !== (previous?.creditedCents ?? 0) || batch.awardedBonusCents !== (previous?.awardedBonusCents ?? 0)) {
      await account.refresh()
    }
  }
  const updateBatch = (action: RechargeBatchAction) =>
    run('billing', () => remote.updateRechargeBatch(action), applyBatch, action.kind !== 'refresh')
  const injected: PlatformInjected = {
    ...files.generatedImages === undefined ? {} : { generatedImageDownloads: files.generatedImages },
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
    updateImageDraft: (patch) => {
      if (state.loading.images || state.loading.imageUploads && patch.references !== undefined) return
      publish({ imageDraft: { ...state.imageDraft, ...patch } })
    },
    addImageReferences: async (selected) => {
      const limits = account.hooks.account.getSnapshot().view?.imageUploadLimits
      if (state.loading.images || selected.length === 0 || limits === undefined) return
      await run('imageUploads', async (signal) => {
        const previous = state.imageDraft.references ?? []
        const previousBytes = previous.reduce((total, image) => total + image.base64.length / 4 * 3
          - (image.base64.endsWith('==') ? 2 : image.base64.endsWith('=') ? 1 : 0), 0)
        if (previous.length + selected.length > limits.maxCount
          || previousBytes + selected.reduce((total, file) => total + file.size, 0) > limits.maxBytes
          || selected.some(file => file.size === 0 || file.name.length === 0 || file.name.length > 255)) {
          return { ok: true, value: { ok: false, error: 'validation' } }
        }
        const added = await Promise.all(selected.map(file => readImageReference(file, signal)))
        return { ok: true, value: { ok: true, data: [...previous, ...added] } }
      }, (references) => { publish({ imageDraft: { ...state.imageDraft, references } }) })
    },
    loadImageModels: async (group) => {
      flights.get('imageModels')?.abort()
      flights.delete('imageModels')
      publish({ imageModelsGroup: group, imageModels: [] })
      await run('imageModels', signal => remote.getImageModels(group, signal), (imageModels) => { publish({ imageModels }) })
    },
    generate: async (input) => {
      if (state.loading.imageUploads || state.loading.images) return
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
        const source = { url: image.source, name: `waibibabo-${id}.${extension}` }
        const result = files.generatedImages === undefined ? await files.save(source, 'download')
          : await files.save(source, 'download', 'generatedImages')
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
      }, (data) => {
        const inspected = state.paymentDialog === 'current' ? null : state.paymentDialog
        const items = data.orders.items.map((order) => {
          const detail = state.paymentState?.id === order.id ? state.paymentState : inspected?.id === order.id ? inspected : null
          // A lagging history response cannot make a settled order payable again.
          return order.status === 'PENDING' && detail && detail.status !== 'PENDING' ? detail : order
        })
        const listed = new Map(items.map(order => [order.id, order]))
        publish({ ...data, orders: { ...data.orders, items }, orderQuery: query, orderUncertain: false,
          pendingCancellationChecks: state.pendingCancellationChecks.filter((id) => {
            const order = listed.get(id)
            return !order || order.status === 'PENDING'
          }),
          paymentState: state.payment ? listed.get(state.payment.id) ?? state.paymentState : null,
          paymentDialog: inspected ? listed.get(inspected.id) ?? inspected : state.paymentDialog })
      })
    },
    createPayment: async (input) => {
      if (state.orderUncertain) return false
      const succeeded = await run('billing', () => remote.createOrder(input), (payment) => {
        publish({ payment, paymentState: null, paymentDialog: 'current' })
      }, true)
      if (!succeeded && state.errors.billing === 'uncertain') publish({ orderUncertain: true })
      return succeeded
    },
    openPayment: (order) => {
      if (state.loading.billing || (!order && !state.payment)) return
      publish({ paymentDialog: order && order.id !== state.payment?.id ? order : 'current',
        errors: { ...state.errors, billing: null } })
    },
    closePayment: () => { publish({ paymentDialog: null }) },
    refreshPayment: async (id) => { await updatePayment(() => remote.getOrder(id, !state.pendingCancellationChecks.includes(id)), false) },
    checkAlipayPayment: async (id, batch) => {
      if (await updatePayment(() => remote.getOrder(id, true, true), false) && batch !== undefined) {
        await updateBatch({ kind: 'refresh', id: batch })
      }
    },
    cancelPayment: async (id) => {
      if (state.pendingCancellationChecks.includes(id)) return
      await updatePayment(async (signal) => {
        publish({ pendingCancellationChecks: [...state.pendingCancellationChecks, id] })
        const result = await remote.cancelOrder(id)
        if (!result.ok) return { ok: false }
        if (!result.value.ok) return { ok: true, value: result.value }
        signal.throwIfAborted()
        return remote.getOrder(id, false)
      }, true)
    },
    quoteRecharge: async (amountCents, channel) => {
      if (rechargeKey !== undefined) return
      await run('billing', () => remote.quoteRechargeBatch(amountCents, channel), (rechargeOffer) => {
        publish({ rechargeOffer, rechargeBatch: null })
      })
    },
    loadRechargeBatches: async (before) => {
      await run('billing', signal => remote.getRechargeBatches(before, signal), (batches) => {
        publish({ rechargeBatches: batches })
      })
    },
    confirmRecharge: async () => {
      const offer = state.rechargeOffer
      if (offer === null || flights.has('billing')) return
      rechargeKey ??= randomUUID()
      const version = revision
      const success = await updateBatch({ kind: 'confirm', amountCents: offer.amountCents, channelId: offer.channelId,
        token: offer.token, key: rechargeKey })
      if (version !== revision) return
      if (success || state.errors.billing !== 'uncertain') rechargeKey = undefined
      if (state.errors.billing === 'conflict') publish({ rechargeOffer: null })
    },
    updateRecharge: async (action) => { await updateBatch(action) },
    closeRecharge: () => {
      if (!state.loading.billing && rechargeKey === undefined) publish({ rechargeOffer: null, rechargeBatch: null,
        errors: { ...state.errors, billing: null } })
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
