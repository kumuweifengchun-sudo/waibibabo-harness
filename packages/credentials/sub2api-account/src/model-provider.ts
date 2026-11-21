/** Model provider identities for the desktop platform account. */
import type { AccountView } from './types.ts'

const prefix = 'sub2api-u'

/**
 * @param view - account and group selected for platform inference.
 * @returns the registered route for that account and group, if selected.
 */
export function accountModelProvider(view: Pick<AccountView, 'profile' | 'selectedGroup'>): string | undefined {
  if (view.profile === null || view.selectedGroup === null) return undefined
  return `${prefix}${view.profile.id}-g${view.selectedGroup}`
}

/**
 * @param active - current platform route, undefined for an account without a group, or false before login.
 * @param provider - provider ID from the model catalog.
 * @returns whether this provider may appear in the desktop model pickers.
 */
export function selectableProvider(active: string | undefined | false, provider: string): boolean {
  if (active === false || provider === 'deepseek-official' || provider === 'deepseek-account' || provider === 'deepseek') return false
  return !provider.startsWith(prefix) || provider === active
}
