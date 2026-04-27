import { describe, it, expect } from 'vitest'
import {
  buildExportFilename,
  computeStrokesBoundingBox,
  exportDrawingAsSvg,
  formatTimestamp,
  paddedBox,
  pointsToPathData,
  rasterScale,
  sanitizeTitle,
} from './exportDrawing'
import type { DrawingRecord } from './db'
import type { Stroke } from '../drawing/types'

function makeDrawing(strokes: Stroke[], opts: Partial<DrawingRecord> = {}): DrawingRecord {
  return {
    strokes,
    thumbnail: '',
    referenceInfo: '',
    createdAt: new Date(2026, 3, 27, 13, 27, 0),
    elapsedMs: 0,
    ...opts,
  }
}

async function blobToText(blob: Blob): Promise<string> {
  // jsdom's Response doesn't read Blob bodies; use Blob.text() if available
  // and fall back to FileReader otherwise.
  if (typeof blob.text === 'function') return blob.text()
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsText(blob)
  })
}

describe('formatTimestamp', () => {
  it('formats local time as YYYYMMDD-HHMMSS with zero padding', () => {
    expect(formatTimestamp(new Date(2026, 3, 27, 13, 27, 0))).toBe('20260427-132700')
    expect(formatTimestamp(new Date(2026, 0, 5, 9, 5, 7))).toBe('20260105-090507')
  })
})

describe('sanitizeTitle', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeTitle('')).toBe('')
  })

  it('replaces whitespace with hyphens and collapses repeats', () => {
    expect(sanitizeTitle('Hello   World')).toBe('Hello-World')
    expect(sanitizeTitle('a\tb  c')).toBe('a-b-c')
  })

  it('strips filesystem-unsafe characters', () => {
    expect(sanitizeTitle('foo/bar\\baz:qux*?"<>|.svg')).toBe('foobarbazqux.svg')
  })

  it('strips control characters', () => {
    expect(sanitizeTitle('a\x00b\x1Fc\x7Fd')).toBe('abcd')
  })

  it('keeps CJK characters intact', () => {
    expect(sanitizeTitle('猫のスケッチ')).toBe('猫のスケッチ')
    expect(sanitizeTitle('猫 の スケッチ')).toBe('猫-の-スケッチ')
  })

  it('trims leading and trailing hyphens and dots', () => {
    expect(sanitizeTitle('  ...hello...  ')).toBe('hello')
    expect(sanitizeTitle('---abc---')).toBe('abc')
  })

  it('truncates to 50 characters and trims trailing hyphens', () => {
    const long = 'a'.repeat(60)
    expect(sanitizeTitle(long)).toBe('a'.repeat(50))
    const longWithSpaces = 'word '.repeat(20).trim()  // 'word word word ...'
    const result = sanitizeTitle(longWithSpaces)
    expect(result.length).toBeLessThanOrEqual(50)
    expect(result.endsWith('-')).toBe(false)
  })
})

describe('buildExportFilename', () => {
  it('appends sanitized reference title when present', () => {
    const drawing = makeDrawing([], {
      reference: { source: 'sketchfab', title: 'My Cool Model', author: 'a', sketchfabUid: 'uid' },
    })
    expect(buildExportFilename(drawing, 'svg')).toBe('drawing-practice-20260427-132700-My-Cool-Model.svg')
  })

  it('omits title segment when no reference', () => {
    const drawing = makeDrawing([])
    expect(buildExportFilename(drawing, 'png')).toBe('drawing-practice-20260427-132700.png')
  })

  it('uses .jpg extension for jpeg format', () => {
    const drawing = makeDrawing([])
    expect(buildExportFilename(drawing, 'jpeg')).toBe('drawing-practice-20260427-132700.jpg')
  })

  it('survives titles with unsafe characters', () => {
    const drawing = makeDrawing([], {
      reference: { source: 'url', title: 'photo: of "cat" / dog', author: '', imageUrl: 'http://x' },
    })
    const name = buildExportFilename(drawing, 'svg')
    expect(name).toBe('drawing-practice-20260427-132700-photo-of-cat-dog.svg')
  })

  it('handles Japanese reference titles', () => {
    const drawing = makeDrawing([], {
      reference: { source: 'pexels', title: '猫のポーズ', author: '', pexelsPhotoId: 1, pexelsImageUrl: '' },
    })
    expect(buildExportFilename(drawing, 'svg')).toBe('drawing-practice-20260427-132700-猫のポーズ.svg')
  })

  it('truncates very long reference titles in the filename', () => {
    const longTitle = 'a'.repeat(120)
    const drawing = makeDrawing([], {
      reference: { source: 'url', title: longTitle, author: '', imageUrl: 'http://x' },
    })
    const name = buildExportFilename(drawing, 'svg')
    const titlePart = name.replace(/^drawing-practice-\d{8}-\d{6}-/, '').replace(/\.svg$/, '')
    expect(titlePart.length).toBeLessThanOrEqual(50)
    expect(name.length).toBeLessThan(120)
  })
})

describe('rasterScale', () => {
  const TARGET = 2048
  const MAX = 4
  const MAX_PIXELS = 8_000_000

  it('upscales small drawings toward the target long edge but not past the absolute cap', () => {
    expect(rasterScale(100, 100)).toBe(MAX)  // would need 20.48x to hit target; capped at 4
    expect(rasterScale(1024, 512)).toBe(TARGET / 1024)  // hits the long-edge target exactly
  })

  it('returns 1x for drawings already at the target long edge', () => {
    expect(rasterScale(TARGET, TARGET / 2)).toBe(1)
  })

  it('downscales below 1x when the drawing exceeds RASTER_MAX_PIXELS', () => {
    // 4000 * 3000 = 12 Mpx > 8 Mpx cap → scale must be < 1.
    const scale = rasterScale(4000, 3000)
    expect(scale).toBeLessThan(1)
    const pixels = 4000 * 3000 * scale * scale
    expect(pixels).toBeLessThanOrEqual(MAX_PIXELS + 1)
  })

  it('keeps the pixel cap binding even for extremely wide aspect ratios', () => {
    // 10000 x 1000 = 10 Mpx; long-edge target alone would say 2048/10000 = 0.2048,
    // pixels at that scale = 10M * 0.2048^2 ≈ 419k, well under the cap, so the
    // long-edge target wins. Test the inverse case where the cap is the tighter bound.
    const scale = rasterScale(20000, 1000)  // 20 Mpx
    const pixels = 20000 * 1000 * scale * scale
    expect(pixels).toBeLessThanOrEqual(MAX_PIXELS + 1)
  })
})

describe('computeStrokesBoundingBox', () => {
  it('returns a fallback box for empty strokes', () => {
    const box = computeStrokesBoundingBox([])
    expect(box).toEqual({ minX: 0, minY: 0, width: 1, height: 1 })
  })

  it('returns a non-zero size for a single point', () => {
    const box = computeStrokesBoundingBox([{ points: [{ x: 5, y: 7 }], timestamp: 0 }])
    expect(box.minX).toBe(5)
    expect(box.minY).toBe(7)
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
  })

  it('encloses all points across multiple strokes', () => {
    const box = computeStrokesBoundingBox([
      { points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], timestamp: 0 },
      { points: [{ x: -5, y: 100 }], timestamp: 1 },
    ])
    expect(box.minX).toBe(-5)
    expect(box.minY).toBe(20)
    expect(box.width).toBe(35)
    expect(box.height).toBe(80)
  })
})

describe('paddedBox', () => {
  it('adds at least the minimum padding on small drawings', () => {
    const box = paddedBox({ minX: 0, minY: 0, width: 10, height: 10 })
    expect(box.padding).toBeGreaterThanOrEqual(20)
    expect(box.x).toBe(-box.padding)
    expect(box.width).toBe(10 + box.padding * 2)
  })

  it('scales padding by 5% on large drawings', () => {
    const box = paddedBox({ minX: 0, minY: 0, width: 1000, height: 500 })
    expect(box.padding).toBe(50)
  })
})

describe('pointsToPathData', () => {
  it('produces M then L commands for a multi-point stroke', () => {
    const d = pointsToPathData({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], timestamp: 0 })
    expect(d).toBe('M1 2 L3 4 L5 6')
  })

  it('emits a zero-length segment for a single-point stroke (rendered as a dot)', () => {
    const d = pointsToPathData({ points: [{ x: 7, y: 8 }], timestamp: 0 })
    expect(d).toBe('M7 8 L7 8')
  })

  it('returns empty string for an empty stroke', () => {
    const d = pointsToPathData({ points: [], timestamp: 0 })
    expect(d).toBe('')
  })
})

describe('exportDrawingAsSvg', () => {
  it('returns a Blob with the svg+xml MIME type', () => {
    const blob = exportDrawingAsSvg(makeDrawing([]))
    expect(blob.type).toBe('image/svg+xml')
  })

  it('emits viewBox, white background rect, and one path per stroke', async () => {
    const drawing = makeDrawing([
      { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], timestamp: 0 },
      { points: [{ x: 0, y: 10 }, { x: 10, y: 10 }], timestamp: 1 },
    ])
    const text = await blobToText(exportDrawingAsSvg(drawing))
    expect(text).toContain('<?xml')
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(text).toMatch(/viewBox="-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?"/)
    expect(text).toContain('fill="#ffffff"')
    expect(text).toContain('stroke="#000000"')
    expect(text).toContain('stroke-linecap="round"')
    expect(text).toContain('stroke-linejoin="round"')
    expect(text.match(/<path /g)?.length).toBe(2)
  })

  it('skips empty strokes in the path output', async () => {
    const drawing = makeDrawing([
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 0 },
      { points: [], timestamp: 1 },
    ])
    const text = await blobToText(exportDrawingAsSvg(drawing))
    expect(text.match(/<path /g)?.length).toBe(1)
  })
})
