import { useState, useCallback, useRef, useEffect } from 'react'
import { Alert, Box, Button, Chip, IconButton, Autocomplete, TextField, ToggleButton, ToggleButtonGroup, Typography, CircularProgress } from '@mui/material'
import { Trash2 } from 'lucide-react'
import { t } from '../i18n'
import type { ReferenceInfo } from '../types'
import {
  SKETCHFAB_CATEGORIES,
  getSketchfabModel,
  isValidUid,
  parseSketchfabModelUrl,
  setSketchfabLastSearch,
  type SketchfabCategorySlug,
  type SketchfabSearchContext,
  type SketchfabTimeFilter,
} from '../utils/sketchfab'
import {
  addSketchfabSearchHistory,
  deleteSketchfabSearchHistory,
  getSketchfabSearchHistory,
  type SketchfabSearchHistoryEntry,
} from '../storage'
import { ToolbarTooltip } from './ToolbarTooltip'
import { resetPageZoom } from '../utils/resetPageZoom'

export interface SketchfabFixAngleExtras {
  searchContext: SketchfabSearchContext | null
  modelThumbnailUrl: string | null
}

interface SketchfabViewerProps {
  onFixAngle: (screenshotUrl: string, info: ReferenceInfo, extras: SketchfabFixAngleExtras) => void
  /** Called when viewer state changes so parent can update toolbar */
  onStateChange?: (state: { showViewer: boolean; isReady: boolean }) => void
  /** Ref for imperative actions from parent */
  actionsRef?: React.RefObject<SketchfabActions | null>
  /** Initial search restoration from URL history sketchfabSearchContext. */
  initialQuery?: string
  initialTimeFilter?: SketchfabTimeFilter
  initialCategory?: SketchfabCategorySlug
}

/** Lightweight model identity used by SketchfabViewer.selectedModel. */
export interface SketchfabModelMeta {
  name: string
  author: string
  thumbnailUrl?: string
}

export interface SketchfabActions {
  fixAngle: () => void
  back: () => void
  /**
   * Loads a model into the iframe by UID. When `meta` is omitted (URL paste,
   * gallery legacy records), the viewer fetches model metadata via the
   * Sketchfab Data API so Fix Angle has a non-empty title/author.
   */
  loadModelByUid: (uid: string, meta?: SketchfabModelMeta) => void
}

// Sketchfab Viewer API type (simplified)
interface SketchfabAPI {
  start(): void
  addEventListener(event: string, callback: () => void): void
  getScreenShot(
    options: { width: number; height: number },
    callback: (err: unknown, result: string) => void,
  ): void
}

interface SketchfabClient {
  init(uid: string, options: {
    success: (api: SketchfabAPI) => void
    error: () => void
    autostart?: number
    ui_stop?: number
    ui_infos?: number
    ui_controls?: number
  }): void
}

declare global {
  interface Window {
    Sketchfab?: new (element: HTMLIFrameElement) => SketchfabClient
  }
}

interface SearchResult {
  uid: string
  name: string
  author: string
  thumbnailUrl: string
}

interface ThumbnailImage {
  url: string
  width: number
}

interface ModelResult {
  uid: string
  name: string
  user?: { displayName?: string; username?: string }
  thumbnails?: { images?: ThumbnailImage[] }
}

const TIME_FILTER_DAYS: Record<SketchfabTimeFilter, number | null> = {
  all: null,
  week: 7,
  month: 30,
  year: 365,
}

function getPublishedSince(filter: SketchfabTimeFilter): string | null {
  const days = TIME_FILTER_DAYS[filter]
  if (days == null) return null
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

interface SearchResponse {
  results?: ModelResult[]
  next?: string | null
}

function categoryLabel(slug: SketchfabCategorySlug): string {
  const cat = SKETCHFAB_CATEGORIES.find(c => c.slug === slug)
  return cat ? t(cat.labelKey) : slug
}

function parseSearchResults(data: SearchResponse): SearchResult[] {
  return data.results?.map(m => ({
    uid: m.uid,
    name: m.name,
    author: m.user?.displayName ?? m.user?.username ?? '',
    thumbnailUrl: m.thumbnails?.images?.find(t => t.width >= 200)?.url ?? '',
  })) ?? []
}

// Classify the unified search-box input. UID-form (32-char alphanumeric) or
// a Sketchfab model URL routes to direct model load; anything else is treated
// as a keyword search. Centralized so the Enter key, the submit button, and
// the button-label all stay in sync.
function classifySketchfabQuery(raw: string): { kind: 'uid'; uid: string } | { kind: 'search' } {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'search' }
  if (isValidUid(trimmed)) return { kind: 'uid', uid: trimmed }
  const parsed = parseSketchfabModelUrl(trimmed)
  if (parsed) return { kind: 'uid', uid: parsed.uid }
  return { kind: 'search' }
}

export function SketchfabViewer({
  onFixAngle,
  onStateChange,
  actionsRef,
  initialQuery,
  initialTimeFilter,
  initialCategory,
}: SketchfabViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const apiRef = useRef<SketchfabAPI | null>(null)
  const [modelUid, setModelUid] = useState<string>('')
  const [showViewer, setShowViewer] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(!!window.Sketchfab)
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? '')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selectedModel, setSelectedModel] = useState<SketchfabModelMeta | null>(null)
  const [timeFilter, setTimeFilter] = useState<SketchfabTimeFilter>(initialTimeFilter ?? 'all')
  const [activeCategory, setActiveCategory] = useState<SketchfabCategorySlug | null>(initialCategory ?? null)
  const [nextPageUrl, setNextPageUrl] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  // Aborts the in-flight search/category fetch when a newer one starts so a
  // slow earlier response can't overwrite faster newer results, and so
  // isSearching/error state belongs to the latest request only.
  const inflightSearchRef = useRef<AbortController | null>(null)
  useEffect(() => () => inflightSearchRef.current?.abort(), [])
  const lastSearchRef = useRef<
    | { type: 'search'; query: string; category?: SketchfabCategorySlug }
    | { type: 'category'; slug: SketchfabCategorySlug }
    | null
  >(null)
  // Pending model UID to load once iframe is mounted
  const pendingLoadRef = useRef<string | null>(null)
  // Latest UID requested via loadModel; the async metadata fetch checks this
  // before applying its result so a slow earlier fetch can't overwrite a
  // newer load's metadata.
  const metaFetchUidRef = useRef<string | null>(null)

  const [searchHistory, setSearchHistory] = useState<SketchfabSearchHistoryEntry[]>([])
  const reloadHistory = useCallback(() => {
    getSketchfabSearchHistory().then(setSearchHistory).catch(() => { /* ignore */ })
  }, [])
  useEffect(() => { reloadHistory() }, [reloadHistory])

  // Load the Sketchfab client script. Initial scriptLoaded covers the case
  // where window.Sketchfab is already present, so the effect only handles the
  // "needs to be injected" path.
  useEffect(() => {
    if (window.Sketchfab) return
    if (document.getElementById('sketchfab-api-script')) return
    const script = document.createElement('script')
    script.id = 'sketchfab-api-script'
    script.src = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js'
    script.async = true
    script.onload = () => setScriptLoaded(true)
    document.head.appendChild(script)
  }, [])

  const initViewer = useCallback((uid: string) => {
    const iframe = iframeRef.current
    if (!iframe || !window.Sketchfab) {
      pendingLoadRef.current = uid
      return
    }

    setLoading(true)
    setError(null)
    setIsReady(false)
    apiRef.current = null

    const client = new window.Sketchfab(iframe)
    client.init(uid, {
      success: (api) => {
        api.start()
        api.addEventListener('viewerready', () => {
          apiRef.current = api
          setIsReady(true)
          setLoading(false)
        })
      },
      error: () => {
        setError(t('failedLoadModel'))
        setLoading(false)
      },
      autostart: 1,
      ui_stop: 0,
      ui_infos: 0,
      ui_controls: 1,
    })
  }, [])

  // Once iframe is mounted and script loaded, init pending model
  useEffect(() => {
    if (showViewer && scriptLoaded && pendingLoadRef.current) {
      const uid = pendingLoadRef.current
      pendingLoadRef.current = null
      // Wait a tick for iframe to mount
      requestAnimationFrame(() => initViewer(uid))
    }
  }, [showViewer, scriptLoaded, initViewer])

  const loadModel = useCallback((uid: string, meta?: SketchfabModelMeta) => {
    resetPageZoom()
    setShowViewer(true)
    setModelUid(uid)
    if (meta) {
      metaFetchUidRef.current = null
      setSelectedModel(meta)
    } else {
      // External callers (URL paste, gallery "use this reference") don't fill
      // selectedModel via the search grid, so Fix Angle would otherwise produce
      // an empty title/author. Fetch metadata async — best-effort, no error UI.
      // Clear stale selection first so a slow fetch can't race a later load,
      // and gate the result on metaFetchUidRef so an earlier in-flight fetch
      // resolving after a newer load can't overwrite the newer metadata.
      setSelectedModel(null)
      metaFetchUidRef.current = uid
      void getSketchfabModel(uid).then(fetched => {
        if (metaFetchUidRef.current !== uid) return
        setSelectedModel({ name: fetched.title, author: fetched.author, thumbnailUrl: fetched.thumbnailUrl })
      }).catch(() => { /* metadata is best-effort */ })
    }
    // If iframe already mounted, init immediately; otherwise defer
    if (iframeRef.current && window.Sketchfab) {
      initViewer(uid)
    } else {
      pendingLoadRef.current = uid
    }
  }, [initViewer])

  const handleFixAngle = useCallback(() => {
    const api = apiRef.current
    if (!api) return

    api.getScreenShot({ width: 1024, height: 1024 }, (err, result) => {
      if (err) {
        setError(t('failedScreenshot'))
        return
      }
      const last = lastSearchRef.current
      let searchContext: SketchfabSearchContext | null = null
      if (last) {
        if (last.type === 'search' && last.query.trim()) {
          searchContext = { query: last.query, timeFilter }
          if (last.category) searchContext.category = last.category
        } else if (last.type === 'category') {
          searchContext = { query: '', category: last.slug, timeFilter }
        }
      }
      onFixAngle(
        result,
        {
          title: selectedModel?.name ?? '',
          author: selectedModel?.author ?? '',
          source: 'sketchfab',
          sketchfabUid: modelUid,
          imageUrl: result,
        },
        {
          searchContext,
          modelThumbnailUrl: selectedModel?.thumbnailUrl ?? null,
        },
      )
    })
  }, [onFixAngle, selectedModel, modelUid, timeFilter])

  // Persist a successful search into history + last-search snapshot. Both
  // keyword searches and category browses are recorded so the dropdown shows
  // the user's full Sketchfab activity. Empty-query + no-category combos
  // (which can't actually happen via the UI) are skipped.
  const recordSearch = useCallback((ctx: SketchfabSearchContext) => {
    setSketchfabLastSearch(ctx)
    if (!ctx.query.trim() && !ctx.category) return
    void addSketchfabSearchHistory(ctx.query, ctx.timeFilter, ctx.category)
      .then(reloadHistory)
      .catch(() => { /* ignore */ })
  }, [reloadHistory])

  const handleSearch = useCallback(async (query: string, category?: SketchfabCategorySlug, filter?: SketchfabTimeFilter) => {
    const effectiveFilter = filter ?? timeFilter
    // Trim once so endpoint selection, query params, lastSearchRef, and
    // recordSearch all agree on whether the query is empty. Otherwise a
    // whitespace-only string would hit /v3/search with a meaningless q while
    // recordSearch (which uses query.trim()) silently skipped history.
    const trimmedQuery = query.trim()
    lastSearchRef.current = { type: 'search', query: trimmedQuery, category }
    setActiveCategory(category ?? null)
    setError(null)
    inflightSearchRef.current?.abort()
    const ctrl = new AbortController()
    inflightSearchRef.current = ctrl
    setIsSearching(true)
    try {
      // /v3/search supports keyword search but ignores published_since
      // /v3/models supports published_since but has poor keyword search
      const useSearchEndpoint = !!trimmedQuery
      const params = new URLSearchParams({
        count: '24',
      })
      if (useSearchEndpoint) params.set('type', 'models')
      if (trimmedQuery) params.set('q', trimmedQuery)
      if (category) params.set('categories', category)
      if (!useSearchEndpoint) {
        const publishedSince = getPublishedSince(effectiveFilter)
        if (publishedSince) params.set('published_since', publishedSince)
      }

      const endpoint = useSearchEndpoint
        ? `https://api.sketchfab.com/v3/search?${params}`
        : `https://api.sketchfab.com/v3/models?${params}`
      const res = await fetch(endpoint, { signal: ctrl.signal })
      if (!res.ok) throw new Error('Search failed')

      const data: SearchResponse = await res.json()
      setSearchResults(parseSearchResults(data))
      setNextPageUrl(data.next ?? null)
      recordSearch({ query: trimmedQuery, timeFilter: effectiveFilter, ...(category ? { category } : {}) })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(t('searchFailed'))
    } finally {
      if (inflightSearchRef.current === ctrl) {
        inflightSearchRef.current = null
        setIsSearching(false)
      }
    }
  }, [timeFilter, recordSearch])

  const handleRandomFromCategory = useCallback((categorySlug: SketchfabCategorySlug, filter?: SketchfabTimeFilter) => {
    const effectiveFilter = filter ?? timeFilter
    lastSearchRef.current = { type: 'category', slug: categorySlug }
    setActiveCategory(categorySlug)
    setError(null)
    const offset = Math.floor(Math.random() * 50)
    const params = new URLSearchParams({
      categories: categorySlug,
      count: '24',
      sort_by: '-likeCount',
      offset: String(offset),
    })
    const publishedSince = getPublishedSince(effectiveFilter)
    if (publishedSince) params.set('published_since', publishedSince)

    inflightSearchRef.current?.abort()
    const ctrl = new AbortController()
    inflightSearchRef.current = ctrl
    setIsSearching(true)
    fetch(`https://api.sketchfab.com/v3/models?${params}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error('Fetch failed')
        return r.json()
      })
      .then((data: SearchResponse) => {
        setSearchResults(parseSearchResults(data))
        setNextPageUrl(data.next ?? null)
        recordSearch({ query: '', category: categorySlug, timeFilter: effectiveFilter })
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(t('failedFetchModels'))
      })
      .finally(() => {
        if (inflightSearchRef.current === ctrl) {
          inflightSearchRef.current = null
          setIsSearching(false)
        }
      })
  }, [timeFilter, recordSearch])

  // Clear the active category and fetch the unfiltered "all works" view —
  // the only escape hatch from a sticky category once the user has clicked
  // one. handleSearch with empty query + no category bypasses the search-
  // history record (recordSearch returns early on the empty-empty case).
  const handleClearCategory = useCallback(() => {
    setActiveCategory(null)
    setSearchQuery('')
    void handleSearch('', undefined, timeFilter)
  }, [handleSearch, timeFilter])

  // Mount-only auto-restore: when initial* props are provided (URL history
  // entry restoration), re-run the saved search so the user lands on results.
  useEffect(() => {
    const hasQuery = !!initialQuery && initialQuery.trim().length > 0
    if (!hasQuery && !initialCategory) return
    queueMicrotask(() => {
      if (hasQuery) {
        void handleSearch(initialQuery, initialCategory, initialTimeFilter ?? 'all')
      } else if (initialCategory) {
        handleRandomFromCategory(initialCategory, initialTimeFilter ?? 'all')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, [])

  const handleLoadMore = useCallback(async () => {
    if (!nextPageUrl || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await fetch(nextPageUrl)
      if (!res.ok) throw new Error('Load more failed')
      const data: SearchResponse = await res.json()
      setSearchResults(prev => [...prev, ...parseSearchResults(data)])
      setNextPageUrl(data.next ?? null)
    } catch {
      setError(t('searchFailed'))
    } finally {
      setIsLoadingMore(false)
    }
  }, [nextPageUrl, isLoadingMore])

  const handleSelectModel = useCallback((model: SearchResult) => {
    loadModel(model.uid, { name: model.name, author: model.author, thumbnailUrl: model.thumbnailUrl })
  }, [loadModel])

  const handleBack = useCallback(() => {
    setShowViewer(false)
    setIsReady(false)
    apiRef.current = null
  }, [])

  const handleSelectHistory = useCallback((entry: SketchfabSearchHistoryEntry) => {
    setSearchQuery(entry.query)
    setTimeFilter(entry.timeFilter)
    if (!entry.query.trim() && entry.category) {
      handleRandomFromCategory(entry.category, entry.timeFilter)
    } else {
      void handleSearch(entry.query, entry.category, entry.timeFilter)
    }
  }, [handleSearch, handleRandomFromCategory])

  const handleDeleteHistory = useCallback((key: string) => {
    void deleteSketchfabSearchHistory(key).then(reloadHistory).catch(() => { /* ignore */ })
  }, [reloadHistory])

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({ showViewer, isReady })
  }, [showViewer, isReady, onStateChange])

  // Expose actions to parent
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        fixAngle: handleFixAngle,
        back: handleBack,
        loadModelByUid: loadModel,
      }
    }
  }, [actionsRef, handleFixAngle, handleBack, loadModel])

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Viewer iframe - always rendered when showViewer, hidden behind browse UI otherwise */}
      {showViewer && (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <iframe
            ref={iframeRef}
            title="Sketchfab Viewer"
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope; magnetometer"
          />
          {loading && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.8)', zIndex: 1 }}>
              <Typography>{t('loadingModel')}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Browse/search UI */}
      {!showViewer && (
        <Box data-allow-page-zoom="true" sx={{ flex: 1, overflow: 'auto', p: 1, touchAction: 'pan-x pan-y pinch-zoom' }}>
          {/* Search row — Autocomplete shows the past-searches dropdown. */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Autocomplete<SketchfabSearchHistoryEntry, false, false, true>
              freeSolo
              openOnFocus
              size="small"
              sx={{ flex: 1 }}
              fullWidth
              options={searchHistory}
              filterOptions={x => x}
              getOptionLabel={option => {
                if (typeof option === 'string') return option
                // Category-only entries have an empty query; returning '' here
                // would collide with an empty input field and cause MUI to
                // suppress the dropdown + spuriously fire onChange on blur.
                // Returning the translated category name keeps each entry
                // distinct without affecting the input text — handleSelectHistory
                // separately resets searchQuery to the entry's actual query
                // (empty for category-only), matching the category-button UX.
                if (!option.query.trim() && option.category) return categoryLabel(option.category)
                return option.query
              }}
              isOptionEqualToValue={(a, b) => typeof a !== 'string' && typeof b !== 'string' && a.key === b.key}
              inputValue={searchQuery}
              onInputChange={(_, value, reason) => {
                if (reason === 'input' || reason === 'clear') setSearchQuery(value)
              }}
              onChange={(_, value, reason) => {
                if (reason === 'selectOption' && value && typeof value !== 'string') {
                  handleSelectHistory(value)
                }
              }}
              renderOption={(props, option) => {
                const { key, ...rest } = props as typeof props & { key: string }
                const hasQuery = !!option.query.trim()
                return (
                  <li key={key} {...rest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hasQuery ? option.query : (
                        <Typography variant="body2" component="span" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          {option.category ? categoryLabel(option.category) : ''}
                        </Typography>
                      )}
                    </Box>
                    {hasQuery && option.category && (
                      <Chip size="small" variant="outlined" label={categoryLabel(option.category)} />
                    )}
                    <ToolbarTooltip title={t('sketchfabSearchHistoryDelete')}>
                      <IconButton
                        size="small"
                        aria-label={t('sketchfabSearchHistoryDelete')}
                        // Touch devices commit option selection on pointerdown
                        // (before click), so stop propagation there too.
                        onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}
                        onClick={e => { e.stopPropagation(); handleDeleteHistory(option.key) }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </ToolbarTooltip>
                  </li>
                )
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  size="small"
                  placeholder={t('searchModels')}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    const trimmed = searchQuery.trim()
                    if (!trimmed) return
                    e.preventDefault()
                    const classified = classifySketchfabQuery(searchQuery)
                    if (classified.kind === 'uid') {
                      loadModel(classified.uid)
                    } else {
                      void handleSearch(searchQuery)
                    }
                    ;(e.target as HTMLInputElement).blur()
                  }}
                />
              )}
            />
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                const classified = classifySketchfabQuery(searchQuery)
                if (classified.kind === 'uid') {
                  loadModel(classified.uid)
                } else {
                  void handleSearch(searchQuery)
                }
              }}
            >
              {classifySketchfabQuery(searchQuery).kind === 'uid' ? t('load') : t('search')}
            </Button>
          </Box>

          {/* Time filter */}
          <ToggleButtonGroup
            value={timeFilter}
            exclusive
            onChange={(_e, val) => {
              if (val === null) return
              const newFilter = val as SketchfabTimeFilter
              setTimeFilter(newFilter)
              const last = lastSearchRef.current
              if (last) {
                if (last.type === 'search') {
                  void handleSearch(last.query, last.category, newFilter)
                } else {
                  handleRandomFromCategory(last.slug, newFilter)
                }
              }
            }}
            size="small"
            sx={{ mb: 1 }}
          >
            <ToggleButton value="all">{t('allTime')}</ToggleButton>
            <ToggleButton value="week">{t('thisWeek')}</ToggleButton>
            <ToggleButton value="month">{t('thisMonth')}</ToggleButton>
            <ToggleButton value="year">{t('thisYear')}</ToggleButton>
          </ToggleButtonGroup>

          {/* Categories — "All" clears the active category so the user can
              return to the unfiltered view; otherwise the category buttons
              would have no escape hatch once one is clicked. */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
            <Button
              size="small"
              variant={activeCategory === null ? 'contained' : 'outlined'}
              onClick={handleClearCategory}
            >
              {t('allCategories')}
            </Button>
            {SKETCHFAB_CATEGORIES.map(cat => (
              <Button
                key={cat.slug}
                size="small"
                variant={activeCategory === cat.slug ? 'contained' : 'outlined'}
                onClick={() => { setSearchQuery(''); handleRandomFromCategory(cat.slug) }}
              >
                {t(cat.labelKey)}
              </Button>
            ))}
          </Box>

          {!scriptLoaded && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('loadingApi')}</Typography>}
          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
          {isSearching && (
            <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          {/* Search results grid */}
          {searchResults.length > 0 && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
                {searchResults.map(model => (
                  <Box
                    key={model.uid}
                    onClick={() => handleSelectModel(model)}
                    sx={{
                      cursor: 'pointer',
                      border: '1px solid #ddd',
                      borderRadius: 1,
                      overflow: 'hidden',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    {model.thumbnailUrl && (
                      <img
                        src={model.thumbnailUrl}
                        alt={model.name}
                        style={{ width: '100%', height: 80, objectFit: 'cover' }}
                      />
                    )}
                    <Typography variant="caption" sx={{ display: 'block', p: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {model.name}
                    </Typography>
                  </Box>
                ))}
              </Box>
              {nextPageUrl && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                  <Button
                    variant="outlined"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    startIcon={isLoadingMore ? <CircularProgress size={16} /> : undefined}
                  >
                    {t('loadMore')}
                  </Button>
                </Box>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  )
}
