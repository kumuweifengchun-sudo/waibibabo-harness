// @vitest-environment jsdom
/** Account forms preserve secrets locally and require an explicit login action. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import { AccountContent, AccountGate, type ClientAccountState } from '../src/client/AccountSection.tsx'
import { zh } from '../src/client/locales.ts'
import { initialUsageState } from '../src/client/usage-state.ts'
import type { AccountView, Sub2apiGroupId, Sub2apiUserId } from '../src/types.ts'

afterEach(cleanup)
const initial: AccountView = {
  productName: '歪比巴卜', platformOrigin: 'https://www.waibibabo.com', status: 'signed-out',
  authorizationUrl: null, profile: null, groups: [], selectedGroup: null, models: [], modelProtocols: [],
  modelLimitOverrides: {}, balanceStale: false,
  modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 }, usage: null, error: null,
}

function account(view: Partial<AccountView> = {}, language = zh, gate = false) {
  const store = createSnapshotStore<ClientAccountState>({ view: { ...initial, ...view },
    busy: false, failed: false, loginVisible: true, usageVisible: false })
  const actions = { signIn: vi.fn(), start: vi.fn(), verify: vi.fn(), cancel: vi.fn(),
    refresh: vi.fn(), signOut: vi.fn(), selectGroup: vi.fn(), setAccountOrigin: vi.fn(),
    showLogin: vi.fn(), showUsage: vi.fn(), loadUsage: vi.fn(),
    setProtocol: vi.fn(), setModelLimitOverride: vi.fn(), setModelLimits: vi.fn() }
  const props = { ...actions, useAccount: bindSnapshotSelector(store),
    useUsage: bindSnapshotSelector(createSnapshotStore(initialUsageState(new Date(2026, 10, 12)))),
    renderFactorySlot: vi.fn(), useFactorySlot: vi.fn(),
    renderSlot: () => <img src="/product-logo.png" alt="" />,
    t: (key: string) => Object.hasOwn(language, key) ? language[key as keyof typeof language] : key,
  } as ComponentProps<typeof AccountContent>
  render(gate
    ? <AccountGate {...props} renderFactorySlot={() => <AccountContent {...props} />} /> : <AccountContent {...props} />)
  return actions
}

describe('platform account UI', () => {
  it('offers automatic and manual account routing before sign-in', () => {
    const actions = account({ connection: { origins: [initial.platformOrigin, 'https://sub.example'], selected: null, active: initial.platformOrigin } })
    const select = screen.getByRole('combobox', { name: zh.accountLine })
    expect(select).toHaveProperty('value', '')
    fireEvent.change(select, { target: { value: 'https://sub.example' } })
    fireEvent.click(screen.getByRole('button', { name: zh.gatewayApply }))
    expect(actions.setAccountOrigin).toHaveBeenCalledWith('https://sub.example')
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: zh.lineDetect }))
    expect(actions.setAccountOrigin).toHaveBeenLastCalledWith(null)
    expect(screen.getByLabelText(zh.email)).toBeTruthy()
  })

  it('keeps account actions available when only usage statistics are unavailable', () => {
    account({ status: 'signed-in', usageError: 'server', profile: { id: '7' as Sub2apiUserId,
      name: 'user@example.com', email: 'user@example.com', balance: 123.45 } })
    expect(screen.getByText(zh.usageSummaryUnavailable)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.refresh })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: zh.signOut })).toHaveProperty('disabled', false)
  })

  it.each([['timeout', 'connectionTimeout'], ['server', 'serverUnavailable']] as const)('shows the specific %s login failure and permits retry', (error, key) => {
    account({ error })
    expect(screen.getByRole('alert').textContent).toBe(zh[key])
    expect(screen.getByRole('button', { name: zh.browserSignIn })).toHaveProperty('disabled', false)
  })

  it('keeps account actions without the duplicate usage button or model controls', () => {
    const actions = account({ status: 'signed-in', selectedGroup: '3' as Sub2apiGroupId, models: ['gpt-5.1'],
      modelProtocols: [{ model: 'gpt-5.1', choice: 'auto', effective: 'openai-responses' }] })
    expect(screen.queryByLabelText('gpt-5.1 · ' + zh.modelProtocol)).toBeNull()
    expect(screen.queryByLabelText(zh.group)).toBeNull()
    expect(screen.queryByRole('button', { name: zh.usageTitle })).toBeNull()
    expect(screen.getByRole('link', { name: zh.billingWebRecharge })).toHaveProperty('href', initial.platformOrigin + '/purchase')
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    expect(actions.refresh).toHaveBeenCalledOnce()
  })
  it('shows the brand mark and avoids repeating an email used as the display name', () => {
    account({ status: 'signed-in', profile: { id: '7' as Sub2apiUserId,
      name: 'user@example.com', email: 'user@example.com', balance: 95957.2563 },
    usage: { todayRequests: 939, todayCost: 18.4766, totalRequests: 1000, totalCost: 3257.9524 } })
    expect(document.querySelector('img[src="/product-logo.png"]')).toBeTruthy()
    expect(screen.getAllByText('user@example.com')).toHaveLength(1)
    expect(screen.getByText(zh.balance).parentElement?.textContent).toBe(zh.balance + '95,957.26')
    expect(screen.getByText(zh.todayCost).parentElement?.textContent).toBe(zh.todayCost + '18.48')
    expect(screen.getByText(zh.totalCost).parentElement?.textContent).toBe(zh.totalCost + '3,257.95')
    expect(screen.getByRole('navigation', { name: zh.accountActions })).toBeTruthy()
  })
  it('closes account sign-in after authentication even before model setup', () => {
    account({ status: 'signed-in' }, zh, true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText(zh.password)).toBeNull()
    cleanup()
    account({ status: 'signed-in', models: ['relay-model'] }, zh, true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('submits credentials only on request and clears the password input', () => {
    const actions = account()
    expect(actions.signIn).not.toHaveBeenCalled()
    expect(actions.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(zh.email), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(zh.password), { target: { value: 'one-use-password' } })
    fireEvent.click(screen.getByRole('button', { name: zh.passwordSignIn }))
    expect(actions.signIn).toHaveBeenCalledWith('user@example.com', 'one-use-password')
    expect(screen.getByLabelText(zh.password)).toHaveProperty('value', '')
    expect(document.body.textContent).not.toContain('one-use-password')
  })

  it('shows the active authorization link and cancellation while password submission is disabled', () => {
    const authorizationUrl = initial.platformOrigin + '/oauth/desktop/authorize?state=opaque'
    const actions = account({ status: 'signing-in', authorizationUrl })
    expect(screen.getByRole('link', { name: zh.openBrowser })).toHaveProperty('href', authorizationUrl)
    expect(screen.getByRole('button', { name: zh.passwordSignIn })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    expect(actions.cancel).toHaveBeenCalledOnce()
  })

  it('localizes CAPTCHA recovery and does not display unavailable balances as zero', () => {
    const actions = account({ error: 'captcha' }, zh)
    expect(screen.getByRole('alert').textContent).toBe(zh.captcha)
    fireEvent.click(screen.getByRole('button', { name: zh.browserSignIn }))
    expect(actions.start).toHaveBeenCalledOnce()
    cleanup()
    account({ status: 'signed-in' })
    expect(screen.getByText(zh.balance).parentElement?.textContent).toBe(zh.balance + '—')
    expect(screen.queryByLabelText(zh.password)).toBeNull()
  })
})
