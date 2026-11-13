/** Account settings, sidebar entry and first-run login over the generated Remote. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-file-actions/client'
import remote from '@deepseek-ai/dsh-sub2api-account/remote'
import type { AccountView } from '../types.ts'
import { AccountContent, AccountGate, AccountLauncher, AccountSection, type AccountInjected, type ClientAccountState } from './AccountSection.tsx'
import { zh } from './locales.ts'
import { UsageOverlay, UsageSection } from './UsageSection.tsx'
import { initialUsageState, type UsageState } from './usage-state.ts'
import { createPlatformClient } from './platform-client.ts'
import { ModelSection } from './ModelSection.tsx'
import { ImagePanel, ImagePanelIcon } from './ImagePanel.tsx'
import { BillingSection } from './BillingSection.tsx'
import { InvoiceSection } from './InvoiceSection.tsx'
export type { AccountInjected } from './AccountSection.tsx'

/** Namespace installation depends only on the transport; page consumers have their own injected lifetime. */
export const inject = ['remote']

/** Register the desktop account without exposing credentials to the browser.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(async (owner) => {
    await owner.remote.$mount(remote)
    owner.inject(['remote.sub2apiAccount', 'slots', 'locale', 'remoteAccess', 'fileActions'], (scope) => {
      scope.effect(() => scope.locale.register('sub2api.account', { en: zh, zh }), 'sub2api-account: dictionaries')
      const t = scope.locale.bind('sub2api.account')
      const account = scope.remote.sub2apiAccount
      let snapshot: ClientAccountState = { view: undefined, busy: false, failed: false, loginVisible: true, usageVisible: false }
      const listeners = new Set<() => void>()
      let usage: UsageState = initialUsageState()
      const usageListeners = new Set<() => void>()
      let usageRequest: AbortController | undefined
      const publishUsage = (patch: Partial<UsageState>) => {
        if (disposed) return
        usage = { ...usage, ...patch }
        for (const listener of usageListeners) listener()
      }
      let disposed = false
      const publish = (patch: Partial<ClientAccountState>) => {
        if (disposed) return
        const next = { ...snapshot, ...patch }
        if (next.view?.profile?.id !== snapshot.view?.profile?.id) {
          platform.reset()
          usageRequest?.abort()
          usageRequest = undefined
          publishUsage(initialUsageState())
          next.usageVisible = false
        }
        const browserReturned = snapshot.view?.status === 'signing-in' && snapshot.view.authorizationUrl !== null
          && (next.view?.status === 'signed-in' || next.view?.error === 'authorization')
        if (next.view?.status === 'signed-in') next.loginVisible = false
        else if (next.view?.status === 'signed-out' && snapshot.view?.status === 'signed-in') next.loginVisible = true
        snapshot = next
        for (const listener of listeners) listener()
        if (browserReturned) {
          const desktop = (globalThis as { dshDesktop?: { activate?: () => Promise<void> } }).dshDesktop
          void desktop?.activate?.().catch(() => { scope.logger.warn('sub2api-account: native window activation failed') })
        }
      }
      const source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      } }
      const run = async (action: () => ReturnType<typeof account.getState>): Promise<AccountView | undefined> => {
        if (snapshot.busy) return undefined
        publish({ busy: true, failed: false })
        try {
          const result = await action()
          if (!result.ok) throw new Error('Account operation failed')
          publish({ view: result.value })
          return result.value
        } catch { publish({ failed: true }); return undefined }
        finally { publish({ busy: false }) }
      }
      const operations: AccountInjected = {
        hooks: { account: source, usage: { getSnapshot: () => usage, subscribe: (listener) => {
          usageListeners.add(listener)
          return () => { usageListeners.delete(listener) }
        } } },
        signIn: async (email, password) => { await run(() => account.signInWithPassword(email, password)) },
        verify: async (code) => { await run(() => account.finishTwoFactor(code)) },
        cancel: async () => { await run(() => account.cancelSignIn()) },
        signOut: async () => { await run(() => account.signOut()); publish({ loginVisible: true }) },
        refresh: async () => { await run(() => account.refresh()) },
        setAccountOrigin: async (origin) => { await run(() => account.setAccountOrigin(origin)) },
        selectGroup: async (group) => { await run(() => account.selectGroup(group)) },
        showLogin: (visible) => { publish({ loginVisible: visible }) },
        showUsage: (visible) => { publish({ usageVisible: visible }) },
        setProtocol: async (group, model, protocol) => { await run(() => account.setModelProtocol(group, model, protocol)) },
        setModelLimits: async (limits) => { await run(() => account.setModelLimits(limits)) },
        setModelLimitOverride: async (group, model, limits) => { await run(() => account.setModelLimitOverride(group, model, limits)) },
        loadUsage: async (query) => {
          const user = snapshot.view?.profile?.id
          if (disposed || user === undefined) return
          usageRequest?.abort()
          const controller = new AbortController()
          usageRequest = controller
          const current = () => !disposed && !controller.signal.aborted && snapshot.view?.profile?.id === user
          publishUsage({ loading: true, error: null })
          try {
            const response = await account.getUsage(query, controller.signal)
            if (!current()) return
            if (!response.ok) { publishUsage({ error: 'network' }); return }
            const result = response.value
            if (result.ok) publishUsage({ data: result.data, query, error: null })
            else publishUsage({ error: result.error })
          } catch {
            if (current()) publishUsage({ error: 'network' })
          } finally {
            if (usageRequest === controller) { usageRequest = undefined; publishUsage({ loading: false }) }
          }
        },
        start: async () => {
          const view = await run(() => account.startSignIn())
          if (!disposed && view?.authorizationUrl) window.open(view.authorizationUrl, '_blank', 'noopener,noreferrer')
        },
      }
      const platform = createPlatformClient(account, operations, scope.fileActions)
      const native = platform.injected
      scope.slots.registerFactory({ name: 'sub2api.account.content', scope: 'root', locale: 'sub2api.account',
        children: { 'sub2api.account.brand': { kind: 'single', scope: 'root' } }, inject: () => operations }, AccountContent)
      scope.remoteAccess.whenAccess('sub2apiAccount/watch', function* () {
        const stream = scope.remote.$stream<AccountView>({ name: 'sub2api-account', open: signal => account.watch(signal), ended: () => new Error('Account stream ended') })
        const subscription = new AbortController()
        yield () => { subscription.abort(); publish({ view: undefined }); return stream.dispose() }
        void (async () => {
          try {
            for await (const frame of stream) {
              if (subscription.signal.aborted) return
              publish({ view: frame.value, failed: false })
              frame.accept()
            }
          } catch { if (!subscription.signal.aborted) publish({ failed: true }) }
        })()
        void run(() => account.getState())
      })
      scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'sub2api-account', order: -30,
        label: () => t('nav') }, AccountSection))
      scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'sub2api-usage', order: -20,
        label: () => t('usageTitle'), locale: 'sub2api.account', inject: () => operations }, UsageSection))
      scope.slots.inject('settings.models.footer', () => scope.slots.register({ name: 'settings.models.footer', id: 'sub2api-models',
        locale: 'sub2api.account', inject: () => native }, ModelSection))
      scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'sub2api-billing', order: -15,
        label: () => t('billingTitle'), locale: 'sub2api.account', inject: () => native }, BillingSection))
      scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: 'sub2api-invoices', order: -10,
        label: () => t('invoiceTitle'), locale: 'sub2api.account', inject: () => native }, InvoiceSection))
      scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: 'sub2api-images', locale: 'sub2api.account', inject: () => native }, ImagePanel))
      scope.slots.inject('sidebar.panellist', () => scope.slots.register({ name: 'sidebar.panellist', id: 'sub2api-images', order: 5,
        label: () => t('imageTitle'), locale: 'sub2api.account' }, ImagePanelIcon))
      scope.slots.inject('settings.launcher', () => scope.slots.register({ name: 'settings.launcher', locale: 'sub2api.account', inject: () => operations }, AccountLauncher))
      scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: 'sub2api-account.sign-in', locale: 'sub2api.account', inject: () => operations }, AccountGate))
      scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: 'sub2api-account.usage', locale: 'sub2api.account', inject: () => operations }, UsageOverlay))
      scope.effect(() => () => { platform.dispose(); disposed = true; usageRequest?.abort(); listeners.clear(); usageListeners.clear() }, 'sub2api-account: client state lifetime')
    })
  })
}
