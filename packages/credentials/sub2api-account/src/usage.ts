/** Validated account-scoped usage queries and display-only response projection. */
import { z } from 'zod'
import { AccountError, parse } from './http.ts'
import type { AccountFailure, Sub2apiUsageId, UsagePage, UsageQuery } from './types.ts'

const querySchema = z.object({
  page: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(100),
  startDate: z.iso.date(), endDate: z.iso.date(), timezone: z.string().min(1).max(100),
  model: z.string().trim().max(256), groupId: z.string().regex(/^[1-9]\d*$/u).nullable(), stream: z.boolean().nullable(),
})
const count = z.number().int().nonnegative()
const row = z.object({
  id: z.number().int().positive(), created_at: z.iso.datetime({ offset: true }), model: z.string(), request_id: z.string(),
  group: z.object({ name: z.string() }).nullish(), api_key: z.object({ name: z.string() }).nullish(),
  inbound_endpoint: z.string().nullish(), input_tokens: count, output_tokens: count,
  cache_read_tokens: count, cache_creation_tokens: count,
  input_cost: z.number(), output_cost: z.number(), cache_read_cost: z.number(), cache_creation_cost: z.number(),
  total_cost: z.number(), actual_cost: z.number(), rate_multiplier: z.number(),
  duration_ms: z.number().nullable(), first_token_ms: z.number().nullable(), stream: z.boolean(), billing_type: z.number().int(),
  image_count: count.optional(),
})
const pageSchema = z.object({ items: z.array(row), total: count, page: z.number().int().positive(),
  page_size: z.number().int().positive(), pages: count.optional() })
const statsSchema = z.object({ total_requests: count, total_tokens: count, total_actual_cost: z.number() })

/** Encode only supported usage filters, preserving the website's inclusive local dates.
 * @param input - Client query with a maximum inclusive range of 90 days.
 * @returns encoded parameters for both list and summary requests.
 */
export function usageParameters(input: UsageQuery): string {
  const result = querySchema.safeParse(input)
  if (!result.success) throw new AccountError('usage-filter')
  const query = result.data
  const days = (Date.parse(query.endDate) - Date.parse(query.startDate)) / 86400000
  if (days < 0 || days > 89) throw new AccountError('usage-filter')
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: query.timezone }) } catch { throw new AccountError('usage-filter') }
  const parameters = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize),
    start_date: query.startDate, end_date: query.endDate, timezone: query.timezone, sort_by: 'created_at', sort_order: 'desc' })
  if (query.model) parameters.set('model', query.model)
  if (query.groupId !== null) parameters.set('group_id', query.groupId)
  if (query.stream !== null) parameters.set('stream', String(query.stream))
  return parameters.toString()
}

/** Strip credentials and administrator fields from the platform's usage responses.
 * @param pageValue - Untrusted paginated records.
 * @param statsValue - Untrusted server totals for the same filter.
 * @param statisticsError - Failure of the independent summary request, when present.
 * @returns display-safe records and authoritative totals.
 */
export function usagePage(pageValue: unknown, statsValue: unknown, statisticsError?: AccountFailure): UsagePage {
  const page = parse(pageSchema, pageValue)
  const statistics = statsSchema.safeParse(statsValue)
  const stats = statistics.success ? statistics.data : null
  return { page: page.page, pageSize: page.page_size, total: page.total, totalPages: Math.ceil(page.total / page.page_size),
    requests: stats?.total_requests ?? null, tokens: stats?.total_tokens ?? null, cost: stats?.total_actual_cost ?? null,
    ...(stats === null ? { statisticsError: statisticsError ?? 'protocol' as const } : {}),
    items: page.items.map(value => ({ id: String(value.id) as Sub2apiUsageId, createdAt: value.created_at,
      model: value.model, requestId: value.request_id, group: value.group?.name ?? null, apiKey: value.api_key?.name ?? null,
      endpoint: value.inbound_endpoint ?? null, inputTokens: value.input_tokens, outputTokens: value.output_tokens,
      cacheReadTokens: value.cache_read_tokens, cacheWriteTokens: value.cache_creation_tokens,
      inputCost: value.input_cost, outputCost: value.output_cost,
      cacheReadCost: value.cache_read_cost, cacheWriteCost: value.cache_creation_cost,
      totalCost: value.total_cost, actualCost: value.actual_cost, multiplier: value.rate_multiplier,
      durationMs: value.duration_ms, firstTokenMs: value.first_token_ms, stream: value.stream,
      billingType: value.billing_type, imageCount: value.image_count ?? 0,
    })),
  }
}
