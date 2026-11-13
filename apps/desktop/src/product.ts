/** Product identity and independent defaults for the Waibibabo desktop application. */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import product from '@deepseek-ai/dsh-waibibabo/src/product.ts'

/** Build identity shared with the installer configuration. */
export const desktopProduct = product

/** Resolve the product home while retaining an explicitly configured DSH_HOME.
 * @param environment - desktop launch environment.
 * @param userHome - OS user home, supplied explicitly by isolated tests.
 * @returns an absolute data root independent of the upstream application's default.
 */
export function desktopProductHome(environment: Readonly<NodeJS.ProcessEnv> = process.env, userHome: string = homedir()): string {
  return resolve(environment.DSH_HOME?.trim() || join(userHome, product.homeDirectory))
}
