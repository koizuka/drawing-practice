import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SplitLayout } from './SplitLayout';
import { loadDraft } from '../storage/sessionStore';
import type { SessionDraft } from '../storage/db';

vi.mock('../storage/sessionStore', () => ({
  saveDraft: vi.fn().mockResolvedValue(undefined),
  loadDraft: vi.fn().mockResolvedValue(undefined),
  clearDraft: vi.fn().mockResolvedValue(undefined),
}));

const getPhotoMock = vi.fn();
vi.mock('../utils/pexels', async () => {
  const actual = await vi.importActual<typeof import('../utils/pexels')>('../utils/pexels');
  return {
    ...actual,
    getPhoto: (id: number) => getPhotoMock(id),
  };
});

function pexelsPhoto(id: number, photographer: string) {
  return {
    id,
    width: 1920,
    height: 1280,
    url: `https://www.pexels.com/photo/sample-${id}/`,
    photographer,
    photographer_url: `https://www.pexels.com/@${photographer.toLowerCase().replace(/\s+/g, '-')}`,
    photographer_id: 1,
    alt: 'A sample pose',
    src: {
      original: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`,
      large2x: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?w=1880`,
      large: '',
      medium: '',
      small: '',
      portrait: '',
      landscape: '',
      tiny: '',
    },
  };
}

describe('SplitLayout', () => {
  it('renders both panels', () => {
    render(<SplitLayout />);
    // ReferencePanel renders source buttons in center when no source selected
    expect(screen.getByText('Sketchfab')).toBeInTheDocument();
    expect(screen.getByText('Image File')).toBeInTheDocument();
    // DrawingPanel renders toolbar buttons
    expect(screen.getByLabelText(/^Pen/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Eraser/)).toBeInTheDocument();
  });

  describe('reference undo integration', () => {
    /**
     * Helper: find the Undo/Redo buttons in the DrawingPanel toolbar. They are
     * wrapped in <span> for disabled Tooltip support, which breaks the normal
     * label inheritance, so we look up the SVG icon by its lucide class name
     * and return the nearest button ancestor.
     */
    function findDrawingToolbarButton(container: HTMLElement, iconClass: string): HTMLButtonElement {
      const icon = container.querySelector(`svg.${iconClass}`);
      if (!icon) throw new Error(`icon ${iconClass} not found`);
      const button = icon.closest('button');
      if (!button) throw new Error(`no button wraps ${iconClass}`);
      return button as HTMLButtonElement;
    }

    const undoBtn = (c: HTMLElement) => findDrawingToolbarButton(c, 'lucide-undo-2');
    const redoBtn = (c: HTMLElement) => findDrawingToolbarButton(c, 'lucide-redo-2');

    it('enables undo after opening Sketchfab and reverts to none on undo', () => {
      const { container } = render(<SplitLayout />);

      // Initial state: source selection visible, undo disabled
      expect(screen.getByText('Image File')).toBeInTheDocument();
      expect(undoBtn(container)).toBeDisabled();

      // Click the center "Sketchfab" button
      fireEvent.click(screen.getByText('Sketchfab'));

      // Selection buttons are gone (Sketchfab browse UI replaces them)
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();
      // Undo is now enabled because a reference change was recorded
      expect(undoBtn(container)).not.toBeDisabled();

      // Click undo → back to none state
      fireEvent.click(undoBtn(container));

      expect(screen.getByText('Image File')).toBeInTheDocument();
      expect(undoBtn(container)).toBeDisabled();
      // Redo should now be enabled
      expect(redoBtn(container)).not.toBeDisabled();
    });

    it('restores the previous reference when Close is undone', () => {
      const { container } = render(<SplitLayout />);

      // Open Sketchfab
      fireEvent.click(screen.getByText('Sketchfab'));
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();

      // Click the Close button (X icon in reference toolbar)
      const closeIcon = container.querySelector('svg.lucide-x');
      if (!closeIcon) throw new Error('close icon not found');
      const closeButton = closeIcon.closest('button')!;
      fireEvent.click(closeButton);

      // Back to none state
      expect(screen.getByText('Image File')).toBeInTheDocument();

      // Undo → should return to Sketchfab browse mode
      fireEvent.click(undoBtn(container));
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();

      // Another undo → back to initial none
      fireEvent.click(undoBtn(container));
      expect(screen.getByText('Image File')).toBeInTheDocument();
      expect(undoBtn(container)).toBeDisabled();
    });

    it('redo re-applies reference changes', () => {
      const { container } = render(<SplitLayout />);

      // Sketchfab → none → sketchfab chain via undo/redo
      fireEvent.click(screen.getByText('Sketchfab'));
      fireEvent.click(undoBtn(container));
      expect(screen.getByText('Image File')).toBeInTheDocument();
      expect(redoBtn(container)).not.toBeDisabled();

      // Redo re-applies
      fireEvent.click(redoBtn(container));
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();
      expect(redoBtn(container)).toBeDisabled();
    });

    it('a new reference change clears the redo stack', () => {
      const { container } = render(<SplitLayout />);

      // Sketchfab → undo → Sketchfab again
      fireEvent.click(screen.getByText('Sketchfab'));
      fireEvent.click(undoBtn(container));
      expect(redoBtn(container)).not.toBeDisabled();

      // Click Sketchfab again — this records a new ref change, clearing redo
      fireEvent.click(screen.getByText('Sketchfab'));
      expect(redoBtn(container)).toBeDisabled();
    });

    it('detects a YouTube URL in the URL field and switches to YouTube reference', () => {
      const { container } = render(<SplitLayout />);
      expect(undoBtn(container)).toBeDisabled();

      const urlInput = screen.getByPlaceholderText(/YouTube/i) as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
      fireEvent.click(screen.getByText('Load'));

      // YouTube iframe is rendered
      const iframe = container.querySelector('iframe[title="YouTube reference"]') as HTMLIFrameElement;
      expect(iframe).not.toBeNull();
      expect(iframe.src).toContain('dQw4w9WgXcQ');

      // Source selection UI is gone
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();

      // Undo is enabled and reverts to none
      expect(undoBtn(container)).not.toBeDisabled();
      fireEvent.click(undoBtn(container));
      expect(screen.getByText('Image File')).toBeInTheDocument();
    });

    it('enables undo after opening Pexels and reverts to none on undo', async () => {
      const { container } = render(<SplitLayout />);

      expect(screen.getByText('Pexels')).toBeInTheDocument();
      expect(undoBtn(container)).toBeDisabled();

      fireEvent.click(screen.getByText('Pexels'));

      // Source selection UI is replaced with Pexels searcher
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();
      // Search input (from PexelsSearcher placeholder) is visible — wait for
      // the lazy chunk to resolve before asserting on its DOM.
      expect(await screen.findByPlaceholderText(/Search photos/i)).toBeInTheDocument();
      expect(undoBtn(container)).not.toBeDisabled();

      fireEvent.click(undoBtn(container));
      expect(screen.getByText('Image File')).toBeInTheDocument();
    });

    it('detects a Pexels URL in the URL field and switches to Pexels reference', async () => {
      getPhotoMock.mockResolvedValueOnce(pexelsPhoto(12345, 'Alice Photographer'));

      const { container } = render(<SplitLayout />);
      expect(undoBtn(container)).toBeDisabled();

      const urlInput = screen.getByPlaceholderText(/Pexels/i) as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: 'https://www.pexels.com/photo/sample-12345/' } });
      fireEvent.click(screen.getByText('Load'));

      await waitFor(() => expect(screen.queryByText('Image File')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByText('Alice Photographer')).toBeInTheDocument());

      expect(getPhotoMock).toHaveBeenCalledWith(12345);
      expect(undoBtn(container)).not.toBeDisabled();

      fireEvent.click(undoBtn(container));
      expect(screen.getByText('Image File')).toBeInTheDocument();
    });
  });

  describe('reference info overlay collapse', () => {
    async function loadPexels(id: number, photographer: string) {
      getPhotoMock.mockResolvedValueOnce(pexelsPhoto(id, photographer));
      const urlInput = screen.getByPlaceholderText(/Pexels/i) as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: `https://www.pexels.com/photo/sample-${id}/` } });
      fireEvent.click(screen.getByText('Load'));
      await waitFor(() => expect(screen.getByText(photographer)).toBeInTheDocument());
    }

    it('collapses the overlay when the collapse button is clicked', async () => {
      render(<SplitLayout />);
      await loadPexels(12345, 'Alice Photographer');

      fireEvent.click(screen.getByLabelText('Collapse info'));

      expect(screen.queryByText('Alice Photographer')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Show info')).toBeInTheDocument();
    });

    it('re-expands the overlay when the info icon is clicked', async () => {
      render(<SplitLayout />);
      await loadPexels(12345, 'Alice Photographer');

      fireEvent.click(screen.getByLabelText('Collapse info'));
      expect(screen.queryByText('Alice Photographer')).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Show info'));
      expect(screen.getByText('Alice Photographer')).toBeInTheDocument();
      expect(screen.getByLabelText('Collapse info')).toBeInTheDocument();
    });

    it('keeps the photographer link clickable while expanded', async () => {
      render(<SplitLayout />);
      await loadPexels(12345, 'Alice Photographer');

      const link = screen.getByText('Alice Photographer').closest('a') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.href).toBe('https://www.pexels.com/@alice-photographer');
      expect(link.target).toBe('_blank');
    });

    it('re-expands automatically when a new reference is loaded', async () => {
      const { container } = render(<SplitLayout />);
      await loadPexels(12345, 'Alice Photographer');

      fireEvent.click(screen.getByLabelText('Collapse info'));
      expect(screen.getByLabelText('Show info')).toBeInTheDocument();

      // Close the reference (toolbar X is the first lucide-x in DOM order —
      // the collapsed overlay shows Info, not X, so no ambiguity).
      const closeIcon = container.querySelector('svg.lucide-x');
      if (!closeIcon) throw new Error('toolbar close icon not found');
      fireEvent.click(closeIcon.closest('button')!);
      await waitFor(() => expect(screen.getByText('Image File')).toBeInTheDocument());

      // Load a different Pexels photo — overlay should mount fresh (expanded).
      await loadPexels(67890, 'Bob Photographer');

      expect(screen.getByText('Bob Photographer')).toBeInTheDocument();
      expect(screen.getByLabelText('Collapse info')).toBeInTheDocument();
      expect(screen.queryByLabelText('Show info')).not.toBeInTheDocument();
    });
  });

  describe('reference panel collapse', () => {
    it('toggles the reference panel hidden state and swaps the icon', () => {
      const { container } = render(<SplitLayout />);

      // Initial: reference panel visible, source picker visible.
      expect(screen.getByText('Image File')).toBeVisible();
      const collapseBtn = screen.getByLabelText(/Hide reference/) as HTMLButtonElement;
      expect(collapseBtn).toBeInTheDocument();

      // Hide reference. The source picker is still in the DOM but its
      // wrapping flex panel is display:none.
      fireEvent.click(collapseBtn);
      expect(screen.getByText('Image File')).not.toBeVisible();

      // Toggle now reads "Show reference" (icon flipped).
      const expandBtn = screen.getByLabelText(/Show reference/) as HTMLButtonElement;
      expect(expandBtn).toBeInTheDocument();

      // Restore — source picker should be visible again.
      fireEvent.click(expandBtn);
      expect(screen.getByText('Image File')).toBeVisible();
      expect(screen.getByLabelText(/Hide reference/)).toBeInTheDocument();

      // Drawing canvas remains mounted throughout.
      expect(container.querySelector('canvas')).not.toBeNull();
    });
  });

  describe('draft restore', () => {
    const loadDraftMock = vi.mocked(loadDraft);

    afterEach(() => {
      loadDraftMock.mockResolvedValue(undefined);
    });

    it('restores strokes, elapsed time, and URL reference from a saved draft', async () => {
      const draft: SessionDraft = {
        id: 1,
        strokes: [
          { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], timestamp: 1000 },
          { points: [{ x: 20, y: 20 }, { x: 30, y: 30 }], timestamp: 2000 },
        ],
        redoStack: [],
        elapsedMs: 90_000, // 1:30
        source: 'url',
        referenceInfo: {
          source: 'url',
          title: 'My saved reference',
          author: '',
          imageUrl: 'https://example.com/pic.jpg',
        },
        referenceImageData: null,
        guideState: {
          grid: { mode: 'normal' },
          lines: [],
        },
        updatedAt: new Date(),
        // Mark with the current coord version so the restore loads strokes
        // immediately. Legacy drafts without coordVersion would defer the load
        // until the reference reports its size — covered by a separate test.
        coordVersion: 2,
      };
      loadDraftMock.mockResolvedValueOnce(draft);

      const { container } = render(<SplitLayout />);

      // The timer shows the restored elapsed time.
      await waitFor(() => {
        expect(screen.getByText('1:30')).toBeInTheDocument();
      });

      // The undo button becomes enabled because the restored strokes populate
      // the undo stack (via StrokeManager.loadState, which seeds `add` entries).
      const undoIcon = container.querySelector('svg.lucide-undo-2');
      const undoBtn = undoIcon!.closest('button') as HTMLButtonElement;
      expect(undoBtn).not.toBeDisabled();

      // The source-selection UI should be gone since source is 'url', not 'none'.
      expect(screen.queryByText('Image File')).not.toBeInTheDocument();
    });

    it('restores referenceCollapsed=true so the reference panel starts hidden', async () => {
      const draft: SessionDraft = {
        id: 1,
        strokes: [],
        redoStack: [],
        elapsedMs: 0,
        source: 'none',
        referenceInfo: null,
        referenceImageData: null,
        guideState: { grid: { mode: 'normal' }, lines: [] },
        referenceCollapsed: true,
        updatedAt: new Date(),
      };
      loadDraftMock.mockResolvedValueOnce(draft);

      render(<SplitLayout />);

      // After restore, the reference panel's source picker is hidden and the
      // toggle is in "Show reference" state.
      await waitFor(() => {
        expect(screen.getByLabelText(/Show reference/)).toBeInTheDocument();
      });
      expect(screen.getByText('Image File')).not.toBeVisible();
    });

    it('does nothing when no draft is stored', async () => {
      loadDraftMock.mockResolvedValueOnce(undefined);

      const { container } = render(<SplitLayout />);

      // Source-selection UI is still visible, timer reads 0:00, undo disabled.
      await waitFor(() => {
        expect(screen.getByText('Image File')).toBeInTheDocument();
      });
      expect(screen.getByText('0:00')).toBeInTheDocument();
      const undoIcon = container.querySelector('svg.lucide-undo-2');
      const undoBtn = undoIcon!.closest('button') as HTMLButtonElement;
      expect(undoBtn).toBeDisabled();
    });
  });
});
