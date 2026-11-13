/** Protocol inference honors gateway declarations without replaying requests through another protocol. */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Sub2apiGroupId } from '../src/types.ts'
import { modelProtocol, protocolBaseURL } from '../src/model-protocol.ts'
import { accountFixture } from './account-fixture.ts'

describe('model protocol selection', () => {
  it.each([
    ['gpt-5.1', 'openai', 'openai-responses'], ['openai/o3', 'anthropic', 'openai-responses'],
    ['claude-sonnet-4-6', 'openai', 'anthropic-messages'], ['anthropic/claude-opus-4-6', 'openai', 'anthropic-messages'],
    ['deepseek/deepseek-v4-flash', 'openai', 'openai-completions'], ['grok-4', 'openai', 'openai-completions'],
    ['gemini-2.5-flash', 'openai', 'google-generative-ai'], ['custom-model', 'anthropic', 'anthropic-messages'],
  ])('selects the native protocol for %s in %s', (model, platform, protocol) => {
    expect(modelProtocol(model, platform, [], 'auto')).toBe(protocol)
  })

  it('uses advertised compatibility in auto mode and lets an explicit override take precedence', () => {
    expect(modelProtocol('gpt-5', 'openai', ['/chat/completions'], 'auto')).toBe('openai-completions')
    expect(modelProtocol('deepseek-v4', 'openai', ['/v1/responses', '/v1/chat/completions'], 'auto')).toBe('openai-completions')
    expect(modelProtocol('gpt-5', 'openai', ['/chat/completions'], 'anthropic-messages')).toBe('anthropic-messages')
    expect(protocolBaseURL('https://platform.example', 'google-generative-ai')).toBe('https://platform.example/v1beta')
  })

  it.each([
    ['gpt-5.1', '/v1/responses'], ['claude-sonnet-4-6', '/v1/messages'],
    ['deepseek-chat', '/v1/chat/completions'], ['gemini-2.5-flash', '/v1beta/models/gemini-2.5-flash:streamGenerateContent'],
  ])('streams %s through its selected endpoint %s', async (model, path) => {
    const f = await accountFixture({ protocol: 'auto', models: [model] })
    const state = await f.account.signInWithPassword('user@example.com', 'password')
    expect(state.error).toBeNull()
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model })
    const chunks = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Say hello.' }],
    })] })) chunks.push(chunk)
    expect(JSON.stringify(chunks)).toContain('Platform model connected.')
    expect(chunks.find(chunk => chunk.type === 'finish')).not.toMatchObject({ reason: { kind: 'error' } })
    const request = f.requests.find(value => value.path === path)
    expect(request).toBeDefined()
    expect([request?.authorization, request?.apiKey, request?.googleKey])
      .toContain(path === '/v1/responses' || path === '/v1/chat/completions' ? 'Bearer short-inference-key' : 'short-inference-key')
  })

  it('persists a model override across reload and restores automatic selection on removal', async () => {
    const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1', 'claude-sonnet-4-6'] })
    await f.account.signInWithPassword('user@example.com', 'password')
    const selected = await f.account.setModelProtocol('3' as Sub2apiGroupId, 'gpt-5.1', 'openai-completions')
    expect(selected.modelProtocols).toContainEqual({ model: 'gpt-5.1', choice: 'openai-completions', effective: 'openai-completions' })
    expect(selected.modelProtocols).toContainEqual({ model: 'claude-sonnet-4-6', choice: 'auto', effective: 'anthropic-messages' })
    const entry = [...f.context.loader.entries()].find(value => value.options.id === 'account')!
    await entry.update({ disabled: true })
    await entry.update({ disabled: false })
    const restored = await f.context.sub2apiAccount.getState()
    expect(restored.modelProtocols).toEqual(selected.modelProtocols)
    const automatic = await f.context.sub2apiAccount.setModelProtocol('3' as Sub2apiGroupId, 'gpt-5.1', 'auto')
    expect(automatic.modelProtocols).toContainEqual({ model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses' })
    expect((await f.context.sub2apiAccount.setModelProtocol('8' as Sub2apiGroupId, 'gpt-5.1', 'openai-completions')).error).toBe('busy')
  })
})
