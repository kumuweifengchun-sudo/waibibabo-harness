/** Platform reasoning metadata combined with the bundled native model catalog. */
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import type { Api, Model, ModelThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai/config'
import { z } from 'zod'

/** Validated platform model listing, including optional gateway reasoning capabilities. */
export const platformModelsResponse = z.object({ data: z.array(z.object({
  id: z.string().min(1), context_window: z.number().int().positive().optional(), max_output_tokens: z.number().int().positive().optional(),
  supported_endpoints: z.array(z.string()).optional(),
  supportsReasoningEffort: z.boolean().optional(),
  reasoningEfforts: z.array(z.object({ value: z.string(), label: z.string().optional(), default: z.boolean().optional() })).optional(),
})) })

/** Parsed gateway catalog retained for protocol and capacity changes. */
export type PlatformModelCatalog = z.infer<typeof platformModelsResponse>['data']

function nativeModel(id: string, api: Api): Model<Api> | undefined {
  const name = id.split(/[/:]/u).at(-1)?.toLowerCase() ?? id.toLowerCase()
  let provider: BuiltinProvider
  if (/^(gpt|chatgpt|codex|o[1-9])(?:[-_.]|$)/u.test(name)) provider = 'openai'
  else if (name.startsWith('claude-')) provider = 'anthropic'
  else if (name.startsWith('gemini-')) provider = 'google'
  else if (name.startsWith('deepseek-')) provider = 'deepseek'
  else if (name.startsWith('minimax-')) provider = 'minimax'
  else if (api === 'anthropic-messages') provider = 'anthropic'
  else if (api === 'google-generative-ai') provider = 'google'
  else provider = 'openai'
  const catalogId = name === 'deepseek-v4-flash' ? 'deepseek-flash' : name
  return getBuiltinModels(provider).find(model => model.id.toLowerCase() === catalogId)
}

function platformEfforts(entries: NonNullable<PlatformModelCatalog[number]['reasoningEfforts']>): ThinkingLevelMap | undefined {
  const map: ThinkingLevelMap = { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null }
  const levels: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  for (const { value } of entries) {
    const normalized = value.toLowerCase()
    const level = normalized === 'none' ? 'off' : levels.find(candidate => candidate === normalized)
    if (level !== undefined) map[level] = value
  }
  return levels.some(level => level !== 'off' && map[level] !== null) ? map : undefined
}

function reasoningCompat(native: Model<Api>, model: Model<Api>): Model<Api>['compat'] {
  const compat = native.compat
  if (native.api !== model.api || compat === undefined) return model.compat
  return { ...model.compat,
    ...'thinkingFormat' in compat ? { thinkingFormat: compat.thinkingFormat } : {},
    ...'supportsReasoningEffort' in compat ? { supportsReasoningEffort: compat.supportsReasoningEffort } : {},
    ...'requiresReasoningContentOnAssistantMessages' in compat
      ? { requiresReasoningContentOnAssistantMessages: compat.requiresReasoningContentOnAssistantMessages } : {},
    ...'forceAdaptiveThinking' in compat ? { forceAdaptiveThinking: compat.forceAdaptiveThinking } : {} }
}

/** Enrich a group route without replacing its model ids, credentials, capacities or gateway URLs.
 * @param profile - Validated group route owned by the signed-in account.
 * @param catalog - Platform model capabilities; explicit declarations override bundled reasoning metadata.
 * @returns a route whose model selector and request serializer use the same reasoning capabilities.
 */
export function withModelCapabilities(profile: ResolvedPiAiProviderProfile, catalog: PlatformModelCatalog): ResolvedPiAiProviderProfile {
  const provider = profile.piProvider
  if (provider === undefined) return profile
  const entries = new Map(catalog.map(model => [model.id, model]))
  const models = provider.getModels().map((model) => {
    const native = nativeModel(model.id, model.api)
    const entry = entries.get(model.id)
    const efforts = entry?.reasoningEfforts === undefined ? undefined : platformEfforts(entry.reasoningEfforts)
    const reasoning = entry?.supportsReasoningEffort === false ? false
      : entry?.reasoningEfforts !== undefined ? efforts !== undefined : native?.reasoning ?? false
    const compat = native === undefined ? undefined : reasoningCompat(native, model)
    return { ...model, reasoning,
      ...native?.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: native.thinkingLevelMap },
      ...compat === undefined ? {} : { compat },
      ...efforts === undefined ? {} : { thinkingLevelMap: efforts } }
  })
  return { ...profile, piProvider: { ...provider, getModels: () => models } }
}
