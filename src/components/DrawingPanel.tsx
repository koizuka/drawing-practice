import { useRef, useState, useCallback, useEffect } from 'react'
import { Box, IconButton, Tooltip, Button, Typography } from '@mui/material'
import { Pen, Eraser, Undo2, Redo2, Trash2, LocateFixed, Save, Check, Images } from 'lucide-react'
import { DrawingCanvas, type DrawingMode } from './DrawingCanvas'
import { StrokeManager } from '../drawing/StrokeManager'
import { useGuides } from '../guides/useGuides'
import { formatTime, type TimerHandle } from '../hooks/useTimer'
import { saveDrawing } from '../storage'
import { generateThumbnail } from '../storage/generateThumbnail'
import { Gallery } from './Gallery'
import { t } from '../i18n'
import type { ReferenceInfo } from '../components/SketchfabViewer'

interface DrawingPanelProps {
  referenceSize?: { width: number; height: number } | null
  referenceInfo?: ReferenceInfo | null
  onStrokeManagerReady?: (sm: StrokeManager) => void
  onStrokesChanged?: () => void
  onOverlayClear?: () => void
  onLoadReference?: (info: ReferenceInfo) => void
  timer: TimerHandle
  restoreVersion?: number
  isFlipped?: boolean
}

export function DrawingPanel({ referenceSize, referenceInfo, onStrokeManagerReady, onStrokesChanged, onOverlayClear, onLoadReference, timer, restoreVersion, isFlipped }: DrawingPanelProps) {
  const strokeManagerRef = useRef(new StrokeManager())
  const [mode, setMode] = useState<DrawingMode>('pen')
  const [highlightedStrokeIndex, setHighlightedStrokeIndex] = useState<number | null>(null)
  const [strokeCount, setStrokeCount] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [redrawVersion, setRedrawVersion] = useState(0)
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [showGallery, setShowGallery] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const { grid, lines, version: guideVersion } = useGuides()

  // Expose stroke manager to parent
  useEffect(() => {
    onStrokeManagerReady?.(strokeManagerRef.current)
  }, [onStrokeManagerReady])

  // Sync UI state after restore
  useEffect(() => {
    if (restoreVersion && restoreVersion > 0) {
      setCanUndo(strokeManagerRef.current.canUndo())
      setCanRedo(strokeManagerRef.current.canRedo())
      setStrokeCount(strokeManagerRef.current.getStrokes().length)
      setRedrawVersion(v => v + 1)
    }
  }, [restoreVersion])

  const syncUndoRedoState = useCallback(() => {
    setCanUndo(strokeManagerRef.current.canUndo())
    setCanRedo(strokeManagerRef.current.canRedo())
    setStrokeCount(strokeManagerRef.current.getStrokes().length)
  }, [])

  const triggerRedraw = useCallback(() => {
    syncUndoRedoState()
    onStrokesChanged?.()
    setRedrawVersion(v => v + 1)
  }, [syncUndoRedoState, onStrokesChanged])

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
    onOverlayClear?.()
  }, [triggerRedraw, timer, onOverlayClear])

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
    onStrokesChanged?.()
    if (!timer.isRunning && strokeManagerRef.current.getStrokes().length > 0) {
      timer.start()
    }
  }, [syncUndoRedoState, onStrokesChanged, timer])

  const handleSave = useCallback(async () => {
    const strokes = strokeManagerRef.current.getStrokes()
    if (strokes.length === 0) return
    setSaving(true)
    const thumbnail = generateThumbnail(strokes)
    await saveDrawing(strokes, thumbnail, referenceInfo ?? null, timer.elapsedMs)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
            }}
          >
            <Pen size={20} />
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
            }}
          >
            <Eraser size={20} />
          </IconButton>
        </Tooltip>

        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

        {/* Edit */}
        <Tooltip title={t('undo')}>
          <span>
            <IconButton size="small" onClick={handleUndo} disabled={!canUndo}>
              <Undo2 size={20} />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t('redo')}>
          <span>
            <IconButton size="small" onClick={handleRedo} disabled={!canRedo}>
              <Redo2 size={20} />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t('clearAll')}>
          <span>
            <IconButton size="small" onClick={handleClear} disabled={strokeCount === 0}>
              <Trash2 size={20} />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {/* View */}
        <Tooltip title={t('resetZoom')}>
          <IconButton size="small" onClick={() => setViewResetVersion(v => v + 1)}>
            <LocateFixed size={20} />
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

        <Tooltip title={saved ? t('saved') : t('saveDrawing')}>
          <span>
            <IconButton
              size="small"
              onClick={handleSave}
              disabled={strokeCount === 0 || saving}
              sx={{
                bgcolor: saved ? 'success.main' : 'transparent',
                color: saved ? 'white' : 'inherit',
                '&:hover': { bgcolor: saved ? 'success.dark' : 'action.hover' },
                transition: 'background-color 0.3s, color 0.3s',
              }}
            >
              {saved ? <Check size={20} /> : <Save size={20} />}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title={t('gallery')}>
          <IconButton size="small" onClick={() => setShowGallery(true)}>
            <Images size={20} />
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
      <Box sx={{ flex: 1, minHeight: 0, transform: isFlipped ? 'scaleX(-1)' : undefined }}>
        <DrawingCanvas
          mode={mode}
          highlightedStrokeIndex={highlightedStrokeIndex}
          onHighlightStroke={setHighlightedStrokeIndex}
          onDeleteHighlightedStroke={handleDeleteHighlighted}
          onStrokeCountChange={handleStrokeCountChange}
          strokeManagerRef={strokeManagerRef}
          redrawVersion={redrawVersion}
          viewResetVersion={viewResetVersion}
          grid={grid}
          guideLines={lines}
          guideVersion={guideVersion}
          fitSize={referenceSize ?? undefined}
          isFlipped={isFlipped}
        />
      </Box>

      {showGallery && <Gallery onClose={() => setShowGallery(false)} onLoadReference={onLoadReference} />}
    </Box>
  )
}
