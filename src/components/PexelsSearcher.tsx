import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { X } from 'lucide-react'
import {
  buildPexelsReferenceInfo,
  getPexelsApiKey,
  isAbortError,
  mapPexelsErrorKey,
  searchPhotos,
  type PexelsPhoto,
} from '../utils/pexels'
import type { ReferenceInfo } from '../types'
import { t } from '../i18n'

type Orientation = 'all' | 'landscape' | 'portrait' | 'square'

interface PexelsSearcherProps {
  onSelectPhoto: (info: Extract<ReferenceInfo, { source: 'pexels' }>, thumbnailUrl: string) => void
  onOpenApiKeySettings: () => void
  initialQuery?: string
  /** Bumped by parent when the API key changes so the searcher re-evaluates key state. */
  apiKeyVersion?: number
}

const SUGGESTED_QUERIES: { label: string; query: string }[] = [
  { label: 'pose', query: 'pose reference' },
  { label: 'figure', query: 'figure' },
  { label: 'portrait', query: 'portrait' },
  { label: 'dance', query: 'dance' },
  { label: 'ballet', query: 'ballet' },
  { label: 'yoga', query: 'yoga' },
  { label: 'martial arts', query: 'martial arts' },
  { label: 'gymnastics', query: 'gymnastics' },
  { label: 'athlete', query: 'athlete' },
  { label: 'hand', query: 'hand' },
]

export function PexelsSearcher({ onSelectPhoto, onOpenApiKeySettings, initialQuery = '', apiKeyVersion = 0 }: PexelsSearcherProps) {
  const [query, setQuery] = useState(initialQuery)
  const [orientation, setOrientation] = useState<Orientation>('all')
  const [photos, setPhotos] = useState<PexelsPhoto[]>([])
  const [activeQuery, setActiveQuery] = useState('')
  const [activeOrientation, setActiveOrientation] = useState<Orientation>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsKey, setNeedsKey] = useState(() => getPexelsApiKey() === '')
  // Re-check needsKey when the parent bumps apiKeyVersion (e.g. after the
  // settings dialog stores a new key). Using the render-time prev-prop pattern
  // instead of an effect so we don't violate react-hooks/set-state-in-effect.
  const [prevApiKeyVersion, setPrevApiKeyVersion] = useState(apiKeyVersion)
  if (prevApiKeyVersion !== apiKeyVersion) {
    setPrevApiKeyVersion(apiKeyVersion)
    setNeedsKey(getPexelsApiKey() === '')
  }

  // Abort the in-flight search when a new one starts or when unmounting, so
  // a slow earlier response can't overwrite a faster later one.
  const inflightRef = useRef<AbortController | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => inflightRef.current?.abort(), [])

  /** Map a Pexels error to (user-visible error text, banner flag). Returns null
   *  for errors already communicated via the API-key banner. */
  const handleError = useCallback((e: unknown): string | null => {
    const key = mapPexelsErrorKey(e)
    if (key === 'pexelsKeyRequired' || key === 'pexelsKeyInvalid') {
      setNeedsKey(true)
      return null
    }
    if (key === 'pexelsNetworkError') console.error('Pexels error:', e)
    return t(key)
  }, [])

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    inflightRef.current?.abort()
    const ctrl = new AbortController()
    inflightRef.current = ctrl

    setLoading(true)
    setError(null)
    try {
      const res = await searchPhotos({
        query: trimmed,
        page: 1,
        orientation: orientation === 'all' ? undefined : orientation,
      }, ctrl.signal)
      setPhotos(res.photos)
      setActiveQuery(trimmed)
      setActiveOrientation(orientation)
      setCurrentPage(1)
      setHasMore(!!res.next_page && res.photos.length > 0)
    } catch (e) {
      if (isAbortError(e)) return
      setError(handleError(e))
      setPhotos([])
      setHasMore(false)
    } finally {
      if (inflightRef.current === ctrl) {
        inflightRef.current = null
        setLoading(false)
      }
    }
  }, [orientation, handleError])

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !activeQuery) return
    inflightRef.current?.abort()
    const ctrl = new AbortController()
    inflightRef.current = ctrl

    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const res = await searchPhotos({
        query: activeQuery,
        page: nextPage,
        orientation: activeOrientation === 'all' ? undefined : activeOrientation,
      }, ctrl.signal)
      setPhotos(prev => [...prev, ...res.photos])
      setCurrentPage(nextPage)
      setHasMore(!!res.next_page && res.photos.length > 0)
    } catch (e) {
      if (isAbortError(e)) return
      setError(handleError(e))
    } finally {
      if (inflightRef.current === ctrl) {
        inflightRef.current = null
        setLoadingMore(false)
      }
    }
  }, [hasMore, loadingMore, activeQuery, activeOrientation, currentPage, handleError])

  const handleSelect = useCallback((photo: PexelsPhoto) => {
    onSelectPhoto(buildPexelsReferenceInfo(photo), photo.src.tiny)
  }, [onSelectPhoto])

  const handleChip = useCallback((preset: string) => {
    setQuery(preset)
    void runSearch(preset)
  }, [runSearch])

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto', p: 1 }}>
      {needsKey && (
        <Alert severity="info" sx={{ mb: 1 }} action={
          <Button color="inherit" size="small" onClick={onOpenApiKeySettings}>
            {t('pexelsApiKeySettings')}
          </Button>
        }>
          {t('pexelsKeyRequired')}
        </Alert>
      )}

      {/* Search row */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <TextField
          size="small"
          placeholder={t('pexelsSearchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              void runSearch(query)
              searchInputRef.current?.blur()
            }
          }}
          inputRef={searchInputRef}
          slotProps={{
            input: {
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label={t('clearSearch')}
                    onClick={() => {
                      setQuery('')
                      searchInputRef.current?.focus()
                    }}
                    disabled={needsKey}
                  >
                    <X size={16} />
                  </IconButton>
                </InputAdornment>
              ) : null,
            },
          }}
          sx={{ flex: 1 }}
          disabled={needsKey}
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => void runSearch(query)}
          disabled={needsKey || !query.trim() || loading}
        >
          {t('search')}
        </Button>
      </Box>

      {/* Orientation filter */}
      <ToggleButtonGroup
        value={orientation}
        exclusive
        size="small"
        onChange={(_e, val) => {
          if (val === null) return
          setOrientation(val as Orientation)
        }}
        sx={{ mb: 1 }}
      >
        <ToggleButton value="all">{t('pexelsOrientationAll')}</ToggleButton>
        <ToggleButton value="landscape">{t('pexelsOrientationLandscape')}</ToggleButton>
        <ToggleButton value="portrait">{t('pexelsOrientationPortrait')}</ToggleButton>
        <ToggleButton value="square">{t('pexelsOrientationSquare')}</ToggleButton>
      </ToggleButtonGroup>

      {/* Suggested chips */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
        {SUGGESTED_QUERIES.map(s => (
          <Chip
            key={s.label}
            label={s.label}
            size="small"
            variant="outlined"
            onClick={() => handleChip(s.query)}
            disabled={needsKey}
          />
        ))}
      </Box>

      {error && (
        <Typography variant="body2" color="error" sx={{ mb: 1 }}>{error}</Typography>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!loading && photos.length > 0 && (
        <>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 1,
          }}>
            {photos.map(photo => (
              <Box
                key={photo.id}
                onClick={() => handleSelect(photo)}
                sx={{
                  cursor: 'pointer',
                  border: '1px solid #ddd',
                  borderRadius: 1,
                  overflow: 'hidden',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <img
                  src={photo.src.medium}
                  alt={photo.alt || `Photo #${photo.id}`}
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
                <Typography variant="caption" sx={{ display: 'block', px: 0.5, py: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {photo.photographer}
                </Typography>
              </Box>
            ))}
          </Box>
          {hasMore && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
              <Button
                variant="outlined"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={16} /> : undefined}
              >
                {t('loadMore')}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
