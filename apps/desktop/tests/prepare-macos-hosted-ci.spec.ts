import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { expect, it } from 'vitest'

const adapter = join(import.meta.dirname, '../scripts/prepare-macos-hosted-ci.mjs')
const product = JSON.parse(readFileSync(new URL('../../../packages/llm/llm/src/waibibabo-product.json', import.meta.url), 'utf8')) as { version: string }

async function runAdapter(settings: NodeJS.ProcessEnv) {
  const root = await mkdtemp(join(tmpdir(), 'macos-hosted-ci-'))
  try {
    const output = join(root, 'output')
    const summary = join(root, 'summary')
    const result = spawnSync(process.execPath, [adapter], { encoding: 'utf8', timeout: 30_000, env: {
      ...process.env,
      DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'arm64',
      PACKAGE_VERSION_MODE: 'follow-dsh', PACKAGE_BUILD_VERSION: '',
      GITHUB_RUN_NUMBER: '7', GITHUB_RUN_ATTEMPT: '2', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      ...settings,
    } })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    return { result, output: await readFile(output, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
      throw error
    }), summary: await readFile(summary, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
      throw error
    }) }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it.each(['arm64', 'x64'])('prepares an unsigned %s build without machine settings or inherited credentials', async (arch) => {
  const run = await runAdapter({
    DSH_DESKTOP_TARGET_ARCH: arch,
    DSH_PACKAGING_PRESET: 'production', DSH_PACKAGING_CONFIG_DIR: '/absent-machine-settings',
    CSC_LINK: '/absent-certificate.p12', CSC_KEY_PASSWORD: 'private-password', APPLE_ID: 'private-account',
  })
  expect(run.result.status).toBe(0)
  expect(run.result.stderr).toBe('')
  expect(parseEnv(run.output)).toEqual({ version: product.version })
  expect(run.summary).toContain(`macOS ${arch} unsigned installer`)
  expect(run.summary).toContain('not notarized')
  expect(run.summary).not.toMatch(/private-password|private-account/u)
})

it('numbers an unpublished build from the product version and Actions run identity', async () => {
  const run = await runAdapter({ PACKAGE_VERSION_MODE: 'build-number' })
  expect(run.result.status).toBe(0)
  const prefix = product.version.includes('-') ? `${product.version}.` : `${product.version}-test.`
  expect(parseEnv(run.output).version).toMatch(new RegExp(`^${prefix.replaceAll('.', '\\.')}[0-9]{8}\\.7\\.2$`, 'u'))
})

it('accepts an explicit manual version belonging to the product', async () => {
  const run = await runAdapter({ PACKAGE_VERSION_MODE: 'manual', PACKAGE_BUILD_VERSION: product.version })
  expect(run.result.status).toBe(0)
  expect(parseEnv(run.output)).toEqual({ version: product.version })
})

it.each([
  { PACKAGE_VERSION_MODE: 'manual', PACKAGE_BUILD_VERSION: '' },
  { PACKAGE_VERSION_MODE: 'manual', PACKAGE_BUILD_VERSION: '999.0.0' },
  { PACKAGE_VERSION_MODE: 'invalid' },
  { PACKAGE_VERSION_MODE: 'build-number', GITHUB_RUN_NUMBER: '0' },
  { DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64' },
  { DSH_DESKTOP_TARGET_ARCH: 'unsupported' },
  { GITHUB_OUTPUT: '' },
])('rejects invalid build settings without recording a usable version: %j', async (settings) => {
  const run = await runAdapter(settings)
  expect(run.result.status).toBe(1)
  expect(run.output).toBe('')
  expect(run.summary).toBe('')
})
