/** Product artwork rendered in the sidebar and empty conversation. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import icon from './assets/colorful.png'
import css from './Brand.module.css'

/** Render the supplied product icon at its owner's requested size.
 * @param props - Size and optional class supplied by the containing slot.
 * @returns decorative product artwork.
 */
export function ProductMark({ size, className }: SidebarBrandMarkOwnerProps & { className?: string | undefined }) {
  return <img src={icon} width={size} height={size} className={[css.mark, className].filter(Boolean).join(' ')} alt="" />
}

/** Render a wrapping product name within the sidebar's available width.
 * @param props - Product locale supplied by the slot registry.
 * @returns the localized product name.
 */
export function ProductName({ t }: PropsLocale<'waibibabo.brand'>) {
  return <span className={css.identity} title={t('name')}>
    <span className={css.name}>{t('shortName')}</span><span className={css.version}>{t('version')}</span>
  </span>
}

/** Render the product name and release version in a new conversation.
 * @param props - Product labels supplied by the brand slot.
 * @returns the complete product headline.
 */
export function ProductHeroName({ t }: PropsLocale<'waibibabo.brand'>) {
  return <><span className={css.heroName}>{t('name')}</span><span className={css.heroVersion}>{t('version')}</span></>
}
