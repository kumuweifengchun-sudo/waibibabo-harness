/** Model budgets reach every platform route and survive credential reloads. */
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Sub2apiGroupId } from '../src/types.ts'
import { accountFixture } from './account-fixture.ts'

it('uses the 256K context and explicit 32K request output default for every model', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1', 'claude-sonnet-4-6'] })
  const view = await f.account.signInWithPassword('user@example.com', 'password')
  expect(view.modelLimits).toEqual({ contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 })
  for (const model of view.models) {
    expect(await f.context.llm.resolveModelInfo('sub2api-u7-g3', model)).toMatchObject({
      context: { contextWindow: 262144 }, defaultMaxTokens: 32768,
      inputModalities: ['text', 'image'],
    })
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model })
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello.' }],
    })] })) if (chunk.type === 'finish') expect(chunk.reason).not.toMatchObject({ kind: 'error' })
  }
  expect(f.requests.find(request => request.path === '/v1/responses')?.body.max_output_tokens).toBe(32768)
  expect(f.requests.find(request => request.path === '/v1/messages')?.body.max_tokens).toBe(32768)
})

it('inherits global budgets while preserving and resetting each model override after reload', async () => {
  const f = await accountFixture({ models: ['gpt-5.1', 'claude-sonnet-4-6'], protocol: 'auto' })
  await f.account.signInWithPassword('user@example.com', 'password')
  const own = { contextWindow: 131072, maxInputTokens: 98304, maxOutputTokens: 32768 }
  const global = { contextWindow: 1048576, maxInputTokens: 983040, maxOutputTokens: 65536 }
  expect((await f.account.setModelLimitOverride('3' as Sub2apiGroupId, 'gpt-5.1', own)).error).toBeNull()
  await f.account.setModelLimits(global)
  expect(await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'gpt-5.1')).toMatchObject({
    context: { contextWindow: own.contextWindow }, defaultMaxTokens: own.maxOutputTokens,
  })
  expect(await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'claude-sonnet-4-6')).toMatchObject({
    context: { contextWindow: global.contextWindow }, defaultMaxTokens: global.maxOutputTokens,
  })
  const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
  await entry.update({ disabled: true })
  await entry.update({ disabled: false })
  const account = f.context.sub2apiAccount
  expect((await account.getState()).modelLimitOverrides).toEqual({ 'gpt-5.1': own })
  expect((await account.setModelLimitOverride('4' as Sub2apiGroupId, 'gpt-5.1', global)).error).toBe('busy')
  expect((await account.setModelLimitOverride('3' as Sub2apiGroupId, 'gpt-5.1', null)).modelLimitOverrides).toEqual({})
  expect(await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'gpt-5.1')).toMatchObject({
    context: { contextWindow: global.contextWindow }, defaultMaxTokens: global.maxOutputTokens,
  })
})

it('persists a custom allocation and restores it when the account provider reloads', async () => {
  const f = await accountFixture()
  await f.account.signInWithPassword('user@example.com', 'password')
  const limits = { contextWindow: 1048576, maxInputTokens: 983040, maxOutputTokens: 65536 }
  expect((await f.account.setModelLimits(limits)).modelLimits).toEqual(limits)
  const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
  await entry.update({ disabled: true })
  await entry.update({ disabled: false })
  expect((await f.context.sub2apiAccount.getState()).modelLimits).toEqual(limits)
  expect(await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'relay-model')).toMatchObject({
    context: { contextWindow: 1048576 }, defaultMaxTokens: 65536,
  })
})

it('keeps the last allocation after an invalid edit and applies a smaller input budget', async () => {
  const f = await accountFixture()
  const before = await f.account.signInWithPassword('user@example.com', 'password')
  const invalid = await f.account.setModelLimits({ contextWindow: 262144, maxInputTokens: 262144, maxOutputTokens: 32768 })
  expect(invalid.error).toBe('model-limits')
  expect(invalid.modelLimits).toEqual(before.modelLimits)
  const changed = await f.account.setModelLimits({ contextWindow: 262144, maxInputTokens: 131072, maxOutputTokens: 32768 })
  expect(changed.error).toBeNull()
  expect(await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'relay-model')).toMatchObject({
    context: { contextWindow: 163840 }, defaultMaxTokens: 32768,
  })
})
