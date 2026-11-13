/** Deterministic protocol selection; requests never probe or retry through another API. */
import type { ModelProtocol, ModelProtocolChoice } from './types.ts'

function advertised(endpoint: string): ModelProtocol | undefined {
  const path = endpoint.toLowerCase().replace(/\/$/u, '')
  if (path.endsWith('/responses')) return 'openai-responses'
  if (path.endsWith('/chat/completions')) return 'openai-completions'
  if (path.endsWith('/messages')) return 'anthropic-messages'
  if (path.includes('generatecontent')) return 'google-generative-ai'
  return undefined
}

/** Select one wire protocol without modifying the model identifier sent to the gateway.
 * @param model - Exact gateway model id, including any provider prefix.
 * @param platform - Server group platform, used when the model family is unknown.
 * @param endpoints - Optional advertised endpoint paths from the model list.
 * @param choice - Explicit user or deployment choice, or auto.
 * @returns the protocol used for subsequent prepared requests.
 */
export function modelProtocol(model: string, platform: string, endpoints: readonly string[], choice: ModelProtocolChoice): ModelProtocol {
  if (choice !== 'auto') return choice
  let preferred: ModelProtocol
  if (/(?:^|[/:])claude(?:[-_.]|$)/iu.test(model)) preferred = 'anthropic-messages'
  else if (/(?:^|[/:])gemini(?:[-_.]|$)/iu.test(model)) preferred = 'google-generative-ai'
  else if (/(?:^|[/:])(?:deepseek|grok|qwen|glm|kimi|moonshot|minimax)(?:[-_.\/]|$)/iu.test(model)) preferred = 'openai-completions'
  else if (/(?:^|[/:])(?:gpt|chatgpt|codex|o[1-9])(?:[-_.]|$)/iu.test(model)) preferred = 'openai-responses'
  else if (platform === 'anthropic') preferred = 'anthropic-messages'
  else if (platform === 'gemini' || platform === 'antigravity') preferred = 'google-generative-ai'
  else preferred = platform === 'openai' ? 'openai-responses' : 'openai-completions'
  const supported = endpoints.map(advertised).filter((value): value is ModelProtocol => value !== undefined)
  return supported.includes(preferred) ? preferred : supported[0] ?? preferred
}

/** Select the versioned gateway base URL expected by the bundled SDK.
 * @param origin - Validated platform origin.
 * @param protocol - Selected wire protocol.
 * @returns a same-origin API base, including the Gemini version prefix when required.
 */
export function protocolBaseURL(origin: string, protocol: ModelProtocol): string {
  if (protocol === 'anthropic-messages') return origin
  return origin + (protocol === 'google-generative-ai' ? '/v1beta' : '/v1')
}
