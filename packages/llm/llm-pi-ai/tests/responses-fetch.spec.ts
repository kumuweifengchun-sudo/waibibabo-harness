/** Per-attempt transport failures survive SDK stringification without overriding cancellation. */
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmError } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'

async function harness(responsesFetch: NonNullable<ConstructorParameters<typeof PiAiAdapter>[0]['responsesFetch']>) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['openai'], new PiAiAdapter({
    profiles: () => resolveProfiles({ openai: { baseURL: 'https://example.invalid/v1' } }),
    resolveApiKey: () => Promise.resolve('fixture-key'), auth: memoryAuth(), responsesFetch,
  }))
  return ctx
}

it.each(['fetch', 'stream'] as const)('preserves typed %s failures separately for concurrent attempts', async (location) => {
  const failures = [new LlmError('Transport detail containing 401', 'TRANSPORT'), new LlmError('Unknown outcome', 'RESPONSES_OUTCOME_UNKNOWN')]
  let attempts = 0
  const ctx = await harness((_request, reportFailure) => {
    const failure = failures[attempts++]!
    return () => {
      reportFailure(failure)
      if (location === 'fetch') return Promise.reject(failure)
      return Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.error(failure) } }),
        { headers: { 'content-type': 'text/event-stream' } }))
    }
  })
  try {
    const results = await Promise.all(failures.map(() => assemble(ctx, { provider: 'openai', model: 'gpt-5.1', messages: [] })))
    expect(results.map(result => result.finish)).toEqual(failures.map(failure => ({
      kind: 'error', failure: { code: failure.code, message: failure.message },
    })))
    expect(attempts).toBe(2)
  } finally { await ctx.fiber.dispose() }
})

it('keeps caller cancellation ahead of a reported transport failure', async () => {
  const abort = new AbortController()
  const ctx = await harness((_request, reportFailure) => () => {
    const failure = new LlmError('Connection closed', 'TRANSPORT')
    reportFailure(failure)
    abort.abort()
    return Promise.reject(failure)
  })
  try {
    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-5.1', messages: [], signal: abort.signal })
    expect(result.finish).toMatchObject({ kind: 'aborted', failure: { code: 'ABORTED' } })
  } finally { await ctx.fiber.dispose() }
})
