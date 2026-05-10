import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import type { DrawingRecord, UrlHistoryEntry } from '../storage';
import type { ReferenceInfo } from '../types';
import { GROUP_MODE_STORAGE_KEY } from './galleryGrouping';

const getAllDrawingsMock = vi.fn<() => Promise<DrawingRecord[]>>();
const bulkDeleteDrawingsMock = vi.fn<(ids: readonly number[]) => Promise<void>>();
const getUrlHistoryEntryMock = vi.fn<(url: string) => Promise<UrlHistoryEntry | undefined>>();

vi.mock('../storage', () => ({
  getAllDrawings: () => getAllDrawingsMock(),
  bulkDeleteDrawings: (ids: readonly number[]) => bulkDeleteDrawingsMock(ids),
  computeStorageUsage: () => Promise.resolve({
    drawings: { strokes: 0, thumbnails: 0, sketchfabImages: 0 },
    urlHistoryImageBytes: 0,
    sessionBytes: 0,
    estimateUsage: null,
    estimateQuota: null,
  }),
  formatBytes: (n: number) => `${n} B`,
}));
vi.mock('../storage/urlHistoryStore', () => ({
  getUrlHistoryEntry: (url: string) => getUrlHistoryEntryMock(url),
}));

import { Gallery } from './Gallery';

const sketchfabRef: ReferenceInfo = {
  source: 'sketchfab',
  sketchfabUid: 'cat-uid',
  title: 'Cat',
  author: 'Alice',
  imageUrl: 'data:image/png;base64,SKETCHFAB',
};
const youtubeRef: ReferenceInfo = {
  source: 'youtube',
  youtubeVideoId: 'vidYT',
  title: 'Pose',
  author: 'Bob',
};

let nextId = 1;
function makeDrawing(createdAt: string, reference?: ReferenceInfo): DrawingRecord {
  return {
    id: nextId++,
    strokes: [],
    thumbnail: 'data:image/png;base64,THUMB',
    referenceInfo: '',
    reference,
    createdAt: new Date(createdAt),
    elapsedMs: 60_000,
  };
}

beforeAll(() => {
  if (typeof URL.createObjectURL === 'undefined') {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), writable: true });
  }
  if (typeof URL.revokeObjectURL === 'undefined') {
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  }
});

beforeEach(() => {
  nextId = 1;
  localStorage.clear();
  getAllDrawingsMock.mockReset();
  bulkDeleteDrawingsMock.mockReset();
  bulkDeleteDrawingsMock.mockResolvedValue(undefined);
  getUrlHistoryEntryMock.mockReset();
  getUrlHistoryEntryMock.mockResolvedValue(undefined);
});

describe('Gallery', () => {
  it('renders default date mode and shows the mode toggle', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
      makeDrawing('2026-03-10T10:00:00Z', youtubeRef),
    ]);
    render(<Gallery onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Gallery (2)')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'By date' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'By reference (first used)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'By reference (recently used)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows per-card "Use this reference" buttons in date mode', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
      makeDrawing('2026-03-10T10:00:00Z', youtubeRef),
    ]);
    render(<Gallery onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Gallery (2)')).toBeInTheDocument());
    // Two drawings → two "Use this reference" buttons (one per card).
    expect(screen.getAllByRole('button', { name: 'Use this reference' })).toHaveLength(2);
  });

  it('moves "Use this reference" to the group label in ref-first mode and consolidates duplicates', async () => {
    // Three drawings, two of which share the same sketchfab reference.
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
      makeDrawing('2026-04-01T10:00:00Z', sketchfabRef),
      makeDrawing('2026-03-10T10:00:00Z', youtubeRef),
    ]);
    render(<Gallery onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gallery (3)')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'By reference (first used)' }));

    // Two unique references → exactly two "Use this reference" buttons (one per group label).
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Use this reference' })).toHaveLength(2),
    );
  });

  it('persists the selected mode to localStorage', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
    ]);
    render(<Gallery onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gallery (1)')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'By reference (recently used)' }));
    expect(localStorage.getItem(GROUP_MODE_STORAGE_KEY)).toBe('ref-recent');

    fireEvent.click(screen.getByRole('button', { name: 'By date' }));
    expect(localStorage.getItem(GROUP_MODE_STORAGE_KEY)).toBe('date');
  });

  it('restores the persisted mode on next mount', async () => {
    localStorage.setItem(GROUP_MODE_STORAGE_KEY, 'ref-first');
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
    ]);
    render(<Gallery onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'By reference (first used)' }))
        .toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('calls onLoadReference and onClose when the group-label load button is clicked', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
    ]);
    const onLoadReference = vi.fn();
    const onClose = vi.fn();
    render(<Gallery onClose={onClose} onLoadReference={onLoadReference} />);
    await waitFor(() => expect(screen.getByText('Gallery (1)')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'By reference (first used)' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use this reference' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use this reference' }));

    expect(onLoadReference).toHaveBeenCalledWith(sketchfabRef);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not delete anything until the bulk-delete button is pressed', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
      makeDrawing('2026-03-10T10:00:00Z', youtubeRef),
    ]);
    render(<Gallery onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gallery (2)')).toBeInTheDocument());

    // No bulk-delete button exists when nothing is selected.
    expect(screen.queryByRole('button', { name: /^Delete \(/ })).toBeNull();
    expect(bulkDeleteDrawingsMock).not.toHaveBeenCalled();
  });

  it('selects via checkbox and bulk-deletes via the delete button', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
      makeDrawing('2026-03-10T10:00:00Z', youtubeRef),
    ]);
    render(<Gallery onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gallery (2)')).toBeInTheDocument());

    const selectBoxes = screen.getAllByRole('checkbox', { name: 'Select this drawing' });
    expect(selectBoxes).toHaveLength(2);
    fireEvent.click(selectBoxes[0]);

    const bulkButton = await screen.findByRole('button', { name: 'Delete (1)' });
    fireEvent.click(bulkButton);

    await waitFor(() => expect(bulkDeleteDrawingsMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByRole('checkbox', { name: 'Select this drawing' })).toHaveLength(1),
    );
    expect(screen.queryByRole('button', { name: /^Delete \(/ })).toBeNull();
  });

  it('toggles selection off when the checkbox is clicked again', async () => {
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', sketchfabRef),
    ]);
    render(<Gallery onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gallery (1)')).toBeInTheDocument());

    const selectBox = screen.getByRole('checkbox', { name: 'Select this drawing' });
    fireEvent.click(selectBox);
    await screen.findByRole('button', { name: 'Delete (1)' });

    const deselectBox = screen.getByRole('checkbox', { name: 'Deselect this drawing' });
    fireEvent.click(deselectBox);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Delete \(/ })).toBeNull(),
    );
    expect(bulkDeleteDrawingsMock).not.toHaveBeenCalled();
  });

  it('renders an "Other" group for legacy drawings without a structured reference in ref modes', async () => {
    getAllDrawingsMock.mockResolvedValue([
      // Legacy: no structured reference field.
      { id: nextId++, strokes: [], thumbnail: '', referenceInfo: 'old text', createdAt: new Date('2026-04-10T00:00:00Z'), elapsedMs: 0 },
    ]);
    render(<Gallery onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gallery (1)')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'By reference (first used)' }));
    await waitFor(() => expect(screen.getByText('Other')).toBeInTheDocument());
    // No load button since there's no structured reference.
    expect(screen.queryByRole('button', { name: 'Use this reference' })).toBeNull();
  });

  it('resolves image-source thumbnails by fetching the Blob from urlHistory', async () => {
    const imageRef: ReferenceInfo = {
      source: 'image',
      fileName: 'cat.jpg',
      url: 'local:abc',
      title: 'cat.jpg',
      author: '',
    };
    getAllDrawingsMock.mockResolvedValue([
      makeDrawing('2026-04-15T10:00:00Z', imageRef),
    ]);
    getUrlHistoryEntryMock.mockResolvedValue({
      url: 'local:abc',
      type: 'image',
      lastUsedAt: new Date('2026-04-15T10:00:00Z'),
      fileName: 'cat.jpg',
      imageBlob: new Blob(['x']),
    });

    render(<Gallery onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Gallery (1)')).toBeInTheDocument();
      expect(getUrlHistoryEntryMock).toHaveBeenCalledWith('local:abc');
    });
  });
});
