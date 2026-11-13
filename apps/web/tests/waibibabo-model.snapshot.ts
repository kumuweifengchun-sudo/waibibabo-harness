/** Keyless platform login and model turn through the shipped Web profile and desktop layer. */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import { accountFixture } from '../../../packages/credentials/sub2api-account/tests/account-fixture.ts'
import { fixtureUserPrompts, launchWebScaffold, normalizeWebSessionVolatiles, rawSessionLog, recordFixture, webSnapshotMode } from './scaffold.ts'

const fixturePath = fileURLToPath(new URL('../../../snapshots/web/waibibabo-model/session.v4.jsonl', import.meta.url))
const mode = webSnapshotMode()

it('replays a group-authorized model reply without putting account credentials in the Session', async () => {
  const platform = await accountFixture({ protocol: 'auto', models: ['gpt-5.1'], webSocket: true, feature: (request, response) => {
    if (request.url !== '/api/v1/desktop/usage') return false
    response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 503 }))
    return true
  }, groups: [
    { id: 3, name: 'First group', platform: 'openai' }, { id: 8, name: 'Second group', platform: 'anthropic' },
  ] })
  const existing = existsSync(fixturePath) ? await readFile(fixturePath, 'utf8') : undefined
  if (existing === undefined && mode !== 'refresh') throw new Error('Refresh the authored waibibabo-model fixture before replay')
  const rows = existing?.trim().split('\n').map(line => JSON.parse(line) as {
    type: string
    data?: { message?: { content?: Array<{ type: string; text?: string }> } }
  })
  const recordedReply = rows?.find(row => row.type === 'assistant/message')?.data?.message?.content
    ?.filter(block => block.type === 'text').map(block => block.text).join('')
  if (existing !== undefined && !recordedReply) throw new Error('The platform fixture must contain a recorded model reply')
  const reply = recordedReply ?? '平台模型连接成功。'
  platform.setReply(reply)
  const bundle = fileURLToPath(new URL('../../../packages/bundle/waibibabo/', import.meta.url))
  const overlay = join(platform.home, 'product-test.yml')
  await writeFile(overlay, JSON.stringify([{ id: 'sub2api-account', config: {
    platformOrigin: platform.origin, accountOrigins: [], productName: 'Waibibabo Harnesss', allowLoopbackHttp: true,
  } }]) + '\n')
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [bundle + '/package.json'], extraOverlayPath: overlay,
    profile: { hmr: false, packages: [], bundles: ['@deepseek-ai/dsh-waibibabo'] },
  })
  try {
    const login = await scaffold.hostFetch('/api/sub2apiAccount/signInWithPassword', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'product-login', method: 'sub2apiAccount/signInWithPassword',
        payload: { args: { email: 'user@example.com', password: 'fixture-password' } } }),
    })
    expect(await login.json()).toMatchObject({ result: { ok: true, value: { status: 'signed-in', selectedGroup: '3', usageError: 'server',
      connection: { selected: null, active: platform.origin } } } })
    const gateways = await scaffold.hostFetch('/api/sub2apiAccount/getGateways', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'automatic-model-route', method: 'sub2apiAccount/getGateways',
        payload: { args: {} } }),
    })
    expect(await gateways.json()).toMatchObject({ result: { ok: true, value: { ok: true,
      data: { selected: null, active: platform.origin } } } })
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({ provider: 'sub2api-u7-g3', model: 'gpt-5.1' })
    expect((await scaffold.ctx.llm.resolveModelInfo('sub2api-u7-g3', 'gpt-5.1')).reasoning?.efforts.map(effort => effort.id)).toContain('high')
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('waibibabo-model'), meta: { cwd: scaffold.workspaceCwd },
      agentOptions: { provider: 'sub2api-u7-g3', model: 'gpt-5.1', reasoningEffort: ReasoningEffortId('high') },
    })
    try {
      const backendDirectory = join(scaffold.workspaceCwd, 'backend')
      await mkdir(backendDirectory)
      const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
      await workspace.attachSession(handle.agent.id)
      await scaffold.ctx.workspaceRegistry.update(workspace.id, 'Full stack', [scaffold.workspaceCwd, backendDirectory])
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text',
        text: existing === undefined ? '请回复：平台模型连接成功。' : fixtureUserPrompts(existing)[0] ?? '',
      }] }))
      await handle.agent.whenIdle()
      const accountRoute = await scaffold.hostFetch('/api/sub2apiAccount/setAccountOrigin', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'manual-account-route', method: 'sub2apiAccount/setAccountOrigin',
          payload: { args: { origin: platform.origin } } }),
      })
      expect(await accountRoute.json()).toMatchObject({ result: { ok: true, value: {
        connection: { selected: platform.origin, active: platform.origin } } } })
      const modelRoute = await scaffold.hostFetch('/api/sub2apiAccount/setGateway', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'manual-model-route', method: 'sub2apiAccount/setGateway',
          payload: { args: { id: platform.origin, allowInsecure: true } } }),
      })
      expect(await modelRoute.json()).toMatchObject({ result: { ok: true, value: { ok: true,
        data: { selected: platform.origin, active: platform.origin } } } })
      await scaffold.ctx.workspaceRegistry.update(workspace.id, 'Full stack', [backendDirectory])
      expect(scaffold.ctx.sandboxPolicy.resolve({ session: handle.agent.session })).toMatchObject({ workspaceRoot: backendDirectory })
      const limits = { contextWindow: 32768, maxInputTokens: 24576, maxOutputTokens: 8192 }
      const updated = await scaffold.hostFetch('/api/sub2apiAccount/setModelLimitOverride', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'model-allocation', method: 'sub2apiAccount/setModelLimitOverride',
          payload: { args: { groupId: '3', model: 'gpt-5.1', limits } } }),
      })
      expect(await updated.json()).toMatchObject({ result: { ok: true, value: { modelLimitOverrides: { 'gpt-5.1': limits } } } })
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text',
        text: existing === undefined ? '继续回复：平台模型连接成功。' : fixtureUserPrompts(existing)[1] ?? '继续回复：平台模型连接成功。',
      }] }))
      await handle.agent.whenIdle()
      const session = handle.agent.session
      const raw = rawSessionLog(session)
      expect(raw).toContain('Workspace folders (primary first)')
      expect(raw).toContain('backend')
      expect(raw).toContain(reply)
      expect(raw).toContain('Waibibabo Harnesss（WSS）')
      expect(raw).not.toContain('DeepSeek Harness')
      expect(raw).not.toMatch(/desktop-access|desktop-refresh|short-inference-key|fixture-password|browser-login/)
      expect(platform.requests.find(request => request.path === '/v1/responses')?.authorization).toBe('Bearer short-inference-key')
      expect(platform.requests.find(request => request.path === '/v1/responses')?.body.max_output_tokens).toBe(32768)
      expect(platform.requests.find(request => request.path === '/v1/responses')?.body.reasoning).toMatchObject({ effort: 'high' })
      expect(platform.requests.filter(request => request.path === '/v1/responses')[1]?.body.max_output_tokens).toBe(8192)
      expect(platform.wsRequests).toHaveLength(2)
      expect(platform.wsRequests.every(request => request.type === 'response.create' && request.stream === undefined)).toBe(true)
      const context = { sessionIds: [String(session.id)], cwd: scaffold.workspaceCwd }
      const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/u, '')
      const prompts = normalizedSystemPrompts(raw, context).map(value => value
        .split(sourceRoot).join('{{sourceRoot}}').split(scaffold.baseUrl).join('{{webUrl}}'))
      const schemas = normalizedToolSchemas(raw, context)
      const prompt = prompts[0]
      const tools = schemas[0]
      if (prompt === undefined || tools === undefined) throw new Error('The platform model turn must log its prompt and tool schemas')
      const sidecars = [
        ['system-prompt.expected.md', formatSystemPromptSnapshot(prompt, prompts.slice(1))],
        ['tool-schemas.expected.json', formatToolSchemasSnapshot(tools, schemas.slice(1))],
      ] as const
      for (const [name, content] of sidecars) {
        const path = join(fixturePath, '..', name)
        if (mode === 'refresh') await writeFile(path, content)
        expect(content).toBe(await readFile(path, 'utf8'))
      }
      if (mode === 'refresh') await recordFixture(scaffold, session.id, fixturePath)
      const expected = await readFile(fixturePath, 'utf8')
      const normalize = (log: string, id: string, cwd: string) => normalizeSessionSnapshots(
        [normalizeWebSessionVolatiles(log)], { sessionIds: [id], cwd },
      )[0]?.split(scaffold.harnessHome).join('{{harnessHome}}')
      const header = JSON.parse(expected.split('\n')[0] ?? '{}') as { id: string; cwd: string }
      expect(normalize(raw, String(session.id), scaffold.workspaceCwd)).toBe(normalize(expected, header.id, header.cwd))
    } finally { await handle.dispose() }
  } finally { await scaffold.close() }
}, 60000)
