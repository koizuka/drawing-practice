import { useState, useCallback, useRef } from 'react'
import { Box, Button, Tooltip, IconButton, Typography } from '@mui/material'
import { SketchfabViewer, type SketchfabActions, type ReferenceInfo } from './SketchfabViewer'
import { ImageViewer, type GuideInteractionMode } from './ImageViewer'
import { useGuides } from '../guides/useGuides'
import { useFullscreen } from '../hooks/useFullscreen'
import { t } from '../i18n'
import type { Stroke } from '../drawing/types'

type ReferenceSource = 'none' | 'sketchfab' | 'image'
type ReferenceMode = 'browse' | 'fixed'

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  onReferenceImageSize?: (width: number, height: number) => void
  overlayActive?: boolean
  onToggleOverlay?: () => void
}

export function ReferencePanel({ overlayStrokes, onReferenceImageSize, overlayActive, onToggleOverlay }: ReferencePanelProps) {
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
      setRefInfo({ title: file.name, author: '', source: 'image', fileName: file.name })
      setSource('image')
      setReferenceMode('fixed')
    }
    input.click()
  }, [])

  const handleFixAngle = useCallback((screenshotUrl: string, info: ReferenceInfo) => {
    setFixedImageUrl(screenshotUrl)
    setRefInfo(info)
    setReferenceMode('fixed')
  }, [])

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
  }, [])

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

  const handleAddGuideLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    addLine(x1, y1, x2, y2)
  }, [addLine])

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedGuideId) {
      removeLine(highlightedGuideId)
      setHighlightedGuideId(null)
    }
  }, [highlightedGuideId, removeLine])

  const handleCancelHighlight = useCallback(() => {
    setHighlightedGuideId(null)
  }, [])

  const toggleGuideMode = useCallback((mode: GuideInteractionMode) => {
    setGuideMode(prev => prev === mode ? 'none' : mode)
    setHighlightedGuideId(null)
  }, [])

  const displayImageUrl = source === 'image' ? localImageUrl : fixedImageUrl
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
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 2,
          }}>
            <Button variant="outlined" size="large" onClick={handleOpenSketchfab}>
              {t('sketchfab')}
            </Button>
            <Button variant="outlined" size="large" onClick={handleLoadLocalImage}>
              {t('image')}
            </Button>
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
