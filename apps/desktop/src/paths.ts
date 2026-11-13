/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { desktopProductHome } from './product.ts'

/** Stable desktop installation paths under the product home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path under the selected product data root.
 * @param dshHome - product home or an explicit shared Harness home.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = desktopProductHome()): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}
