import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Box, IconButton, Popover, Typography } from '@mui/material';
import { ToolbarTooltip } from './ToolbarTooltip';
import { Pen, Eraser, LassoSelect, Undo2, Redo2, Trash2, LocateFixed, Save, Check, Images, X, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen } from 'lucide-react';
import { useLongPress } from '../hooks/useLongPress';
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
  // The most-recently-used eraser sub-mode. In narrow layouts the eraser
  // toolbar button shows this icon and a short tap activates this sub-mode;
  // long-press opens a chooser. Not persisted across sessions.
  const [eraseSubmode, setEraseSubmode] = useState<'eraser' | 'lasso'>('eraser');
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

  // Layout snaps on collapse-toggle, but the toolbar slides from its
  // pre-toggle position so the user can visually trace where the toggle
  // button moved (and find their way back to expand the reference panel).
  const [toolbarSlide, setToolbarSlide] = useState<{ offset: number; animate: boolean }>({ offset: 0, animate: false });
  const toolbarSlideTokenRef = useRef(0);

  // Collapse the eraser/lasso pair into a single long-press button when the
  // toolbar is narrower than the threshold. Stored as a boolean (rather than
  // raw width) so resize events that don't cross the breakpoint don't trigger
  // re-renders. Threshold of 480px catches iPhone widths in both portrait
  // (375–430px) and landscape half-panel (~466px).
  const COMPACT_ERASE_THRESHOLD = 480;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compactErase, setCompactErase] = useState(false);
  const [eraserMenuAnchor, setEraserMenuAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const isCompact = w < COMPACT_ERASE_THRESHOLD;
      setCompactErase(isCompact);
      // Close the chooser when growing back to the wide layout — its anchor
      // IconButton is about to unmount and the popover would otherwise render
      // against a stale element.
      if (!isCompact) setEraserMenuAnchor(null);
    };
    const obs = new ResizeObserver(update);
    obs.observe(el);
    update();
    return () => obs.disconnect();
  }, []);

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
    setHighlightedStrokeIndex(null);
    setEraseSubmode('eraser');
  }, []);

  const handleLassoTool = useCallback(() => {
    setMode('lasso');
    setHighlightedStrokeIndex(null);
    setEraseSubmode('lasso');
  }, []);

  // Compact (narrow toolbar) eraser button: short tap re-enters the most-
  // recently-used erase sub-mode; long-press opens the chooser popover.
  const handleCompactEraseTap = useCallback(() => {
    if (eraseSubmode === 'lasso') handleLassoTool();
    else handleEraserTool();
  }, [eraseSubmode, handleEraserTool, handleLassoTool]);

  const compactEraseLongPress = useLongPress({
    onLongPress: (target) => {
      setEraserMenuAnchor(target);
    },
    onClick: handleCompactEraseTap,
    ms: 500,
  });

  const mod = getModifierPrefix();

  useKeyboardShortcuts({
    disabled: showGallery,
    actions: useMemo(() => ({
      onUndo: handleUndo,
      onRedo: handleRedo,
      onPenTool: handlePenTool,
      onEraserTool: handleEraserTool,
      onLassoTool: handleLassoTool,
      onSave: handleSave,
    }), [handleUndo, handleRedo, handlePenTool, handleEraserTool, handleLassoTool, handleSave]),
  });

  const eraseSx = (active: boolean) => ({
    'bgcolor': active ? 'error.main' : 'transparent',
    'color': active ? 'white' : 'inherit',
    '&:hover': { bgcolor: active ? 'error.dark' : 'action.hover' },
  });
  const compactEraseIcon = eraseSubmode === 'lasso' ? <LassoSelect size={20} /> : <Eraser size={20} />;
  const compactEraseLabel = eraseSubmode === 'lasso' ? t('lassoEraser') : t('eraser');

  const isLandscape = orientation === 'landscape';

  const handleCollapseToggleClick = useCallback(() => {
    if (collapseLocked || !onToggleReferenceCollapsed) return;
    // The reference panel always splits the viewport in half along the split
    // axis, so the toolbar's pre-toggle edge is half a viewport away from its
    // post-toggle edge. Snap the toolbar to that old edge with no transition,
    // then animate back to 0 once the layout has committed.
    const dimension = isLandscape ? window.innerWidth : window.innerHeight;
    const startOffset = (referenceCollapsed ? -1 : 1) * dimension / 2;
    setToolbarSlide({ offset: startOffset, animate: false });
    onToggleReferenceCollapsed();
    // Double rAF: first frame lets React commit the offset + layout snap;
    // second frame waits for paint so the next transform change actually
    // triggers a CSS transition instead of folding into the same style recalc.
    // Token guard: a rapid second click bumps the token, so the in-flight
    // chain becomes a no-op instead of fighting the new chain's start offset.
    const token = ++toolbarSlideTokenRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (toolbarSlideTokenRef.current !== token) return;
        setToolbarSlide({ offset: 0, animate: true });
      });
    });
  }, [collapseLocked, onToggleReferenceCollapsed, referenceCollapsed, isLandscape]);

  // Invalidate any in-flight rAF chain on unmount so the inner callback
  // becomes a no-op instead of calling setState on an unmounted component.
  useEffect(() => () => { toolbarSlideTokenRef.current++; }, []);

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box
        ref={toolbarRef}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid #ddd',
          bgcolor: '#fafafa',
          minHeight: 40,
          // Stack above the (now-revealed) reference panel during the
          // expand-direction slide so the sliding toolbar covers its sibling
          // toolbar instead of overlapping it transparently.
          position: 'relative',
          zIndex: 1,
          transform: isLandscape
            ? `translateX(${toolbarSlide.offset}px)`
            : `translateY(${toolbarSlide.offset}px)`,
          transition: toolbarSlide.animate ? 'transform 250ms ease-out' : 'none',
        }}
      >
        {/* Reference panel collapse toggle is placed at the left end (instead
            of the right view group) so it sits next to the reference/drawing
            boundary in landscape mode and stays in a fixed spot across
            orientations. See .claude/rules/ui-design-principles.md §1. */}
        {onToggleReferenceCollapsed && (() => {
          const icons = orientation === 'portrait'
            ? { collapsed: PanelTopOpen, expanded: PanelTopClose }
            : { collapsed: PanelLeftOpen, expanded: PanelLeftClose };
          const Icon = referenceCollapsed ? icons.collapsed : icons.expanded;
          const tooltip = collapseLocked
            ? t('collapseLockedSketchfabBrowse')
            : referenceCollapsed ? t('expandReference') : t('collapseReference');
          const button = (
            <IconButton size="small" onClick={handleCollapseToggleClick} disabled={collapseLocked} aria-label={tooltip}>
              <Icon size={20} />
            </IconButton>
          );
          return (
            <>
              <ToolbarTooltip title={tooltip}>
                {collapseLocked ? <span>{button}</span> : button}
              </ToolbarTooltip>
              <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
            </>
          );
        })()}

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

        {compactErase
          ? (
              <ToolbarTooltip title={`${compactEraseLabel} (E / L)`}>
                <IconButton
                  size="small"
                  aria-label={compactEraseLabel}
                  sx={{ ...eraseSx(mode === 'eraser' || mode === 'lasso'), touchAction: 'none' }}
                  {...compactEraseLongPress}
                >
                  {compactEraseIcon}
                </IconButton>
              </ToolbarTooltip>
            )
          : (
              <>
                <ToolbarTooltip title={`${t('eraser')} (E)`}>
                  <IconButton size="small" onClick={handleEraserTool} aria-label={t('eraser')} sx={eraseSx(mode === 'eraser')}>
                    <Eraser size={20} />
                  </IconButton>
                </ToolbarTooltip>
                <ToolbarTooltip title={`${t('lassoEraser')} (L)`}>
                  <IconButton size="small" onClick={handleLassoTool} aria-label={t('lassoEraser')} sx={eraseSx(mode === 'lasso')}>
                    <LassoSelect size={20} />
                  </IconButton>
                </ToolbarTooltip>
              </>
            )}

        <Popover
          open={Boolean(eraserMenuAnchor)}
          anchorEl={eraserMenuAnchor}
          onClose={() => setEraserMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          transformOrigin={{ vertical: 'top', horizontal: 'center' }}
          slotProps={{ paper: { sx: { display: 'flex', p: 0.5 } } }}
        >
          <ToolbarTooltip title={t('eraser')}>
            <IconButton
              size="small"
              aria-label={t('eraser')}
              onClick={() => { handleEraserTool(); setEraserMenuAnchor(null); }}
              sx={eraseSx(mode === 'eraser')}
            >
              <Eraser size={20} />
            </IconButton>
          </ToolbarTooltip>
          <ToolbarTooltip title={t('lassoEraser')}>
            <IconButton
              size="small"
              aria-label={t('lassoEraser')}
              onClick={() => { handleLassoTool(); setEraserMenuAnchor(null); }}
              sx={eraseSx(mode === 'lasso')}
            >
              <LassoSelect size={20} />
            </IconButton>
          </ToolbarTooltip>
        </Popover>

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
