import { useState, useCallback } from 'react'
import { Box, Button, Tooltip, IconButton } from '@mui/material'
import { SketchfabViewer } from './SketchfabViewer'
import { ImageViewer, type GuideInteractionMode } from './ImageViewer'
import { useGuides } from '../guides/useGuides'
import { useFullscreen } from '../hooks/useFullscreen'
import type { Stroke } from '../drawing/types'

type ReferenceSource = 'none' | 'sketchfab' | 'image'
type ReferenceMode = 'browse' | 'fixed'

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  onReferenceImageSize?: (width: number, height: number) => void
}

export function ReferencePanel({ overlayStrokes, onReferenceImageSize }: ReferencePanelProps) {
  const { grid, lines, version: guideVersion, toggleGrid, addLine, removeLine, clearLines } = useGuides()
  const { isFullscreen, toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen()
  const [source, setSource] = useState<ReferenceSource>('none')
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse')
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null)
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null)
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('none')
  const [highlightedGuideId, setHighlightedGuideId] = useState<string | null>(null)

  const handleLoadLocalImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const url = URL.createObjectURL(file)
      setLocalImageUrl(url)
      setSource('image')
      setReferenceMode('fixed')
    }
    input.click()
  }, [])

  const handleFixAngle = useCallback((screenshotUrl: string) => {
    setFixedImageUrl(screenshotUrl)
    setReferenceMode('fixed')
  }, [])

  const handleChangeAngle = useCallback(() => {
    setReferenceMode('browse')
    setFixedImageUrl(null)
  }, [])

  const handleOpenSketchfab = useCallback(() => {
    setSource('sketchfab')
    setReferenceMode('browse')
    setFixedImageUrl(null)
    setLocalImageUrl(null)
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
  const showGuideTools = referenceMode === 'fixed' && displayImageUrl

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
          flexWrap: 'wrap',
          minHeight: 40,
        }}
      >
        {/* Source selection */}
        <Button size="small" variant={source === 'sketchfab' ? 'contained' : 'outlined'} onClick={handleOpenSketchfab}>
          Sketchfab
        </Button>
        <Button size="small" variant={source === 'image' ? 'contained' : 'outlined'} onClick={handleLoadLocalImage}>
          Image
        </Button>

        {source === 'sketchfab' && referenceMode === 'fixed' && (
          <Button size="small" variant="outlined" onClick={handleChangeAngle}>
            Change Angle
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        {/* Guide line tools (only when image is fixed) */}
        {showGuideTools && (
          <>
            <Tooltip title="Add guide line">
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

            <Tooltip title="Delete guide line">
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

            <Tooltip title="Clear all guide lines">
              <span>
                <IconButton
                  size="small"
                  onClick={clearLines}
                  disabled={lines.length === 0}
                >
                  &#128465;
                </IconButton>
              </span>
            </Tooltip>

            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
          </>
        )}

        {/* Delete confirmation */}
        {highlightedGuideId && (
          <>
            <Button size="small" color="error" variant="contained" onClick={handleDeleteHighlighted}>
              Delete
            </Button>
            <Button size="small" variant="outlined" onClick={handleCancelHighlight}>
              Cancel
            </Button>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
          </>
        )}

        {/* View controls */}
        <Tooltip title="Toggle grid">
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

        {showGuideTools && (
          <Tooltip title="Reset zoom">
            <IconButton size="small" onClick={() => setViewResetVersion(v => v + 1)}>
              &#8858;
            </IconButton>
          </Tooltip>
        )}

        {fullscreenSupported && (
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <IconButton size="small" onClick={toggleFullscreen}>
              {isFullscreen ? '\u2716' : '\u26F6'}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {source === 'none' && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
            Select a reference source above
          </Box>
        )}

        {source === 'sketchfab' && referenceMode === 'browse' && (
          <SketchfabViewer onFixAngle={handleFixAngle} />
        )}

        {referenceMode === 'fixed' && displayImageUrl && (
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
