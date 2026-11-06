import { describe, expect, it } from 'vitest';
import { diffRect, encodeGif, frameDelaysCs, lzwEncode } from './gifEncoder';

/** Reference GIF LZW decoder (written from the spec, independent of the encoder). */
function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
    codeSize = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bitPos = 0;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[(bitPos + i) >> 3];
      if (byte === undefined) throw new Error('eof');
      code |= ((byte >> ((bitPos + i) & 7)) & 1) << i;
    }
    bitPos += codeSize;
    return code;
  };
  let prev: number[] | null = null;
  for (;;) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (code === table.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`bad code ${code} (table ${table.length})`);
    out.push(...entry);
    if (prev && table.length < 4096) {
      table.push([...prev, entry[0]]);
      if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  expect(out.length).toBe(expected);
  return out;
}

/** Split a GIF into its parts (enough structure to check our own output). */
function parseGif(bytes: Uint8Array) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => {
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  p = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  const tableSize = 1 << ((packed & 7) + 1);
  const palette: number[] = [];
  for (let i = 0; i < tableSize; i++) {
    palette.push((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]);
    p += 3;
  }
  const frames: { x: number; y: number; w: number; h: number; delay: number; pixels: number[] }[] =
    [];
  let loopCount: number | null = null;
  const disposals: number[] = [];
  let delay = 0;
  const readBlocks = () => {
    const parts: number[] = [];
    for (let n = u8(); n !== 0; n = u8()) {
      for (let i = 0; i < n; i++) parts.push(u8());
    }
    return new Uint8Array(parts);
  };
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      const body = readBlocks();
      if (label === 0xf9) {
        disposals.push((body[0] >> 2) & 7);
        delay = body[1] | (body[2] << 8);
      }
      if (label === 0xff && String.fromCharCode(...body.subarray(0, 11)) === 'NETSCAPE2.0') {
        // Sub-block 1 = [0x01, countLo, countHi]; 0 means loop forever.
        loopCount = body[11] === 1 ? body[12] | (body[13] << 8) : null;
      }
    } else if (b === 0x2c) {
      const x = u16(),
        y = u16(),
        w = u16(),
        h = u16();
      u8();
      const min = u8();
      const pixels = lzwDecode(readBlocks(), min, w * h);
      frames.push({ x, y, w, h, delay, pixels });
    } else {
      throw new Error(`unexpected block 0x${b.toString(16)}`);
    }
  }
  return { header, width, height, palette, frames, loopCount, disposals };
}

describe('lzwEncode', () => {
  it.each([
    ['empty', [] as number[], 2],
    ['single', [1], 2],
    ['run', Array.from({ length: 5000 }, () => 3), 2],
    ['pattern', Array.from({ length: 3000 }, (_, i) => i % 4), 2],
  ])('round-trips %s', (_name, data, min) => {
    expect(lzwDecode(lzwEncode(data, min), min, data.length)).toEqual(data);
  });

  it('round-trips pseudo-random 8-bit data across several table resets', () => {
    let seed = 12345;
    const data = Array.from({ length: 60_000 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 16) & 0xff;
    });
    expect(lzwDecode(lzwEncode(data, 8), 8, data.length)).toEqual(data);
  });
});

describe('diffRect', () => {
  it('finds the changed rectangle', () => {
    const a = new Uint8Array(5 * 4);
    const b = a.slice();
    b[1 * 5 + 1] = 2;
    b[2 * 5 + 3] = 2;
    expect(diffRect(a, b, 5, 4)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
    expect(diffRect(a, a.slice(), 5, 4)).toBeNull();
  });
});

describe('encodeGif', () => {
  it('writes a looping GIF89a whose frames reconstruct the input', () => {
    const w = 6,
      h = 4;
    const f0 = new Uint8Array(w * h);
    const f1 = f0.slice();
    f1[2 * w + 4] = 1;
    f1[3 * w + 5] = 2;
    const f2 = f1.slice(); // identical frame
    const gif = parseGif(
      encodeGif({
        width: w,
        height: h,
        palette: [0xffffff, 0x000000, 0x2f6fdf],
        frames: [
          { indices: f0, delayCs: 13 },
          { indices: f1, delayCs: 12 },
          { indices: f2, delayCs: 13 },
        ],
      }),
    );
    expect(gif.header).toBe('GIF89a');
    expect([gif.width, gif.height]).toEqual([w, h]);
    expect(gif.loopCount).toBe(0); // forever
    expect(gif.disposals).toEqual([1, 1, 1]); // keep — the compositing below relies on it
    expect(gif.palette.slice(0, 3)).toEqual([0xffffff, 0x000000, 0x2f6fdf]);
    expect(gif.palette).toHaveLength(4); // padded to a power of two
    expect(gif.frames.map((f) => f.delay)).toEqual([13, 12, 13]);

    // Composite (disposal = keep) and compare with each input frame.
    const screen = Array.from({ length: w * h }, () => -1);
    const inputs = [f0, f1, f2];
    gif.frames.forEach((fr, i) => {
      for (let y = 0; y < fr.h; y++) {
        for (let x = 0; x < fr.w; x++) screen[(fr.y + y) * w + fr.x + x] = fr.pixels[y * fr.w + x];
      }
      expect(screen).toEqual(Array.from(inputs[i]));
    });
    // Frame 2 only carries its changed rectangle; the duplicate is 1×1.
    expect(gif.frames[1]).toMatchObject({ x: 4, y: 2, w: 2, h: 2 });
    expect(gif.frames[2]).toMatchObject({ w: 1, h: 1 });
  });

  it('rejects bad input', () => {
    const frames = [{ indices: new Uint8Array(4), delayCs: 10 }];
    expect(() => encodeGif({ width: 2, height: 2, palette: [], frames })).toThrow();
    expect(() => encodeGif({ width: 2, height: 2, palette: [0], frames: [] })).toThrow();
    expect(() => encodeGif({ width: 3, height: 2, palette: [0], frames })).toThrow();
  });
});

describe('frameDelaysCs', () => {
  it('keeps the total duration exact', () => {
    expect(frameDelaysCs(4, 8)).toEqual([13, 12, 13, 12]);
    expect(frameDelaysCs(3, 4)).toEqual([25, 25, 25]);
    const d = frameDelaysCs(24, 24);
    expect(d.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.min(...d)).toBeGreaterThanOrEqual(4);
  });
});
