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
vi.mock('../utils/pexels', async (orig) => ({
  ...(await orig<typeof import('../utils/pexels')>()),
  getPhoto: vi.fn(),
}));
vi.mock('../utils/youtube', async (orig) => ({
  ...(await orig<typeof import('../utils/youtube')>()),
  fetchYouTubeTitle: vi.fn().mockResolvedValue('A video'),
}));

import { useUrlReferenceLoader } from './useUrlReferenceLoader';
import { addUrlHistory, deleteUrlHistory, getUrlHistory, getUrlHistoryEntry } from '../storage';
import { getPhoto, type PexelsPhoto } from '../utils/pexels';

function setup() {
  const applied: ReferenceSnapshot[] = [];
  // Mirrors SplitLayout's referenceGenerationRef: every reference change and
  // every load start is a new generation.
  let generation = 0;
  const beginReferenceLoad = () => {
    const mine = ++generation;
    return () => mine === generation;
  };
  const onReferenceChange = vi.fn((mutate: (s: ReferenceSetters) => void) => {
    generation++;
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
    beginReferenceLoad,
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

  describe('superseded loads (#423)', () => {
    /** Controllable stand-in for the preload `Image` (jsdom never loads). */
    class FakeImage {
      static instances: FakeImage[] = [];
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin: string | null = null;
      naturalWidth = 0;
      src = '';
      constructor() {
        FakeImage.instances.push(this);
      }
      succeed() {
        this.naturalWidth = 10;
        this.onload?.();
      }
    }
    const byUrl = (url: string) => FakeImage.instances.find((i) => i.src === url)!;
    const OriginalImage = globalThis.Image;
    beforeEach(() => {
      FakeImage.instances = [];
      globalThis.Image = FakeImage as unknown as typeof Image;
    });
    afterEach(() => {
      globalThis.Image = OriginalImage;
    });

    it('a slow earlier image URL does not overwrite a newer one', () => {
      const { result, applied } = setup();
      act(() => result.current.loadFromUrl('https://a.example/slow.png'));
      act(() => result.current.loadFromUrl('https://b.example/fast.png'));
      act(() => byUrl('https://b.example/fast.png').succeed());
      act(() => byUrl('https://a.example/slow.png').succeed());
      expect(applied).toHaveLength(1);
      expect(applied[0].fixedImageUrl).toBe('https://b.example/fast.png');
      expect(result.current.urlLoading).toBe(false);
    });

    it('navigating away cancels a pending image URL and clears the spinner', () => {
      const { result, opts, applied } = setup();
      act(() => result.current.loadFromUrl('https://a.example/slow.png'));
      expect(result.current.urlLoading).toBe(true);
      // e.g. the user opens another source (any changeReference).
      act(() => opts.onReferenceChange(() => {}));
      act(() => byUrl('https://a.example/slow.png').succeed());
      expect(applied).toHaveLength(0);
      expect(result.current.urlLoading).toBe(false);
    });

    it('a stale failure does not show an error over the newer reference', () => {
      const { result, applied } = setup();
      act(() => result.current.loadFromUrl('https://a.example/broken.png'));
      act(() => result.current.loadFromUrl('https://youtu.be/dQw4w9WgXcQ'));
      const instances = () =>
        FakeImage.instances.filter((x) => x.src === 'https://a.example/broken.png');
      act(() => instances()[0].onerror?.()); // CORS attempt fails → plain retry
      expect(instances()).toHaveLength(2);
      act(() => instances()[1].onerror?.()); // retry fails too
      expect(result.current.urlError).toBeNull();
      expect(applied.map((a) => a.source)).toEqual(['youtube']);
    });

    it('a slow Pexels lookup is dropped once a newer load wins', async () => {
      let resolveSlow!: (p: PexelsPhoto) => void;
      vi.mocked(getPhoto).mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
      const { result, applied } = setup();
      act(() => result.current.loadFromUrl('https://www.pexels.com/photo/slow-123/'));
      act(() => result.current.loadFromUrl('https://youtu.be/dQw4w9WgXcQ'));
      await act(async () => {
        resolveSlow({
          id: 123,
          alt: 'slow',
          photographer: 'P',
          photographer_url: 'https://www.pexels.com/@p',
          url: 'https://www.pexels.com/photo/slow-123/',
          src: { large2x: 'https://cdn/slow.jpg', tiny: 'https://cdn/t.jpg' },
        } as PexelsPhoto);
      });
      expect(applied.map((a) => a.source)).toEqual(['youtube']);
    });

    describe('with a controllable FileReader', () => {
      /** FileReader whose completion the test triggers explicitly. */
      class FakeFileReader {
        static instances: FakeFileReader[] = [];
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result: string | null = null;
        constructor() {
          FakeFileReader.instances.push(this);
        }
        readAsDataURL() {}
        finish(dataUrl = 'data:image/png;base64,AAA') {
          this.result = dataUrl;
          this.onload?.();
        }
      }
      const OriginalFileReader = globalThis.FileReader;
      beforeEach(() => {
        FakeFileReader.instances = [];
        globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
      });
      afterEach(() => {
        globalThis.FileReader = OriginalFileReader;
      });

      const imageEntry: UrlHistoryEntry = {
        url: 'local:abc',
        type: 'image',
        fileName: 'cat.png',
        imageBlob: new Blob(['img'], { type: 'image/png' }),
        lastUsedAt: new Date(0),
      };

      it('a history image decoded after a newer selection is dropped', () => {
        const { result, applied } = setup();
        act(() => result.current.selectHistoryEntry(imageEntry));
        // Newer synchronous load lands before the FileReader finishes.
        act(() => result.current.loadFromUrl('https://youtu.be/dQw4w9WgXcQ'));
        expect(FakeFileReader.instances).toHaveLength(1);
        act(() => FakeFileReader.instances[0].finish());
        expect(applied.map((a) => a.source)).toEqual(['youtube']);
      });

      it('a history image that is still current is applied', () => {
        const { result, applied } = setup();
        act(() => result.current.selectHistoryEntry(imageEntry));
        act(() => FakeFileReader.instances[0].finish());
        expect(applied.map((a) => a.source)).toEqual(['image']);
      });

      it('a blob load superseding a URL preload clears the spinner at once', () => {
        const { result, applied } = setup();
        act(() => result.current.loadFromUrl('https://a.example/slow.png'));
        expect(result.current.urlLoading).toBe(true);
        act(() => result.current.selectHistoryEntry(imageEntry));
        expect(result.current.urlLoading).toBe(false);
        act(() => FakeFileReader.instances[0].finish());
        // The stale preload settling afterwards changes nothing.
        act(() => byUrl('https://a.example/slow.png').succeed());
        expect(result.current.urlLoading).toBe(false);
        expect(applied.map((a) => a.source)).toEqual(['image']);
      });
    });

    it('a Sketchfab paste does not load the model after the user has moved on', async () => {
      const uid = '0123456789abcdef0123456789abcdef';
      let resolveLookup!: (e: UrlHistoryEntry | undefined) => void;
      vi.mocked(getUrlHistoryEntry).mockReturnValueOnce(new Promise((r) => (resolveLookup = r)));
      const { result, opts } = setup();
      act(() => result.current.loadFromUrl(`https://sketchfab.com/models/${uid}`));
      act(() => opts.onReferenceChange(() => {})); // e.g. Close
      await act(async () => {
        resolveLookup({
          url: `https://sketchfab.com/models/${uid}`,
          type: 'sketchfab',
          title: 'Teapot',
          lastUsedAt: new Date(0),
          sketchfabSearchContext: { query: 'tea', timeFilter: 'all' },
        } as UrlHistoryEntry);
      });
      expect(opts.loadSketchfabModel).not.toHaveBeenCalled();
      expect(opts.applySketchfabRestore).not.toHaveBeenCalled();
    });

    it("a Pexels photo's search context is not restored after the user has moved on", async () => {
      vi.mocked(getPhoto).mockResolvedValueOnce({
        id: 1,
        alt: 'p',
        photographer: 'P',
        photographer_url: 'https://www.pexels.com/@p',
        url: 'https://www.pexels.com/photo/p-1/',
        src: { large2x: 'https://cdn/p.jpg', tiny: 'https://cdn/t.jpg' },
      } as PexelsPhoto);
      let resolveLookup!: (e: UrlHistoryEntry | undefined) => void;
      vi.mocked(getUrlHistoryEntry).mockReturnValueOnce(new Promise((r) => (resolveLookup = r)));
      const { result, opts, applied } = setup();
      act(() => result.current.loadFromUrl('https://www.pexels.com/photo/p-1/'));
      await waitFor(() => expect(applied.map((a) => a.source)).toEqual(['pexels']));
      act(() => opts.onReferenceChange(() => {})); // moved on
      await act(async () => {
        resolveLookup({
          url: 'https://www.pexels.com/photo/p-1/',
          type: 'pexels',
          lastUsedAt: new Date(0),
          pexelsSearchContext: { query: 'cats', orientation: 'all' },
        } as UrlHistoryEntry);
      });
      expect(opts.applyPexelsRestore).not.toHaveBeenCalled();
    });
  });
});
