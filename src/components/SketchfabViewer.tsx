import { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Button, TextField, Typography } from '@mui/material'
import { t } from '../i18n'

interface SketchfabViewerProps {
  onFixAngle: (screenshotUrl: string) => void
  /** Called when viewer state changes so parent can update toolbar */
  onStateChange?: (state: { showViewer: boolean; isReady: boolean }) => void
  /** Ref for imperative actions from parent */
  actionsRef?: React.RefObject<SketchfabActions | null>
}

export interface SketchfabActions {
  fixAngle: () => void
  back: () => void
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
  thumbnailUrl: string
}

const SKETCHFAB_CATEGORIES = [
  { slug: 'animals-pets', labelKey: 'animals' as const },
  { slug: 'cars-vehicles', labelKey: 'vehicles' as const },
  { slug: 'characters-creatures', labelKey: 'characters' as const },
  { slug: 'food-drink', labelKey: 'food' as const },
  { slug: 'furniture-home', labelKey: 'furniture' as const },
  { slug: 'nature-plants', labelKey: 'plants' as const },
  { slug: 'science-technology', labelKey: 'technology' as const },
]

interface ThumbnailImage {
  url: string
  width: number
}

interface ModelResult {
  uid: string
  name: string
  thumbnails?: { images?: ThumbnailImage[] }
}

function parseSearchResults(data: { results?: ModelResult[] }): SearchResult[] {
  return data.results?.map(m => ({
    uid: m.uid,
    name: m.name,
    thumbnailUrl: m.thumbnails?.images?.find(t => t.width >= 200)?.url ?? '',
  })) ?? []
}

export function SketchfabViewer({ onFixAngle, onStateChange, actionsRef }: SketchfabViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const apiRef = useRef<SketchfabAPI | null>(null)
  const [modelUid, setModelUid] = useState<string>('')
  const [showViewer, setShowViewer] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(!!window.Sketchfab)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  // Pending model UID to load once iframe is mounted
  const pendingLoadRef = useRef<string | null>(null)

  // Load the Sketchfab client script
  useEffect(() => {
    if (window.Sketchfab) {
      setScriptLoaded(true)
      return
    }
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

  const loadModel = useCallback((uid: string) => {
    setShowViewer(true)
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
      onFixAngle(result)
    })
  }, [onFixAngle])

  const handleSearch = useCallback(async (query: string, category?: string) => {
    setError(null)
    try {
      const params = new URLSearchParams({
        type: 'models',
        count: '12',
      })
      if (query) params.set('q', query)
      if (category) params.set('categories', category)

      const res = await fetch(`https://api.sketchfab.com/v3/search?${params}`)
      if (!res.ok) throw new Error('Search failed')

      const data = await res.json()
      setSearchResults(parseSearchResults(data))
    } catch {
      setError(t('searchFailed'))
    }
  }, [])

  const handleRandomFromCategory = useCallback((categorySlug: string) => {
    const offset = Math.floor(Math.random() * 50)
    const params = new URLSearchParams({
      type: 'models',
      categories: categorySlug,
      count: '12',
      sort_by: '-likeCount',
      offset: String(offset),
    })

    fetch(`https://api.sketchfab.com/v3/search?${params}`)
      .then(r => r.json())
      .then(data => {
        setSearchResults(parseSearchResults(data))
      })
      .catch(() => setError(t('failedFetchModels')))
  }, [])

  const handleSelectModel = useCallback((uid: string) => {
    setModelUid(uid)
    loadModel(uid)
  }, [loadModel])

  const handleBack = useCallback(() => {
    setShowViewer(false)
    setIsReady(false)
    apiRef.current = null
  }, [])

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({ showViewer, isReady })
  }, [showViewer, isReady, onStateChange])

  // Expose actions to parent
  useEffect(() => {
    if (actionsRef) {
      (actionsRef as React.MutableRefObject<SketchfabActions | null>).current = {
        fixAngle: handleFixAngle,
        back: handleBack,
      }
    }
  }, [actionsRef, handleFixAngle, handleBack])

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Viewer iframe - always rendered when showViewer, hidden behind browse UI otherwise */}
      {showViewer && (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <iframe
            ref={iframeRef}
            title="Sketchfab Viewer"
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="autoplay; fullscreen; xr-spatial-tracking"
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
        <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
          {/* Search */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <TextField
              size="small"
              placeholder={t('searchModels')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(searchQuery) }}
              sx={{ flex: 1 }}
            />
            <Button size="small" variant="contained" onClick={() => handleSearch(searchQuery)}>
              {t('search')}
            </Button>
          </Box>

          {/* Categories */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
            {SKETCHFAB_CATEGORIES.map(cat => (
              <Button key={cat.slug} size="small" variant="outlined" onClick={() => handleRandomFromCategory(cat.slug)}>
                {t(cat.labelKey)}
              </Button>
            ))}
          </Box>

          {/* Direct UID input */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <TextField
              size="small"
              placeholder={t('modelUid')}
              value={modelUid}
              onChange={e => setModelUid(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button size="small" variant="outlined" onClick={() => loadModel(modelUid)} disabled={!modelUid || !scriptLoaded}>
              {t('load')}
            </Button>
          </Box>

          {!scriptLoaded && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('loadingApi')}</Typography>}
          {error && <Typography variant="body2" color="error" sx={{ mb: 1 }}>{error}</Typography>}

          {/* Search results grid */}
          {searchResults.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
              {searchResults.map(model => (
                <Box
                  key={model.uid}
                  onClick={() => handleSelectModel(model.uid)}
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
          )}
        </Box>
      )}
    </Box>
  )
}
