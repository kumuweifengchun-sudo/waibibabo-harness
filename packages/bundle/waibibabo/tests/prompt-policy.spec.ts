/** Product validation guidance through the Loader and scoped prompt assembly. */
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { expect, it, onTestFinished } from 'vitest'
import * as Waibibabo from '../src/index.ts'

async function harness(): Promise<Context> {
  const directory = await mkdtemp(join(tmpdir(), 'wss-prompt-policy-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  const configPath = join(directory, 'cordis.yml')
  await copyFile(new URL('./fixtures/prompt-policy.cordis.yml', import.meta.url), configPath)
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.include = Include
  ctx.loader.builtins['system-prompt'] = SystemPrompt
  ctx.loader.builtins.waibibabo = Waibibabo
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

it('ships the validation guidance without workspace files or model calls', async () => {
  const ctx = await harness()
  const assembly = await ctx.systemPrompt.assemble()
  expect(assembly.contexts.map(context => context.name)).toEqual(['waibibabo:validation-policy'])
  await expect(`${renderContextSnapshot(assembly)}\n`).toMatchFileSnapshot('./expected/validation-policy.txt')
  expect(assembly.tools).toEqual([])
})

it.each([false, true])('retains the policy for a scoped persona and its child (complete: %s)', async (complete) => {
  const ctx = await harness()
  const key = { agent: 'parent' }
  const childKey = { agent: 'child' }
  await ctx.plugin({
    inject: ['systemPrompt'],
    apply(inner: Context) {
      const parent = createScope(inner, key)
      parent.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: 'Preset instructions.', complete })
      if (complete) parent.ctx.systemPrompt.suppressRuntimeContext()
      createScope(parent.ctx, childKey, { parent: key })
    },
  }).await()
  const expected = renderContextSnapshot(await ctx.systemPrompt.assemble())
  for (const scope of [key, childKey]) {
    const assembly = await ctx.systemPrompt.assemble({ scope })
    expect(renderContextSnapshot(assembly)).toBe(expected)
    expect(renderContextSnapshot(ctx.systemPrompt.refreshContext(assembly, { scope }))).toBe(expected)
    if (complete) expect(renderPrompt(assembly)).toBe('Preset instructions.')
    else expect(renderPrompt(assembly)).toContain('Preset instructions.')
  }
})

it('removes the policy on unload and contributes it once after remount', async () => {
  const ctx = await harness()
  const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'waibibabo-brand')
  expect(entry?.fiber).toBeDefined()
  await entry!.fiber!.dispose()
  expect(renderContextSnapshot(await ctx.systemPrompt.assemble())).toBe('')
  await ctx.plugin(Waibibabo).await()
  const contexts = (await ctx.systemPrompt.assemble()).contexts
  expect(contexts.map(context => context.name)).toEqual(['waibibabo:validation-policy'])
})
