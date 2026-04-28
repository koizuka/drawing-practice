export const HISTORY_IMAGE_MAX_EDGE = 2048
export const HISTORY_IMAGE_PASSTHROUGH_SIZE = 1.5 * 1024 * 1024
export const HISTORY_IMAGE_JPEG_QUALITY = 0.85

/**
 * Compute the scaled dimensions that fit within maxEdge on the longest side
 * while preserving aspect ratio. Returned dimensions are integers.
 */
export function computeFitDimensions(
  srcWidth: number,
  srcHeight: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(srcWidth, srcHeight)
  if (longest <= maxEdge) {
    return { width: Math.round(srcWidth), height: Math.round(srcHeight) }
  }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image-load-failed'))
    img.src = url
  })
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob)
        else reject(new Error('canvas-toblob-failed'))
      },
      type,
      quality,
    )
  })
}

/**
 * Produce a compact Blob suitable for storing in URL history.
 *
 * If the image already fits within HISTORY_IMAGE_MAX_EDGE AND the original
 * file is already small, the original File bytes are returned unchanged — we
 * don't pay the recompression quality loss for images that don't need it.
 * Otherwise the image is rasterized to a canvas at max HISTORY_IMAGE_MAX_EDGE
 * on the longest side and re-encoded as JPEG.
 *
 * Throws on decode failure so the caller can skip the history add without
 * corrupting state.
 */
export async function resizeImageForHistory(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    if (longest <= HISTORY_IMAGE_MAX_EDGE && file.size <= HISTORY_IMAGE_PASSTHROUGH_SIZE) {
      // `File` is already a `Blob` — slice yields a new Blob view without
      // copying the bytes, and lets us guarantee a type even when the source
      // File has an empty MIME.
      return file.slice(0, file.size, file.type || 'application/octet-stream')
    }
    const { width, height } = computeFitDimensions(img.naturalWidth, img.naturalHeight, HISTORY_IMAGE_MAX_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas-2d-unavailable')
    ctx.drawImage(img, 0, 0, width, height)
    return await canvasToBlob(canvas, 'image/jpeg', HISTORY_IMAGE_JPEG_QUALITY)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Re-encode a data URL as a JPEG Blob, optionally fitting it within `maxEdge`
 * on the longest side. Used to convert the 1024x1024 PNG Sketchfab screenshot
 * (~1MB+) into a ~200KB JPEG Blob for URL-history storage. Storing as Blob
 * (instead of base64 data URL) avoids the ~33% expansion from base64 and the
 * UTF-16 doubling IndexedDB applies to strings.
 *
 * Returns null on decode/encode failure so the caller can fall back gracefully.
 */
export async function dataUrlToJpegBlob(
  dataUrl: string,
  maxEdge = 1024,
  quality = 0.85,
): Promise<Blob | null> {
  try {
    const img = await loadImage(dataUrl)
    const { width, height } = computeFitDimensions(img.naturalWidth, img.naturalHeight, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, width, height)
    return await canvasToBlob(canvas, 'image/jpeg', quality)
  } catch {
    return null
  }
}

/**
 * Read a Blob into a data URL. Used when restoring an image from URL history
 * back into reference state — drawing/autosave paths consume data URLs, not
 * Blob ObjectURLs (data URLs survive page reload via the autosave draft).
 */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/**
 * SHA-256 content hash as a lowercase hex string. Used as the URL history key
 * for local-image entries so byte-identical files dedupe across paths,
 * renames, and re-downloads with different mtimes.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  // Wrap in Uint8Array so SubtleCrypto receives a TypedArray even when the
  // polyfilled Blob.arrayBuffer() returns a non-ArrayBuffer (some jsdom/Node
  // environments surface a NodeBuffer-like result that the API rejects).
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const digestBytes = new Uint8Array(digest)
  let hex = ''
  for (const b of digestBytes) hex += b.toString(16).padStart(2, '0')
  return hex
}
