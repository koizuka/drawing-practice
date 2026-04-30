import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { PexelsSearchHistoryEntry } from '../storage/db'

const getPexelsSearchHistoryMock = vi.fn<() => Promise<PexelsSearchHistoryEntry[]>>()
const addPexelsSearchHistoryMock = vi.fn().mockResolvedValue(undefined)
const deletePexelsSearchHistoryMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../storage', () => ({
  getPexelsSearchHistory: () => getPexelsSearchHistoryMock(),
  addPexelsSearchHistory: (...args: unknown[]) => addPexelsSearchHistoryMock(...args),
  deletePexelsSearchHistory: (...args: unknown[]) => deletePexelsSearchHistoryMock(...args),
}))

import { PexelsSearcher } from './PexelsSearcher'

const NOW = new Date()

function makeEntry(overrides: Partial<PexelsSearchHistoryEntry> = {}): PexelsSearchHistoryEntry {
  return {
    key: 'pose',
    query: 'pose',
    orientation: 'all',
    lastUsedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  getPexelsSearchHistoryMock.mockReset().mockResolvedValue([])
  addPexelsSearchHistoryMock.mockReset().mockResolvedValue(undefined)
  deletePexelsSearchHistoryMock.mockReset().mockResolvedValue(undefined)
  // Set a non-empty API key so the "needs key" banner doesn't disable input.
  localStorage.setItem('pexelsApiKey', 'test-key')
  localStorage.removeItem('pexelsLastSearch')
})

afterEach(() => {
  localStorage.removeItem('pexelsApiKey')
  localStorage.removeItem('pexelsLastSearch')
})

describe('PexelsSearcher history dropdown', () => {
  it('opens the dropdown on focus thanks to openOnFocus, listing past queries', async () => {
    getPexelsSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: 'pose', query: 'pose' }),
      makeEntry({ key: 'figure', query: 'figure' }),
    ])
    render(<PexelsSearcher onSelectPhoto={vi.fn()} onOpenApiKeySettings={vi.fn()} />)

    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled())

    // The placeholder text is the localized search-input prompt — match by role
    // and aria attributes via the textbox role to avoid coupling to the string.
    const input = screen.getByRole('combobox')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /pose/ })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: /figure/ })).toBeInTheDocument()
  })
})

describe('PexelsSearcher search error feedback', () => {
  it('shows an error Alert when the search fetch fails', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Network down'))

    render(<PexelsSearcher onSelectPhoto={vi.fn()} onOpenApiKeySettings={vi.fn()} />)
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled())

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'pose' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const alert = await screen.findByRole('alert')
    // pexelsNetworkError content; matching loosely so locale changes don't break.
    expect(alert.textContent).toBeTruthy()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })

  it('does not surface an Alert when fetch succeeds', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ photos: [], next_page: null }), { status: 200 }),
    )

    render(<PexelsSearcher onSelectPhoto={vi.fn()} onOpenApiKeySettings={vi.fn()} />)
    await waitFor(() => expect(getPexelsSearchHistoryMock).toHaveBeenCalled())

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'pose' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    // Wait one more tick for the success branch to run, then assert no error Alert.
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    // The needsKey info Alert is gated on missing key — with a key set it should
    // not be present, so any role="alert" here would be the error banner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fetchSpy.mockRestore()
  })
})
