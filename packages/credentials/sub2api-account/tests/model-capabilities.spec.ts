/** Reasoning selection reaches each gateway protocol through the registered account adapter. */
import { describe, expect, it } from 'vitest'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Sub2apiGroupId } from '../src/types.ts'
import { accountFixture } from './account-fixture.ts'

describe('platform reasoning capabilities', () => {
  it.each([
    { model: 'gpt-5.1', path: '/v1/responses', payload: { reasoning: { effort: 'high' } } },
    { model: 'openai/gpt-5.1', path: '/v1/responses', payload: { reasoning: { effort: 'high' } } },
    { model: 'claude-sonnet-4-6', path: '/v1/messages', payload: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } } },
    { model: 'deepseek-v4-flash', path: '/v1/chat/completions', payload: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } },
    { model: 'gemini-2.5-flash', path: '/v1beta/models/gemini-2.5-flash:streamGenerateContent',
      payload: { generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24576 } } } },
  ])('offers and sends high effort for $model', async ({ model, path, payload }) => {
    const f = await accountFixture({ protocol: 'auto', models: [model] })
    expect((await f.account.signInWithPassword('user@example.com', 'password')).error).toBeNull()
    const info = await f.context.llm.resolveModelInfo('sub2api-u7-g3', model)
    expect(info.reasoning?.efforts.map(effort => effort.id)).toContain('high')
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model, reasoningEffort: ReasoningEffortId('high') })
    const chunks = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello.' }],
    })] })) chunks.push(chunk)
    expect(chunks.find(chunk => chunk.type === 'finish')).not.toMatchObject({ reason: { kind: 'error' } })
    expect(f.requests.find(request => request.path === path)?.body).toMatchObject(payload)
    if (!path.startsWith('/v1beta/')) expect(f.requests.find(request => request.path === path)?.body.model).toBe(model)
  })

  it('sends off using the native DeepSeek switch and preserves reasoning after a protocol change', async () => {
    const f = await accountFixture({ protocol: 'auto', models: ['deepseek-v4-flash', 'gpt-5.1'] })
    await f.account.signInWithPassword('user@example.com', 'password')
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model: 'deepseek-v4-flash', reasoningEffort: ReasoningEffortId('off') })
    for await (const _chunk of prepared.stream({ ...prepared.config, messages: [] })) { /* Drain the finite fixture response. */ }
    expect(f.requests.find(request => request.path === '/v1/chat/completions')?.body).toMatchObject({ thinking: { type: 'disabled' } })
    await f.account.setModelProtocol('3' as Sub2apiGroupId, 'gpt-5.1', 'openai-completions')
    expect((await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'gpt-5.1')).reasoning?.efforts.map(effort => effort.id)).toContain('high')
  })

  it('uses advertised gateway levels for an alias and honors explicit capability removal', async () => {
    const f = await accountFixture({ protocol: 'auto', feature: (req, res) => {
      if (req.url !== '/v1/models') return false
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [
        { id: 'custom-reasoning', supportsReasoningEffort: true, reasoningEfforts: [{ value: 'low' }, { value: 'xhigh' }, { value: 'future-level' }] },
        { id: 'gpt-5.1', supportsReasoningEffort: false }, { id: 'unknown-model' }, { id: 'gpt-4o' },
      ] }))
      return true
    } })
    await f.account.signInWithPassword('user@example.com', 'password')
    expect((await f.context.llm.resolveModelInfo('sub2api-u7-g3', 'custom-reasoning')).reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'xhigh'])
    for (const model of ['gpt-5.1', 'unknown-model', 'gpt-4o']) {
      expect((await f.context.llm.resolveModelInfo('sub2api-u7-g3', model)).reasoning).toBeUndefined()
    }
    const prepared = await f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model: 'custom-reasoning', reasoningEffort: ReasoningEffortId('xhigh') })
    for await (const _chunk of prepared.stream({ ...prepared.config, messages: [] })) { /* Drain the finite fixture response. */ }
    expect(f.requests.find(request => request.path === '/v1/responses')?.body).toMatchObject({ reasoning: { effort: 'xhigh' } })
  })

  it('rejects an unavailable level before sending a model request', async () => {
    const f = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'] })
    await f.account.signInWithPassword('user@example.com', 'password')
    await expect(f.context.llm.prepareCall({ provider: 'sub2api-u7-g3', model: 'gpt-5.1', reasoningEffort: ReasoningEffortId('minimal') }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    expect(f.requests.some(request => request.path === '/v1/responses')).toBe(false)
  })
})
