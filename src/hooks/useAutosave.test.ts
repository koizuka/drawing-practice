import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../storage/sessionStore', () => ({
  saveDraft: vi.fn().mockResolvedValue(undefined),
  clearDraft: vi.fn().mockResolvedValue(undefined),
}));

import { useAutosave } from './useAutosave';
import { saveDraft, clearDraft } from '../storage/sessionStore';

describe('useAutosave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeState = (overrides = {}) => ({
    strokes: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 }],
    redoStack: [],
    elapsedMs: 5000,
    source: 'sketchfab' as const,
    referenceInfo: { title: 'Test', author: 'Author', source: 'sketchfab' as const, sketchfabUid: 'test-uid' },
    referenceImageData: 'data:image/png;base64,abc',
    grid: { mode: 'normal' as const },
    lines: [],
    ...overrides,
  });

  it('does not save on initial render (changeVersion=0)', () => {
    const suppressRef = { current: false };
    renderHook(() => useAutosave(() => makeState(), 0, 0, suppressRef));

    vi.advanceTimersByTime(3000);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves after debounce delay when changeVersion > 0', async () => {
    const suppressRef = { current: false };
    const { rerender } = renderHook(
      ({ version }) => useAutosave(() => makeState(), version, 0, suppressRef),
      { initialProps: { version: 0 } },
    );

    rerender({ version: 1 });

    // Not yet saved (before debounce)
    expect(saveDraft).not.toHaveBeenCalled();

    // Advance past debounce (2 seconds)
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid changes', async () => {
    const suppressRef = { current: false };
    const { rerender } = renderHook(
      ({ version }) => useAutosave(() => makeState(), version, 0, suppressRef),
      { initialProps: { version: 0 } },
    );

    // Rapid changes
    rerender({ version: 1 });
    vi.advanceTimersByTime(500);
    rerender({ version: 2 });
    vi.advanceTimersByTime(500);
    rerender({ version: 3 });

    // Advance past debounce from last change
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    // Should only save once (the debounced call)
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('clears draft when no strokes and no reference', async () => {
    const suppressRef = { current: false };
    const { rerender } = renderHook(
      ({ version }) => useAutosave(() => makeState({ strokes: [], source: 'none' }), version, 0, suppressRef),
      { initialProps: { version: 0 } },
    );

    rerender({ version: 1 });
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(clearDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('does not save when suppressed', async () => {
    const suppressRef = { current: true };
    const { rerender } = renderHook(
      ({ version }) => useAutosave(() => makeState(), version, 0, suppressRef),
      { initialProps: { version: 0 } },
    );

    rerender({ version: 1 });
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(saveDraft).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('flushes immediately when flushVersion changes', async () => {
    const suppressRef = { current: false };
    const { rerender } = renderHook(
      ({ flush }) => useAutosave(() => makeState(), 0, flush, suppressRef),
      { initialProps: { flush: 0 } },
    );

    await act(async () => {
      rerender({ flush: 1 });
    });

    // Saved without advancing the debounce timer.
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('cancels pending debounce when flushVersion fires', async () => {
    const suppressRef = { current: false };
    const { rerender } = renderHook(
      ({ version, flush }) => useAutosave(() => makeState(), version, flush, suppressRef),
      { initialProps: { version: 0, flush: 0 } },
    );

    // Schedule a debounced save, then before it fires bump flushVersion.
    rerender({ version: 1, flush: 0 });
    vi.advanceTimersByTime(1000);

    await act(async () => {
      rerender({ version: 1, flush: 1 });
    });

    // Immediate save fired once.
    expect(saveDraft).toHaveBeenCalledTimes(1);

    // Past the original debounce: still only one save (pending timer was cancelled).
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('respects suppressRef on immediate flush', async () => {
    const suppressRef = { current: true };
    const { rerender } = renderHook(
      ({ flush }) => useAutosave(() => makeState(), 0, flush, suppressRef),
      { initialProps: { flush: 0 } },
    );

    await act(async () => {
      rerender({ flush: 1 });
    });

    expect(saveDraft).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('uses latest state on flush (no stale capture)', async () => {
    const suppressRef = { current: false };
    let currentState = makeState({ referenceInfo: { title: 'Old', author: 'A', source: 'sketchfab' as const, sketchfabUid: 'old' } });
    const { rerender } = renderHook(
      ({ flush }) => useAutosave(() => currentState, 0, flush, suppressRef),
      { initialProps: { flush: 0 } },
    );

    // Update state, then bump flushVersion. The hook captures getState via ref,
    // so the latest reference data should make it into saveDraft.
    currentState = makeState({ referenceInfo: { title: 'New', author: 'B', source: 'sketchfab' as const, sketchfabUid: 'new' } });

    await act(async () => {
      rerender({ flush: 1 });
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
    const arg = (saveDraft as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.referenceInfo).toMatchObject({ title: 'New', sketchfabUid: 'new' });
  });
});
