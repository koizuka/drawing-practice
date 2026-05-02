import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { ToolbarTooltip } from './ToolbarTooltip';
import { Pen, Eraser, Undo2, Redo2, Trash2, LocateFixed, Save, Check, Images, X, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen } from 'lucide-react';
import type { Orientation } from '../hooks/useOrientation';
import { DrawingCanvas, type DrawingMode } from './DrawingCanvas';
import type { ViewTransform } from '../drawing/ViewTransform';
import { StrokeManager } from '../drawing/StrokeManager';
import { useGuides } from '../guides/useGuides';
import { formatTime, type TimerHandle } from '../hooks/useTimer';
import { useKeyboardShortcuts, getModifierPrefix } from '../hooks/useKeyboardShortcuts';
import { saveDrawing } from '../storage';
import { generateThumbnail } from '../storage/generateThumbnail';
import { Gallery } from './Gallery';
import { t } from '../i18n';
import type { ReferenceInfo } from '../types';
import type { Stroke, ReferenceSnapshot } from '../drawing/types';

interface DrawingPanelProps {
  referenceSize?: { width: number; height: number } | null;
  referenceInfo?: ReferenceInfo | null;
  onStrokeManagerReady?: (sm: StrokeManager) => void;
  onStrokesChanged?: () => void;
  onOverlayClear?: () => void;
  onLoadReference?: (info: ReferenceInfo) => void;
  onCurrentStrokeChange?: (stroke: Stroke | null) => void;
  /**
   * Called from undo/redo so StrokeManager can record the current reference
   * state in the opposite history stack when popping a reference entry.
   */
  captureReferenceSnapshot?: () => ReferenceSnapshot;
  timer: TimerHandle;
  restoreVersion?: number;
  /**
   * Incremented by the parent when the StrokeManager's undo/redo stacks
   * change outside of DrawingPanel (e.g. a reference change recorded in
   * SplitLayout). Triggers a canUndo/canRedo refresh.
   */
  historySyncVersion?: number;
  isFlipped?: boolean;
  /** Optional shared ViewTransform for zoom sync with ReferencePanel. */
  viewTransform?: ViewTransform;
  /** Which panel owns the fit calculation. */
  fitLeader?: 'reference' | 'drawing';
  /** Current viewport orientation, used to pick the collapse-toggle icon. */
  orientation?: Orientation;
  /** Whether the reference panel is currently hidden (free-drawing layout). */
  referenceCollapsed?: boolean;
  /** Toggle the reference-panel collapsed state. */
  onToggleReferenceCollapsed?: () => void;
  /**
   * Disable the collapse toggle when collapsing is currently blocked (e.g.
   * the Sketchfab 3D viewer is being used in browse mode — the panel must
   * stay at half-screen so the captured-screenshot framing matches what the
   * user sees on Fix Angle).
   */
  collapseLocked?: boolean;
}

export function DrawingPanel({ referenceSize, referenceInfo, onStrokeManagerReady, onStrokesChanged, onOverlayClear, onLoadReference, onCurrentStrokeChange, captureReferenceSnapshot, timer, restoreVersion, historySyncVersion, isFlipped, viewTransform, fitLeader, orientation = 'landscape', referenceCollapsed = false, onToggleReferenceCollapsed, collapseLocked = false }: DrawingPanelProps) {
  const strokeManagerRef = useRef(new StrokeManager());
  const [mode, setMode] = useState<DrawingMode>('pen');
  const [highlightedStrokeIndex, setHighlightedStrokeIndex] = useState<number | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [redrawVersion, setRedrawVersion] = useState(0);
  const [viewResetVersion, setViewResetVersion] = useState(0);
  const [, setViewTick] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { grid, lines, version: guideVersion } = useGuides();

  // Expose stroke manager to parent
  useEffect(() => {
    onStrokeManagerReady?.(strokeManagerRef.current);
  }, [onStrokeManagerReady]);

  // Re-render when the shared ViewTransform changes so the reset button can
  // reflect the current dirty state.
  useEffect(() => {
    if (!viewTransform) return;
    return viewTransform.subscribe(() => setViewTick(t => t + 1));
  }, [viewTransform]);

  const resetDisabled = viewTransform ? !viewTransform.isDirty() : false;

  // Sync UI state after restore
  useEffect(() => {
    if (restoreVersion && restoreVersion > 0) {
      setCanUndo(strokeManagerRef.current.canUndo());
      setCanRedo(strokeManagerRef.current.canRedo());
      setStrokeCount(strokeManagerRef.current.getStrokes().length);
      setRedrawVersion(v => v + 1);
    }
  }, [restoreVersion]);

  // Refresh canUndo/canRedo when the parent records a reference change that
  // grew the stroke manager's undo stack from outside DrawingPanel.
  useEffect(() => {
    if (historySyncVersion && historySyncVersion > 0) {
      setCanUndo(strokeManagerRef.current.canUndo());
      setCanRedo(strokeManagerRef.current.canRedo());
    }
  }, [historySyncVersion]);

  const syncUndoRedoState = useCallback(() => {
    setCanUndo(strokeManagerRef.current.canUndo());
    setCanRedo(strokeManagerRef.current.canRedo());
    setStrokeCount(strokeManagerRef.current.getStrokes().length);
  }, []);

  const triggerRedraw = useCallback(() => {
    syncUndoRedoState();
    onStrokesChanged?.();
    setRedrawVersion(v => v + 1);
  }, [syncUndoRedoState, onStrokesChanged]);

  const handleUndo = useCallback(() => {
    strokeManagerRef.current.undo(captureReferenceSnapshot);
    setHighlightedStrokeIndex(null);
    triggerRedraw();
    if (!strokeManagerRef.current.canUndo()) {
      timer.reset();
    }
  }, [triggerRedraw, captureReferenceSnapshot, timer]);

  const handleRedo = useCallback(() => {
    strokeManagerRef.current.redo(captureReferenceSnapshot);
    setHighlightedStrokeIndex(null);
    triggerRedraw();
    if (!timer.isRunning && strokeManagerRef.current.getStrokes().length > 0) {
      timer.start();
    }
  }, [triggerRedraw, captureReferenceSnapshot, timer]);

  const handleClear = useCallback(() => {
    strokeManagerRef.current.clear();
    setHighlightedStrokeIndex(null);
    setMode('pen');
    timer.reset();
    triggerRedraw();
    onOverlayClear?.();
  }, [triggerRedraw, timer, onOverlayClear]);

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedStrokeIndex !== null) {
      strokeManagerRef.current.deleteStroke(highlightedStrokeIndex);
      setHighlightedStrokeIndex(null);
      triggerRedraw();
    }
  }, [highlightedStrokeIndex, triggerRedraw]);

  const handleCancelHighlight = useCallback(() => {
    setHighlightedStrokeIndex(null);
  }, []);

  const handleStrokeCountChange = useCallback(() => {
    syncUndoRedoState();
    onStrokesChanged?.();
    if (!timer.isRunning && strokeManagerRef.current.getStrokes().length > 0) {
      timer.start();
    }
  }, [syncUndoRedoState, onStrokesChanged, timer]);

  const handleSave = useCallback(async () => {
    const strokes = strokeManagerRef.current.getStrokes();
    if (strokes.length === 0) return;
    setSaving(true);
    const thumbnail = generateThumbnail(strokes);
    await saveDrawing(strokes, thumbnail, referenceInfo ?? null, timer.elapsedMs);
    timer.pause();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [referenceInfo, timer]);

  const handlePenTool = useCallback(() => {
    setMode('pen');
    setHighlightedStrokeIndex(null);
  }, []);

  const handleEraserTool = useCallback(() => {
    setMode('eraser');
  }, []);

  const mod = getModifierPrefix();

  useKeyboardShortcuts({
    disabled: showGallery,
    actions: useMemo(() => ({
      onUndo: handleUndo,
      onRedo: handleRedo,
      onPenTool: handlePenTool,
      onEraserTool: handleEraserTool,
      onSave: handleSave,
    }), [handleUndo, handleRedo, handlePenTool, handleEraserTool, handleSave]),
  });

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
        <ToolbarTooltip title={`${t('pen')} (P)`}>
          <IconButton
            size="small"
            onClick={handlePenTool}
            sx={{
              'bgcolor': mode === 'pen' ? 'primary.main' : 'transparent',
              'color': mode === 'pen' ? 'white' : 'inherit',
              '&:hover': { bgcolor: mode === 'pen' ? 'primary.dark' : 'action.hover' },
            }}
          >
            <Pen size={20} />
          </IconButton>
        </ToolbarTooltip>

        <ToolbarTooltip title={`${t('eraser')} (E)`}>
          <IconButton
            size="small"
            onClick={handleEraserTool}
            sx={{
              'bgcolor': mode === 'eraser' ? 'error.main' : 'transparent',
              'color': mode === 'eraser' ? 'white' : 'inherit',
              '&:hover': { bgcolor: mode === 'eraser' ? 'error.dark' : 'action.hover' },
            }}
          >
            <Eraser size={20} />
          </IconButton>
        </ToolbarTooltip>

        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

        {/* Edit */}
        <ToolbarTooltip title={`${t('undo')} (${mod}Z)`}>
          <span>
            <IconButton size="small" onClick={handleUndo} disabled={!canUndo}>
              <Undo2 size={20} />
            </IconButton>
          </span>
        </ToolbarTooltip>

        <ToolbarTooltip title={`${t('redo')} (${mod}Shift+Z)`}>
          <span>
            <IconButton size="small" onClick={handleRedo} disabled={!canRedo}>
              <Redo2 size={20} />
            </IconButton>
          </span>
        </ToolbarTooltip>

        <ToolbarTooltip title={t('clearAll')}>
          <span>
            <IconButton size="small" onClick={handleClear} disabled={strokeCount === 0}>
              <Trash2 size={20} />
            </IconButton>
          </span>
        </ToolbarTooltip>

        <Box sx={{ flex: 1 }} />

        {/* View */}
        {onToggleReferenceCollapsed && (() => {
          const icons = orientation === 'portrait'
            ? { collapsed: PanelTopOpen, expanded: PanelTopClose }
            : { collapsed: PanelLeftOpen, expanded: PanelLeftClose };
          const Icon = referenceCollapsed ? icons.collapsed : icons.expanded;
          const tooltip = collapseLocked
            ? t('collapseLockedSketchfabBrowse')
            : referenceCollapsed ? t('expandReference') : t('collapseReference');
          // Only wrap in <span> when disabled — MUI suppresses tooltips on
          // disabled buttons unless wrapped, but adding the span when enabled
          // breaks the aria-label propagation tests rely on for queryByLabelText.
          const button = (
            <IconButton size="small" onClick={onToggleReferenceCollapsed} disabled={collapseLocked} aria-label={tooltip}>
              <Icon size={20} />
            </IconButton>
          );
          return (
            <ToolbarTooltip title={tooltip}>
              {collapseLocked ? <span>{button}</span> : button}
            </ToolbarTooltip>
          );
        })()}

        <ToolbarTooltip title={t('resetZoom')}>
          <span>
            <IconButton
              size="small"
              onClick={() => setViewResetVersion(v => v + 1)}
              disabled={resetDisabled}
            >
              <LocateFixed size={20} />
            </IconButton>
          </span>
        </ToolbarTooltip>

        <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

        {/* Timer & data */}
        <Typography
          variant="body2"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            color: timer.isRunning ? 'primary.main' : 'text.disabled',
            minWidth: 48,
            textAlign: 'right',
          }}
        >
          {formatTime(timer.elapsedMs)}
        </Typography>

        {highlightedStrokeIndex === null && (
          <>
            <ToolbarTooltip title={saved ? t('saved') : `${t('saveDrawing')} (${mod}S)`}>
              <span>
                <IconButton
                  size="small"
                  onClick={handleSave}
                  disabled={strokeCount === 0 || saving}
                  sx={{
                    'bgcolor': saved ? 'success.main' : 'transparent',
                    'color': saved ? 'white' : 'inherit',
                    '&:hover': { bgcolor: saved ? 'success.dark' : 'action.hover' },
                    'transition': 'background-color 0.3s, color 0.3s',
                  }}
                >
                  {saved ? <Check size={20} /> : <Save size={20} />}
                </IconButton>
              </span>
            </ToolbarTooltip>

            <ToolbarTooltip title={t('gallery')}>
              <IconButton size="small" onClick={() => { timer.pause(); setShowGallery(true); }}>
                <Images size={20} />
              </IconButton>
            </ToolbarTooltip>
          </>
        )}

        {/* Eraser confirmation (replaces save/gallery in-place to keep the timer position stable) */}
        {highlightedStrokeIndex !== null && (
          <>
            <ToolbarTooltip title={t('delete')}>
              <IconButton
                size="small"
                onClick={handleDeleteHighlighted}
                sx={{
                  'bgcolor': 'error.main',
                  'color': 'white',
                  '&:hover': { bgcolor: 'error.dark' },
                }}
              >
                <Trash2 size={20} />
              </IconButton>
            </ToolbarTooltip>
            <ToolbarTooltip title={t('cancel')}>
              <IconButton size="small" onClick={handleCancelHighlight}>
                <X size={20} />
              </IconButton>
            </ToolbarTooltip>
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
          onCurrentStrokeChange={onCurrentStrokeChange}
          viewTransform={viewTransform}
          isFitLeader={fitLeader === 'drawing'}
        />
      </Box>

      {showGallery && <Gallery onClose={() => setShowGallery(false)} onLoadReference={onLoadReference} />}
    </Box>
  );
}
