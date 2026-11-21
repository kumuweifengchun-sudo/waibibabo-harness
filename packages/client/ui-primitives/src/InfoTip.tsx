/** A focusable information icon for short, localized explanations. */
import { Button } from './Button.tsx'
import { IconInfoOutlineRegular } from './icons/index.tsx'
import { Tooltip } from './Tooltip.tsx'
import css from './InfoTip.module.css'

/**
 * @param props.label - accessible name identifying the subject of the explanation.
 * @param props.text - explanation shown on hover, keyboard focus, or tap.
 * @returns an information button with a portaled tooltip.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  return <Tooltip label={text} side="bottom" delayMs={250} maxWidth={320} portal openOnClick>
    <Button variant="ghost" size="sm" className={css.icon} aria-label={label}>
      <IconInfoOutlineRegular size={16} aria-hidden="true" />
    </Button>
  </Tooltip>
}
