import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReferenceSnapshot } from '../drawing/types';
import type { ReferenceSetters } from '../components/ReferencePanel';
import type { UrlHistoryEntry } from '../storage';

vi.mock('../storage', () => ({
  addUrlHistory: vi.fn().mockResolvedValue(undefined),
  deleteUrlHistory: vi.fn().mockResolvedValue(undefined),
  getUrlHistory: vi.fn().mockResolvedValue([]),
  getUrlHistoryEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/youtube', async (orig) => ({
  ...(await orig<typeof import('../utils/youtube')>()),
  fetchYouTubeTitle: vi.fn().mockResolvedValue('A video'),
}));

import { useUrlReferenceLoader } from './useUrlReferenceLoader';
import { addUrlHistory, deleteUrlHistory, getUrlHistory, getUrlHistoryEntry } from '../storage';

function setup() {
  const applied: ReferenceSnapshot[] = [];
  const onReferenceChange = vi.fn((mutate: (s: ReferenceSetters) => void) => {
    mutate({
      setSource: vi.fn(),
      setReferenceMode: vi.fn(),
      setFixedImageUrl: vi.fn(),
      setLocalImageUrl: vi.fn(),
      setReferenceInfo: vi.fn(),
      setAll: (snap) => applied.push(snap),
    });
  });
  const opts = {
    onReferenceChange,
    applySketchfabRestore: vi.fn(),
    applyPexelsRestore: vi.fn(),
    loadSketchfabModel: vi.fn(),
    onRegisterReloadUrlHistory: vi.fn(),
  };
  const hook = renderHook(() => useUrlReferenceLoader(opts));
  return { ...hook, opts, applied };
}

describe('useUrlReferenceLoader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads history on mount and registers the reload with the parent', async () => {
    const entry: UrlHistoryEntry = { url: 'https://a/x.png', type: 'url', lastUsedAt: new Date(0) };
    vi.mocked(getUrlHistory).mockResolvedValueOnce([entry]);
    const { result, opts } = setup();
    await waitFor(() => expect(result.current.urlHistory).toEqual([entry]));
    expect(opts.onRegisterReloadUrlHistory).toHaveBeenCalledWith(expect.any(Function));
  });

  it('rejects a malformed URL without touching the reference', () => {
    const { result, opts } = setup();
    act(() => result.current.loadFromUrl('not a url'));
    expect(result.current.urlError).not.toBeNull();
    expect(result.current.urlLoading).toBe(false);
    expect(opts.onReferenceChange).not.toHaveBeenCalled();
  });

  it('ignores a blank URL', () => {
    const { result, opts } = setup();
    act(() => result.current.loadFromUrl('   '));
    expect(result.current.urlError).toBeNull();
    expect(opts.onReferenceChange).not.toHaveBeenCalled();
  });

  it('routes a YouTube URL to youtube browse with one reference change + history add', async () => {
    const { result, opts, applied } = setup();
    act(() => result.current.changeUrlInput('https://youtu.be/dQw4w9WgXcQ'));
    act(() => result.current.loadFromUrl('https://youtu.be/dQw4w9WgXcQ'));
    expect(opts.onReferenceChange).toHaveBeenCalledTimes(1);
    expect(applied[0]).toMatchObject({
      source: 'youtube',
      referenceMode: 'browse',
      referenceInfo: { youtubeVideoId: 'dQw4w9WgXcQ' },
    });
    expect(result.current.urlInput).toBe('');
    await waitFor(() =>
      expect(addUrlHistory).toHaveBeenCalledWith(
        'https://youtu.be/dQw4w9WgXcQ',
        'youtube',
        'A video',
      ),
    );
  });

  it('routes a Sketchfab URL to sketchfab browse and loads the model with the saved title', async () => {
    const uid = '0123456789abcdef0123456789abcdef';
    vi.mocked(getUrlHistoryEntry).mockResolvedValueOnce({
      url: `https://sketchfab.com/models/${uid}`,
      type: 'sketchfab',
      title: 'Teapot',
      lastUsedAt: new Date(0),
      sketchfabSearchContext: { query: 'tea', timeFilter: 'all' },
    } as UrlHistoryEntry);
    const { result, opts, applied } = setup();
    act(() => result.current.loadFromUrl(`https://sketchfab.com/3d-models/teapot-${uid}`));
    expect(applied[0]).toMatchObject({ source: 'sketchfab', referenceMode: 'browse' });
    await waitFor(() =>
      expect(opts.loadSketchfabModel).toHaveBeenCalledWith(uid, { name: 'Teapot', author: '' }),
    );
    expect(opts.applySketchfabRestore).toHaveBeenCalledWith({
      query: 'tea',
      category: undefined,
      timeFilter: 'all',
    });
  });

  it('restores a Blob-backed image history entry straight into fixed mode', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    const { result, applied } = setup();
    act(() =>
      result.current.selectHistoryEntry({
        url: 'local:abc',
        type: 'image',
        fileName: 'cat.png',
        imageBlob: blob,
        lastUsedAt: new Date(0),
      }),
    );
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({
      source: 'image',
      referenceMode: 'fixed',
      fixedImageUrl: null,
      referenceInfo: { fileName: 'cat.png', url: 'local:abc' },
    });
    expect(applied[0].localImageUrl).toMatch(/^data:/);
  });

  it('deletes a history entry and reloads the list', async () => {
    const { result } = setup();
    await waitFor(() => expect(getUrlHistory).toHaveBeenCalledTimes(1));
    act(() => result.current.deleteHistoryEntry('https://a/x.png'));
    expect(deleteUrlHistory).toHaveBeenCalledWith('https://a/x.png');
    await waitFor(() => expect(getUrlHistory).toHaveBeenCalledTimes(2));
  });

  it('typing clears a previous error', () => {
    const { result } = setup();
    act(() => result.current.reportLoadError());
    expect(result.current.urlError).not.toBeNull();
    act(() => result.current.changeUrlInput('h'));
    expect(result.current.urlError).toBeNull();
  });
});
