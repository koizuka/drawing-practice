import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useUrlHistoryThumbnails } from './useUrlHistoryThumbnails';
import type { UrlHistoryEntry } from '../storage';

const entry = (url: string, extra: Partial<UrlHistoryEntry> = {}): UrlHistoryEntry => ({
  url,
  type: 'url',
  lastUsedAt: new Date(0),
  ...extra,
});

describe('useUrlHistoryThumbnails', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const createSpy = vi.fn<(blob: Blob) => string>();
  const revokeSpy = vi.fn<(url: string) => void>();

  beforeEach(() => {
    let n = 0;
    createSpy.mockReset().mockImplementation(() => `blob:fake-${++n}`);
    revokeSpy.mockReset();
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('keeps a failed thumbnail suppressed across a reload that still contains it', () => {
    const { result } = renderHook(() => useUrlHistoryThumbnails([]));
    act(() => result.current.markThumbError('https://a.example/x.png'));
    act(() =>
      result.current.pruneThumbErrors([
        entry('https://a.example/x.png'),
        entry('https://b.example/y.png'),
      ]),
    );
    expect(result.current.thumbErrors.has('https://a.example/x.png')).toBe(true);
  });

  it('drops the suppression once its entry is no longer in history', () => {
    const { result } = renderHook(() => useUrlHistoryThumbnails([]));
    act(() => result.current.markThumbError('https://a.example/x.png'));
    act(() => result.current.pruneThumbErrors([entry('https://b.example/y.png')]));
    expect(result.current.thumbErrors.has('https://a.example/x.png')).toBe(false);
  });

  it('keeps the same set identity when a prune removes nothing', () => {
    const { result } = renderHook(() => useUrlHistoryThumbnails([]));
    act(() => result.current.markThumbError('https://a.example/x.png'));
    const before = result.current.thumbErrors;
    act(() => result.current.pruneThumbErrors([entry('https://a.example/x.png')]));
    expect(result.current.thumbErrors).toBe(before);
  });

  it('mints ObjectURLs only for Blob-backed entries and revokes them when history changes', () => {
    const blob = new Blob(['x']);
    const first = [
      entry('local:1', { type: 'image', imageBlob: blob }),
      entry('https://sketchfab.com/models/abc', { type: 'sketchfab', imageBlob: blob }),
      entry('https://c.example/z.png'),
    ];
    const { result, rerender, unmount } = renderHook(({ h }) => useUrlHistoryThumbnails(h), {
      initialProps: { h: first },
    });
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect([...result.current.blobThumbUrls.keys()].sort()).toEqual([
      'https://sketchfab.com/models/abc',
      'local:1',
    ]);

    rerender({ h: [] });
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(result.current.blobThumbUrls.size).toBe(0);

    unmount();
    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });
});
