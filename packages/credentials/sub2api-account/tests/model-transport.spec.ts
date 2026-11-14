/** Per-model Responses preferences persist through the real account Loader and choose the wire transport. */
import { expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ModelTransport, Sub2apiGroupId } from '../src/types.ts'
import { accountFixture } from './account-fixture.ts'

const group = '3' as Sub2apiGroupId
const otherGroup = '8' as Sub2apiGroupId

async function stream(f: Awaited<ReturnType<typeof accountFixture>>, model = 'gpt-5.1') {
  const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model })
  const chunks = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'Say hello.' }],
  })] })) chunks.push(chunk)
  expect(chunks.find(chunk => chunk.type === 'finish')).not.toMatchObject({ reason: { kind: 'error' } })
  expect(JSON.stringify(chunks)).toContain('Platform model connected.')
}

it('defaults to SSE and sends only the selected model over WebSocket until switched back', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1', 'gpt-5.2'], webSocket: true })
  const state = await f.account.signInWithPassword('user@example.com', 'password')
  expect(state.modelProtocols.map(value => value.transport)).toEqual(['sse', 'sse'])
  await stream(f)
  expect(f.wsRequests).toHaveLength(0)
  expect(f.requests.filter(value => value.path === '/v1/responses')).toHaveLength(1)
  expect((await f.account.setModelTransport(group, 'gpt-5.1', 'websocket')).error).toBeNull()
  await stream(f)
  expect(f.wsRequests).toHaveLength(1)
  expect(f.wsRequests[0]).toMatchObject({ model: 'gpt-5.1', type: 'response.create' })
  await stream(f, 'gpt-5.2')
  expect(f.wsRequests).toHaveLength(1)
  expect((await f.account.setModelTransport(group, 'gpt-5.1', 'sse')).error).toBeNull()
  await stream(f)
  expect(f.wsRequests).toHaveLength(1)
  expect(f.requests.filter(value => value.path === '/v1/responses')).toHaveLength(4)
})

it('restores the saved transport after refresh, group and protocol changes, and Host reload', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'], groups: [
    { id: 3, name: 'First', platform: 'openai' }, { id: 8, name: 'Second', platform: 'openai' },
  ] })
  await f.account.signInWithPassword('user@example.com', 'password')
  const saved = await f.account.setModelTransport(group, 'gpt-5.1', 'websocket')
  expect((await f.account.refresh()).modelProtocols).toEqual(saved.modelProtocols)
  expect((await f.account.selectGroup(otherGroup)).modelProtocols[0]?.transport).toBe('sse')
  expect((await f.account.selectGroup(group)).modelProtocols).toEqual(saved.modelProtocols)
  expect((await f.account.setModelProtocol(group, 'gpt-5.1', 'openai-completions')).modelProtocols[0]?.transport).toBeNull()
  expect((await f.account.setModelProtocol(group, 'gpt-5.1', 'auto')).modelProtocols).toEqual(saved.modelProtocols)
  const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
  await entry.update({ disabled: true })
  await entry.update({ disabled: false })
  expect((await f.context.sub2apiAccount.getState()).modelProtocols).toEqual(saved.modelProtocols)
  await f.context.sub2apiAccount.signOut()
  expect((await f.context.sub2apiAccount.signInWithPassword('user@example.com', 'password')).modelProtocols[0]?.transport).toBe('sse')
})

it('honors an explicit deployment WS default while allowing a model to select SSE', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'], responsesTransport: 'auto', webSocket: true })
  expect((await f.account.signInWithPassword('user@example.com', 'password')).modelProtocols[0]?.transport).toBe('websocket')
  await f.account.setModelTransport(group, 'gpt-5.1', 'sse')
  await stream(f)
  expect(f.wsRequests).toHaveLength(0)
})

it('rejects stale groups, unknown models, unsupported protocols and invalid transport values', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1', 'claude-sonnet-4-6'] })
  expect((await f.account.setModelTransport(group, 'gpt-5.1', 'websocket')).error).toBe('authorization')
  await f.account.signInWithPassword('user@example.com', 'password')
  expect((await f.account.setModelTransport(otherGroup, 'gpt-5.1', 'websocket')).error).toBe('busy')
  expect((await f.account.setModelTransport(group, 'missing', 'websocket')).error).toBe('busy')
  expect((await f.account.setModelTransport(group, 'claude-sonnet-4-6', 'websocket')).error).toBe('validation')
  expect((await f.account.setModelTransport(group, 'gpt-5.1', 'invalid' as ModelTransport)).error).toBe('protocol')
  expect((await f.account.getState()).modelProtocols[0]?.transport).toBe('sse')
})

it('retains SSE when saving the WebSocket choice fails', async () => {
  const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'], webSocket: true })
  await f.account.signInWithPassword('user@example.com', 'password')
  const write = vi.spyOn(f.context.credentials, 'modifyRecord').mockRejectedValueOnce(new Error('storage unavailable'))
  try {
    const result = await f.account.setModelTransport(group, 'gpt-5.1', 'websocket')
    expect(result.error).toBe('storage')
    expect(result.modelProtocols[0]?.transport).toBe('sse')
  } finally { write.mockRestore() }
  await stream(f)
  expect(f.wsRequests).toHaveLength(0)
})
