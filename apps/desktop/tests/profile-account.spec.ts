/** Account providers selected by the shipped Desktop profile. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'

it('keeps the platform account active without upstream account notification dependencies', () => {
  const home = mkdtempSync(join(tmpdir(), 'wss-desktop-profile-account-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir)
    const installAnchor = fileURLToPath(new URL('../../desktop-host/package.json', import.meta.url))
    const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ], message => warnings.push(message))
    const active = rows.filter(row => row.disabled !== true)

    expect(active.find(row => row.id === 'sub2api-account'))
      .toMatchObject({ name: '@deepseek-ai/dsh-sub2api-account' })
    expect(active.filter(row => [
      'deepseek-account', 'llm-deepseek-account', 'ui-settings-account', 'ui-account-notifications',
    ].includes(row.id ?? ''))).toEqual([])
    expect(warnings).toEqual([])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
