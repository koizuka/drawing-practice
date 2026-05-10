import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { PexelsSearchHistoryEntry } from '../storage/db';

const getPexelsSearchHistoryMock = vi.fn<() => Promise<PexelsSearchHistoryEntry[]>>();
const addPexelsSearchHistoryMock = vi.fn().mockResolvedValue(undefined);
const deletePexelsSearchHistoryMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../storage', () => ({
  getPexelsSearchHistory: () => getPexelsSearchHistoryMock(),
  addPexelsSearchHistory: (...args: unknown[]) => addPexelsSearchHistoryMock(...args),
  deletePexelsSearchHistory: (...args: unknown[]) => deletePexelsSearchHistoryMock(...args),
}));

import { PexelsSearcher, type PexelsGestureSessionConfig } from './PexelsSearcher';
import { PEXELS_SESSION_DURATION_STORAGE_KEY } from '../utils/pexels';

const NOW = new Date();

function makeEntry(overrides: Partial<PexelsSearchHistoryEntry> = {}): PexelsSearchHistoryEntry {
  return {
    key: 'pose',
    query: 'pose',
    orientation: 'all',
    lastUsedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  getPexelsSearchHistoryMock.mockReset().mockResolvedValue([]);
  addPexelsSearchHistoryMock.mockReset().mockResolvedValue(undefined);
  deletePexelsSearchHistoryMock.mockReset().mockResolvedValue(undefined);
  // Set a non-empty API key so the "needs key" banner doesn't disable input.
  localStorage.setItem('pexelsApiKey', 'test-key');
  localStorage.removeItem('pexelsLastSearch');
});

afterEach(() => {
  localStorage.removeItem('pexelsApiKey');
  localStorage.removeItem('pexelsLastSearch');
});

describe('PexelsSearcher history dropdown', () => {
  it('does not open the dropdown on focus alone (no openOnFocus)', async () => {
    getPexelsSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: 'pose', query: 'pose' }),
    ]);
    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={vi.fn()} />);
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());

    // The component auto-focuses the input on mount; that focus alone must not
    // pop the history dropdown — that was the behavior the user found
    // surprising. The dropdown should only appear in response to an explicit
    // mouse interaction, typing, or arrow keys.
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('opens the dropdown on explicit mouseDown (history stays discoverable)', async () => {
    getPexelsSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: 'pose', query: 'pose' }),
      makeEntry({ key: 'figure', query: 'figure' }),
    ]);
    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={vi.fn()} />);
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());

    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /pose/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /figure/ })).toBeInTheDocument();
  });
});

describe('PexelsSearcher search error feedback', () => {
  // Restore window.fetch / console.error spies even if an assertion throws
  // mid-test, so a failed test doesn't leak its mocks into the next one.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an error Alert when the search fetch fails', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Network down'));
    // The component logs the network error via console.error on this branch;
    // silence it here so the deliberate-failure path doesn't dump a stack trace
    // into the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={vi.fn()} />);
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'pose' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const alert = await screen.findByRole('alert');
    // pexelsNetworkError content; matching loosely so locale changes don't break.
    expect(alert.textContent).toBeTruthy();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('does not surface an Alert when fetch succeeds', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ photos: [], next_page: null }), { status: 200 }),
    );

    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={vi.fn()} />);
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'pose' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    // Wait one more tick for the success branch to run, then assert no error Alert.
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    // With a key set and fetch succeeding, no error Alert should be present.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('PexelsSearcher API key recovery notification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires onApiKeyMissing on mount when no API key is set', async () => {
    // beforeEach sets a key; clear it before this render simulates the
    // session-restore case where source='pexels' is restored without a key.
    localStorage.removeItem('pexelsApiKey');
    const onRecover = vi.fn();
    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={onRecover} />);
    await waitFor(() => expect(onRecover).toHaveBeenCalled());
  });

  it('fires onApiKeyMissing when a search returns 401 (invalid stored key)', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    const onRecover = vi.fn();
    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={onRecover} />);
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());
    // Initial mount with a stored (but possibly invalid) key — recovery must
    // not fire yet.
    expect(onRecover).not.toHaveBeenCalled();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'pose' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRecover).toHaveBeenCalled());
  });

  it('fires onApiKeyMissing when apiKeyVersion bumps and the key is now empty', async () => {
    const onRecover = vi.fn();
    const { rerender } = render(
      <PexelsSearcher
        onSelectPhoto={vi.fn()}
        onApiKeyMissing={onRecover}
        apiKeyVersion={0}
      />,
    );
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());
    expect(onRecover).not.toHaveBeenCalled();

    // Simulate the user opening the API-key dialog (from elsewhere) and
    // clearing the key — parent bumps apiKeyVersion to signal re-evaluation.
    localStorage.removeItem('pexelsApiKey');
    rerender(
      <PexelsSearcher
        onSelectPhoto={vi.fn()}
        onApiKeyMissing={onRecover}
        apiKeyVersion={1}
      />,
    );

    await waitFor(() => expect(onRecover).toHaveBeenCalled());
  });

  it('does NOT fire onApiKeyMissing while inactive (fixed-mode hidden mount)', async () => {
    // Session-restore into fixed mode with a cleared key: the searcher is
    // mounted-but-hidden behind the loaded photo. Pulling the user into a
    // key dialog here would interrupt fixed-mode viewing for no reason —
    // the CDN URL works without the API key.
    localStorage.removeItem('pexelsApiKey');
    const onRecover = vi.fn();
    render(
      <PexelsSearcher
        onSelectPhoto={vi.fn()}
        onApiKeyMissing={onRecover}
        active={false}
      />,
    );
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());
    expect(onRecover).not.toHaveBeenCalled();
  });
});

describe('PexelsSearcher gesture-session start UI', () => {
  function makePhotoJson(id: number, photographer = 'P') {
    return {
      id,
      width: 1920,
      height: 1280,
      url: `https://www.pexels.com/photo/sample-${id}/`,
      photographer,
      photographer_url: `https://www.pexels.com/@p${id}`,
      photographer_id: id,
      alt: `pose ${id}`,
      src: {
        original: 'o',
        large2x: 'l2',
        large: 'l',
        medium: 'm',
        small: 's',
        portrait: 'po',
        landscape: 'la',
        tiny: 't',
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(PEXELS_SESSION_DURATION_STORAGE_KEY);
  });

  async function renderAndSearch(onStartSession: ReturnType<typeof vi.fn<(config: PexelsGestureSessionConfig) => void>>) {
    // Use mockImplementation so each call gets a fresh Response — the same
    // Response object can only have its body read once.
    vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({
        photos: [makePhotoJson(1, 'Alice'), makePhotoJson(2, 'Bob')],
        page: 1,
        per_page: 24,
        total_results: 2,
        next_page: 'https://api.pexels.com/v1/search?page=2',
      }),
      { status: 200 },
    ));
    render(
      <PexelsSearcher
        onSelectPhoto={vi.fn()}
        onApiKeyMissing={vi.fn()}
        onStartSession={onStartSession}
      />,
    );
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'pose' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Wait for results to render.
    await screen.findByText('Alice');
  }

  it('does not show the Start session control when onStartSession is omitted', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({
        photos: [makePhotoJson(1, 'Alice')],
        page: 1,
        per_page: 24,
        total_results: 1,
        next_page: null,
      }),
      { status: 200 },
    ));
    render(<PexelsSearcher onSelectPhoto={vi.fn()} onApiKeyMissing={vi.fn()} />);
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled());
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'pose' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Alice');
    expect(screen.queryByRole('button', { name: /start session/i })).not.toBeInTheDocument();
  });

  it('shows the Start session control disabled before any results exist', () => {
    render(
      <PexelsSearcher
        onSelectPhoto={vi.fn()}
        onApiKeyMissing={vi.fn()}
        onStartSession={vi.fn<(config: PexelsGestureSessionConfig) => void>()}
      />,
    );
    const startBtn = screen.getByRole('button', { name: /start session/i });
    expect(startBtn).toBeInTheDocument();
    expect(startBtn).toBeDisabled();
  });

  it('shows the Start session control once results exist and fires onStartSession with the current results', async () => {
    const onStartSession = vi.fn<(config: PexelsGestureSessionConfig) => void>();
    await renderAndSearch(onStartSession);

    const startBtn = screen.getByRole('button', { name: /start session/i });
    fireEvent.click(startBtn);

    expect(onStartSession).toHaveBeenCalledTimes(1);
    const arg = onStartSession.mock.calls[0][0];
    expect(arg.query).toBe('pose');
    expect(arg.orientation).toBe('all');
    expect(arg.initialPhotos.map(p => p.id)).toEqual([1, 2]);
    expect(arg.page).toBe(1);
    expect(arg.hasMore).toBe(true);
    // Default duration is 30 seconds.
    expect(arg.durationMs).toBe(30_000);
  });

  it('passes the user-selected duration to onStartSession and persists it', async () => {
    const onStartSession = vi.fn<(config: PexelsGestureSessionConfig) => void>();
    await renderAndSearch(onStartSession);

    // The duration toggle exposes labels like "60s" via aria-label.
    fireEvent.click(screen.getByRole('button', { name: '60s' }));
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    expect(onStartSession).toHaveBeenCalledTimes(1);
    expect(onStartSession.mock.calls[0][0].durationMs).toBe(60_000);
    expect(localStorage.getItem(PEXELS_SESSION_DURATION_STORAGE_KEY)).toBe('60000');
  });
});
