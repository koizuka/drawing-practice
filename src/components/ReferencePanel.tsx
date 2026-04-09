import { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Button, Tooltip, IconButton, Typography, TextField } from '@mui/material'
import { X, PenLine, CircleX, Trash2, Layers, FlipHorizontal2, LocateFixed, Maximize, Minimize } from 'lucide-react'
import { SketchfabViewer, type SketchfabActions, type ReferenceInfo } from './SketchfabViewer'
import { ImageViewer, type GuideInteractionMode } from './ImageViewer'
import { useGuides } from '../guides/useGuides'
import type { GridMode } from '../guides/types'
import { useFullscreen } from '../hooks/useFullscreen'
import { t } from '../i18n'
import type { Stroke } from '../drawing/types'
import type { ReferenceSource, ReferenceMode } from '../types'

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

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>
  onRegisterOverlayRedraw?: (redraw: () => void) => void
  onReferenceImageSize?: (width: number, height: number) => void
  overlayActive?: boolean
  onToggleOverlay?: () => void
  onReferenceInfoChange?: (info: ReferenceInfo | null) => void
  // Lifted state
  source: ReferenceSource
  onSourceChange: (source: ReferenceSource) => void
  referenceMode: ReferenceMode
  onReferenceModeChange: (mode: ReferenceMode) => void
  fixedImageUrl: string | null
  onFixedImageUrlChange: (url: string | null) => void
  localImageUrl: string | null
  onLocalImageUrlChange: (url: string | null) => void
  refInfo: ReferenceInfo | null
  onRegisterLoadSketchfabModel?: (fn: (uid: string) => void) => void
  isFlipped?: boolean
  onToggleFlip?: () => void
}

export function ReferencePanel({
  overlayStrokes, overlayCurrentStrokeRef, onRegisterOverlayRedraw,
  onReferenceImageSize, overlayActive, onToggleOverlay, onReferenceInfoChange,
  source, onSourceChange, referenceMode, onReferenceModeChange,
  fixedImageUrl, onFixedImageUrlChange, localImageUrl, onLocalImageUrlChange, refInfo,
  onRegisterLoadSketchfabModel, isFlipped, onToggleFlip,
}: ReferencePanelProps) {
  const { grid, lines, version: guideVersion, cycleGridMode, addLine, removeLine, clearLines } = useGuides()
  const { isFullscreen, toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen()
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('none')
  const [highlightedGuideId, setHighlightedGuideId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)

  // Sketchfab viewer state (reported by child)
  const [sfShowViewer, setSfShowViewer] = useState(false)
  const [sfIsReady, setSfIsReady] = useState(false)
  const sfActionsRef = useRef<SketchfabActions | null>(null)

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
        onLocalImageUrlChange(dataUrl)
        const info: ReferenceInfo = { title: file.name, author: '', source: 'image', fileName: file.name }
        onReferenceInfoChange?.(info)
        onSourceChange('image')
        onReferenceModeChange('fixed')
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }, [onReferenceInfoChange, onSourceChange, onReferenceModeChange, onLocalImageUrlChange])

  const [urlLoading, setUrlLoading] = useState(false)

  const handleLoadFromUrl = useCallback((url: string) => {
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

    const onFail = () => {
      setUrlError(t('urlLoadFailed'))
      setUrlLoading(false)
    }

    const onSuccess = () => {
      setUrlLoading(false)
      const title = url.split('/').pop()?.split('?')[0] ?? url
      const info: ReferenceInfo = { title, author: '', source: 'url', imageUrl: url }
      onFixedImageUrlChange(url)
      onReferenceInfoChange?.(info)
      onSourceChange('url')
      onReferenceModeChange('fixed')
      setUrlInput('')
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
  }, [onReferenceInfoChange, onSourceChange, onReferenceModeChange, onFixedImageUrlChange])

  const handleFixAngle = useCallback((screenshotUrl: string, info: ReferenceInfo) => {
    onFixedImageUrlChange(screenshotUrl)
    onReferenceInfoChange?.(info)
    onReferenceModeChange('fixed')
  }, [onReferenceInfoChange, onReferenceModeChange, onFixedImageUrlChange])

  const handleChangeAngle = useCallback(() => {
    onReferenceModeChange('browse')
    onFixedImageUrlChange(null)
  }, [onReferenceModeChange, onFixedImageUrlChange])

  const handleClose = useCallback(() => {
    onSourceChange('none')
    onReferenceModeChange('browse')
    onFixedImageUrlChange(null)
    onLocalImageUrlChange(null)
    setGuideMode('none')
    setHighlightedGuideId(null)
    onReferenceInfoChange?.(null)
  }, [onReferenceInfoChange, onSourceChange, onReferenceModeChange, onFixedImageUrlChange, onLocalImageUrlChange])

  const handleOpenSketchfab = useCallback(() => {
    onSourceChange('sketchfab')
    onReferenceModeChange('browse')
    onFixedImageUrlChange(null)
    onLocalImageUrlChange(null)
  }, [onSourceChange, onReferenceModeChange, onFixedImageUrlChange, onLocalImageUrlChange])

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
    // Reset to none state so user sees the error
    onSourceChange('none')
    onReferenceModeChange('browse')
    onFixedImageUrlChange(null)
    onReferenceInfoChange?.(null)
  }, [onReferenceInfoChange, onSourceChange, onReferenceModeChange, onFixedImageUrlChange])

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

  const displayImageUrl = source === 'image' ? localImageUrl : fixedImageUrl  // 'sketchfab' and 'url' use fixedImageUrl
  const isFixed = referenceMode === 'fixed' && !!displayImageUrl
  const isNone = source === 'none'
  // Sketchfab browse mode: either searching or viewing a model
  const isSfBrowse = source === 'sketchfab' && referenceMode === 'browse'

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

        {/* Guide line tools (only when fixed) */}
        {isFixed && (
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
        {isFixed && (
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
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', transform: isFlipped ? 'scaleX(-1)' : undefined }}>
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
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="outlined" size="large" onClick={handleOpenSketchfab}>
                {t('sketchfab')}
              </Button>
              <Button variant="outlined" size="large" onClick={handleLoadLocalImage}>
                {t('image')}
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, width: '80%', maxWidth: 400 }}>
              <TextField
                size="small"
                placeholder={t('urlPlaceholder')}
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setUrlError(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && urlInput) handleLoadFromUrl(urlInput) }}
                sx={{ flex: 1 }}
                fullWidth
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
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
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

        {/* Reference info overlay */}
        {isFixed && refInfo && (refInfo.title || refInfo.author) && (
          <Box sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            zIndex: 5,
            bgcolor: 'rgba(0,0,0,0.5)',
            color: 'white',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            maxWidth: '80%',
            pointerEvents: 'none',
          }}>
            {refInfo.title && (
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {refInfo.title}
              </Typography>
            )}
            {refInfo.author && (
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {refInfo.author}
              </Typography>
            )}
          </Box>
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
          />
        )}
      </Box>
    </Box>
  )
}
