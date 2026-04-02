import { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Button, Tooltip, IconButton, Typography, TextField } from '@mui/material'
import { SketchfabViewer, type SketchfabActions, type ReferenceInfo } from './SketchfabViewer'
import { ImageViewer, type GuideInteractionMode } from './ImageViewer'
import { useGuides } from '../guides/useGuides'
import { useFullscreen } from '../hooks/useFullscreen'
import { t } from '../i18n'
import type { Stroke } from '../drawing/types'

type ReferenceSource = 'none' | 'sketchfab' | 'image' | 'url'
type ReferenceMode = 'browse' | 'fixed'

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  onReferenceImageSize?: (width: number, height: number) => void
  overlayActive?: boolean
  onToggleOverlay?: () => void
  onReferenceInfoChange?: (info: ReferenceInfo | null) => void
  /** Called with a function to load a reference; parent stores it for later use */
  onRegisterLoadReference?: (loadFn: (info: ReferenceInfo) => void) => void
}

export function ReferencePanel({ overlayStrokes, onReferenceImageSize, overlayActive, onToggleOverlay, onReferenceInfoChange, onRegisterLoadReference }: ReferencePanelProps) {
  const { grid, lines, version: guideVersion, toggleGrid, addLine, removeLine, clearLines } = useGuides()
  const { isFullscreen, toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen()
  const [source, setSource] = useState<ReferenceSource>('none')
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse')
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null)
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null)
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('none')
  const [refInfo, setRefInfo] = useState<ReferenceInfo | null>(null)
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
      const url = URL.createObjectURL(file)
      setLocalImageUrl(url)
      const info: ReferenceInfo = { title: file.name, author: '', source: 'image', fileName: file.name }
      setRefInfo(info)
      onReferenceInfoChange?.(info)
      setSource('image')
      setReferenceMode('fixed')
    }
    input.click()
  }, [onReferenceInfoChange])

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
      setFixedImageUrl(url)
      setRefInfo(info)
      onReferenceInfoChange?.(info)
      setSource('url')
      setReferenceMode('fixed')
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
  }, [onReferenceInfoChange])

  const handleFixAngle = useCallback((screenshotUrl: string, info: ReferenceInfo) => {
    setFixedImageUrl(screenshotUrl)
    setRefInfo(info)
    setReferenceMode('fixed')
    onReferenceInfoChange?.(info)
  }, [onReferenceInfoChange])

  const handleChangeAngle = useCallback(() => {
    setReferenceMode('browse')
    setFixedImageUrl(null)
  }, [])

  const handleClose = useCallback(() => {
    setSource('none')
    setReferenceMode('browse')
    setFixedImageUrl(null)
    setLocalImageUrl(null)
    setRefInfo(null)
    setGuideMode('none')
    setHighlightedGuideId(null)
    onReferenceInfoChange?.(null)
  }, [onReferenceInfoChange])

  const handleOpenSketchfab = useCallback(() => {
    setSource('sketchfab')
    setReferenceMode('browse')
    setFixedImageUrl(null)
    setLocalImageUrl(null)
  }, [])

  const handleSfStateChange = useCallback((state: { showViewer: boolean; isReady: boolean }) => {
    setSfShowViewer(state.showViewer)
    setSfIsReady(state.isReady)
  }, [])

  // Expose actions to parent
  const handleLoadReference = useCallback((info: ReferenceInfo) => {
    if (info.source === 'sketchfab' && info.sketchfabUid) {
      setSource('sketchfab')
      setReferenceMode('browse')
      setFixedImageUrl(null)
      setRefInfo(null)
      requestAnimationFrame(() => {
        sfActionsRef.current?.loadModelByUid(info.sketchfabUid!)
      })
    } else if (info.source === 'url' && info.imageUrl) {
      handleLoadFromUrl(info.imageUrl)
    }
  }, [handleLoadFromUrl])

  useEffect(() => {
    onRegisterLoadReference?.(handleLoadReference)
  }, [onRegisterLoadReference, handleLoadReference])

  const handleImageError = useCallback(() => {
    setUrlError(t('urlLoadFailed'))
    // Reset to none state so user sees the error
    setSource('none')
    setReferenceMode('browse')
    setFixedImageUrl(null)
    setRefInfo(null)
    onReferenceInfoChange?.(null)
  }, [onReferenceInfoChange])

  const handleAddGuideLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    addLine(x1, y1, x2, y2)
  }, [addLine])

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedGuideId) {
      removeLine(highlightedGuideId)
      // 削除後、残りの末尾を自動選択（連続削除を容易にする）
      const remaining = lines.filter(l => l.id !== highlightedGuideId)
      setHighlightedGuideId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
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
              &#10005;
            </IconButton>
          </Tooltip>
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
                &#9999;
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
                  &#10060;
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title={t('clearGuideLines')}>
              <span>
                <IconButton size="small" onClick={clearLines} disabled={lines.length === 0}>
                  &#128465;
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
              &#9881;
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title={t('toggleGrid')}>
          <IconButton
            size="small"
            onClick={toggleGrid}
            sx={{
              bgcolor: grid.enabled ? 'info.main' : 'transparent',
              color: grid.enabled ? 'white' : 'inherit',
              '&:hover': { bgcolor: grid.enabled ? 'info.dark' : 'action.hover' },
            }}
          >
            #
          </IconButton>
        </Tooltip>

        {isFixed && (
          <Tooltip title={t('resetZoom')}>
            <IconButton size="small" onClick={() => setViewResetVersion(v => v + 1)}>
              &#8858;
            </IconButton>
          </Tooltip>
        )}

        {fullscreenSupported && (
          <Tooltip title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}>
            <IconButton size="small" onClick={toggleFullscreen}>
              {isFullscreen ? '\u2716' : '\u26F6'}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
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
            onImageLoaded={onReferenceImageSize}
            onImageError={handleImageError}
            guideMode={guideMode}
            onAddGuideLine={handleAddGuideLine}
            onDeleteGuideLine={removeLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
          />
        )}
      </Box>
    </Box>
  )
}
