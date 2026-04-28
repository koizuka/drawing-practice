import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { SketchfabSearchHistoryEntry } from '../storage/db'

// Mock the storage layer so we can inject deterministic search history
// without touching IndexedDB. Use type-safe mocks per call.
const getSketchfabSearchHistoryMock = vi.fn<() => Promise<SketchfabSearchHistoryEntry[]>>()
const addSketchfabSearchHistoryMock = vi.fn().mockResolvedValue(undefined)
const deleteSketchfabSearchHistoryMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../storage', () => ({
  getSketchfabSearchHistory: () => getSketchfabSearchHistoryMock(),
  addSketchfabSearchHistory: (...args: unknown[]) => addSketchfabSearchHistoryMock(...args),
  deleteSketchfabSearchHistory: (...args: unknown[]) => deleteSketchfabSearchHistoryMock(...args),
}))

import { SketchfabViewer } from './SketchfabViewer'

const NOW = new Date()

function makeEntry(overrides: Partial<SketchfabSearchHistoryEntry> = {}): SketchfabSearchHistoryEntry {
  return {
    key: 'tree|',
    query: 'tree',
    timeFilter: 'all',
    lastUsedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  getSketchfabSearchHistoryMock.mockReset()
  addSketchfabSearchHistoryMock.mockReset().mockResolvedValue(undefined)
  deleteSketchfabSearchHistoryMock.mockReset().mockResolvedValue(undefined)
  // Default: no Sketchfab API loaded — keeps the viewer in browse mode.
  ;(window as unknown as { Sketchfab?: unknown }).Sketchfab = undefined
})

describe('SketchfabViewer search history dropdown', () => {
  it('opens the dropdown when the search input is focused, listing keyword entries', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: 'tree|', query: 'tree' }),
      makeEntry({ key: 'castle|', query: 'castle' }),
    ])
    render(<SketchfabViewer onFixAngle={vi.fn()} />)

    // Wait for the async history load to populate state
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('Search models...')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    // Both history queries should appear in the dropdown listbox
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /tree/ })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: /castle/ })).toBeInTheDocument()
  })

  it('opens the dropdown showing category-only entries by their translated label', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: '|animals-pets', query: '', category: 'animals-pets' }),
    ])
    render(<SketchfabViewer onFixAngle={vi.fn()} />)

    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('Search models...')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    await waitFor(() => {
      // Category-only entry is labeled by the translated category name.
      // English locale renders 'animals-pets' as 'Animals'.
      expect(screen.getByRole('option', { name: /Animals/ })).toBeInTheDocument()
    })
  })

  it('does NOT spuriously fire onChange-driven selection when the input is focused with empty value and only category-only history exists', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: '|animals-pets', query: '', category: 'animals-pets' }),
    ])
    // The viewer reads window.fetch for the actual category browse — block it
    // so a spurious selection would surface as an unexpected fetch call.
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(
      () => Promise.resolve(new Response(JSON.stringify({ results: [], next: null }))),
    )

    render(<SketchfabViewer onFixAngle={vi.fn()} />)
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('Search models...')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)
    // Click outside to blur — this is what was wrongly selecting the option.
    fireEvent.blur(input)

    // After mount + focus + blur with no explicit option click, no search
    // fetch should have been triggered (mount-only auto-restore is also not
    // active because no initial* props were passed).
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('triggers a category-only search when a category-only history entry is clicked', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: '|animals-pets', query: '', category: 'animals-pets' }),
    ])
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(
      () => Promise.resolve(new Response(JSON.stringify({ results: [], next: null }))),
    )

    render(<SketchfabViewer onFixAngle={vi.fn()} />)
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('Search models...')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    const animalsOption = await screen.findByRole('option', { name: /Animals/ })
    fireEvent.click(animalsOption)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const calledUrl = (fetchSpy.mock.calls[0]?.[0] as string) ?? ''
    expect(calledUrl).toContain('categories=animals-pets')
    fetchSpy.mockRestore()
  })

  it('restores search context when initialQuery/initialCategory props are provided (URL-history reopen flow)', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([])
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(
      () => Promise.resolve(new Response(JSON.stringify({ results: [], next: null }))),
    )

    // Simulate the parent passing the saved searchContext after a URL-history
    // sketchfab entry was selected — this is what makes the "Animals" button
    // appear highlighted on Change Angle, by design.
    render(
      <SketchfabViewer
        onFixAngle={vi.fn()}
        initialQuery=""
        initialCategory="animals-pets"
        initialTimeFilter="all"
      />,
    )

    // The mount-only auto-restore should fire a category fetch
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const firstCallUrl = (fetchSpy.mock.calls[0]?.[0] as string) ?? ''
    expect(firstCallUrl).toContain('categories=animals-pets')

    // The Animals category button reflects activeCategory via 'contained' variant.
    // MUI renders the variant as a CSS class — assert via the button's class list.
    const animalsButton = screen.getByRole('button', { name: 'Animals' })
    await waitFor(() => {
      expect(animalsButton.className).toMatch(/MuiButton-contained/)
    })
    fetchSpy.mockRestore()
  })

  it('clicking the All button after a category click clears the active category and fetches /v3/models without category filter', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([])
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(
      () => Promise.resolve(new Response(JSON.stringify({ results: [], next: null }))),
    )

    render(<SketchfabViewer onFixAngle={vi.fn()} />)
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalled())

    // First click Animals → activeCategory becomes 'animals-pets'
    fireEvent.click(screen.getByRole('button', { name: 'Animals' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Animals' }).className).toMatch(/MuiButton-contained/)

    // Then click All → activeCategory cleared, All becomes contained
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All' }).className).toMatch(/MuiButton-contained/)
    })
    expect(screen.getByRole('button', { name: 'Animals' }).className).not.toMatch(/MuiButton-contained/)

    // The most recent fetch should be /v3/models WITHOUT a `categories=` param
    const lastUrl = fetchSpy.mock.calls.at(-1)?.[0] as string
    expect(lastUrl).not.toContain('categories=')
    fetchSpy.mockRestore()
  })

  it('All button is initially highlighted when no category is active and no search has run', async () => {
    getSketchfabSearchHistoryMock.mockResolvedValue([])
    render(<SketchfabViewer onFixAngle={vi.fn()} />)
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'All' }).className).toMatch(/MuiButton-contained/)
  })

  it('full flow: clicking the Animals category button saves to history and the dropdown shows it on next focus', async () => {
    // No history initially
    getSketchfabSearchHistoryMock.mockResolvedValueOnce([])
    // After the category click triggers reloadHistory, return the new entry
    getSketchfabSearchHistoryMock.mockResolvedValue([
      makeEntry({ key: '|animals-pets', query: '', category: 'animals-pets' }),
    ])

    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(
      () => Promise.resolve(new Response(JSON.stringify({ results: [], next: null }))),
    )

    render(<SketchfabViewer onFixAngle={vi.fn()} />)
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalledTimes(1))

    // Click the Animals category button — this is the "category-only browse"
    // path that previously was not being saved.
    const animalsButton = screen.getByRole('button', { name: 'Animals' })
    fireEvent.click(animalsButton)

    // Wait for the fetch to complete and recordSearch → addSketchfabSearchHistory
    // → reloadHistory chain to fire.
    await waitFor(() => expect(addSketchfabSearchHistoryMock).toHaveBeenCalled())
    await waitFor(() => expect(getSketchfabSearchHistoryMock).toHaveBeenCalledTimes(2))

    // addSketchfabSearchHistory should be called with empty query + the category
    const callArgs = addSketchfabSearchHistoryMock.mock.calls[0]
    expect(callArgs[0]).toBe('') // query
    expect(callArgs[2]).toBe('animals-pets') // category

    // Now focus the search input — the dropdown should open with the saved
    // category-only entry visible.
    const input = screen.getByPlaceholderText('Search models...')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Animals/ })).toBeInTheDocument()
    })
    fetchSpy.mockRestore()
  })
})
