/** Client-owned usage query state; responses are never persisted in browser storage. */
import type { AccountFailure, UsagePage, UsageQuery } from '../types.ts'

/** Last successful query stays paired with its records during refresh or failure. */
export interface UsageState {
  readonly query: UsageQuery
  readonly data: UsagePage | null
  readonly loading: boolean
  readonly error: AccountFailure | null
}

/** Build the website-compatible initial seven-day query in the user's local timezone.
 * @param now - Current local date, supplied explicitly in date-boundary tests.
 * @returns an empty, inactive usage view.
 */
export function initialUsageState(now: Date = new Date()): UsageState {
  const date = (value: Date) => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-')
  const start = new Date(now)
  start.setDate(start.getDate() - 6)
  return { data: null, loading: false, error: null, query: { page: 1, pageSize: 20,
    startDate: date(start), endDate: date(now), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    model: '', groupId: null, stream: null } }
}
