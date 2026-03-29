import { useRef, useState, useCallback } from 'react'
import { Box, IconButton, Tooltip, Button, Typography } from '@mui/material'
import { DrawingCanvas, type DrawingMode } from './DrawingCanvas'
import { StrokeManager } from '../drawing/StrokeManager'
import { useGuides } from '../guides/useGuides'
import { useTimer, formatTime } from '../hooks/useTimer'
import { saveDrawing } from '../storage'
import { generateThumbnail } from '../storage/generateThumbnail'
import { Gallery } from './Gallery'
import { t } from '../i18n'
import type { Stroke } from '../drawing/types'

interface DrawingPanelProps {
  onOverlayStrokes?: (strokes: readonly Stroke[] | null) => void
  referenceInfo?: string
  referenceSize?: { width: number; height: number } | null
}

export function DrawingPanel({ onOverlayStrokes, referenceInfo = '', referenceSize }: DrawingPanelProps) {
  const strokeManagerRef = useRef(new StrokeManager())
  const [mode, setMode] = useState<DrawingMode>('pen')
  const [highlightedStrokeIndex, setHighlightedStrokeIndex] = useState<number | null>(null)
  const [strokeCount, setStrokeCount] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [redrawVersion, setRedrawVersion] = useState(0)
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [overlayActive, setOverlayActive] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [saving, setSaving] = useState(false)

  const { grid, lines, version: guideVersion } = useGuides()
  const timer = useTimer()

  const syncOverlay = useCallback(() => {
    if (overlayActive) {
      onOverlayStrokes?.([...strokeManagerRef.current.getStrokes()])
    }
  }, [overlayActive, onOverlayStrokes])

  const syncUndoRedoState = useCallback(() => {
    setCanUndo(strokeManagerRef.current.canUndo())
    setCanRedo(strokeManagerRef.current.canRedo())
    setStrokeCount(strokeManagerRef.current.getStrokes().length)
  }, [])

  const triggerRedraw = useCallback(() => {
    syncUndoRedoState()
    syncOverlay()
    setRedrawVersion(v => v + 1)
  }, [syncUndoRedoState, syncOverlay])

  const handleUndo = useCallback(() => {
    strokeManagerRef.current.undo()
    setHighlightedStrokeIndex(null)
    triggerRedraw()
  }, [triggerRedraw])

  const handleRedo = useCallback(() => {
    strokeManagerRef.current.redo()
    setHighlightedStrokeIndex(null)
    triggerRedraw()
  }, [triggerRedraw])

  const handleClear = useCallback(() => {
    strokeManagerRef.current.clear()
    setHighlightedStrokeIndex(null)
    setMode('pen')
    timer.reset()
    triggerRedraw()
    // Clear overlay
    if (overlayActive) {
      setOverlayActive(false)
      onOverlayStrokes?.(null)
    }
  }, [triggerRedraw, timer, overlayActive, onOverlayStrokes])

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedStrokeIndex !== null) {
      strokeManagerRef.current.deleteStroke(highlightedStrokeIndex)
      setHighlightedStrokeIndex(null)
      triggerRedraw()
    }
  }, [highlightedStrokeIndex, triggerRedraw])

  const handleCancelHighlight = useCallback(() => {
    setHighlightedStrokeIndex(null)
  }, [])

  const handleStrokeCountChange = useCallback(() => {
    syncUndoRedoState()
    syncOverlay()
    // Auto-start timer on first stroke
    if (!timer.isRunning && strokeManagerRef.current.getStrokes().length > 0) {
      timer.start()
    }
  }, [syncUndoRedoState, syncOverlay, timer])

  const handleToggleOverlay = useCallback(() => {
    if (overlayActive) {
      setOverlayActive(false)
      onOverlayStrokes?.(null)
    } else {
      setOverlayActive(true)
      const strokes = strokeManagerRef.current.getStrokes()
      onOverlayStrokes?.(strokes.length > 0 ? [...strokes] : [])
    }
  }, [overlayActive, onOverlayStrokes])

  const handleSave = useCallback(async () => {
    const strokes = strokeManagerRef.current.getStrokes()
    if (strokes.length === 0) return
    setSaving(true)
    const thumbnail = generateThumbnail(strokes)
    await saveDrawing(strokes, thumbnail, referenceInfo, timer.elapsedMs)
    setSaving(false)
  }, [referenceInfo, timer.elapsedMs])

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
        {/* Drawing tools */}
        <Tooltip title={t('pen')}>
          <IconButton
            size="small"
            onClick={() => { setMode('pen'); setHighlightedStrokeIndex(null) }}
            sx={{
              bgcolor: mode === 'pen' ? 'primary.main' : 'transparent',
              color: mode === 'pen' ? 'white' : 'inherit',
              '&:hover': { bgcolor: mode === 'pen' ? 'primary.dark' : 'action.hover' },
              fontSize: '1.2rem',
            }}
          >
            &#9998;
          </IconButton>
        </Tooltip>

        <Tooltip title={t('eraser')}>
          <IconButton
            size="small"
            onClick={() => setMode('eraser')}
            sx={{
              bgcolor: mode === 'eraser' ? 'error.main' : 'transparent',
              color: mode === 'eraser' ? 'white' : 'inherit',
              '&:hover': { bgcolor: mode === 'eraser' ? 'error.dark' : 'action.hover' },
              fontSize: '1.2rem',
            }}
          >
            &#9003;
          </IconButton>
        </Tooltip>

        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

        {/* Edit */}
        <Tooltip title={t('undo')}>
          <span>
            <IconButton size="small" onClick={handleUndo} disabled={!canUndo}>
              &#8630;
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t('redo')}>
          <span>
            <IconButton size="small" onClick={handleRedo} disabled={!canRedo}>
              &#8631;
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t('clearAll')}>
          <span>
            <IconButton size="small" onClick={handleClear} disabled={strokeCount === 0}>
              &#128465;
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {/* View & compare */}
        <Tooltip title={t('compare')}>
          <IconButton
            size="small"
            onClick={handleToggleOverlay}
            sx={{
              bgcolor: overlayActive ? 'warning.main' : 'transparent',
              color: overlayActive ? 'white' : 'inherit',
              '&:hover': { bgcolor: overlayActive ? 'warning.dark' : 'action.hover' },
            }}
          >
            &#9881;
          </IconButton>
        </Tooltip>

        <Tooltip title={t('resetZoom')}>
          <IconButton size="small" onClick={() => setViewResetVersion(v => v + 1)}>
            &#8858;
          </IconButton>
        </Tooltip>

        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

        {/* Timer & data */}
        <Typography
          variant="body2"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            color: timer.isRunning ? 'text.primary' : 'text.secondary',
            minWidth: 48,
            textAlign: 'right',
          }}
        >
          {formatTime(timer.elapsedMs)}
        </Typography>

        <Tooltip title={t('saveDrawing')}>
          <span>
            <IconButton size="small" onClick={handleSave} disabled={strokeCount === 0 || saving}>
              &#128190;
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t('gallery')}>
          <IconButton size="small" onClick={() => setShowGallery(true)}>
            &#128444;
          </IconButton>
        </Tooltip>

        {/* Eraser confirmation */}
        {highlightedStrokeIndex !== null && (
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
      </Box>

      {/* Canvas */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DrawingCanvas
          mode={mode}
          highlightedStrokeIndex={highlightedStrokeIndex}
          onHighlightStroke={setHighlightedStrokeIndex}
          onStrokeCountChange={handleStrokeCountChange}
          strokeManagerRef={strokeManagerRef}
          redrawVersion={redrawVersion}
          viewResetVersion={viewResetVersion}
          grid={grid}
          guideLines={lines}
          guideVersion={guideVersion}
          fitSize={referenceSize ?? undefined}
        />
      </Box>

      {showGallery && <Gallery onClose={() => setShowGallery(false)} />}
    </Box>
  )
}
