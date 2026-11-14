/** Image gateway validation without retaining user prompts or upstream credentials. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { AccountError, parse } from './http.ts'
import type { ImageOutputId, ImageRequest, ImageResult, ImageUploadLimits } from './platform-types.ts'
import { imageMime } from './image-mime.ts'

const request = z.object({ groupId: z.string().regex(/^[1-9]\d*$/u), model: z.string().trim().min(1).max(256),
  prompt: z.string().trim().min(1).max(32000), count: z.number().int().min(1).max(10),
  size: z.string().max(64).refine(value => value === '' || /^[1-9]\d*x[1-9]\d*$/u.test(value)
    && value.split('x').every(dimension => Number.isSafeInteger(Number(dimension)))),
  references: z.array(z.object({ id: z.string().min(1), name: z.string().min(1).max(255),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), base64: z.string().min(1) })).optional() })
const result = z.object({ data: z.array(z.object({ url: z.string().optional(), b64_json: z.string().optional(),
  revised_prompt: z.string().optional() })).min(1).max(10) })

/** Validate a user-triggered image request before any billable call.
 * @param input - Model, prompt, image count, optional size and reference images.
 * @param limits - Host-owned count and combined decoded-byte limits.
 * @returns the generation JSON or editing multipart request; invalid files fail before a gateway call.
 */
export function imageRequest(input: ImageRequest, limits: ImageUploadLimits): { path: string; body: object | FormData } {
  const checked = request.safeParse(input)
  if (!checked.success) throw new AccountError('validation')
  const fields = { model: checked.data.model, prompt: checked.data.prompt, n: checked.data.count,
    ...(checked.data.size ? { size: checked.data.size } : {}) }
  const references = checked.data.references ?? []
  if (references.length === 0) return { path: '/v1/images/generations', body: fields }
  if (references.length > limits.maxCount) throw new AccountError('validation')
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.append(key, String(value))
  let remaining = limits.maxBytes
  for (const reference of references) {
    if (reference.base64.length > Math.ceil(remaining / 3) * 4 || reference.base64.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/u.test(reference.base64)) throw new AccountError('validation')
    const bytes = Buffer.from(reference.base64, 'base64')
    if (bytes.length > remaining || imageMime(bytes) !== reference.mime) throw new AccountError('validation')
    remaining -= bytes.length
    body.append('image[]', new Blob([bytes], { type: reference.mime }), reference.name)
  }
  return { path: '/v1/images/edits', body }
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
      const mime = imageMime(prefix)
      if (mime === null) throw new AccountError('protocol')
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
