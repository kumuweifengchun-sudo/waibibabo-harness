/** Account-wide model budgets and their effective input-plus-output window. */
import { z } from 'zod'
import { AccountError } from './http.ts'
import type { ModelLimits } from './types.ts'

/** Validates persisted and remotely supplied token budgets. */
export const modelLimitsSchema = z.object({
  contextWindow: z.number().int().min(1024),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
}).refine(value => value.maxInputTokens + value.maxOutputTokens <= value.contextWindow)

/** Validate a complete token-budget choice before persistence or model registration.
 * @param value - User or deployment supplied token budgets.
 * @returns validated budgets, rejecting incompatible input and output allocations.
 */
export function parseModelLimits(value: unknown): ModelLimits {
  const result = modelLimitsSchema.safeParse(value)
  if (!result.success) throw new AccountError('model-limits')
  return result.data
}

/** Resolve the window used by existing compaction after reserving the configured output.
 * @param limits - Validated context, input and output budgets.
 * @returns effective context window, which leaves at most the configured input capacity.
 */
export function effectiveContextWindow(limits: ModelLimits): number {
  return Math.min(limits.contextWindow, limits.maxInputTokens + limits.maxOutputTokens)
}
