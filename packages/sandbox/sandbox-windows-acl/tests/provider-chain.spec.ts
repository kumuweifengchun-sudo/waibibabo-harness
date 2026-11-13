/**
 * The win32 chain's argv contract, denial dialect, and runner-failure rules,
 * exercised through the REAL LocalSandboxProvider.confine() with an injected
 * platform and runner argv prefix. Platform-independent assertions: they run
 * in every CI lane (Windows included, where sandbox-local's own POSIX-only
 * suites are excluded) — the end-to-end runner behavior lives in
 * runner.spec.ts on win32 hosts.
 */

import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

const RO: SandboxPolicy = { mode: 'read-only', workspaceRoot: '/ws' }
const WW: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: '/ws' }

async function setup(internals: LocalSandboxProvider['internals']) {
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = internals
  return sandbox
}

describe('windows-acl win32 chain (LocalSandboxProvider)', () => {
  it.skipIf(process.platform !== 'win32')('executes a session with multiple grants and revokes removed folder capabilities on the next call', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'wss-native-folders-')))
    const ctx = new Context()
    try {
      const front = join(root, 'front')
      const back = join(root, 'back')
      const outside = join(root, 'outside')
      for (const path of [front, back, outside]) mkdirSync(path)
      await ctx.plugin(LocalSandboxProvider, {})
      const sandbox = ctx.sandbox as LocalSandboxProvider
      sandbox.internals = { platform: 'win32', windowsAclRunnerArgs: [process.execPath, '--import', 'tsx/esm',
        fileURLToPath(new URL('../src/runner.ts', import.meta.url))] }
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: front, sessionId: SessionId('native-multi-folder') }
      const quote = (path: string) => `'${path.replaceAll("'", "''")}'`
      const write = (path: string) => `Set-Content -LiteralPath ${quote(path)} -Value ok -ErrorAction Stop;`
      const run = async (policy: SandboxPolicy, script: string) => {
        const confined = await sandbox.confine([resolvePwshPath(), '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], policy)
        const executable = confined.argv[0]
        if (executable === undefined) throw new Error('missing runner executable')
        return spawnSync(executable, confined.argv.slice(1), { encoding: 'utf8', timeout: 30_000 })
      }
      const allowed = await run({ ...policy, additionalWritableRoots: [back] },
        `${write(join(front, 'ok.txt'))}${write(join(back, 'ok.txt'))}try{${write(join(outside, 'no.txt'))}}catch{'OUTSIDE-DENIED'}`)
      expect(allowed.status, allowed.stderr).toBe(0)
      expect(allowed.stdout).toContain('OUTSIDE-DENIED')
      expect(existsSync(join(back, 'ok.txt'))).toBe(true)
      expect(existsSync(join(outside, 'no.txt'))).toBe(false)
      const reduced = await run(policy, `try{${write(join(back, 'removed.txt'))}'UNEXPECTED'}catch{'REMOVED-DENIED'}`)
      expect(reduced.status, reduced.stderr).toBe(0)
      expect(reduced.stdout).toContain('REMOVED-DENIED')
      expect(existsSync(join(back, 'removed.txt'))).toBe(false)
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 90_000)

  it('agentless workspace-write: runner argv prefix, temp root, mode flag, partial enforcement, ACL denial dialect', async () => {
    const probeWindowsAcl = vi.fn(() => true)
    const sandbox = await setup({
      platform: 'win32',
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
      probeWindowsAcl,
    })
    const confined = await sandbox.confine(['pwsh', '/Command', 'x'], WW)
    expect(confined.argv).toEqual([
      'node', 'windows-acl-runner.js',
      '--workspace', '/ws',
      '--temp', tmpdir(),
      '--mode', 'workspace-write',
      '--',
      'pwsh', '/Command', 'x',
    ])
    expect(confined.enforcement).toBe('partial')
    expect(confined.denialSignatures).toEqual(['access is denied', 'access to the path', 'permission denied', 'operation not permitted'])
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
    // A sole candidate is selected unprobed.
    expect(probeWindowsAcl).not.toHaveBeenCalled()
  })

  it('read-only: same runner and contract, read-only mode flag', async () => {
    const sandbox = await setup({ platform: 'win32', windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'] })
    const confined = await sandbox.confine(['true'], RO)
    expect(confined.argv.slice(-4)).toEqual(['--mode', 'read-only', '--', 'true'])
    expect(confined.enforcement).toBe('partial')
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
  })
})
