/** Image gateway validation without retaining user prompts or upstream credentials. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { AccountError, parse } from './http.ts'
import type { ImageOutputId, ImageRequest, ImageResult } from './platform-types.ts'

const request = z.object({ groupId: z.string().regex(/^[1-9]\d*$/u), model: z.string().trim().min(1).max(256),
  prompt: z.string().trim().min(1).max(32000), count: z.number().int().min(1).max(10),
  size: z.string().max(64).refine(value => value === '' || /^[1-9]\d*x[1-9]\d*$/u.test(value)
    && value.split('x').every(dimension => Number.isSafeInteger(Number(dimension)))) })
const result = z.object({ data: z.array(z.object({ url: z.string().optional(), b64_json: z.string().optional(),
  revised_prompt: z.string().optional() })).min(1).max(10) })

/** Validate a user-triggered image request before any billable call.
 * @param input - Model, prompt, image count and optional size.
 * @returns the OpenAI-compatible gateway body.
 */
export function imageRequest(input: ImageRequest): object {
  const checked = request.safeParse(input)
  if (!checked.success) throw new AccountError('validation')
  return { model: checked.data.model, prompt: checked.data.prompt, n: checked.data.count,
    ...(checked.data.size ? { size: checked.data.size } : {}) }
}

/** Project provider output to safe image URLs without fetching arbitrary URLs on the Host.
 * @param value - Image gateway JSON.
 * @returns previews held by the client until account change or disposal.
 */
export function imageResult(value: unknown): ImageResult {
  const parsed = parse(result, value)
  return { images: parsed.data.map((item) => {
    let source: string
    if (item.b64_json) {
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(item.b64_json) || item.b64_json.length % 4 !== 0) throw new AccountError('protocol')
      const prefix = Buffer.from(item.b64_json.slice(0, 32), 'base64')
      const mime = prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 ? 'image/jpeg'
          : prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined
      if (mime === undefined) throw new AccountError('protocol')
      source = `data:${mime};base64,${item.b64_json}`
    } else {
      let url: URL
      try { url = new URL(item.url ?? '') } catch { throw new AccountError('protocol') }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new AccountError('protocol')
      source = url.href
    }
    return { id: randomUUID() as ImageOutputId, source, revisedPrompt: item.revised_prompt ?? null }
  }) }
}
