import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, lazy, Suspense } from 'react';
import { Box, CircularProgress, IconButton, Popover, Typography } from '@mui/material';
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
import { LazyErrorBoundary } from './LazyErrorBoundary';
import { t } from '../i18n';
import type { ReferenceInfo } from '../types';
import type { Stroke, ReferenceSnapshot } from '../drawing/types';

// Gallery is a modal opened on demand via the "Gallery" toolbar button —
// keep it out of the initial bundle.
const Gallery = lazy(() => import('./Gallery').then(m => ({ default: m.Gallery })));

const FLIP_TRANSITION = 'transform 250ms ease-out';
const FLIP_TRANSLATE_EPSILON = 0.5;
const FLIP_SCALE_EPSILON = 0.01;

interface DrawingPanelProps {
  referenceSize?: { width: number; height: number } | null;
  referenceInfo?: ReferenceInfo | null;
  /**
   * StrokeManager instance owned by SplitLayout. Passed in (rather than
   * created locally) so it exists from app mount — draft restore can
   * `loadState` into it before this panel ever renders.
   */
  strokeManager: StrokeManager;
  onStrokesChanged?: () => void;
  /** Hook for the parent to flush autosave after a successful gallery save. */
  onGallerySaved?: () => void;
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
  /** Pass-through to DrawingCanvas: when true, new strokes can't start. Used
   *  during the gesture-session swap window to swallow reflexive taps. */
  inputFrozen?: boolean;
}

export function DrawingPanel({ referenceSize, referenceInfo, strokeManager, onStrokesChanged, onGallerySaved, onOverlayClear, onLoadReference, onCurrentStrokeChange, captureReferenceSnapshot, timer, restoreVersion, historySyncVersion, isFlipped, viewTransform, orientation = 'landscape', referenceCollapsed = false, onToggleReferenceCollapsed, collapseLocked = false, inputFrozen = false }: DrawingPanelProps) {
  const [mode, setMode] = useState<DrawingMode>('pen');
  // The most-recently-used eraser sub-mode. In narrow layouts the eraser
  // toolbar button shows this icon and a short tap activates this sub-mode;
  // long-press opens a chooser. Not persisted across sessions.
  const [eraseSubmode, setEraseSubmode] = useState<'eraser' | 'lasso'>('eraser');
  const [highlightedStrokeIndex, setHighlightedStrokeIndex] = useState<number | null>(null);
  // canUndo/canRedo/strokeCount are computed inline from the strokeManager
  // instance each render rather than mirrored into state. State-mirroring
  // required follow-up useEffects after restore/reference-change that produced
  // a second commit and made the toolbar's undo/redo enabled state flicker.
  // Inline reads pick up new values on the same commit that bumps
  // restoreVersion / historySyncVersion.
  const [redrawVersion, setRedrawVersion] = useState(0);
  const [viewResetVersion, setViewResetVersion] = useState(0);
  const [, setViewTick] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // FLIP animation across collapse-toggle. Per-child (not whole-toolbar) so
  // right-anchored icons that don't move in landscape stay perfectly still
  // instead of being dragged off-screen and back with the rest of the bar.
  // The cover element extends the toolbar bg across the toolbar's pre-toggle
  // bounds during the slide so the (newly-revealed) reference toolbar
  // doesn't peek through the area behind translating icons on expand.
  //
  // Children are keyed by element reference (not index) so a list-shape
  // change between pre and post — e.g. compactErase swapping eraser+lasso
  // for a single long-press button when the toolbar crosses the width
  // threshold — gracefully drops the missing children instead of pairing
  // surviving icons with unrelated rects.
  const pendingFlipRef = useRef<{ box: DOMRect; children: Map<HTMLElement, DOMRect> } | null>(null);
  const flipRafIdRef = useRef<number | null>(null);
  const toolbarCoverRef = useRef<HTMLDivElement>(null);

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

  // Re-render when the shared ViewTransform changes so the reset button can
  // reflect the current dirty state.
  useEffect(() => {
    if (!viewTransform) return;
    return viewTransform.subscribe(() => setViewTick(t => t + 1));
  }, [viewTransform]);

  const resetDisabled = viewTransform ? !viewTransform.isDirty() : false;

  // Force a canvas redraw on parent draft-restore. Render-time prev-prop
  // pattern (vs a setState-in-effect) keeps react-hooks/set-state-in-effect
  // happy.
  const [prevRestoreVersion, setPrevRestoreVersion] = useState(restoreVersion ?? 0);
  if (prevRestoreVersion !== (restoreVersion ?? 0)) {
    setPrevRestoreVersion(restoreVersion ?? 0);
    if (restoreVersion && restoreVersion > 0) {
      setRedrawVersion(v => v + 1);
    }
  }

  const canUndo = strokeManager.canUndo();
  const canRedo = strokeManager.canRedo();
  const strokeCount = strokeManager.getStrokes().length;
  // Mark the version props as render dependencies so React Compiler keeps
  // the inline strokeManager reads above re-evaluating on parent-recorded
  // reference changes (historySyncVersion) and local stroke mutations
  // (redrawVersion).
  void historySyncVersion;
  void redrawVersion;

  const triggerRedraw = useCallback(() => {
    onStrokesChanged?.();
    setRedrawVersion(v => v + 1);
  }, [onStrokesChanged]);

  const handleUndo = useCallback(() => {
    strokeManager.undo(captureReferenceSnapshot);
    setHighlightedStrokeIndex(null);
    triggerRedraw();
    if (!strokeManager.canUndo()) {
      timer.reset();
    }
  }, [strokeManager, triggerRedraw, captureReferenceSnapshot, timer]);

  const handleRedo = useCallback(() => {
    strokeManager.redo(captureReferenceSnapshot);
    setHighlightedStrokeIndex(null);
    triggerRedraw();
    if (!timer.isRunning && strokeManager.getStrokes().length > 0) {
      timer.start();
    }
  }, [strokeManager, triggerRedraw, captureReferenceSnapshot, timer]);

  const handleClear = useCallback(() => {
    strokeManager.clear();
    setHighlightedStrokeIndex(null);
    setMode('pen');
    timer.reset();
    triggerRedraw();
    onOverlayClear?.();
  }, [strokeManager, triggerRedraw, timer, onOverlayClear]);

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedStrokeIndex !== null) {
      strokeManager.deleteStroke(highlightedStrokeIndex);
      setHighlightedStrokeIndex(null);
      triggerRedraw();
    }
  }, [strokeManager, highlightedStrokeIndex, triggerRedraw]);

  const handleCancelHighlight = useCallback(() => {
    setHighlightedStrokeIndex(null);
  }, []);

  const handleStrokeCountChange = useCallback(() => {
    setRedrawVersion(v => v + 1);
    onStrokesChanged?.();
    if (!timer.isRunning && strokeManager.getStrokes().length > 0) {
      timer.start();
    }
  }, [strokeManager, onStrokesChanged, timer]);

  // Re-entrancy guard via ref (not `saving` state) so a Cmd/Ctrl+S burst
  // sees the latched value on the same render, before React commits the
  // setSaving(true) update.
  const savingRef = useRef(false);
  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    const strokes = strokeManager.getStrokes();
    if (strokes.length === 0) return;
    // Guard: nothing has changed since the last gallery save (also covers
    // the keyboard-shortcut path when the button is visually disabled).
    if (!strokeManager.isDirtySinceGallerySave()) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const thumbnail = generateThumbnail(strokes);
      await saveDrawing(strokes, thumbnail, referenceInfo ?? null, timer.elapsedMs);
      strokeManager.markSavedToGallery();
      onGallerySaved?.();
      timer.pause();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    catch (err) {
      console.error('Gallery save failed:', err);
    }
    finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [strokeManager, referenceInfo, timer, onGallerySaved]);

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
      onResetZoom: () => setViewResetVersion(v => v + 1),
    }), [handleUndo, handleRedo, handlePenTool, handleEraserTool, handleLassoTool, handleSave]),
  });

  const eraseSx = (active: boolean) => ({
    'bgcolor': active ? 'error.main' : 'transparent',
    'color': active ? 'white' : 'inherit',
    '&:hover': { bgcolor: active ? 'error.dark' : 'action.hover' },
  });
  const compactEraseIcon = eraseSubmode === 'lasso' ? <LassoSelect size={20} /> : <Eraser size={20} />;
  const compactEraseLabel = eraseSubmode === 'lasso' ? t('lassoEraser') : t('eraser');

  const collectFlipTargets = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return null;
    const cover = toolbarCoverRef.current;
    const children = (Array.from(toolbar.children) as HTMLElement[]).filter(c => c !== cover);
    return { toolbar, cover, children };
  }, []);

  const handleCollapseToggleClick = useCallback(() => {
    if (collapseLocked || !onToggleReferenceCollapsed) return;
    // getBoundingClientRect includes any in-flight transform, so a rapid
    // second click during the previous animation starts the new animation
    // from the current visual position rather than snapping.
    const targets = collectFlipTargets();
    if (targets) {
      const childRects = new Map<HTMLElement, DOMRect>();
      for (const c of targets.children) childRects.set(c, c.getBoundingClientRect());
      pendingFlipRef.current = {
        box: targets.toolbar.getBoundingClientRect(),
        children: childRects,
      };
    }
    onToggleReferenceCollapsed();
  }, [collapseLocked, onToggleReferenceCollapsed, collectFlipTargets]);

  // Gate via pendingFlipRef: draft-restore paths that flip referenceCollapsed
  // without a click leave the ref null, so this effect no-ops in that case.
  useLayoutEffect(() => {
    const pending = pendingFlipRef.current;
    if (!pending) return;
    pendingFlipRef.current = null;
    const targets = collectFlipTargets();
    if (!targets) return;
    const { toolbar, cover, children } = targets;

    const resetStyles = (el: HTMLElement) => {
      el.style.transition = 'none';
      el.style.transform = '';
    };
    if (cover) resetStyles(cover);
    children.forEach(resetStyles);

    const postBox = toolbar.getBoundingClientRect();

    let animatedAny = false;

    children.forEach((child) => {
      const preRect = pending.children.get(child);
      if (!preRect) return;
      const post = child.getBoundingClientRect();
      const dx = preRect.left - post.left;
      const dy = preRect.top - post.top;
      if (Math.abs(dx) < FLIP_TRANSLATE_EPSILON && Math.abs(dy) < FLIP_TRANSLATE_EPSILON) return;
      child.style.transform = `translate(${dx}px, ${dy}px)`;
      animatedAny = true;
    });

    if (cover && postBox.width > 0 && postBox.height > 0) {
      const tx = pending.box.left - postBox.left;
      const ty = pending.box.top - postBox.top;
      const sx = pending.box.width / postBox.width;
      const sy = pending.box.height / postBox.height;
      const significant
        = Math.abs(tx) > FLIP_TRANSLATE_EPSILON
          || Math.abs(ty) > FLIP_TRANSLATE_EPSILON
          || Math.abs(sx - 1) > FLIP_SCALE_EPSILON
          || Math.abs(sy - 1) > FLIP_SCALE_EPSILON;
      if (significant) {
        cover.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
        animatedAny = true;
      }
    }

    if (!animatedAny) return;
    // Force reflow so the inverted transforms are committed before we switch
    // to transitioned transforms — otherwise the browser folds both into the
    // same style recalc and skips the animation.
    void toolbar.offsetWidth;
    if (flipRafIdRef.current !== null) cancelAnimationFrame(flipRafIdRef.current);
    flipRafIdRef.current = requestAnimationFrame(() => {
      flipRafIdRef.current = null;
      const animateBack = (el: HTMLElement, identity: string) => {
        if (!el.style.transform) return;
        el.style.transition = FLIP_TRANSITION;
        el.style.transform = identity;
      };
      if (cover) animateBack(cover, '');
      children.forEach(child => animateBack(child, 'translate(0, 0)'));
    });
  }, [referenceCollapsed, collectFlipTargets]);

  // Cancel in-flight rAF on unmount so the callback doesn't touch a
  // detached DOM node.
  useEffect(() => () => {
    if (flipRafIdRef.current !== null) cancelAnimationFrame(flipRafIdRef.current);
  }, []);

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
          // expand-direction slide so toolbar children translating across
          // the panel boundary cover the sibling toolbar instead of
          // overlapping it transparently.
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Bg cover used by the FLIP animation (see useLayoutEffect above) to
            keep the draw-toolbar bg in front of the reference toolbar during
            the collapse-toggle slide. zIndex: -1 keeps it behind the icons in
            the toolbar's stacking context but above the toolbar's own bg, so
            scaling it beyond the toolbar's natural width extends the visible
            #fafafa region during the animation. */}
        <Box
          ref={toolbarCoverRef}
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: '#fafafa',
            borderBottom: '1px solid #ddd',
            transformOrigin: '0 0',
            pointerEvents: 'none',
            zIndex: -1,
          }}
        />
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
                  disabled={strokeCount === 0 || saving || !strokeManager.isDirtySinceGallerySave()}
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
          strokeManager={strokeManager}
          redrawVersion={redrawVersion}
          viewResetVersion={viewResetVersion}
          grid={grid}
          guideLines={lines}
          guideVersion={guideVersion}
          fitSize={referenceSize ?? undefined}
          isFlipped={isFlipped}
          onCurrentStrokeChange={onCurrentStrokeChange}
          viewTransform={viewTransform}
          inputFrozen={inputFrozen}
        />
      </Box>

      {showGallery && (
        <LazyErrorBoundary>
          <Suspense
            fallback={(
              <Box sx={{
                position: 'fixed',
                inset: 0,
                bgcolor: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
              >
                <CircularProgress />
              </Box>
            )}
          >
            <Gallery onClose={() => setShowGallery(false)} onLoadReference={onLoadReference} />
          </Suspense>
        </LazyErrorBoundary>
      )}
    </Box>
  );
}
