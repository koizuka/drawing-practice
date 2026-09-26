import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReferenceImage } from './loadReferenceImage';

// Fake Image whose outcome is decided per instance: `failPlain` fails the
// first (non-CORS) load, `failCors` fails the crossOrigin upgrade.
let failPlain = false;
let failCors = false;
const created: FakeImage[] = [];
class FakeImage {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  constructor() {
    created.push(this);
  }
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    const fail = this.crossOrigin ? failCors : failPlain;
    queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
  }
}

describe('loadReferenceImage', () => {
  beforeEach(() => {
    failPlain = false;
    failCors = false;
    created.length = 0;
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with the CORS-upgraded image when the upgrade succeeds', async () => {
    const img = await loadReferenceImage('https://example.com/a.png');
    expect(created).toHaveLength(2);
    expect(img).toBe(created[1]);
    expect(img.crossOrigin).toBe('anonymous');
  });

  it('falls back to the plain image when the CORS upgrade fails', async () => {
    failCors = true;
    const img = await loadReferenceImage('https://example.com/a.png');
    expect(img).toBe(created[0]);
    expect(img.crossOrigin).toBeNull();
  });

  it('rejects when the plain load fails', async () => {
    failPlain = true;
    await expect(loadReferenceImage('https://example.com/a.png')).rejects.toThrow();
    expect(created).toHaveLength(1);
  });

  it('rejects with AbortError when aborted before completion', async () => {
    const controller = new AbortController();
    const p = loadReferenceImage('https://example.com/a.png', controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
