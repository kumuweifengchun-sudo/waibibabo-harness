/** Chinese product identity displayed in the client. */
import product from '../product.ts'

/** Product-owned labels shared with the desktop shell. */
export const zh = { name: product.name, shortName: product.shortName, version: product.version }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product name used by the sidebar branding. */
    'waibibabo.brand': keyof typeof zh
  }
}
