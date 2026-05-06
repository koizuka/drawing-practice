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

import { PexelsSearcher } from './PexelsSearcher';

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
});
