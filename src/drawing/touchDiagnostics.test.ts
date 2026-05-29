import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveEnabled,
  diag,
  resetDiag,
  logEvent,
  getLog,
  clearLog,
  serializeLog,
  loadPersistedLog,
  registerStateProbe,
  readState,
  registerRecoveryActions,
  getRecoveryActions,
} from './touchDiagnostics';

function makeStorage(initial: Record<string, string> = {}): Storage & { _data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    _data: data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
  } as Storage & { _data: Record<string, string> };
}

describe('resolveEnabled', () => {
  it('enables and persists on ?diag=touch', () => {
    const storage = makeStorage();
    expect(resolveEnabled('?diag=touch', storage)).toBe(true);
    expect(storage._data.diag).toBe('touch');
  });

  it('disables and clears on ?diag=off', () => {
    const storage = makeStorage({ diag: 'touch' });
    expect(resolveEnabled('?diag=off', storage)).toBe(false);
    expect(storage._data.diag).toBeUndefined();
  });

  it('falls back to persisted flag when no query param', () => {
    expect(resolveEnabled('', makeStorage({ diag: 'touch' }))).toBe(true);
    expect(resolveEnabled('', makeStorage())).toBe(false);
  });

  it('ignores unrelated query params', () => {
    expect(resolveEnabled('?foo=bar', makeStorage())).toBe(false);
  });
});

describe('ring buffer', () => {
  beforeEach(() => {
    clearLog();
    resetDiag();
  });

  it('caps the log at 200 entries, dropping the oldest', () => {
    for (let i = 0; i < 250; i++) logEvent('e', { i });
    const log = getLog();
    expect(log).toHaveLength(200);
    // Oldest survivor should be entry #50 (0..49 dropped).
    expect(log[0].detail?.i).toBe(50);
    expect(log[log.length - 1].detail?.i).toBe(249);
  });

  it('serializeLog includes counters and events', () => {
    diag.touchstart = 3;
    logEvent('start', { touchType: 'stylus' });
    const out = serializeLog();
    expect(out).toContain('touchstart');
    expect(out).toContain('start');
    expect(out).toContain('stylus');
  });

  it('clearLog empties the buffer', () => {
    logEvent('x');
    expect(getLog().length).toBeGreaterThan(0);
    clearLog();
    expect(getLog()).toHaveLength(0);
  });

  it('loadPersistedLog drops malformed entries so the overlay cannot crash', () => {
    clearLog();
    window.localStorage.setItem('diag.log', JSON.stringify([
      { t: 100, type: 'start', detail: { touches: 1 } }, // valid
      { t: 'oops', type: 'bad' }, // t not a number
      { type: 'noTimestamp' }, // missing t
      { t: 200 }, // missing type
      'not-an-object', // wrong type
      { t: 300, type: 'end' }, // valid, no detail
    ]));
    loadPersistedLog();
    const log = getLog();
    expect(log).toHaveLength(2);
    expect(log.map(e => e.type)).toEqual(['start', 'end']);
    // serializeLog must not throw on the loaded entries.
    expect(() => serializeLog()).not.toThrow();
    window.localStorage.removeItem('diag.log');
  });
});

describe('resetDiag', () => {
  it('zeroes all counters', () => {
    diag.touchmove = 99;
    diag.appendOk = 42;
    diag.lastResetTrigger = 'blur';
    resetDiag();
    expect(diag.touchmove).toBe(0);
    expect(diag.appendOk).toBe(0);
    expect(diag.lastResetTrigger).toBeNull();
  });
});

describe('state probe registry', () => {
  it('returns the registered probe value and null after unregister', () => {
    registerStateProbe(() => ({
      hasStylus: true,
      activeTouchCount: 2,
      activeTouchIds: [1, 2],
      pinchActive: true,
      strokeCount: 5,
      mode: 'pen',
      drawing: true,
    }));
    expect(readState()?.strokeCount).toBe(5);
    registerStateProbe(null);
    expect(readState()).toBeNull();
  });
});

describe('recovery actions registry', () => {
  it('stores and returns callable actions', () => {
    let called = '';
    registerRecoveryActions({
      resetSession: () => { called = 'reset'; },
      clearStylus: () => { called = 'stylus'; },
      forceRedraw: () => { called = 'redraw'; },
      nudgeCompositor: () => { called = 'nudge'; },
    });
    getRecoveryActions()?.clearStylus();
    expect(called).toBe('stylus');
    registerRecoveryActions(null);
    expect(getRecoveryActions()).toBeNull();
  });
});
