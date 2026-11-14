// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('renders the product name and supplied artwork through the assembled client modules', async () => {
  mountAssembledApp({ bundleDirectories: ['packages/bundle/waibibabo'], exclude: ['@deepseek-ai/dsh-sub2api-account'] })
  expect(await screen.findByText('Waibibabo Harnesss', {}, { timeout: 10000 })).toBeTruthy()
  expect(screen.getByText('WSS')).toBeTruthy()
  expect(screen.getAllByText('0.1.0')).toHaveLength(2)
  expect(document.querySelectorAll('img[src*="dsh-waibibabo/assets/colorful-"]').length).toBeGreaterThanOrEqual(2)
  expect(screen.queryByText('DSH 本地构建')).toBeNull()
  expect(screen.queryByText('探索未至之境')).toBeNull()
  expect(screen.queryByText('Into the Unknown')).toBeNull()
  expect(screen.queryByText('Preview')).toBeNull()
  expect(screen.queryByText('预览版')).toBeNull()
  await expect(`${[...document.querySelectorAll('[title="Waibibabo Harnesss"]')].map(node => node.textContent).join('\n')}\n`)
    .toMatchFileSnapshot('./expected/waibibabo-brand.txt')
}, 20000)

it('mounts the native platform pages through the shipped client registrations', async () => {
  vi.stubGlobal('__DSH_LOCALE__', { read: async () => ({ languages: ['en-US'], preference: 'en', fixedLocale: 'zh' }),
    onChange: () => {} })
  const remote = mountAssembledApp({ bundleDirectories: ['packages/bundle/waibibabo'] })
  const view = { productName: 'Waibibabo Harnesss', platformOrigin: 'https://platform.example', status: 'signed-in',
    connection: { origins: ['https://platform.example'], selected: null, active: 'https://platform.example' },
    authorizationUrl: null, profile: { id: '7', email: 'user@example.com', name: '测试账号', balance: 10 },
    groups: [{ id: '3', name: '测试分组', platform: 'openai', imageGeneration: true }], selectedGroup: '3',
    models: ['gpt-5.1'], modelLimitOverrides: {}, balanceStale: false, imageUploadLimits: { maxCount: 16, maxBytes: 20 * 1024 * 1024 },
    modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 },
    modelProtocols: [{ model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses', transport: 'sse' }], usage: null, error: null }
  remote.mock.unary('sub2apiAccount/getState', () => ok(view))
  const setTransport = vi.fn(() => ok({ ...view, modelProtocols: [
    { model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses', transport: 'websocket' },
  ] }))
  remote.mock.unary('sub2apiAccount/setModelTransport', setTransport)
  remote.mock.stream('sub2apiAccount/watch', (_args, stream) => { stream.push(view) })
  remote.mock.unary('sub2apiAccount/getGateways', () => ok({ ok: true, data: { selected: null, active: 'https://platform.example', endpoints: [
    { id: 'https://platform.example', origin: 'https://platform.example', name: '主站', description: '', insecure: false },
  ] } }))
  remote.mock.unary('sub2apiAccount/getCheckout', () => ok({ ok: false, error: 'unavailable' }))
  remote.mock.unary('sub2apiAccount/getSubscriptions', () => ok({ ok: true, data: [] }))
  remote.mock.unary('sub2apiAccount/getOrders', () => ok({ ok: true, data: { items: [], total: 0, page: 1, pageSize: 20 } }))
  remote.mock.unary('sub2apiAccount/getInvoices', () => ok({ ok: true, data: { items: [], total: 0 } }))
  remote.mock.unary('sub2apiAccount/getImageModels', () => ok({ ok: true, data: ['gpt-image-2'] }))
  remote.mock.unary('llm/listProviders', () => ok([]))
  remote.mock.unary('llm/listConfigurableProviders', () => ok([]))

  fireEvent.click(await screen.findByRole('button', { name: '生图' }, { timeout: 10000 }))
  expect(await screen.findByRole('heading', { name: '生图' })).toBeTruthy()
  expect(screen.getByRole('form', { name: '生成设置' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '生成结果' })).toBeTruthy()
  expect(screen.getByText('等待生成图片')).toBeTruthy()
  expect(screen.getByLabelText('图片模型')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '测试账号 · 10.00 额度' }))
  expect(await screen.findByRole('button', { name: '平台账号' })).toBeTruthy()
  const accountPage = screen.getByRole('navigation', { name: '账号服务' }).closest('section') ?? screen.getByRole('navigation', { name: '账号服务' }).parentElement!
  expect(accountPage.querySelector('img[src*="dsh-waibibabo/assets/colorful-"]')).toBeTruthy()
  expect(within(accountPage).queryByRole('button', { name: '使用日志' })).toBeNull()
  expect(screen.getByRole('button', { name: '使用日志' })).toBeTruthy()
  expect(screen.queryByLabelText('gpt-5.1 · 请求协议')).toBeNull()
  expect(screen.getByLabelText('账号线路')).toHaveProperty('value', '')
  fireEvent.click(screen.getByRole('button', { name: '模型' }))
  expect(await screen.findByRole('heading', { name: '平台模型' })).toBeTruthy()
  expect(await screen.findByLabelText('模型线路')).toHaveProperty('value', '')
  const transport = screen.getByLabelText('gpt-5.1 · 传输方式')
  expect(transport).toHaveProperty('value', 'sse')
  fireEvent.change(transport, { target: { value: 'websocket' } })
  await waitFor(() => { expect(transport).toHaveProperty('value', 'websocket') })
  expect(setTransport).toHaveBeenCalledWith({ groupId: '3', model: 'gpt-5.1', transport: 'websocket' })
  fireEvent.click(screen.getByRole('button', { name: '充值与订阅' }))
  expect(await screen.findByRole('heading', { name: '充值与订阅' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '发票申请' }))
  expect(await screen.findByRole('button', { name: '申请发票' })).toBeTruthy()
}, 20000)

it('shows the supplied logo and both sign-in methods in the assembled login dialog', async () => {
  const remote = mountAssembledApp({ bundleDirectories: ['packages/bundle/waibibabo'] })
  const view = { productName: 'Waibibabo Harnesss', platformOrigin: 'https://platform.example', status: 'signed-out',
    connection: { origins: ['https://platform.example'], selected: null, active: null },
    authorizationUrl: null, profile: null, groups: [], selectedGroup: null, models: [], modelProtocols: [],
    modelLimitOverrides: {}, balanceStale: false, imageUploadLimits: { maxCount: 16, maxBytes: 20 * 1024 * 1024 },
    modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 }, usage: null, error: null }
  remote.mock.unary('sub2apiAccount/getState', () => ok(view))
  remote.mock.stream('sub2apiAccount/watch', (_args, stream) => { stream.push(view) })
  const dialog = await screen.findByRole('dialog', { name: '登录平台账号' }, { timeout: 10000 })
  expect(dialog.querySelector('img[src*="dsh-waibibabo/assets/colorful-"]')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: '账号密码登录' })).toHaveProperty('disabled', true)
  expect(within(dialog).getByRole('button', { name: '浏览器一键授权' })).toHaveProperty('disabled', false)
  expect(within(dialog).getByLabelText('邮箱')).toBeTruthy()
  expect(within(dialog).getByLabelText('密码')).toBeTruthy()
  expect(within(dialog).getByLabelText('账号线路')).toHaveProperty('value', '')
}, 20000)
