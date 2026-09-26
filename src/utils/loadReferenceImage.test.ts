import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReferenceImage } from './loadReferenceImage';

// Fake Image whose outcome is decided per instance: `failPlain` fails the
// first (non-CORS) load, `failCors` fails the crossOrigin upgrade.
let failPlain = false;
let failCors = false;
// When true the CORS upgrade load never settles (stays in flight).
let holdCors = false;
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
    if (v === '' || (this.crossOrigin && holdCors)) return;
    const fail = this.crossOrigin ? failCors : failPlain;
    queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
  }
}

describe('loadReferenceImage', () => {
  beforeEach(() => {
    failPlain = false;
    failCors = false;
    holdCors = false;
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

  it('cancels the in-flight request on abort (detaches handlers, clears src)', async () => {
    const controller = new AbortController();
    const p = loadReferenceImage('https://example.com/a.png', controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe('');
    expect(created[0].onload).toBeNull();
    expect(created[0].onerror).toBeNull();
  });

  it('cancels the CORS upgrade request when aborted mid-upgrade', async () => {
    holdCors = true;
    const controller = new AbortController();
    const p = loadReferenceImage('https://example.com/a.png', controller.signal);
    // Let the plain load complete so the CORS upgrade image is created.
    await new Promise<void>((r) => queueMicrotask(r));
    expect(created).toHaveLength(2);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(created[1].src).toBe('');
    expect(created[1].onload).toBeNull();
  });
});
