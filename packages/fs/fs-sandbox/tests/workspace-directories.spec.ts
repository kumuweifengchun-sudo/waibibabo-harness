/** Workspace grants reach the real filesystem fence, including revocation and subagent inheritance. */
import { mkdir, mkdtemp, realpath, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { assertWorkspaceOutsideTemp, outsideTempWorkspaceParent } from '../../../../scripts/snapshot-workspace-parent.ts'

it('writes to every authorized folder and denies siblings, removed folders, and read-only mutations', async () => {
  const root = await realpath(await mkdtemp(join(outsideTempWorkspaceParent(), '.wss-multi-folder-')))
  assertWorkspaceOutsideTemp(root)
  const ctx = new Context()
  try {
    const [front, back, mobile, outside] = ['front', 'back', 'mobile', 'outside'].map(name => join(root, name)) as [string, string, string, string]
    await Promise.all([front, back, mobile, outside].map(path => mkdir(path)))
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend())
    const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', domain)
    ctx.provide('storageDomain', domain)
    ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    await ctx.plugin(WorkspaceRegistry)
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write' })
    await ctx.plugin(SandboxedFileSystem, { cwd: front })
    const workspace = await ctx.workspaceRegistry.create(front)
    const session = ctx.sessions.create(SessionId('multi-root'), { meta: { cwd: front } })
    await workspace.attachSession(session.id)
    await ctx.workspaceRegistry.update(workspace.id, 'Product', [front, back, mobile])
    const policy = () => ctx.sandboxPolicy.resolve({ session })
    const write = async (path: string) => ctx.fs.writeText(await ctx.fs.resolve(join(path, 'file.txt')), 'hello', undefined, undefined, policy())
    for (const path of workspace.directories) {
      await write(path)
      expect(await readFile(join(path, 'file.txt'), 'utf8')).toBe('hello')
    }
    await expect(write(outside)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    const child = ctx.sessions.create(SessionId('child'), { meta: { cwd: mobile, origin: 'subagent', parentSession: session.id } })
    expect(ctx.sandboxPolicy.resolve({ session: child }).additionalWritableRoots).toEqual([back, mobile])
    await ctx.workspaceRegistry.update(workspace.id, 'Product', [back, mobile])
    expect(policy().workspaceRoot).toBe(back)
    expect(workspace.sessionIds).toContain(session.id)
    await expect(write(front)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    expect(await ctx.fs.readText(await ctx.fs.resolve(join(front, 'file.txt')))).toBe('hello')
    expect(ctx.sandboxPolicy.resolve({ session: child }).workspaceRoot).toBe(back)
    setSandboxMode(session, 'read-only')
    await expect(write(back)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    await expect(write(mobile)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
