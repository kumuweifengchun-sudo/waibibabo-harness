/** Product-owned occupants of the shared sidebar and conversation brand slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-sub2api-account/client'
import { ProductMark, ProductName, ProductHeroName } from './Brand.tsx'
import { zh } from './locales.ts'

/** Services owning product translations and reversible slot registrations. */
export const inject = ['slots', 'locale']

/** Fill the product's branding slots without replacing shared navigation.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('waibibabo.brand', { en: zh, zh }), 'waibibabo: brand text')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, ProductMark))
  ctx.slots.inject('sub2api.account.brand', () => ctx.slots.register({ name: 'sub2api.account.brand' }, ProductMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', locale: 'waibibabo.brand' }, ProductName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, ProductMark))
  ctx.slots.inject('conversation.hero.brand.name', () => ctx.slots.register({
    name: 'conversation.hero.brand.name', locale: 'waibibabo.brand',
  }, ProductHeroName))
}
