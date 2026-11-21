// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv({ initialResize: true })

it('renders the product name and supplied artwork through the assembled client modules', async () => {
  mountAssembledApp({ bundleDirectories: ['packages/bundle/waibibabo'], exclude: ['@deepseek-ai/dsh-sub2api-account'] })
  expect(await screen.findByText('Waibibabo Harnesss', {}, { timeout: 10000 })).toBeTruthy()
  expect(screen.getByText('WSS')).toBeTruthy()
  expect(screen.getAllByText('0.1.1')).toHaveLength(2)
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
  vi.stubGlobal('__DSH_MODELS_ONBOARDING__', { credentialOnboarding: false, showProviderSettings: false })
  const remote = mountAssembledApp({ bundleDirectories: ['packages/bundle/waibibabo'] })
  const view = { productName: 'Waibibabo Harnesss', platformOrigin: 'https://platform.example', status: 'signed-in',
    connection: { origins: ['https://platform.example'], selected: null, active: 'https://platform.example' },
    authorizationUrl: null, profile: { id: '7', email: 'user@example.com', name: '测试账号', balance: 10 },
    groups: [{ id: '3', name: '测试分组', platform: 'openai', imageGeneration: true }], selectedGroup: '3',
    models: ['gpt-5.1'], modelLimitOverrides: {}, balanceStale: false, imageUploadLimits: { maxCount: 16, maxBytes: 20 * 1024 * 1024 },
    modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 },
    modelProtocols: [{ model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses', transport: 'sse' }], usage: null, error: null }
  remote.mock.unary('sub2apiAccount/getState', () => ok(view))
  const setting = { schema: { type: 'object' }, autoGenerate: false, applies: 'live', revision: 0, secrets: [] }
  remote.mock.unary('settings/describe', () => ok({ writable: true, hasDocument: true, namespaces: [
    { ...setting, ns: 'ui-settings', value: { enabled: true } },
    { ...setting, ns: 'permission', value: { defaultPreset: 'danger-full-access' } },
  ] }))
  remote.mock.unary('permissionPresets/catalog', () => ok({ options: [], defaultPreset: 'danger-full-access',
    defaultOptions: [{ value: 'danger-full-access', name: 'Full access' }] }))
  const setTransport = vi.fn(() => ok({ ...view, modelProtocols: [
    { model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses', transport: 'websocket' },
  ] }))
  remote.mock.unary('sub2apiAccount/setModelTransport', setTransport)
  remote.mock.stream('sub2apiAccount/watch', (_args, stream) => { stream.push(view) })
  remote.mock.unary('sub2apiAccount/getGateways', () => ok({ ok: true, data: { selected: null, active: 'https://platform.example', endpoints: [
    { id: 'https://platform.example', origin: 'https://platform.example', name: '主站', description: '', insecure: false },
  ] } }))
  remote.mock.unary('sub2apiAccount/getCheckout', () => ok({ ok: true, data: {
    enabled: true, balanceDisabled: false, plans: [], balanceMultiplier: 1, subscriptionExchangeRate: 0,
    bonusMode: 'bonus', bonusTiers: [], notice: '', help: '',
    methods: [{ id: 'alipay', name: '支付宝', currency: 'CNY', minimum: 1, maximum: 5000, feeRate: 0, available: true }],
  } }))
  const createOrder = vi.fn(() => ok({ ok: true, data: { id: '237', amount: 10, payAmount: 10, currency: 'CNY',
    expiresAt: '2099-01-01T09:00:00Z', qrCode: 'data:image/png;base64,aGVsbG8=', paymentUrl: null } }))
  remote.mock.unary('sub2apiAccount/createOrder', createOrder)
  remote.mock.unary('sub2apiAccount/getSubscriptions', () => ok({ ok: true, data: [] }))
  remote.mock.unary('sub2apiAccount/getOrders', () => ok({ ok: true, data: { items: [], total: 0, page: 1, pageSize: 20 } }))
  remote.mock.unary('sub2apiAccount/getInvoices', () => ok({ ok: true, data: { items: [], total: 0 } }))
  remote.mock.unary('sub2apiAccount/getUsage', () => ok({ ok: true, data: {
    items: [], page: 1, pageSize: 20, total: 0, totalPages: 1, requests: 0, tokens: 0, cost: 0,
  } }))
  remote.mock.unary('sub2apiAccount/getImageModels', () => ok({ ok: true, data: ['gpt-image-2'] }))
  remote.mock.unary('llm/listProviders', () => ok([]))
  const listConfigurableProviders = vi.fn(() => ok([]))
  remote.mock.unary('llm/listConfigurableProviders', listConfigurableProviders)

  fireEvent.click(await screen.findByRole('button', { name: '生图' }, { timeout: 10000 }))
  expect(await screen.findByRole('heading', { name: '生图' })).toBeTruthy()
  expect(screen.getByRole('form', { name: '生成设置' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '生成结果' })).toBeTruthy()
  expect(screen.getByText('等待生成图片')).toBeTruthy()
  expect(screen.getByLabelText('图片模型')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '测试账号 · 10.00 额度' }))
  expect(await screen.findByRole('button', { name: '平台账号' })).toBeTruthy()
  const accountPage = screen.getByRole('region', { name: '平台账号' })
  expect(accountPage.querySelector('img[src*="dsh-waibibabo/assets/colorful-"]')).toBeTruthy()
  await expect(`${accountPage.textContent}\n`).toMatchFileSnapshot('./expected/waibibabo-account-overview.txt')
  for (const [section, glyph] of [
    ['平台账号', 'user-outline'], ['使用日志', 'clock-outline'], ['充值与订阅', 'layers-outline'], ['发票申请', 'list-pen-outline'],
  ] as const) {
    expect(screen.getByRole('button', { name: section }).querySelector('svg')?.getAttribute('data-icon')).toBe(`dsw-icon-${glyph}-medium`)
  }
  fireEvent.click(within(accountPage).getByRole('button', { name: '充值或购买套餐' }))
  expect(await screen.findByRole('heading', { name: '充值与订阅' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '平台账号' }))
  expect(within(screen.getByRole('region', { name: '平台账号' })).queryByRole('button', { name: '使用日志' })).toBeNull()
  expect(screen.getByRole('button', { name: '使用日志' })).toBeTruthy()
  expect(screen.queryByLabelText('gpt-5.1 · 请求协议')).toBeNull()
  expect(screen.getByRole('combobox', { name: '账号线路' })).toHaveProperty('value', '')
  fireEvent.click(screen.getByRole('button', { name: '使用日志' }))
  expect(await screen.findByRole('region', { name: '用量汇总' })).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '请求明细' })).getByText('当前条件下没有使用记录')).toBeTruthy()
  const directoryQueries = listConfigurableProviders.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '模型' }))
  const settings = within(screen.getByRole('dialog', { name: '设置' }))
  expect(await settings.findByRole('heading', { name: '平台模型' })).toBeTruthy()
  expect(settings.queryByRole('heading', { name: '模型' })).toBeNull()
  expect(settings.queryByRole('button', { name: '添加模型提供商' })).toBeNull()
  expect(settings.queryByText('DeepSeek')).toBeNull()
  expect(settings.queryByText('填入各提供商的 API 密钥即可使用其模型。')).toBeNull()
  expect(settings.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual([
    '模型分组', '默认模型容量', '单独配置模型容量', '模型线路',
  ])
  const gateway = await settings.findByRole('combobox', { name: '模型线路' })
  expect(within(gateway).getByRole('option', { selected: true }).textContent).toBe('主站 · https://platform.example（自动）')
  expect(gateway.parentElement).toBe(settings.getByRole('button', { name: '应用并重新检测' }).parentElement)
  expect(settings.queryByText(/^当前连接/u)).toBeNull()
  expect(listConfigurableProviders.mock.calls).toHaveLength(directoryQueries)
  const transport = screen.getByLabelText('gpt-5.1 · 传输方式')
  expect(transport).toHaveProperty('value', 'sse')
  fireEvent.change(transport, { target: { value: 'websocket' } })
  await waitFor(() => { expect(transport).toHaveProperty('value', 'websocket') })
  expect(setTransport).toHaveBeenCalledWith({ groupId: '3', model: 'gpt-5.1', transport: 'websocket' })
  fireEvent.click(screen.getByRole('button', { name: '充值与订阅' }))
  const amount = await settings.findByLabelText('充值金额（CNY）')
  fireEvent.change(amount, { target: { value: '10' } })
  const checkoutButton = settings.getByRole('button', { name: '创建充值订单' })
  checkoutButton.focus()
  fireEvent.click(checkoutButton)
  const payment = await screen.findByRole('dialog', { name: '订单详情 #237' })
  expect(within(payment).getByRole('img', { name: '使用对应的支付软件扫码付款' })).toBeTruthy()
  expect(within(payment).getByRole('button', { name: '取消订单' })).toBeTruthy()
  expect(settings.queryByRole('dialog', { name: '订单详情 #237' })).toBeNull()
  fireEvent.keyDown(payment, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '订单详情 #237' })).toBeNull()
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
  expect(document.activeElement).toBe(checkoutButton)
  expect(amount).toHaveProperty('value', '10')
  expect(createOrder).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '发票申请' }))
  expect(await screen.findByRole('button', { name: '申请发票' })).toBeTruthy()
  fireEvent.click(settings.getByRole('button', { name: '通用设置' }))
  const hints = [
    ['权限', '选择新会话的默认权限模式'], ['字号大小', '仅影响会话内容的字号'],
    ['工作步骤展示', '选择希望看到多少工具调用细节'], ['工作步骤收起时机', '选择何时自动收起工作步骤'],
    ['收起后显示的回复', '工作步骤收起后，保留哪些助手回复'], ['显示代码工作视图', '开启后，显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换'],
    ['快捷键', '查看和编辑当前可用的快捷键和输入操作'],
  ] as const
  for (const [topic, text] of hints) {
    expect(await settings.findByRole('button', { name: topic + '说明' })).toBeTruthy()
    expect(settings.queryByText(text)).toBeNull()
  }
  const help = settings.getByRole('button', { name: '字号大小说明' })
  fireEvent.pointerOver(help)
  const tip = await screen.findByRole('tooltip')
  expect(tip.textContent).toBe('仅影响会话内容的字号')
  expect(help.getAttribute('aria-describedby')).toBe(tip.id)
  fireEvent.pointerOut(help)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.keyDown(help, { key: 'Tab' })
  fireEvent.focus(help)
  expect(screen.getByRole('tooltip').textContent).toBe('仅影响会话内容的字号')
  fireEvent.blur(help)
  fireEvent.click(help)
  expect(screen.getByRole('tooltip').getAttribute('data-pinned')).not.toBeNull()
  fireEvent.keyDown(help, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(settings.getByRole('button', { name: '平台账号' }))
  const signOut = settings.getByRole('button', { name: '退出登录' })
  signOut.focus()
  fireEvent.click(signOut)
  const confirm = within(await screen.findByRole('dialog', { name: '退出当前账号？' }))
  expect(document.activeElement).toBe(confirm.getByRole('button', { name: '取消' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '退出当前账号？' })).toBeNull()
  expect(document.activeElement).toBe(signOut)
  expect(remote.mock.log.calls('sub2apiAccount/signOut')).toHaveLength(0)
}, 20000)

it('opens login from the sidebar and offers provider choices only for the signed-in account', async () => {
  vi.stubGlobal('__DSH_LOCALE__', { read: async () => ({ languages: ['zh-CN'], preference: 'zh', fixedLocale: 'zh' }),
    onChange: () => {} })
  const remote = mountAssembledApp({ bundleDirectories: ['packages/bundle/waibibabo'] })
  const view = { productName: 'Waibibabo Harnesss', platformOrigin: 'https://platform.example', status: 'signed-out',
    connection: { origins: ['https://platform.example'], selected: null, active: null },
    authorizationUrl: null, profile: null, groups: [], selectedGroup: null, models: [], modelProtocols: [],
    modelLimitOverrides: {}, balanceStale: false, imageUploadLimits: { maxCount: 16, maxBytes: 20 * 1024 * 1024 },
    modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 }, usage: null, error: null }
  remote.mock.unary('sub2apiAccount/getState', () => ok(view))
  remote.mock.stream('sub2apiAccount/watch', (_args, stream) => { stream.push(view) })
  const group = (id: string, name: string, model: string, label: string) => ({ id, name, models: [{ id: model, name: label }] })
  const catalog = [
    group('deepseek-official', 'DeepSeek', 'deepseek-v4-flash', 'DeepSeek-V4-Flash'),
    group('sub2api-u7-g3', 'WSS · 平台分组', 'deepseek-v4-flash', '平台 Flash'),
    group('sub2api-u9-g3', '旧账号', 'old-model', '旧账号模型'),
    group('local', '自建供应商', 'local-model', '自建模型'),
  ]
  remote.mock.unary('session/modelCatalog', () => ok({ default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    groups: catalog, routableProviders: catalog.map(provider => provider.id),
    failures: [{ id: 'deepseek-account', name: 'DeepSeek Account', message: 'unavailable' }] }))
  remote.mock.unary('sub2apiAccount/cancelSignIn', () => ok(view))
  remote.mock.unary('sub2apiAccount/signInWithPassword', () => ok({ ...view, status: 'signed-in',
    profile: { id: '7', name: '测试账号', email: 'user@example.com', balance: 10 }, selectedGroup: '3', models: ['deepseek-v4-flash'] }))
  const dialog = await screen.findByRole('dialog', { name: '平台账号' }, { timeout: 10000 })
  expect(dialog.querySelector('img[src*="dsh-waibibabo/assets/colorful-"]')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: '账号密码登录' })).toHaveProperty('disabled', true)
  expect(within(dialog).getByRole('button', { name: '浏览器一键授权' })).toHaveProperty('disabled', false)
  expect(within(dialog).getByRole('button', { name: '注册账号' })).toHaveProperty('disabled', false)
  expect(within(dialog).getByLabelText('邮箱')).toBeTruthy()
  expect(within(dialog).getByLabelText('密码')).toBeTruthy()
  expect(within(dialog).getByRole('combobox', { name: '账号线路' })).toHaveProperty('value', '')
  await expect(`${dialog.textContent}\n`).toMatchFileSnapshot('./expected/waibibabo-sign-in.txt')
  remote.mock.unary('sub2apiAccount/getRegistrationOptions', () => ok({ ok: true, data: {
    enabled: true, emailVerification: true, registrationCode: true, affiliate: true, promo: false,
    captcha: false, notice: '', agreements: [{ id: 'terms', title: '服务协议' }],
  } }))
  fireEvent.click(within(dialog).getByRole('button', { name: '注册账号' }))
  expect(await within(dialog).findByLabelText('注册码')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: '发送验证码' })).toBeTruthy()
  expect(within(dialog).getByRole('link', { name: '服务协议' })).toHaveProperty('href', 'https://platform.example/legal/terms')
  expect(within(dialog).queryByRole('link', { name: '注册账号' })).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: '返回登录' }))
  expect(within(dialog).getByLabelText('密码')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
  const launcher = screen.getByRole('button', { name: '点击登录 Waibibao Harness' })
  const loginText = launcher.textContent
  expect(loginText).toBe('点击登录 Waibibao Harness')
  expect(launcher.getAttribute('title')).toBe(loginText)
  fireEvent.click(await screen.findByLabelText('在“fixture”中新建会话', { selector: 'button' }))
  const picker = await screen.findByRole('button', { name: '请选择模型' })
  fireEvent.click(picker)
  const empty = await screen.findByText('暂无可用模型')
  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  fireEvent.keyDown(picker, { key: 'Escape' })
  fireEvent.click(launcher)
  const login = within(await screen.findByRole('dialog', { name: '平台账号' }))
  fireEvent.change(login.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
  fireEvent.change(login.getByLabelText('密码'), { target: { value: 'test-password' } })
  fireEvent.click(login.getByRole('button', { name: '账号密码登录' }))
  await screen.findByRole('button', { name: '测试账号 · 10.00 额度' })
  fireEvent.click(picker)
  await screen.findByRole('menuitemradio', { name: '平台 Flash' })
  const modelNames = screen.getAllByRole('menuitemradio').map(row => row.textContent)
  expect(modelNames).toEqual(['平台 Flash', '自建模型'])
  expect(screen.queryByText(/DeepSeek Account/u)).toBeNull()
  const platformGroup = screen.getByText('WSS · 平台分组')
  await expect([loginText, empty.textContent, platformGroup.textContent, ...modelNames, ''].join('\n'))
    .toMatchFileSnapshot('./expected/waibibabo-model-picker.txt')
  remote.mock.streams.push('sub2apiAccount/watch', view)
  await screen.findByRole('dialog', { name: '平台账号' })
  expect(screen.getByRole('button', { name: '点击登录 Waibibao Harness' })).toBeTruthy()
  expect(screen.queryByText('平台 Flash')).toBeNull()
  expect(screen.queryByText('自建模型')).toBeNull()
}, 20000)
