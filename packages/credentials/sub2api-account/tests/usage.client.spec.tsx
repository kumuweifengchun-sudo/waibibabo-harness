// @vitest-environment jsdom
/** Usage filters, pagination, detail fields and failure retention in the shipped component. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { ClientAccountState } from '../src/client/AccountSection.tsx'
import { initialUsageState } from '../src/client/usage-state.ts'
import type { UsageState } from '../src/client/usage-state.ts'
import { zh } from '../src/client/locales.ts'
import type { Sub2apiGroupId, Sub2apiUsageId, Sub2apiUserId, UsageRecord } from '../src/types.ts'

afterEach(cleanup)
const record: UsageRecord = { id: '19' as Sub2apiUsageId, createdAt: '2026-11-12T08:00:00Z', model: 'gpt-5.1',
  requestId: 'request-19', group: 'Standard', apiKey: 'Desktop', endpoint: '/v1/responses',
  inputTokens: 100, outputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 20,
  inputCost: 0.1, outputCost: 0.2, cacheReadCost: 0.01, cacheWriteCost: 0.02,
  totalCost: 0.33, actualCost: 0.165, multiplier: 0.5, durationMs: 1500, firstTokenMs: 250,
  stream: true, billingType: 0, imageCount: 0 }

function fixture(signedIn = true) {
  const account = createSnapshotStore<ClientAccountState>({ busy: false, failed: false, loginVisible: false, usageVisible: false,
    view: { productName: 'Waibibabo Harnesss', platformOrigin: 'https://platform.example',
      status: signedIn ? 'signed-in' : 'signed-out', authorizationUrl: null,
      profile: signedIn ? { id: '7' as Sub2apiUserId, name: 'Example', email: 'user@example.com', balance: 10 } : null,
      groups: [{ id: '3' as Sub2apiGroupId, name: 'Standard', platform: 'openai', imageGeneration: false }], selectedGroup: null,
      models: [], modelProtocols: [], modelLimitOverrides: {}, balanceStale: false,
      modelLimits: { contextWindow: 262144, maxInputTokens: 229376, maxOutputTokens: 32768 },
      usage: null, error: null } })
  const usage = createSnapshotStore<UsageState>({ ...initialUsageState(new Date(2026, 10, 12)),
    data: { items: [record], page: 1, pageSize: 20, total: 21, totalPages: 2, requests: 21, tokens: 1000, cost: 3.75 } })
  const loadUsage = vi.fn(async () => {})
  const props = { close: vi.fn(), useAccount: bindSnapshotSelector(account), useUsage: bindSnapshotSelector(usage), loadUsage,
    t: (key: keyof typeof zh, params?: Record<string, string>) =>
      zh[key].replace(/\{(\w+)\}/gu, (_match, name: string) => params?.[name] ?? name),
  } as Parameters<typeof UsageSection>[0]
  render(<UsageSection {...props} />)
  return { account, usage, loadUsage }
}

it('queries the selected filters and pages using the last successful filter', () => {
  const f = fixture()
  expect(f.loadUsage).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByLabelText(zh.usageModel), { target: { value: 'vendor/gpt-5.1' } })
  fireEvent.click(screen.getByRole('button', { name: zh.usageSearch }))
  expect(f.loadUsage).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'vendor/gpt-5.1', page: 1 }))
  fireEvent.click(screen.getByRole('button', { name: zh.usageNext }))
  expect(f.loadUsage).toHaveBeenLastCalledWith(expect.objectContaining({ model: '', page: 2 }))
  expect(screen.getByRole('button', { name: zh.usagePrevious })).toHaveProperty('disabled', true)
})

it('shows available records and missing totals separately when summary loading fails', () => {
  const f = fixture()
  const state = f.usage.getSnapshot()
  if (state.data === null) throw new Error('fixture has no records')
  act(() => { f.usage.set({ ...state, data: { ...state.data!, requests: null, tokens: null, cost: null, statisticsError: 'network' } }) })
  expect(screen.getByText(zh.usageStatsUnavailable)).toBeTruthy()
  expect(screen.getByText('gpt-5.1')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.usageDetails })).toBeTruthy()
})

it('shows token, cost, endpoint and latency details and retains rows on query failure', async () => {
  const f = fixture()
  expect(screen.getByText('3.75')).toBeTruthy()
  expect(screen.getByRole('table').textContent).toContain('0.17')
  fireEvent.click(screen.getByRole('button', { name: zh.usageDetails }))
  const details = within(screen.getByRole('dialog'))
  expect(details.getByText('/v1/responses')).toBeDefined()
  expect(details.getByText(zh.usageCacheRead).nextElementSibling?.textContent).toBe('30')
  expect(details.getByText(zh.usageFirstToken).nextElementSibling?.textContent).toBe('250 毫秒')
  expect(details.getByText(zh.usageCost).nextElementSibling?.textContent).toBe('0.17')
  expect(details.getByText(zh.usageInputCost).nextElementSibling?.textContent).toBe('0.10')
  fireEvent.click(details.getByRole('button', { name: zh.close }))
  await act(async () => { f.usage.set({ ...f.usage.getSnapshot(), error: 'network' }) })
  expect(screen.getByRole('alert').textContent).toContain(zh.usageRetained)
  expect(screen.getByText(record.model)).toBeDefined()
  await act(async () => { f.account.set({ ...f.account.getSnapshot(), view: undefined }) })
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByText(zh.usageLogin)).toBeDefined()
})

it('never requests or displays retained usage when signed out', () => {
  const f = fixture(false)
  expect(f.loadUsage).not.toHaveBeenCalled()
  expect(screen.queryByText(record.model)).toBeNull()
})
