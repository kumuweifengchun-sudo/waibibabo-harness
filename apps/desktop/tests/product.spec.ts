import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopProduct, desktopProductHome } from '../src/product.ts'
import { resolveDesktopPaths } from '../src/paths.ts'

describe('Waibibabo desktop identity', () => {
  it('keeps the default data directory independent from the upstream home', () => {
    const userHome = join(process.cwd(), 'fixture-user')
    const home = desktopProductHome({}, userHome)
    expect(home).toBe(join(userHome, '.waibibabo'))
    expect(resolveDesktopPaths(home).profile).toBe(join(home, 'profiles', 'desktop'))
    expect(desktopProduct.appId).toBe('com.waibibabo.desktop')
    expect(desktopProduct.managedUpdates).toBe(false)
    expect(desktopProduct.chineseOnly).toBe(true)
    expect(desktopProduct.shortName).toBe('WSS')
    expect(desktopProduct.version).toBe('0.1.0')
  })

  it('honors an explicit data directory without rewriting it', () => {
    const root = join(process.cwd(), 'custom-data')
    expect(desktopProductHome({ DSH_HOME: root }, join(process.cwd(), 'unused'))).toBe(root)
  })
})
