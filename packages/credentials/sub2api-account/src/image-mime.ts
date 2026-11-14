/** Shared signature checks for uploaded reference images and generated previews. */

/** Identify the supported raster encoding from its file signature.
 * @param bytes - At least the first twelve file bytes, when available.
 * @returns a supported MIME type, or null for an unrecognized signature.
 */
export function imageMime(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}
