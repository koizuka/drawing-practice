import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, lazy, Suspense } from 'react';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import { ToolbarTooltip } from './ToolbarTooltip';
import { Pen, Eraser, Undo2, Redo2, Trash2, LocateFixed, Save, Check, Images, X, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen, RotateCcw } from 'lucide-react';
import type { TraceFeedback, TraceStroke, TemplateScore } from '../trace/types';
import type { Orientation } from '../hooks/useOrientation';
import { DrawingCanvas, type DrawingMode } from './DrawingCanvas';
import { DIAG_ENABLED } from '../drawing/touchDiagnostics';
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

// Touch/Pencil diagnostics HUD — only loaded when `?diag=touch` is set. Lazy so
// the chunk stays out of the normal bundle and the overlay never mounts for
// ordinary users. See touchDiagnostics.ts / TouchDiagnosticsOverlay.tsx.
const TouchDiagnosticsOverlay = lazy(() => import('./TouchDiagnosticsOverlay'));

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
  onStrokesChanged?: (opts?: { flush?: boolean }) => void;
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
  /** Trace-template strokes shown as semi-transparent guide lines. */
  templateStrokes?: readonly TraceStroke[] | null;
  /** Latest scored attempt's deviation visualization. */
  traceFeedback?: TraceFeedback | null;
  /** Called when a stroke is committed (forwarded to DrawingCanvas). */
  onStrokeFinalized?: (stroke: Stroke) => void;
  /** Per-template-stroke scores (one per attempted target). */
  traceScores?: readonly TemplateScore[];
  /** Number of distinct template strokes the user has attempted. */
  traceTotalCovered?: number;
  /** Total number of template strokes in the active template. */
  traceTotalStrokes?: number;
  /** Average best errorPct across attempted strokes. */
  traceOverallBestPct?: number | null;
  /** Clear all scores + attempts (template stays active) and erase traced strokes. */
  onTraceResetScores?: () => void;
  /** Resync scoring derived state when strokes mutate outside scoring (undo/redo/erase). */
  onTraceSyncAttempts?: () => void;
  /**
   * Stroke timestamps that should render dimmed on the drawing canvas
   * (trace-template scored attempts) so the underlying template guide
   * stays readable while the user re-traces.
   */
  dimmedStrokeTimestamps?: ReadonlySet<number> | null;
  /**
   * Called the instant the user starts a pen-mode stroke. Trace-template
   * scoring uses this to clear the previous attempt's red deviation
   * feedback so the re-trace surface is clean.
   */
  onTraceStrokeStart?: () => void;
}

export function DrawingPanel({
  referenceSize, referenceInfo, strokeManager, onStrokesChanged, onGallerySaved, onOverlayClear, onLoadReference, onCurrentStrokeChange, captureReferenceSnapshot, timer, restoreVersion, historySyncVersion, isFlipped, viewTransform, orientation = 'landscape', referenceCollapsed = false, onToggleReferenceCollapsed, collapseLocked = false, inputFrozen = false,
  templateStrokes = null,
  traceFeedback = null,
  onStrokeFinalized,
  traceTotalCovered = 0,
  traceTotalStrokes = 0,
  traceOverallBestPct = null,
  onTraceResetScores,
  onTraceSyncAttempts,
  dimmedStrokeTimestamps = null,
  onTraceStrokeStart,
}: DrawingPanelProps) {
  const [mode, setMode] = useState<DrawingMode>('pen');
  const [highlightedStrokeIndex, setHighlightedStrokeIndex] = useState<number | null>(null);
  // canUndo/canRedo/strokeCount are computed inline from the strokeManager
  // instance each render rather than mirrored into state. State-mirroring
  // required follow-up useEffects after restore/reference-change that produced
  // a second commit and made the toolbar's undo/redo enabled state flicker.
  // Inline reads pick up new values on the same commit that bumps
  // restoreVersion / historySyncVersion.
  const [redrawVersion, setRedrawVersion] = useState(0);
  // Bumped ONLY on discrete stroke-edit ops (undo/redo/clear/delete) via
  // triggerRedraw — distinct from redrawVersion, which also bumps on every
  // freehand commit. The input-freeze hint uses this to reset its streak around
  // a button press without being reset by ordinary drawing.
  const [strokeEditVersion, setStrokeEditVersion] = useState(0);
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
  // Children are keyed by element reference (not index) so a list-shape change
  // between pre and post gracefully drops missing children instead of pairing
  // surviving icons with unrelated rects.
  const pendingFlipRef = useRef<{ box: DOMRect; children: Map<HTMLElement, DOMRect> } | null>(null);
  const flipRafIdRef = useRef<number | null>(null);
  const toolbarCoverRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

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

  // `opts.flush` propagates to the parent's autosave: discrete editing buttons
  // (undo / redo / clear / delete-highlighted) pass `{ flush: true }` so the
  // result persists immediately, matching flip / grid / collapse. Plain redraws
  // (none currently) would fall through to the 2s debounce.
  const triggerRedraw = useCallback((opts?: { flush?: boolean }) => {
    onStrokesChanged?.(opts);
    setRedrawVersion(v => v + 1);
    // Discrete stroke edit (undo/redo/clear/delete all funnel through here, and
    // only they do — freehand commits bump redrawVersion via
    // handleStrokeCountChange instead). Signals the freeze-hint streak reset.
    setStrokeEditVersion(v => v + 1);
  }, [onStrokesChanged]);

  const handleUndo = useCallback(() => {
    strokeManager.undo(captureReferenceSnapshot);
    setHighlightedStrokeIndex(null);
    triggerRedraw({ flush: true });
    // Stroke set changed: let trace scoring drop entries whose strokes were
    // popped and re-add entries whose strokes were spliced back. Without
    // this, attemptMap stays stale and the next retrace fails to replace.
    onTraceSyncAttempts?.();
    if (!strokeManager.canUndo()) {
      timer.reset();
    }
  }, [strokeManager, triggerRedraw, captureReferenceSnapshot, timer, onTraceSyncAttempts]);

  const handleRedo = useCallback(() => {
    strokeManager.redo(captureReferenceSnapshot);
    setHighlightedStrokeIndex(null);
    triggerRedraw({ flush: true });
    onTraceSyncAttempts?.();
    if (!timer.isRunning && strokeManager.getStrokes().length > 0) {
      timer.start();
    }
  }, [strokeManager, triggerRedraw, captureReferenceSnapshot, timer, onTraceSyncAttempts]);

  const handleClear = useCallback(() => {
    // Bail out if there is nothing the user could perceive as "clearing"
    // (canvas already empty and no tentative state to extend). Without this
    // guard we'd still run the trace-scoring reset below on a no-op click.
    if (strokeManager.getStrokes().length === 0 && !strokeManager.isTentativeClearActive()) return;
    // Reset trace scoring BEFORE tentativeClear. `resetScores` calls
    // `discardStrokes(scoredTimestamps)` which only works while the
    // matching strokes are still in `strokeManager.getStrokes()` — running
    // it after `tentativeClear()` (which empties strokes) would early-return
    // in `discardStrokes`, leaving the scored strokes inside the `'clear'`
    // undo entry. Undo would then resurrect them as untracked ghosts AND
    // a follow-up re-trace could not replace them (attemptMap was wiped),
    // duplicating strokes on the same template target permanently.
    onTraceResetScores?.();
    // Tentative clear: hide remaining (unscored) strokes from the canvas but
    // keep them recoverable via Undo until the user starts drawing again
    // (commits) or saves. Returns false when nothing remains to clear (e.g.
    // all strokes were scored & discarded above) — in that case the trash
    // is effectively destructive for this click.
    strokeManager.tentativeClear();
    setHighlightedStrokeIndex(null);
    setMode('pen');
    // Pause (don't reset) — Undo of the tentative-clear entry should also
    // restore the elapsed time. A reset happens later iff the user commits
    // by drawing a new stroke (see handleStrokeCountChange).
    timer.pause();
    triggerRedraw({ flush: true });
    onOverlayClear?.();
  }, [strokeManager, triggerRedraw, timer, onOverlayClear, onTraceResetScores]);

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedStrokeIndex !== null) {
      strokeManager.deleteStroke(highlightedStrokeIndex);
      setHighlightedStrokeIndex(null);
      triggerRedraw({ flush: true });
      onTraceSyncAttempts?.();
    }
  }, [strokeManager, highlightedStrokeIndex, triggerRedraw, onTraceSyncAttempts]);

  const handleCancelHighlight = useCallback(() => {
    setHighlightedStrokeIndex(null);
  }, []);

  const handleStrokeCountChange = useCallback((info: { flush?: boolean } = {}) => {
    setRedrawVersion(v => v + 1);
    // Lasso-delete and other discrete erases arrive with `flush` so they
    // persist immediately; a freehand stroke commit omits it and rides the 2s
    // debounce (continuous input, batched for perf).
    onStrokesChanged?.(info.flush ? { flush: true } : undefined);
    // Lasso-delete from DrawingCanvas reaches us via this path (NOT through
    // handleStrokeFinalized), so resync trace scoring here too. The add-path
    // also lands here just before handleStrokeFinalized records its history
    // entry — that intermediate sync is harmless (syncAttempts is idempotent
    // and reads the latest StrokeManager state).
    onTraceSyncAttempts?.();
    // Timer start/reset now happens at stroke START (handleStrokeStart), so by
    // the time a pen commit lands here the timer is already running. This guard
    // stays as a safety net for non-pen commit paths (e.g. lasso-delete) that
    // never fire onStrokeStart.
    if (!timer.isRunning && strokeManager.getStrokes().length > 0) {
      timer.start();
    }
  }, [strokeManager, onStrokesChanged, timer, onTraceSyncAttempts]);

  const handleStrokeStart = useCallback(() => {
    // Clear the previous attempt's red deviation feedback in the same React
    // batch as the first redraw (trace-template scoring), so the bands vanish
    // the instant the pen touches down.
    onTraceStrokeStart?.();
    // Committing a tentative clear means the user is starting a fresh drawing —
    // zero out the elapsed reading carried over from the cleared drawing.
    if (strokeManager.isTentativeClearActive()) {
      timer.reset();
    }
    // Count from the instant the pen touches down rather than when it lifts, so
    // a long opening stroke is timed. Covers the first stroke and resume-after-
    // pause uniformly (resume-after-pause does NOT reset, since the guard above
    // only fires while tentative — start() then resumes from the accumulated
    // elapsed). Trade-off: starting at pen-down decouples "timer running" from
    // "a stroke committed", so a pen-down whose stroke never commits (escalated
    // to a pinch via DrawingCanvas cancelStroke, freeze-recovery, or a trace
    // stroke rejected by scoring) leaves the timer running with no committed
    // stroke. On a fresh canvas it ticks from 0 until the first real stroke; if
    // a tentative clear was active, the pre-clear elapsed is also lost on a
    // subsequent Undo. Accepted: the leaked interval is the pinch-recognition
    // window (a few frames) in practice, it self-corrects on the next stroke,
    // and compensating would need a cancel signal plumbed back from the canvas.
    if (!timer.isRunning) {
      timer.start();
    }
  }, [onTraceStrokeStart, strokeManager, timer]);

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

  // Unified erase/select tool. A tap selects the nearest stroke; a
  // drag-to-enclose acts as a lasso — the branch is decided in DrawingCanvas
  // by pointer travel, so there's a single mode and a single button.
  const handleEraseTool = useCallback(() => {
    setMode('erase');
    setHighlightedStrokeIndex(null);
  }, []);

  const mod = getModifierPrefix();

  useKeyboardShortcuts({
    disabled: showGallery,
    actions: useMemo(() => ({
      onUndo: handleUndo,
      onRedo: handleRedo,
      onPenTool: handlePenTool,
      onEraseTool: handleEraseTool,
      onSave: handleSave,
      onResetZoom: () => setViewResetVersion(v => v + 1),
    }), [handleUndo, handleRedo, handlePenTool, handleEraseTool, handleSave]),
  });

  const eraseSx = (active: boolean) => ({
    'bgcolor': active ? 'error.main' : 'transparent',
    'color': active ? 'white' : 'inherit',
    '&:hover': { bgcolor: active ? 'error.dark' : 'action.hover' },
  });

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
    // position: relative は診断オーバーレイ(TouchDiagnosticsOverlay)の
    // absolute 基準。ビューポート基準(fixed)だと別タブ警告バナーで
    // ツールバー/キャンバスが下にずれた分を追従できず重なるため、
    // DrawingPanel を基準にしてレイアウトと一緒に下がるようにする。
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
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

        {/* Unified erase/select: tap to select the nearest stroke, drag to
            enclose as a lasso. One button — the lasso is gesture-driven, so it
            isn't surfaced separately. */}
        <ToolbarTooltip title={`${t('erase')} (E)`}>
          <IconButton size="small" onClick={handleEraseTool} aria-label={t('erase')} sx={eraseSx(mode === 'erase')}>
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
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* Trace score overlay — pinned to the top-right of the canvas so it
            stays out of the way of the centered template strokes. Only shown
            while a trace template is active. The overlay container ignores
            pointer events except for the reset button. */}
        {templateStrokes && templateStrokes.length > 0 && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: 'rgba(0, 0, 0, 0.55)',
              color: 'white',
              pointerEvents: 'none',
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
              aria-label={t('traceScoreLabel')}
            >
              {t('traceScoreLabel')}
              {' '}
              {traceTotalCovered}
              /
              {traceTotalStrokes}
              {traceOverallBestPct !== null && (
                <>
                  {' · '}
                  {t('traceScoreBest')}
                  {' '}
                  {traceOverallBestPct.toFixed(1)}
                  %
                </>
              )}
            </Typography>
            {onTraceResetScores && (
              <ToolbarTooltip title={t('traceResetScore')}>
                <span style={{ pointerEvents: 'auto' }}>
                  <IconButton
                    size="small"
                    onClick={onTraceResetScores}
                    disabled={traceTotalCovered === 0}
                    sx={{
                      'color': 'white',
                      'p': 0.25,
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                      '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)' },
                    }}
                  >
                    <RotateCcw size={16} />
                  </IconButton>
                </span>
              </ToolbarTooltip>
            )}
          </Box>
        )}
        <Box sx={{ width: '100%', height: '100%', transform: isFlipped ? 'scaleX(-1)' : undefined }}>
          <DrawingCanvas
            mode={mode}
            highlightedStrokeIndex={highlightedStrokeIndex}
            onHighlightStroke={setHighlightedStrokeIndex}
            onDeleteHighlightedStroke={handleDeleteHighlighted}
            onStrokeCountChange={handleStrokeCountChange}
            strokeManager={strokeManager}
            redrawVersion={redrawVersion}
            strokeEditVersion={strokeEditVersion}
            viewResetVersion={viewResetVersion}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            fitSize={referenceSize ?? undefined}
            isFlipped={isFlipped}
            onCurrentStrokeChange={onCurrentStrokeChange}
            viewTransform={viewTransform}
            inputFrozen={inputFrozen}
            templateStrokes={templateStrokes}
            traceFeedback={traceFeedback}
            onStrokeFinalized={onStrokeFinalized}
            dimmedStrokeTimestamps={dimmedStrokeTimestamps}
            onStrokeStart={handleStrokeStart}
          />
        </Box>
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

      {DIAG_ENABLED && (
        <LazyErrorBoundary>
          <Suspense fallback={null}>
            <TouchDiagnosticsOverlay />
          </Suspense>
        </LazyErrorBoundary>
      )}
    </Box>
  );
}
