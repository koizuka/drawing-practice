/**
 * Minimal animated-GIF (GIF89a) encoder — palette-indexed frames in, bytes out.
 *
 * Written in-house rather than pulled from npm: it is ~150 lines, has no
 * runtime needs beyond typed arrays, and keeps the dependency surface small
 * (supply-chain hardening). Scope is deliberately narrow:
 *
 * - one global color table (≤ 256 entries), no local tables, no transparency;
 * - every frame is full-canvas size; the encoder itself crops each frame to
 *   the rectangle that differs from the previous one (disposal "do not
 *   dispose"), which is what keeps line-art animations small;
 * - infinite looping via the NETSCAPE2.0 extension.
 */

export interface GifFrame {
  /** Palette indices, row-major, `width * height` long. */
  indices: Uint8Array;
  /** Display time in centiseconds (1/100 s). */
  delayCs: number;
}

export interface GifInput {
  width: number;
  height: number;
  /** 0xRRGGBB entries, 1–256 of them. */
  palette: readonly number[];
  frames: readonly GifFrame[];
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private buf = new Uint8Array(4096);
  private len = 0;

  byte(b: number): void {
    if (this.len === this.buf.length) this.flushBuf();
    this.buf[this.len++] = b & 0xff;
  }

  u16(v: number): void {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }

  bytes(arr: ArrayLike<number>): void {
    for (let i = 0; i < arr.length; i++) this.byte(arr[i]);
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  private flushBuf(): void {
    this.chunks.push(this.buf.slice(0, this.len));
    this.len = 0;
  }

  result(): Uint8Array {
    this.flushBuf();
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

/** Bits needed for a color table holding `n` entries (GIF minimum: 2 entries). */
function tableBits(n: number): number {
  let bits = 1;
  while (1 << bits < n) bits++;
  return bits;
}

const MAX_CODE = 4096;

/**
 * GIF-flavored LZW: variable code width starting at `minCodeSize + 1`, LSB-
 * first bit packing, clear code emitted first and whenever the 12-bit table
 * fills. Output is the raw code stream (not yet split into sub-blocks).
 */
export function lzwEncode(indices: ArrayLike<number>, minCodeSize: number): Uint8Array {
  const out = new ByteWriter();
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  // key = prefixCode * 256 + pixel  (prefix < 4096 ⇒ key < 2^20)
  let dict = new Map<number, number>();

  let bitBuf = 0;
  let bitCount = 0;
  const emit = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.byte(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
  } else {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = prefix * 256 + k;
      const code = dict.get(key);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      emit(prefix);
      if (nextCode < MAX_CODE) {
        dict.set(key, nextCode++);
        // The decoder lags one entry behind, so it widens when ITS next
        // code reaches 2^codeSize — i.e. when ours passes it.
        if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        emit(clear);
        dict = new Map();
        nextCode = eoi + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
  }
  if (bitCount > 0) out.byte(bitBuf & 0xff);
  return out.result();
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding rect of pixels that differ between two frames (null = identical). */
export function diffRect(
  prev: Uint8Array,
  next: Uint8Array,
  width: number,
  height: number,
): Rect | null {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let x0 = -1;
    for (let x = 0; x < width; x++) {
      if (prev[row + x] !== next[row + x]) {
        x0 = x;
        break;
      }
    }
    if (x0 < 0) continue;
    let x1 = x0;
    for (let x = width - 1; x > x0; x--) {
      if (prev[row + x] !== next[row + x]) {
        x1 = x;
        break;
      }
    }
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (y < minY) minY = y;
    maxY = y;
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function cropIndices(src: Uint8Array, width: number, r: Rect): Uint8Array {
  if (r.x === 0 && r.y === 0 && r.w === width) return src.subarray(0, r.w * r.h);
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const s = (r.y + y) * width + r.x;
    out.set(src.subarray(s, s + r.w), y * r.w);
  }
  return out;
}

function writeSubBlocks(w: ByteWriter, data: Uint8Array): void {
  for (let off = 0; off < data.length; off += 255) {
    const n = Math.min(255, data.length - off);
    w.byte(n);
    w.bytes(data.subarray(off, off + n));
  }
  w.byte(0);
}

/**
 * Streaming encoder: frames are compressed as they are added and only the
 * previous frame's indices are kept (for the diff crop), so a 120-frame
 * export never holds every full-size frame at once.
 */
export class GifWriter {
  private readonly w = new ByteWriter();
  private readonly minCodeSize: number;
  private prev: Uint8Array | null = null;
  private frameCount = 0;

  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number, palette: readonly number[]) {
    this.width = width;
    this.height = height;
    if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
      throw new Error('gif-bad-size');
    }
    if (palette.length < 1 || palette.length > 256) throw new Error('gif-bad-palette');
    const bits = tableBits(palette.length);
    this.minCodeSize = Math.max(2, bits);
    const w = this.w;
    w.ascii('GIF89a');
    // Logical screen descriptor: global table present, 8-bit color resolution.
    w.u16(width);
    w.u16(height);
    w.byte(0x80 | (7 << 4) | (bits - 1));
    w.byte(0); // background color index
    w.byte(0); // pixel aspect ratio
    for (let i = 0; i < 1 << bits; i++) {
      const c = palette[i] ?? 0;
      w.byte((c >> 16) & 0xff);
      w.byte((c >> 8) & 0xff);
      w.byte(c & 0xff);
    }
    // NETSCAPE2.0 application extension: loop count 0 = forever.
    w.bytes([0x21, 0xff, 0x0b]);
    w.ascii('NETSCAPE2.0');
    w.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  }

  /** `frame.indices` may be reused by the caller only after the NEXT call. */
  addFrame(frame: GifFrame): void {
    const { width, height, w } = this;
    if (frame.indices.length !== width * height) throw new Error('gif-bad-frame');
    let rect: Rect = { x: 0, y: 0, w: width, h: height };
    if (this.prev) {
      // An identical frame still needs an image (its delay must be honored);
      // a single unchanged pixel is the cheapest valid one.
      rect = diffRect(this.prev, frame.indices, width, height) ?? { x: 0, y: 0, w: 1, h: 1 };
    }
    // Graphic control extension: disposal 1 (keep), no transparency.
    w.bytes([0x21, 0xf9, 0x04, 1 << 2]);
    w.u16(Math.max(0, Math.min(0xffff, Math.round(frame.delayCs))));
    w.bytes([0x00, 0x00]);
    // Image descriptor (no local color table, not interlaced).
    w.byte(0x2c);
    w.u16(rect.x);
    w.u16(rect.y);
    w.u16(rect.w);
    w.u16(rect.h);
    w.byte(0);
    w.byte(this.minCodeSize);
    writeSubBlocks(w, lzwEncode(cropIndices(frame.indices, width, rect), this.minCodeSize));
    this.prev = frame.indices;
    this.frameCount++;
  }

  finish(): Uint8Array {
    if (this.frameCount === 0) throw new Error('gif-no-frames');
    this.prev = null;
    this.w.byte(0x3b);
    return this.w.result();
  }
}

/** One-shot convenience over `GifWriter`. */
export function encodeGif({ width, height, palette, frames }: GifInput): Uint8Array {
  if (frames.length === 0) throw new Error('gif-no-frames');
  const gw = new GifWriter(width, height, palette);
  for (const f of frames) gw.addFrame(f);
  return gw.finish();
}

/**
 * Per-frame delays (centiseconds) for `count` frames at `fps`, distributing
 * rounding so the total stays accurate (8 fps → 13,12,13,12… instead of a
 * uniform 13 that would drift to 7.7 fps).
 */
export function frameDelaysCs(count: number, fps: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const target = Math.round(((i + 1) * 100) / fps);
    out.push(Math.max(2, target - acc));
    acc = target;
  }
  return out;
}
