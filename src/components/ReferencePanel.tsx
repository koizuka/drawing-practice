import { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Button, Tooltip, IconButton, Typography, TextField, Link as MuiLink, Autocomplete } from '@mui/material'
import { X, PenLine, CircleX, Trash2, Layers, FlipHorizontal2, LocateFixed, Maximize, Minimize, Settings, Info, Film, Camera, Image as ImageIcon } from 'lucide-react'
import { SketchfabViewer, type SketchfabActions } from './SketchfabViewer'
import { ImageViewer, type GuideInteractionMode } from './ImageViewer'
import type { ViewTransform } from '../drawing/ViewTransform'
import { YouTubeViewer } from './YouTubeViewer'
import { PexelsSearcher } from './PexelsSearcher'
import { PexelsApiKeyDialog } from './PexelsApiKeyDialog'
import { GitHubIcon } from './GitHubIcon'
import { parseYouTubeVideoId, fetchYouTubeTitle } from '../utils/youtube'
import {
  buildPexelsReferenceInfo,
  getPhoto,
  mapPexelsErrorKey,
  parsePexelsPhotoUrl,
} from '../utils/pexels'
import { addUrlHistory, getUrlHistory, deleteUrlHistory, type UrlHistoryEntry, type UrlHistoryType } from '../storage'

function describeHistoryUrl(entry: UrlHistoryEntry): { primary: string; secondary: string } {
  if (entry.title) return { primary: entry.title, secondary: entry.url }
  if (entry.type === 'youtube') {
    const id = parseYouTubeVideoId(entry.url)
    return { primary: id ? `YouTube · ${id}` : entry.url, secondary: entry.url }
  }
  let parsed: URL
  try {
    parsed = new URL(entry.url)
  } catch {
    return { primary: entry.url, secondary: '' }
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (entry.type === 'pexels') {
    const photoIndex = segments.indexOf('photo')
    const slug = photoIndex >= 0 ? segments[photoIndex + 1] : undefined
    return { primary: slug ? `Pexels · ${slug}` : entry.url, secondary: entry.url }
  }
  const filename = segments.pop()
  return { primary: filename || parsed.hostname, secondary: parsed.hostname }
}

function HistoryTypeIcon({ type }: { type: UrlHistoryType }) {
  if (type === 'youtube') return <Film size={14} />
  if (type === 'pexels') return <Camera size={14} />
  return <ImageIcon size={14} />
}
import { useGuides } from '../guides/useGuides'
import type { GridMode } from '../guides/types'
import { useFullscreen } from '../hooks/useFullscreen'
import { t } from '../i18n'
import type { Stroke } from '../drawing/types'
import { referenceKey, type ReferenceSource, type ReferenceMode, type ReferenceInfo } from '../types'

/**
 * Raw setters for the reference-related state living in SplitLayout. Exposed
 * through `onReferenceChange(setters => ...)` so that every user-initiated
 * mutation is routed through the undo history recording path.
 */
export interface ReferenceSetters {
  setSource: (source: ReferenceSource) => void
  setReferenceMode: (mode: ReferenceMode) => void
  setFixedImageUrl: (url: string | null) => void
  setLocalImageUrl: (url: string | null) => void
  setReferenceInfo: (info: ReferenceInfo | null) => void
}

function GridIcon({ mode }: { mode: GridMode }) {
  const size = 20
  const color = 'currentColor'
  if (mode === 'none') {
    // Empty square outline — no grid
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5">
        <rect x="1" y="1" width="18" height="18" rx="1" />
      </svg>
    )
  }
  if (mode === 'large') {
    // 2x2 grid with thick center lines
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
        <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
        <line x1="10" y1="1" x2="10" y2="19" strokeWidth="2.5" />
        <line x1="1" y1="10" x2="19" y2="10" strokeWidth="2.5" />
      </svg>
    )
  }
  // normal: 4x4 grid with thick center lines
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
      <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
      {/* Thin grid lines */}
      <line x1="5.5" y1="1" x2="5.5" y2="19" strokeWidth="0.7" />
      <line x1="14.5" y1="1" x2="14.5" y2="19" strokeWidth="0.7" />
      <line x1="1" y1="5.5" x2="19" y2="5.5" strokeWidth="0.7" />
      <line x1="1" y1="14.5" x2="19" y2="14.5" strokeWidth="0.7" />
      {/* Thick center lines */}
      <line x1="10" y1="1" x2="10" y2="19" strokeWidth="2" />
      <line x1="1" y1="10" x2="19" y2="10" strokeWidth="2" />
    </svg>
  )
}

/**
 * Reference-source attribution pill shown over the bottom-left of the
 * reference image. Collapses to a small info icon on user tap so it doesn't
 * cover the lower portion of the reference while drawing. Parent keys this
 * component by reference identity, so a new reference remounts it in the
 * expanded state.
 */
function ReferenceInfoOverlay({ refInfo }: { refInfo: ReferenceInfo }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Box sx={{
      position: 'absolute',
      bottom: 8,
      left: 8,
      // Cap the overall overlay width so long titles / author lines can't
      // push the collapse button off-screen on narrow viewports. The 16px
      // budget accounts for the 8px left offset plus an 8px right gutter.
      maxWidth: 'calc(100% - 16px)',
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      {collapsed ? (
        <Tooltip title={t('expandReferenceInfo')}>
          <IconButton
            size="small"
            onClick={() => setCollapsed(false)}
            aria-label={t('expandReferenceInfo')}
            sx={{
              pointerEvents: 'auto',
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            }}
          >
            <Info size={18} />
          </IconButton>
        </Tooltip>
      ) : (
        <Box sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.5,
          pointerEvents: 'auto',
          bgcolor: 'rgba(0,0,0,0.5)',
          color: 'white',
          pl: 1,
          pr: 0.5,
          py: 0.5,
          borderRadius: 1,
        }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {refInfo.title && (
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {refInfo.title}
              </Typography>
            )}
            {refInfo.author && (
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {refInfo.source === 'pexels' && refInfo.pexelsPhotographerUrl ? (
                  <>
                    {t('pexelsPhotoBy')}{' '}
                    <MuiLink href={refInfo.pexelsPhotographerUrl} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                      {refInfo.author}
                    </MuiLink>
                    {refInfo.pexelsPageUrl && (
                      <>
                        {' · '}
                        <MuiLink href={refInfo.pexelsPageUrl} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                          {t('pexelsViaPexels')}
                        </MuiLink>
                      </>
                    )}
                  </>
                ) : refInfo.author}
              </Typography>
            )}
          </Box>
          <Tooltip title={t('collapseReferenceInfo')}>
            <IconButton
              size="small"
              onClick={() => setCollapsed(true)}
              aria-label={t('collapseReferenceInfo')}
              sx={{
                flexShrink: 0,
                color: 'white',
                p: 0.25,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
              }}
            >
              <X size={14} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  )
}

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>
  onRegisterOverlayRedraw?: (redraw: () => void) => void
  onReferenceImageSize?: (width: number, height: number) => void
  overlayActive?: boolean
  onToggleOverlay?: () => void
  // Read-only reference state (source of truth is SplitLayout)
  source: ReferenceSource
  referenceMode: ReferenceMode
  fixedImageUrl: string | null
  localImageUrl: string | null
  refInfo: ReferenceInfo | null
  /** Apply a reference-state mutation with undo history recording. */
  onReferenceChange: (mutate: (setters: ReferenceSetters) => void) => void
  /** Non-undoable reset used when an image fails to load. */
  onReferenceResetOnError: () => void
  onRegisterLoadSketchfabModel?: (fn: (uid: string) => void) => void
  isFlipped?: boolean
  onToggleFlip?: () => void
  /** Optional shared ViewTransform for zoom sync with DrawingPanel. */
  viewTransform?: ViewTransform
  /** Which panel owns the fit calculation. */
  fitLeader?: 'reference' | 'drawing'
}

export function ReferencePanel({
  overlayStrokes, overlayCurrentStrokeRef, onRegisterOverlayRedraw,
  onReferenceImageSize, overlayActive, onToggleOverlay,
  source, referenceMode, fixedImageUrl, localImageUrl, refInfo,
  onReferenceChange, onReferenceResetOnError,
  onRegisterLoadSketchfabModel, isFlipped, onToggleFlip,
  viewTransform, fitLeader,
}: ReferencePanelProps) {
  const { grid, lines, version: guideVersion, cycleGridMode, addLine, removeLine, clearLines } = useGuides()
  const { isFullscreen, toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen()
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('none')
  const [highlightedGuideId, setHighlightedGuideId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlHistory, setUrlHistory] = useState<UrlHistoryEntry[]>([])

  const reloadUrlHistory = useCallback(() => {
    getUrlHistory().then(setUrlHistory).catch(() => { /* ignore storage errors */ })
  }, [])

  useEffect(() => {
    reloadUrlHistory()
  }, [reloadUrlHistory])

  // Sketchfab viewer state (reported by child)
  const [sfShowViewer, setSfShowViewer] = useState(false)
  const [sfIsReady, setSfIsReady] = useState(false)
  const sfActionsRef = useRef<SketchfabActions | null>(null)

  // Pexels API key dialog state
  const [pexelsKeyDialogOpen, setPexelsKeyDialogOpen] = useState(false)
  const [pexelsKeyVersion, setPexelsKeyVersion] = useState(0)

  const handleLoadLocalImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      // Read as data URL so it survives page reload (for autosave)
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const info: ReferenceInfo = { title: file.name, author: '', source: 'image', fileName: file.name }
        onReferenceChange(s => {
          s.setLocalImageUrl(dataUrl)
          s.setFixedImageUrl(null)
          s.setReferenceInfo(info)
          s.setSource('image')
          s.setReferenceMode('fixed')
        })
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }, [onReferenceChange])

  const [urlLoading, setUrlLoading] = useState(false)

  const handleLoadFromUrl = useCallback((rawUrl: string) => {
    const url = rawUrl.trim()
    if (!url) return
    setUrlError(null)
    setUrlLoading(true)

    // Validate URL format
    try {
      new URL(url)
    } catch {
      setUrlError(t('urlLoadFailed'))
      setUrlLoading(false)
      return
    }

    // YouTube URL: switch to YouTube reference mode without image preload
    const ytId = parseYouTubeVideoId(url)
    if (ytId) {
      const info: ReferenceInfo = {
        title: ytId,
        author: '',
        source: 'youtube',
        youtubeVideoId: ytId,
      }
      onReferenceChange(s => {
        s.setSource('youtube')
        s.setReferenceMode('browse')
        s.setFixedImageUrl(null)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
      })
      setUrlInput('')
      setUrlLoading(false)
      fetchYouTubeTitle(ytId)
        .catch(() => null)
        .then(title => addUrlHistory(url, 'youtube', title ?? undefined))
        .then(reloadUrlHistory)
        .catch(() => { /* ignore */ })
      return
    }

    // Pexels photo URL: resolve via API to fetch the CDN URL + photographer
    const pexelsMatch = parsePexelsPhotoUrl(url)
    if (pexelsMatch) {
      getPhoto(pexelsMatch.id)
        .then(photo => {
          const info = buildPexelsReferenceInfo(photo)
          onReferenceChange(s => {
            s.setSource('pexels')
            s.setReferenceMode('fixed')
            s.setFixedImageUrl(photo.src.large2x)
            s.setLocalImageUrl(null)
            s.setReferenceInfo(info)
          })
          setUrlInput('')
          addUrlHistory(url, 'pexels', info.title).then(reloadUrlHistory).catch(() => { /* ignore */ })
        })
        .catch(e => setUrlError(t(mapPexelsErrorKey(e))))
        .finally(() => setUrlLoading(false))
      return
    }

    const onFail = () => {
      setUrlError(t('urlLoadFailed'))
      setUrlLoading(false)
    }

    const onSuccess = () => {
      setUrlLoading(false)
      const title = url.split('/').pop()?.split('?')[0] ?? url
      const info: ReferenceInfo = { title, author: '', source: 'url', imageUrl: url }
      onReferenceChange(s => {
        s.setFixedImageUrl(url)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
        s.setSource('url')
        s.setReferenceMode('fixed')
      })
      setUrlInput('')
      addUrlHistory(url, 'url').then(reloadUrlHistory).catch(() => { /* ignore */ })
    }

    // Preload image: try CORS first, then without, check naturalWidth
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (img.naturalWidth > 0) { onSuccess() } else { onFail() }
    }
    img.onerror = () => {
      const retry = new Image()
      retry.onload = () => {
        if (retry.naturalWidth > 0) { onSuccess() } else { onFail() }
      }
      retry.onerror = onFail
      retry.src = url
    }
    img.src = url
  }, [onReferenceChange, reloadUrlHistory])

  const handleFixAngle = useCallback((screenshotUrl: string, info: ReferenceInfo) => {
    onReferenceChange(s => {
      s.setFixedImageUrl(screenshotUrl)
      s.setReferenceInfo(info)
      s.setReferenceMode('fixed')
    })
  }, [onReferenceChange])

  const handleChangeAngle = useCallback(() => {
    onReferenceChange(s => {
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
    })
  }, [onReferenceChange])

  const handleClose = useCallback(() => {
    onReferenceChange(s => {
      s.setSource('none')
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(null)
    })
    setGuideMode('none')
    setHighlightedGuideId(null)
  }, [onReferenceChange])

  const handleOpenSketchfab = useCallback(() => {
    onReferenceChange(s => {
      s.setSource('sketchfab')
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(null)
    })
  }, [onReferenceChange])

  const handleOpenPexels = useCallback(() => {
    onReferenceChange(s => {
      s.setSource('pexels')
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(null)
    })
  }, [onReferenceChange])

  const handleSelectPexelsPhoto = useCallback((info: Extract<ReferenceInfo, { source: 'pexels' }>) => {
    onReferenceChange(s => {
      s.setSource('pexels')
      s.setReferenceMode('fixed')
      s.setFixedImageUrl(info.pexelsImageUrl)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(info)
    })
  }, [onReferenceChange])

  const handleBackToPexelsSearch = useCallback(() => {
    onReferenceChange(s => {
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
    })
  }, [onReferenceChange])

  const handleSfStateChange = useCallback((state: { showViewer: boolean; isReady: boolean }) => {
    setSfShowViewer(state.showViewer)
    setSfIsReady(state.isReady)
  }, [])

  // Load a Sketchfab model by UID (called from parent for gallery "load reference")
  const loadSketchfabModel = useCallback((uid: string) => {
    requestAnimationFrame(() => {
      sfActionsRef.current?.loadModelByUid(uid)
    })
  }, [])

  // Expose loadSketchfabModel to parent
  useEffect(() => {
    onRegisterLoadSketchfabModel?.(loadSketchfabModel)
  }, [onRegisterLoadSketchfabModel, loadSketchfabModel])

  const handleImageError = useCallback(() => {
    setUrlError(t('urlLoadFailed'))
    // Non-undoable reset — undoing back to a broken URL would just trigger
    // the same error again.
    onReferenceResetOnError()
  }, [onReferenceResetOnError])

  const handleAddGuideLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    addLine(x1, y1, x2, y2)
  }, [addLine])

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedGuideId) {
      removeLine(highlightedGuideId)
      // 削除後、削除した線の一つ前を自動選択
      const idx = lines.findIndex(l => l.id === highlightedGuideId)
      const prevIdx = idx - 1
      setHighlightedGuideId(prevIdx >= 0 ? lines[prevIdx].id : null)
    }
  }, [highlightedGuideId, removeLine, lines])

  const handleCancelHighlight = useCallback(() => {
    setHighlightedGuideId(null)
  }, [])

  const toggleGuideMode = useCallback((mode: GuideInteractionMode) => {
    setGuideMode(prev => {
      const nextMode = prev === mode ? 'none' : mode
      // deleteモードに入る時、最新の補助線を自動選択
      if (nextMode === 'delete' && lines.length > 0) {
        setHighlightedGuideId(lines[lines.length - 1].id)
      } else {
        setHighlightedGuideId(null)
      }
      return nextMode
    })
  }, [lines])

  const displayImageUrl = source === 'image' ? localImageUrl : fixedImageUrl  // 'sketchfab', 'url', 'pexels' use fixedImageUrl
  const isFixed = referenceMode === 'fixed' && !!displayImageUrl
  const isNone = source === 'none'
  // Sketchfab browse mode: either searching or viewing a model
  const isSfBrowse = source === 'sketchfab' && referenceMode === 'browse'
  const isYouTube = source === 'youtube'

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid #ddd',
          bgcolor: '#fafafa',
          minHeight: 40,
        }}
      >
        {/* Close button (when source is set) */}
        {!isNone && (
          <Tooltip title={t('cancel')}>
            <IconButton size="small" onClick={handleClose}>
              <X size={20} />
            </IconButton>
          </Tooltip>
        )}

        {/* Sketchfab model viewer: Back to search results */}
        {isSfBrowse && sfShowViewer && (
          <Button size="small" variant="outlined" onClick={() => sfActionsRef.current?.back()}>
            {t('back')}
          </Button>
        )}

        {/* Sketchfab model viewer: Fix This Angle button */}
        {isSfBrowse && sfShowViewer && sfIsReady && (
          <Button size="small" variant="contained" color="success" onClick={() => sfActionsRef.current?.fixAngle()}>
            {t('fixThisAngle')}
          </Button>
        )}

        {/* Fixed mode: Change Angle (Sketchfab only) */}
        {isFixed && source === 'sketchfab' && (
          <Button size="small" variant="outlined" onClick={handleChangeAngle}>
            {t('changeAngle')}
          </Button>
        )}

        {/* Fixed mode: Back to Pexels search */}
        {isFixed && source === 'pexels' && (
          <Button size="small" variant="outlined" onClick={handleBackToPexelsSearch}>
            {t('pexelsBackToSearch')}
          </Button>
        )}

        {/* Guide line tools (fixed images or YouTube) */}
        {(isFixed || isYouTube) && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

            <Tooltip title={t('addGuideLine')}>
              <IconButton
                size="small"
                onClick={() => toggleGuideMode('add')}
                sx={{
                  bgcolor: guideMode === 'add' ? 'error.main' : 'transparent',
                  color: guideMode === 'add' ? 'white' : 'inherit',
                  '&:hover': { bgcolor: guideMode === 'add' ? 'error.dark' : 'action.hover' },
                }}
              >
                <PenLine size={20} />
              </IconButton>
            </Tooltip>

            <Tooltip title={t('deleteGuideLine')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => toggleGuideMode('delete')}
                  disabled={lines.length === 0}
                  sx={{
                    bgcolor: guideMode === 'delete' ? 'error.main' : 'transparent',
                    color: guideMode === 'delete' ? 'white' : 'inherit',
                    '&:hover': { bgcolor: guideMode === 'delete' ? 'error.dark' : 'action.hover' },
                  }}
                >
                  <CircleX size={20} />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title={t('clearGuideLines')}>
              <span>
                <IconButton size="small" onClick={clearLines} disabled={lines.length === 0}>
                  <Trash2 size={20} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}

        {/* Delete confirmation */}
        {highlightedGuideId && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
            <Button size="small" color="error" variant="contained" onClick={handleDeleteHighlighted}>
              {t('delete')}
            </Button>
            <Button size="small" variant="outlined" onClick={handleCancelHighlight}>
              {t('cancel')}
            </Button>
          </>
        )}

        <Box sx={{ flex: 1 }} />

        {/* View controls (always visible) */}
        {(isFixed || isYouTube) && (
          <Tooltip title={t('compare')}>
            <IconButton
              size="small"
              onClick={onToggleOverlay}
              sx={{
                bgcolor: overlayActive ? 'warning.main' : 'transparent',
                color: overlayActive ? 'white' : 'inherit',
                '&:hover': { bgcolor: overlayActive ? 'warning.dark' : 'action.hover' },
              }}
            >
              <Layers size={20} />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title={t('cycleGrid')}>
          <IconButton
            size="small"
            onClick={cycleGridMode}
            sx={{
              bgcolor: grid.mode !== 'none' ? 'info.main' : 'transparent',
              color: grid.mode !== 'none' ? 'white' : 'inherit',
              '&:hover': { bgcolor: grid.mode !== 'none' ? 'info.dark' : 'action.hover' },
            }}
          >
            <GridIcon mode={grid.mode} />
          </IconButton>
        </Tooltip>

        {!isYouTube && (
          <Tooltip title={t('flipHorizontal')}>
            <IconButton
              size="small"
              onClick={onToggleFlip}
              sx={{
                bgcolor: isFlipped ? 'info.main' : 'transparent',
                color: isFlipped ? 'white' : 'inherit',
                '&:hover': { bgcolor: isFlipped ? 'info.dark' : 'action.hover' },
              }}
            >
              <FlipHorizontal2 size={20} />
            </IconButton>
          </Tooltip>
        )}

        {isFixed && (
          <Tooltip title={t('resetZoom')}>
            <IconButton size="small" onClick={() => setViewResetVersion(v => v + 1)}>
              <LocateFixed size={20} />
            </IconButton>
          </Tooltip>
        )}

        {fullscreenSupported && (
          <Tooltip title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}>
            <IconButton size="small" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', transform: (isFlipped && !isYouTube) ? 'scaleX(-1)' : undefined }}>
        {/* No source: show selection buttons in center */}
        {isNone && (
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 2,
          }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button variant="outlined" size="large" onClick={handleOpenSketchfab}>
                {t('sketchfab')}
              </Button>
              <Button variant="outlined" size="large" onClick={handleLoadLocalImage}>
                {t('image')}
              </Button>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Button variant="outlined" size="large" onClick={handleOpenPexels}>
                  {t('pexels')}
                </Button>
                <Tooltip title={t('pexelsApiKeySettings')}>
                  <IconButton size="small" onClick={() => setPexelsKeyDialogOpen(true)} sx={{ ml: 0.5 }}>
                    <Settings size={18} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, width: '80%', maxWidth: 400 }}>
              <Autocomplete<UrlHistoryEntry, false, false, true>
                freeSolo
                size="small"
                sx={{ flex: 1 }}
                fullWidth
                options={urlHistory}
                filterOptions={x => x}
                getOptionLabel={option => typeof option === 'string' ? option : option.url}
                isOptionEqualToValue={(a, b) => a.url === b.url}
                inputValue={urlInput}
                onInputChange={(_, value, reason) => {
                  if (reason === 'input' || reason === 'clear') {
                    setUrlInput(value)
                    setUrlError(null)
                  }
                }}
                onChange={(_, value, reason) => {
                  if (reason === 'selectOption' && value && typeof value !== 'string') {
                    setUrlInput(value.url)
                    setUrlError(null)
                    handleLoadFromUrl(value.url)
                  }
                }}
                renderOption={(props, option) => {
                  const { key, ...rest } = props as typeof props & { key: string }
                  const { primary, secondary } = describeHistoryUrl(option)
                  return (
                    <li key={key} {...rest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Box component="span" sx={{ color: 'text.secondary', display: 'inline-flex' }}>
                        <HistoryTypeIcon type={option.type} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {primary}
                        </Typography>
                        {secondary && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {secondary}
                          </Typography>
                        )}
                      </Box>
                      <Tooltip title={t('urlHistoryDelete')}>
                        <IconButton
                          size="small"
                          aria-label={t('urlHistoryDelete')}
                          // Touch devices commit option selection on pointerdown
                          // (before click), so we have to stop propagation there
                          // too — not just on click.
                          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}
                          onClick={e => {
                            e.stopPropagation()
                            deleteUrlHistory(option.url).then(reloadUrlHistory).catch(() => { /* ignore */ })
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </Tooltip>
                    </li>
                  )
                }}
                renderInput={params => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder={t('urlPlaceholder')}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && urlInput) {
                        e.preventDefault()
                        handleLoadFromUrl(urlInput)
                      }
                    }}
                  />
                )}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleLoadFromUrl(urlInput)}
                disabled={!urlInput || urlLoading}
              >
                {t('loadUrl')}
              </Button>
            </Box>
            {urlLoading && (
              <Typography variant="caption" color="text.secondary">{t('loading')}</Typography>
            )}
            {urlError && (
              <Typography variant="caption" color="error">{urlError}</Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.disabled">
                {t('buildDate')}: {new Date(import.meta.env.BUILD_DATE as string).toLocaleString()}
              </Typography>
              <a
                href="https://github.com/koizuka/drawing-practice"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', color: '#888' }}
              >
                <GitHubIcon />
              </a>
            </Box>
          </Box>
        )}

        {/* Sketchfab viewer (kept mounted when source is sketchfab) */}
        {source === 'sketchfab' && (
          <Box sx={{ display: referenceMode === 'browse' ? 'contents' : 'none' }}>
            <SketchfabViewer
              onFixAngle={handleFixAngle}
              onStateChange={handleSfStateChange}
              actionsRef={sfActionsRef}
            />
          </Box>
        )}

        {/* Pexels searcher — kept mounted while source is 'pexels' so the
            search state (query, results, pagination, scroll) persists across
            browse ↔ fixed transitions. Hidden when a photo is being viewed. */}
        {source === 'pexels' && (
          <Box sx={{ display: referenceMode === 'browse' ? 'contents' : 'none' }}>
            <PexelsSearcher
              onSelectPhoto={handleSelectPexelsPhoto}
              onOpenApiKeySettings={() => setPexelsKeyDialogOpen(true)}
              apiKeyVersion={pexelsKeyVersion}
            />
          </Box>
        )}

        {/* YouTube viewer */}
        {refInfo?.source === 'youtube' && (
          <YouTubeViewer
            videoId={refInfo.youtubeVideoId}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            overlayCurrentStrokeRef={overlayCurrentStrokeRef}
            onRegisterOverlayRedraw={onRegisterOverlayRedraw}
            onFitSize={onReferenceImageSize}
            guideMode={guideMode}
            onAddGuideLine={handleAddGuideLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
          />
        )}

        {/* Reference info overlay */}
        {isFixed && refInfo && (refInfo.title || refInfo.author) && (
          <ReferenceInfoOverlay
            key={referenceKey(refInfo)}
            refInfo={refInfo}
          />
        )}

        {/* Fixed image */}
        {isFixed && displayImageUrl && (
          <ImageViewer
            imageUrl={displayImageUrl}
            viewResetVersion={viewResetVersion}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            overlayCurrentStrokeRef={overlayCurrentStrokeRef}
            onRegisterOverlayRedraw={onRegisterOverlayRedraw}
            onImageLoaded={onReferenceImageSize}
            onImageError={handleImageError}
            guideMode={guideMode}
            onAddGuideLine={handleAddGuideLine}
            onDeleteGuideLine={removeLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            isFlipped={isFlipped}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
          />
        )}
      </Box>

      <PexelsApiKeyDialog
        open={pexelsKeyDialogOpen}
        onClose={() => setPexelsKeyDialogOpen(false)}
        onKeyChanged={() => setPexelsKeyVersion(v => v + 1)}
      />
    </Box>
  )
}
