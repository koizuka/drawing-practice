import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import type { UrlHistoryEntry } from '../storage/db';
import { buildYouTubeThumbnailUrl } from '../utils/youtube';
import { resolveHistoryThumbnailSrc } from './urlHistoryThumbnail';

// Stub draft loader so the SplitLayout draft-restore effect resolves quickly.
vi.mock('../storage/sessionStore', () => ({
  saveDraft: vi.fn().mockResolvedValue(undefined),
  loadDraft: vi.fn().mockResolvedValue(undefined),
  clearDraft: vi.fn().mockResolvedValue(undefined),
}));

// Stub URL history so we can inject deterministic entries and observe the
// component's ObjectURL lifecycle without touching IndexedDB.
const getUrlHistoryMock = vi.fn<() => Promise<UrlHistoryEntry[]>>();
vi.mock('../storage/urlHistoryStore', () => ({
  addUrlHistory: vi.fn().mockResolvedValue(undefined),
  getUrlHistory: () => getUrlHistoryMock(),
  getUrlHistoryEntry: vi.fn().mockResolvedValue(undefined),
  deleteUrlHistory: vi.fn().mockResolvedValue(undefined),
  URL_HISTORY_LIMIT: 50,
  URL_HISTORY_IMAGE_LIMIT: 10,
}));

import { SplitLayout } from './SplitLayout';

describe('resolveHistoryThumbnailSrc', () => {
  const NOW = new Date();

  it('returns the ObjectURL for an image entry when one is registered', () => {
    const entry: UrlHistoryEntry = {
      url: 'local:abc',
      type: 'image',
      fileName: 'cat.jpg',
      imageBlob: new Blob(['x']),
      lastUsedAt: NOW,
    };
    const map = new Map([['local:abc', 'blob:fake-1']]);
    expect(resolveHistoryThumbnailSrc(entry, map)).toBe('blob:fake-1');
  });

  it('returns null for an image entry whose ObjectURL is missing', () => {
    // Defensive: matches the real failure mode where the imageBlob was
    // undefined at Map-build time and the entry should fall back to its icon.
    const entry: UrlHistoryEntry = {
      url: 'local:abc',
      type: 'image',
      fileName: 'cat.jpg',
      lastUsedAt: NOW,
    };
    expect(resolveHistoryThumbnailSrc(entry, new Map())).toBeNull();
  });

  it('derives a YouTube thumbnail URL from the canonical video id', () => {
    const entry: UrlHistoryEntry = {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      type: 'youtube',
      lastUsedAt: NOW,
    };
    expect(resolveHistoryThumbnailSrc(entry, new Map())).toBe(buildYouTubeThumbnailUrl('dQw4w9WgXcQ'));
  });

  it('returns null for a YouTube entry whose URL no longer parses to a video id', () => {
    const entry: UrlHistoryEntry = {
      url: 'https://youtube.com/results?search_query=foo',
      type: 'youtube',
      lastUsedAt: NOW,
    };
    expect(resolveHistoryThumbnailSrc(entry, new Map())).toBeNull();
  });

  it('uses the stored thumbnailUrl for a Pexels entry', () => {
    const entry: UrlHistoryEntry = {
      url: 'https://www.pexels.com/photo/x-1/',
      type: 'pexels',
      thumbnailUrl: 'https://images.pexels.com/photos/1/tiny.jpg',
      lastUsedAt: NOW,
    };
    expect(resolveHistoryThumbnailSrc(entry, new Map())).toBe(
      'https://images.pexels.com/photos/1/tiny.jpg',
    );
  });

  it('returns null for a Pexels entry without a stored thumbnailUrl', () => {
    // Older entries from before the thumbnailUrl field existed should fall
    // back to the type icon, not produce a broken Pexels page-URL <img>.
    const entry: UrlHistoryEntry = {
      url: 'https://www.pexels.com/photo/x-1/',
      type: 'pexels',
      lastUsedAt: NOW,
    };
    expect(resolveHistoryThumbnailSrc(entry, new Map())).toBeNull();
  });

  it('uses the entry url itself for a generic url entry (it is the image)', () => {
    const entry: UrlHistoryEntry = {
      url: 'https://example.com/picture.jpg',
      type: 'url',
      lastUsedAt: NOW,
    };
    expect(resolveHistoryThumbnailSrc(entry, new Map())).toBe('https://example.com/picture.jpg');
  });
});

describe('ReferencePanel ObjectURL lifecycle (via SplitLayout)', () => {
  const createObjectURLSpy = vi.fn<(blob: Blob) => string>();
  const revokeObjectURLSpy = vi.fn<(url: string) => void>();
  let counter = 0;

  beforeEach(() => {
    counter = 0;
    createObjectURLSpy.mockReset().mockImplementation(() => `blob:fake-${++counter}`);
    revokeObjectURLSpy.mockReset();
    // jsdom doesn't implement these on URL by default; install fresh spies
    // each test so we can observe call counts.
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
    getUrlHistoryMock.mockReset();
  });

  function imageEntry(key: string): UrlHistoryEntry {
    return {
      url: key,
      type: 'image',
      fileName: `${key}.jpg`,
      imageBlob: new Blob([key]),
      lastUsedAt: new Date(),
    };
  }

  it('creates one ObjectURL per image history entry and revokes them all on unmount', async () => {
    getUrlHistoryMock.mockResolvedValue([imageEntry('local:a'), imageEntry('local:b')]);

    const { unmount } = render(<SplitLayout />);
    // Wait for the URL-history reload effect to settle so imageThumbUrls is built.
    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalledTimes(2);
    });
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    unmount();
    // Every ObjectURL we minted must be revoked — no leaked blob references.
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2);
    const revokedArgs = (revokeObjectURLSpy as Mock).mock.calls.map(c => c[0]).sort();
    expect(revokedArgs).toEqual(['blob:fake-1', 'blob:fake-2']);
  });

  it('falls back to the type icon when an image thumbnail fails to load', async () => {
    // jsdom never actually fetches img.src, so the dropdown stays in the
    // "showing img" state until something triggers onError. We fire that event
    // manually to verify the icon-fallback path.
    getUrlHistoryMock.mockResolvedValue([
      { url: 'https://example.com/picture.jpg', type: 'url', lastUsedAt: new Date() },
    ]);

    render(<SplitLayout />);
    // Source-selection screen has rendered; URL input is now in the DOM.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/URL/i)).toBeInTheDocument();
    });

    // Open the Autocomplete popup so the option (and its <img>) render.
    const input = screen.getByPlaceholderText(/URL/i) as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.focus(input);

    const option = await screen.findByRole('option');
    // The thumbnail <img> is decorative (alt=""), so it has no accessible
    // "img" role — query by tag instead.
    const img = option.querySelector('img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.src).toBe('https://example.com/picture.jpg');
    // Lucide renders SVGs with a class; before the error there's no fallback icon.
    expect(option.querySelector('.lucide-image')).toBeNull();

    fireEvent.error(img!);

    // After the error, the same option should now show the fallback icon and
    // no <img>. We re-query the option to pick up the rerender.
    const refreshed = await screen.findByRole('option');
    expect(refreshed.querySelector('img')).toBeNull();
    expect(refreshed.querySelector('.lucide-image')).not.toBeNull();
  });

  it('does not flip the source-selection screen even when flip mode is on', async () => {
    // Regression: the outer reference-content Box used to apply scaleX(-1)
    // unconditionally, which made the source-selection / search UI text
    // unreadable. Flip should now apply only to the ImageViewer container,
    // not to the source-selection screen.
    getUrlHistoryMock.mockResolvedValue([]);

    const { container } = render(<SplitLayout />);
    await waitFor(() => {
      expect(screen.getByText('Sketchfab')).toBeInTheDocument();
    });

    // Toggle flip mode via the toolbar's lucide-icon button (no aria-label,
    // so we locate it by its icon class).
    const flipIcon = container.querySelector('.lucide-flip-horizontal-2');
    expect(flipIcon).not.toBeNull();
    const flipBtn = flipIcon!.closest('button') as HTMLButtonElement;
    fireEvent.click(flipBtn);

    // Walk up from the "Sketchfab" source-selection button: no ancestor
    // should carry an inline scaleX(-1) transform.
    const sketchfabBtn = screen.getByText('Sketchfab').closest('button') as HTMLButtonElement;
    expect(sketchfabBtn).not.toBeNull();
    for (let el: HTMLElement | null = sketchfabBtn; el; el = el.parentElement) {
      expect(el.style.transform).not.toContain('scaleX(-1)');
    }
  });

  it('only creates ObjectURLs for image entries, not for url/youtube/pexels', async () => {
    // url/youtube/pexels resolve their thumbnails without holding a Blob, so
    // they must not contribute to the ObjectURL Map. Otherwise we'd be paying
    // a leak per non-image dropdown render.
    getUrlHistoryMock.mockResolvedValue([
      { url: 'https://youtu.be/dQw4w9WgXcQ', type: 'youtube', lastUsedAt: new Date() },
      { url: 'https://example.com/x.jpg', type: 'url', lastUsedAt: new Date() },
      {
        url: 'https://www.pexels.com/photo/x-1/',
        type: 'pexels',
        thumbnailUrl: 'https://images.pexels.com/tiny.jpg',
        lastUsedAt: new Date(),
      },
      imageEntry('local:only'),
    ]);

    render(<SplitLayout />);
    await waitFor(() => {
      // SplitLayout has settled when the source-selection screen is showing
      // (which it does whenever no source is loaded, including post-mount).
      expect(screen.getByText('Sketchfab')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    });
  });
});
