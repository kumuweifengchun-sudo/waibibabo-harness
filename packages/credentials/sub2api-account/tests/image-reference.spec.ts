import { expect, it } from 'vitest'
import { imageRequest } from '../src/images.ts'
import { AccountError } from '../src/http.ts'
import type { ImageReferenceId, ImageRequest, Sub2apiGroupId } from '../src/types.ts'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const reference = { id: 'reference' as ImageReferenceId, name: 'reference.png', mime: 'image/png', base64: png.toString('base64') }
const input: ImageRequest = { groupId: '4' as Sub2apiGroupId, model: 'model', prompt: 'prompt', count: 1, size: '', references: [reference] }

it('bounds all decoded references together, accepting the exact count and byte limit', () => {
  const pair = { ...input, references: [reference, { ...reference, id: 'second' as ImageReferenceId }] }
  expect(imageRequest(pair, { maxCount: 2, maxBytes: 16 }).path).toBe('/v1/images/edits')
  expect(() => imageRequest(pair, { maxCount: 1, maxBytes: 16 })).toThrow(new AccountError('validation'))
  expect(() => imageRequest(pair, { maxCount: 2, maxBytes: 15 })).toThrow(new AccountError('validation'))
  expect(() => imageRequest(input, { maxCount: 1, maxBytes: 1 })).toThrow(new AccountError('validation'))
  expect(imageRequest({ ...input, references: [] }, { maxCount: 1, maxBytes: 1 })).toEqual({
    path: '/v1/images/generations', body: { model: 'model', prompt: 'prompt', n: 1 },
  })
})

it.each([
  { ...reference, mime: 'image/jpeg' },
  { ...reference, mime: 'image/svg+xml' },
  { ...reference, base64: '' },
  { ...reference, base64: '****' },
  { ...reference, base64: 'abc' },
  { ...reference, base64: Buffer.from('<svg/>').toString('base64') },
])('rejects unsupported or malformed reference bytes before constructing a billable request: %j', (file) => {
  expect(() => imageRequest({ ...input, references: [file] }, { maxCount: 16, maxBytes: 100 })).toThrow(new AccountError('validation'))
})

it.each([
  { mime: 'image/jpeg', bytes: Buffer.from([255, 216, 255, 224]) },
  { mime: 'image/webp', bytes: Buffer.from('RIFF0000WEBP') },
])('retains uploaded $mime bytes and metadata', async ({ mime, bytes }) => {
  const result = imageRequest({ ...input, references: [{ ...reference, mime, base64: bytes.toString('base64') }] }, { maxCount: 1, maxBytes: bytes.length })
  expect(result.body).toBeInstanceOf(FormData)
  const file = (result.body as FormData).get('image[]')
  if (file === null || typeof file === 'string') throw new Error('Expected reference image')
  expect(file.type).toBe(mime)
  expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes)
})
