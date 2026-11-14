/** Cancellable local image reads owned by the account-scoped platform controller. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { imageMime } from '../image-mime.ts'
import type { ImageReference, ImageReferenceId } from '../platform-types.ts'

/** Read one reference after the controller validates the complete selection's size.
 * @param file - User-selected local file; the path never crosses the Remote.
 * @param signal - Account reset or platform disposal cancels the read.
 * @returns supported raster bytes and a stable draft identity; rejects unreadable or unsupported files.
 */
export async function readImageReference(file: File, signal: AbortSignal): Promise<ImageReference> {
  const base64 = await new Promise<string>((resolve, reject) => {
    signal.throwIfAborted()
    const reader = new FileReader()
    const cleanup = () => { signal.removeEventListener('abort', abort) }
    const abort = () => { reader.abort(); cleanup(); reject(new Error('Image read cancelled')) }
    reader.onerror = () => { cleanup(); reject(new Error('Image read failed')) }
    reader.onload = () => {
      cleanup()
      if (typeof reader.result === 'string') resolve(reader.result.slice(reader.result.indexOf(',') + 1))
      else reject(new Error('Image read failed'))
    }
    signal.addEventListener('abort', abort, { once: true })
    try { reader.readAsDataURL(file) } catch (error) { cleanup(); reject(new Error('Image read failed', { cause: error })) }
  })
  const mime = imageMime(Uint8Array.from(atob(base64.slice(0, 32)), character => character.charCodeAt(0)))
  if (mime === null || file.type !== '' && file.type !== mime) throw new Error('Unsupported reference image')
  return { id: randomUUID() as ImageReferenceId, name: file.name, mime, base64 }
}
