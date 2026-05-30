import { useRef, useEffect, useCallback } from 'react';
import { Box } from '@mui/material';
import { StrokeManager } from '../drawing/StrokeManager';
import { CanvasRenderer } from '../drawing/CanvasRenderer';
import { ViewTransform, type ContainerSize } from '../drawing/ViewTransform';
import { computeBaseScale, GRID_CENTER, pointInPolygon, emptyBoundingBox, extendBoundingBox, type BoundingBox } from '../drawing/canvasUtils';
import { TRACKPAD_ZOOM_SPEED } from '../drawing/constants';
import { drawGrid, drawGuideLines } from '../guides/drawGuides';
import type { Point, Stroke } from '../drawing/types';
import type { GridSettings, GuideLine } from '../guides/types';
import type { TraceFeedback, TraceStroke } from '../trace/types';
import { DIAG_ENABLED, diag, logEvent, persistLog, registerStateProbe, registerRecoveryActions, type ResetTrigger } from '../drawing/touchDiagnostics';

// Unified erase/select mode: a tap selects the nearest stroke (eraser), a
// drag-to-enclose acts as a lasso. The pen mode is unchanged. See
// .claude/rules/drawing-undo.md and the erase-pending machinery below.
export type DrawingMode = 'pen' | 'erase';

interface DrawingCanvasProps {
  mode: DrawingMode;
  highlightedStrokeIndex: number | null;
  onHighlightStroke: (index: number | null) => void;
  onDeleteHighlightedStroke?: () => void;
  /**
   * Called when the visible stroke set changes (commit, undo/redo, lasso
   * delete). `committedTentativeClear` is true ONLY when this notification
   * accompanies an `endStroke()` that just committed a tentative clear —
   * i.e. the new stroke discarded a `tentativeClear` entry. Callers use it to
   * reset the timer (the user is starting a fresh drawing). Lasso-delete and
   * other paths always pass false.
   *
   * `flush` is true for discrete deletions (lasso-delete) that should persist
   * immediately rather than wait the 2s autosave debounce — same intent as the
   * undo / redo / clear toolbar buttons. Freehand stroke commits omit it so
   * continuous drawing stays batched.
   */
  onStrokeCountChange: (info: { committedTentativeClear: boolean; flush?: boolean }) => void;
  strokeManager: StrokeManager;
  /** Increment this to force a canvas redraw (e.g. after undo/redo/clear). */
  redrawVersion: number;
  /** Increment this to reset zoom/pan to home. */
  viewResetVersion: number;
  grid: GridSettings;
  guideLines: readonly GuideLine[];
  guideVersion: number;
  /** If provided, fit this content size into the container (image reference). */
  fitSize?: { width: number; height: number };
  isFlipped?: boolean;
  /** Called with the in-progress stroke during drawing, or null when stroke ends */
  onCurrentStrokeChange?: (stroke: Stroke | null) => void;
  /** Optional shared ViewTransform instance. If provided, used instead of a private one (enables zoom sync with ReferencePanel). */
  viewTransform?: ViewTransform;
  /** When true, swallow new pointerdown events (touch + mouse) so a stroke
   *  cannot start. Used during the gesture-session swap window so a
   *  reflexive next-stroke from the user does not land on the wrong photo.
   *  In-flight strokes (started before the freeze) are NOT cancelled here —
   *  the caller's clear-strokes step handles that. */
  inputFrozen?: boolean;
  /** Trace-template strokes to render as semi-transparent guides. */
  templateStrokes?: readonly TraceStroke[] | null;
  /** Latest scored attempt's deviation visualization. */
  traceFeedback?: TraceFeedback | null;
  /** Called when a stroke is committed (after endStroke). Used by scoring. */
  onStrokeFinalized?: (stroke: Stroke) => void;
  /**
   * `Stroke.timestamp` values for strokes that should be rendered at
   * reduced opacity. Trace-template scoring populates this with the
   * already-attempted strokes so the underlying template guide stays
   * visible during re-tracing.
   */
  dimmedStrokeTimestamps?: ReadonlySet<number> | null;
  /**
   * Fired when a pen-mode stroke is about to begin (right before
   * `strokeManager.startStroke`). Used by trace-template scoring to clear
   * the lingering deviation feedback so the re-trace surface is clean.
   */
  onStrokeStart?: () => void;
}

/**
 * Opacity for scored trace-template attempts. Picked below the template
 * guide's 0.45 alpha so the visual hierarchy reads template > past attempts
 * > current draw — re-tracing a target stays unobstructed even when many
 * scored strokes already sit on the canvas.
 */
const DIMMED_STROKE_OPACITY = 0.2;

const ERASER_THRESHOLD = 20;

// Screen-space movement (CSS px) that promotes an erase-mode press from a
// "tap to select" into a "drag to lasso". Matches useLongPress's
// moveTolerancePx so the tap-vs-drag feel is uniform across the app. Screen
// space (not world) so the trigger distance is independent of zoom — a
// world-space threshold would make the lasso fire on tiny hand jitter at high
// zoom.
const ERASE_LASSO_THRESHOLD = 8;

export function DrawingCanvas({
  mode,
  highlightedStrokeIndex,
  onHighlightStroke,
  onDeleteHighlightedStroke,
  onStrokeCountChange,
  strokeManager,
  redrawVersion,
  viewResetVersion,
  grid,
  guideLines,
  guideVersion,
  fitSize,
  isFlipped,
  onCurrentStrokeChange,
  viewTransform,
  inputFrozen = false,
  templateStrokes = null,
  traceFeedback = null,
  onStrokeFinalized,
  dimmedStrokeTimestamps = null,
  onStrokeStart,
}: DrawingCanvasProps) {
  const inputFrozenRef = useRef(inputFrozen);
  useEffect(() => {
    inputFrozenRef.current = inputFrozen;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  // Lazy-init: useRef's argument runs every render, so a plain default would
  // allocate a throw-away ViewTransform on each render. The non-null cast is
  // safe because the if-block always assigns before any read.
  const viewTransformRef = useRef<ViewTransform>(null!);
  if (viewTransformRef.current === null) {
    viewTransformRef.current = viewTransform ?? new ViewTransform();
  }
  const hasStylusRef = useRef(false);
  const rafIdRef = useRef<number>(0);
  // Lasso (free-form selection) state. Points are in world coordinates so the
  // selection follows the camera while the user draws; null when inactive.
  const lassoPointsRef = useRef<Point[] | null>(null);
  // Running bbox of the lasso polygon, updated incrementally on each append
  // so per-move enclosure recomputation is O(1) in polygon size.
  const lassoBboxRef = useRef<BoundingBox | null>(null);
  // Marching-ants animation phase (in world units). Advanced on every rAF
  // tick while lasso is active so the dashes appear to flow along the path.
  const dashPhaseRef = useRef(0);
  const marchingRafRef = useRef<number>(0);
  // Indices of strokes currently enclosed by the in-progress lasso. Recomputed
  // whenever the lasso path grows so the user gets live "would-be-deleted"
  // feedback in red. Null when no lasso is active.
  const lassoSelectedRef = useRef<Set<number> | null>(null);
  // Erase-mode pending state: held from pointerdown until the press either
  // crosses ERASE_LASSO_THRESHOLD (promoting to a lasso) or releases as a tap.
  // startWorld seeds the lasso polygon's first vertex on promotion; the client
  // coords measure screen-space travel (client distance is mirror-invariant,
  // so no rect math is needed for the flipped case). Null when no erase press
  // is in flight.
  const erasePendingRef = useRef<{ startWorld: Point; startClientX: number; startClientY: number } | null>(null);
  // Latest container size in CSS pixels — refreshed on every ResizeObserver
  // tick. The camera transform projects against this on every read so layout
  // changes (collapse, rotate, window resize) all preserve view center
  // automatically without ad-hoc compensation.
  const containerSizeRef = useRef<ContainerSize>({ width: 0, height: 0 });
  const fitSizeRef = useRef(fitSize);
  useEffect(() => { fitSizeRef.current = fitSize; });

  const getBaseScale = useCallback(() => computeBaseScale(containerSizeRef.current, fitSizeRef.current), []);

  // Pinch state
  const pinchRef = useRef<{ id1: number; id2: number; lastDist: number; lastMidX: number; lastMidY: number } | null>(null);
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Cached canvas rect captured at pinch start; reused each touchmove to avoid
  // forcing a synchronous layout at 60fps.
  const pinchRectRef = useRef<DOMRect | null>(null);

  const notifyStrokeCount = useCallback((info: { committedTentativeClear: boolean; flush?: boolean } = { committedTentativeClear: false }) => {
    onStrokeCountChange(info);
  }, [onStrokeCountChange]);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    if (DIAG_ENABLED) {
      diag.redrawAll++;
      diag.heartbeat++;
      diag.lastRedrawAt = performance.now();
    }

    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const container = containerSizeRef.current;
    // Read fitSize directly from props (not via ref) so a redraw triggered by
    // a shared-camera notification (e.g. ImageViewer's loadContent on image
    // load) uses the latest fitSize even when the parent's setState hasn't
    // been observed via the ref-update effect yet.
    const baseScale = computeBaseScale(container, fitSize);

    // Reset to identity and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    renderer.clear();

    const projected = viewTransformRef.current.project(container, baseScale);
    ctx.setTransform(
      dpr * projected.scale, 0,
      0, dpr * projected.scale,
      dpr * projected.offsetX, dpr * projected.offsetY,
    );

    // Trace-template guide layer (semi-transparent gray, under user strokes).
    // Drawn first so user strokes paint over it. Line width compensates for
    // zoom so the guide stays visually subtle at high magnifications.
    if (templateStrokes && templateStrokes.length > 0) {
      const guideWidth = 2 / projected.scale;
      for (const t of templateStrokes) {
        renderer.drawTracePath(t.points, guideWidth);
      }
    }

    const strokes = strokeManager.getStrokes();
    const lassoSelected = lassoSelectedRef.current;
    // Strokes tagged as scored attempts render at reduced opacity so the
    // semi-transparent template guide stays readable underneath when the
    // user starts re-tracing. Highlighted (lasso-preselected or eraser-
    // hovered) strokes ignore the dim — the highlight is a stronger UI
    // signal.
    const opacityFor = (s: Stroke) =>
      dimmedStrokeTimestamps && dimmedStrokeTimestamps.has(s.timestamp)
        ? DIMMED_STROKE_OPACITY
        : undefined;
    if (lassoSelected && lassoSelected.size > 0) {
      // Draw enclosed strokes in the highlight color so the user can see what
      // releasing the lasso right now would delete.
      for (let i = 0; i < strokes.length; i++) {
        if (lassoSelected.has(i)) {
          renderer.drawHighlightedStroke(strokes[i]);
        }
        else {
          renderer.drawStroke(strokes[i], undefined, undefined, opacityFor(strokes[i]));
        }
      }
    }
    else if (dimmedStrokeTimestamps && dimmedStrokeTimestamps.size > 0) {
      for (const s of strokes) {
        renderer.drawStroke(s, undefined, undefined, opacityFor(s));
      }
    }
    else {
      renderer.drawStrokes(strokes);
    }

    // Draw highlighted stroke
    if (highlightedStrokeIndex !== null) {
      if (highlightedStrokeIndex < strokes.length) {
        renderer.drawHighlightedStroke(strokes[highlightedStrokeIndex]);
      }
    }

    // Draw current in-progress stroke
    const current = strokeManager.getCurrentStroke();
    if (current && current.points.length >= 2) {
      renderer.drawStroke(current);
    }

    // Grid + guide lines in canvas (world) coordinate space.
    const topLeft = viewTransformRef.current.screenToCanvas(0, 0, container, baseScale);
    const bottomRight = viewTransformRef.current.screenToCanvas(container.width, container.height, container, baseScale);
    drawGrid(ctx, grid, topLeft, bottomRight, projected.scale, GRID_CENTER);
    drawGuideLines(ctx, guideLines, projected.scale);

    // Trace feedback (deviation bands) above strokes so the user can see
    // where they were off. Width also zoom-compensated.
    if (traceFeedback && traceFeedback.segments.length > 0) {
      let maxMag = 0;
      for (const s of traceFeedback.segments) {
        if (s.magnitude > maxMag) maxMag = s.magnitude;
      }
      renderer.drawTraceFeedback(traceFeedback.segments, maxMag, 2 / projected.scale);
    }

    // In-progress lasso (marching ants). Drawn on top of strokes/grid so the
    // selection outline is always visible. Line width compensates for zoom so
    // the outline thickness stays visually constant.
    const lasso = lassoPointsRef.current;
    if (lasso && lasso.length >= 2) {
      const worldLineWidth = 1.5 / projected.scale;
      renderer.drawLasso(lasso, dashPhaseRef.current / projected.scale, worldLineWidth);
    }

    // Reset to DPR-only transform
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Diagnostic heartbeat (screen space, DPR-only transform): a per-frame
    // counter + moving dot painted ON the canvas. If the overlay's redrawAll /
    // rafTick counters keep climbing but this marker is visually frozen while
    // drawing, the compositor isn't presenting new canvas content (render-side
    // stall) — the key discriminator vs. an input-side drop.
    if (DIAG_ENABLED) {
      ctx.save();
      ctx.fillStyle = 'rgba(220,0,0,0.85)';
      ctx.fillRect(4, 4, 58, 18);
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.fillText(`#${diag.heartbeat}`, 7, 17);
      ctx.beginPath();
      ctx.arc(72 + (diag.heartbeat % 20) * 3, 13, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }
  }, [highlightedStrokeIndex, strokeManager, grid, guideLines, fitSize, templateStrokes, traceFeedback, dimmedStrokeTimestamps]);

  // Setup canvas with DPR
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    containerSizeRef.current = { width: rect.width, height: rect.height };

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    rendererRef.current = new CanvasRenderer(ctx);

    // Camera-model: projection is computed against the live container size on
    // every read, so resizing alone preserves the visual center. No need to
    // refit or re-anchor the grid.
    redrawAll();
  }, [redrawAll]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setupCanvas();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [setupCanvas]);

  // Redraw when highlighted stroke, redrawVersion, or guides change
  useEffect(() => {
    redrawAll();
  }, [highlightedStrokeIndex, redrawVersion, guideVersion, redrawAll]);

  // Latest-ref bridge so the effects below can read fresh redraw without
  // taking a dep on it — its identity churns on unrelated state.
  const redrawAllRef = useRef(redrawAll);
  useEffect(() => { redrawAllRef.current = redrawAll; });

  // Reset view when viewResetVersion bumps (user clicked the reset button).
  useEffect(() => {
    if (viewResetVersion > 0) {
      viewTransformRef.current.userResetToHome();
      redrawAllRef.current();
    }
  }, [viewResetVersion]);

  // Home is registered by the active fitting viewer (ImageViewer / YouTubeViewer)
  // via `loadContent` on actual content load — we never register it here.
  // UI-only transitions (entering search, returning to picker, closing a
  // reference) deliberately leave the camera alone so pan/zoom survive.

  // Compensate `zoom` to keep `visualScale = baseScale × zoom` continuous
  // when the reference is closed (size → null): baseScale jumps from
  // fit-to-reference to 1 and strokes would otherwise visibly grow. null →
  // size and size → size are content loads where the viewer's loadContent
  // reset is intended, so this branch must NOT fire there. adjustForUnfit
  // notifies with intent null, so no autosave flush is triggered.
  const prevFitSizeRef = useRef(fitSize);
  useEffect(() => {
    const prev = prevFitSizeRef.current;
    prevFitSizeRef.current = fitSize;
    if (!prev || fitSize) return;
    const container = containerSizeRef.current;
    const oldBaseScale = computeBaseScale(container, prev);
    const newBaseScale = computeBaseScale(container, fitSize);
    viewTransformRef.current.adjustForUnfit(oldBaseScale, newBaseScale);
  }, [fitSize]);

  const getCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    // When CSS scaleX(-1) is applied, mirror the X coordinate
    if (isFlipped) {
      screenX = rect.width - screenX;
    }
    return viewTransformRef.current.screenToCanvas(screenX, screenY, containerSizeRef.current, getBaseScale());
  }, [isFlipped, getBaseScale]);

  const getCurrentScale = useCallback(() => viewTransformRef.current.getScale(getBaseScale()), [getBaseScale]);

  const requestRedraw = useCallback(() => {
    if (rafIdRef.current) return;
    if (DIAG_ENABLED) diag.rafScheduled++;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      redrawAll();
    });
  }, [redrawAll]);

  const stopMarching = useCallback(() => {
    if (marchingRafRef.current) {
      cancelAnimationFrame(marchingRafRef.current);
      marchingRafRef.current = 0;
    }
  }, []);

  // Drives the marching-ants animation while a lasso is being drawn. The loop
  // self-stops once `lassoPointsRef.current` becomes null.
  const startMarching = useCallback(() => {
    if (marchingRafRef.current) return;
    const tick = () => {
      if (!lassoPointsRef.current) {
        marchingRafRef.current = 0;
        return;
      }
      // ~1px / frame in screen space. Multiplied by some constant so motion
      // is visible without being distracting.
      dashPhaseRef.current = (dashPhaseRef.current + 0.5) % 1024;
      requestRedraw();
      marchingRafRef.current = requestAnimationFrame(tick);
    };
    marchingRafRef.current = requestAnimationFrame(tick);
  }, [requestRedraw]);

  const cancelLasso = useCallback(() => {
    if (!lassoPointsRef.current) return;
    if (DIAG_ENABLED) logEvent('lassoCancel', { points: lassoPointsRef.current.length });
    lassoPointsRef.current = null;
    lassoBboxRef.current = null;
    lassoSelectedRef.current = null;
    stopMarching();
    requestRedraw();
  }, [stopMarching, requestRedraw]);

  const syncActiveTouchesFromEvent = useCallback((e: TouchEvent) => {
    // `event.touches` is the browser's current active-touch set. Rebuilding
    // from it on touchstart protects us from iOS Safari occasionally missing
    // a prior touchend/touchcancel, which otherwise leaves a stale id in the
    // map and makes every later single Pencil stroke look like a two-finger
    // pinch. Tests that synthesize only `changedTouches` fall back to the
    // incremental path below.
    if (e.touches.length > 0) {
      activeTouchesRef.current.clear();
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }
      return;
    }

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
  }, []);

  const clearStalePinchAfterTouchSync = useCallback(() => {
    const pinch = pinchRef.current;
    if (!pinch) return;
    if (activeTouchesRef.current.size < 2
      || !activeTouchesRef.current.has(pinch.id1)
      || !activeTouchesRef.current.has(pinch.id2)) {
      pinchRef.current = null;
      pinchRectRef.current = null;
    }
  }, []);

  const resetTouchSession = useCallback((trigger: ResetTrigger = 'manual') => {
    const hadCurrentStroke = Boolean(strokeManager.getCurrentStroke());
    const hadLasso = Boolean(lassoPointsRef.current) || Boolean(erasePendingRef.current);
    const hadTouchState = activeTouchesRef.current.size > 0 || Boolean(pinchRef.current);

    if (DIAG_ENABLED) {
      diag.resetCount++;
      diag.lastResetTrigger = trigger;
      // Snapshot the cumulative counters here: a blur/visibility reset is almost
      // always the user's own recovery gesture (tab/app switch), so this is the
      // last reading taken *before* the frozen session is cleared. Without it the
      // post-recovery copy only shows healthy idle state.
      logEvent('reset', {
        trigger, hadCurrentStroke, hadLasso, hadTouchState,
        move: diag.touchmove, docMove: diag.docTouchmove,
        append: diag.appendOk, redraw: diag.redrawAll, raf: diag.rafTick,
      });
    }

    activeTouchesRef.current.clear();
    pinchRef.current = null;
    pinchRectRef.current = null;

    if (hadCurrentStroke) {
      if (DIAG_ENABLED) diag.cancelStroke++;
      strokeManager.cancelStroke();
      onCurrentStrokeChange?.(null);
    }
    if (hadLasso) {
      erasePendingRef.current = null;
      lassoPointsRef.current = null;
      lassoBboxRef.current = null;
      lassoSelectedRef.current = null;
      stopMarching();
    }
    if (hadCurrentStroke || hadLasso || hadTouchState) {
      requestRedraw();
    }
  }, [strokeManager, onCurrentStrokeChange, stopMarching, requestRedraw]);

  /** Begin a new lasso path at the given world-space point. */
  const startLasso = useCallback((point: Point) => {
    if (DIAG_ENABLED) logEvent('lassoStart', {});
    lassoPointsRef.current = [point];
    const bb = emptyBoundingBox();
    extendBoundingBox(bb, point);
    lassoBboxRef.current = bb;
    lassoSelectedRef.current = null;
    dashPhaseRef.current = 0;
  }, []);

  /** Append a point to the lasso path and refresh the running bbox. */
  const appendLasso = useCallback((point: Point) => {
    const polygon = lassoPointsRef.current;
    const bb = lassoBboxRef.current;
    if (!polygon || !bb) return;
    polygon.push(point);
    extendBoundingBox(bb, point);
  }, []);

  /**
   * Recompute which strokes are fully enclosed by the current lasso path, so
   * `redrawAll` can render them in the highlight color. The lasso bbox is
   * already maintained incrementally; the per-stroke loop uses it as a cheap
   * reject before falling back to the ray-cast.
   */
  const recomputeLassoSelection = useCallback(() => {
    const polygon = lassoPointsRef.current;
    const bb = lassoBboxRef.current;
    if (!polygon || polygon.length < 3 || !bb) {
      lassoSelectedRef.current = null;
      return;
    }
    const strokes = strokeManager.getStrokes();
    const selected = new Set<number>();
    for (let i = 0; i < strokes.length; i++) {
      const pts = strokes[i].points;
      if (pts.length === 0) continue;
      let allInside = true;
      for (const p of pts) {
        if (p.x < bb.minX || p.x > bb.maxX || p.y < bb.minY || p.y > bb.maxY
          || !pointInPolygon(p, polygon)) {
          allInside = false;
          break;
        }
      }
      if (allInside) selected.add(i);
    }
    lassoSelectedRef.current = selected;
  }, [strokeManager]);

  // Apply the just-drawn lasso path: delete every stroke flagged as enclosed
  // and notify the parent so save/undo state refreshes. Reuses the live
  // selection cache (kept up to date by recomputeLassoSelection on each move)
  // so the release path doesn't redo the per-stroke geometry pass.
  const finishLasso = useCallback(() => {
    const polygon = lassoPointsRef.current;
    const selected = lassoSelectedRef.current;
    if (DIAG_ENABLED) logEvent('lassoFinish', { points: polygon?.length ?? 0, selected: selected?.size ?? 0 });
    lassoPointsRef.current = null;
    lassoBboxRef.current = null;
    lassoSelectedRef.current = null;
    stopMarching();
    if (!polygon || polygon.length < 3 || !selected || selected.size === 0) {
      requestRedraw();
      return;
    }
    const targets = Array.from(selected).sort((a, b) => a - b);
    strokeManager.lassoDelete(targets);
    // Discrete erase — persist immediately like the undo/redo/clear buttons.
    notifyStrokeCount({ committedTentativeClear: false, flush: true });
    redrawAll();
  }, [stopMarching, requestRedraw, strokeManager, notifyStrokeCount, redrawAll]);

  // Stop the marching animation if the component unmounts mid-lasso.
  useEffect(() => () => stopMarching(), [stopMarching]);

  // If the user toggles out of erase mode mid-gesture, abandon any partial
  // lasso path and pending press so they don't linger / resolve later.
  useEffect(() => {
    if (mode !== 'erase') {
      erasePendingRef.current = null;
      if (lassoPointsRef.current) {
        cancelLasso();
      }
    }
  }, [mode, cancelLasso]);

  // Subscribe via a ref-stable indirection so the subscription survives
  // redrawAll identity changes (which churn whenever fitSize / grid / guides
  // change). Otherwise we'd unsubscribe + resubscribe per render and miss
  // notifications fired during the swap window.
  const requestRedrawRef = useRef(requestRedraw);
  useEffect(() => { requestRedrawRef.current = requestRedraw; });

  useEffect(() => {
    if (!viewTransform) return;
    return viewTransform.subscribe(() => requestRedrawRef.current());
  }, [viewTransform]);

  // Wheel event for trackpad zoom/pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      let focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;
      if (isFlipped) {
        focalX = rect.width - focalX;
      }

      const container = containerSizeRef.current;
      const baseScale = getBaseScale();

      if (e.ctrlKey) {
        // Pinch zoom on trackpad (ctrlKey is set by the browser for pinch gestures)
        const scaleDelta = 1 - e.deltaY * TRACKPAD_ZOOM_SPEED;
        viewTransformRef.current.applyGesture(focalX, focalY, scaleDelta, 0, 0, container, baseScale);
      }
      else {
        // Pan — flip horizontal delta when flipped
        const deltaX = isFlipped ? e.deltaX : -e.deltaX;
        viewTransformRef.current.applyGesture(focalX, focalY, 1, deltaX, -e.deltaY, container, baseScale);
      }

      requestRedraw();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [requestRedraw, isFlipped, getBaseScale]);

  // --- Erase mode: shared tap-vs-lasso branching (touch + mouse) ---

  // pointerdown in erase mode: arm the pending state. We do NOT start a lasso
  // yet — the press might turn out to be a tap.
  const beginErasePending = useCallback((clientX: number, clientY: number, worldPoint: Point) => {
    erasePendingRef.current = { startWorld: worldPoint, startClientX: clientX, startClientY: clientY };
  }, []);

  // pointermove in erase mode: while pending, promote to a lasso once travel
  // exceeds the threshold (seeding the polygon with the press origin so the
  // enclosed region matches what the user drew). Already-promoted presses just
  // extend the lasso path.
  const advanceErasePending = useCallback((clientX: number, clientY: number, worldPoint: Point) => {
    const pend = erasePendingRef.current;
    if (pend) {
      const dx = clientX - pend.startClientX;
      const dy = clientY - pend.startClientY;
      if (dx * dx + dy * dy <= ERASE_LASSO_THRESHOLD * ERASE_LASSO_THRESHOLD) return;
      erasePendingRef.current = null;
      // Starting a lasso supersedes any pending tap candidate: clear the
      // highlight so the Delete/Cancel confirmation goes away and the lasso
      // selection is the only thing on screen.
      if (highlightedStrokeIndex !== null) onHighlightStroke(null);
      startLasso(pend.startWorld);
      appendLasso(worldPoint);
      startMarching();
      recomputeLassoSelection();
      requestRedraw();
      return;
    }
    if (lassoPointsRef.current) {
      appendLasso(worldPoint);
      recomputeLassoSelection();
      requestRedraw();
    }
  }, [highlightedStrokeIndex, onHighlightStroke, startLasso, appendLasso, startMarching, recomputeLassoSelection, requestRedraw]);

  // pointerup in erase mode: a still-pending press is a tap → reuse the eraser
  // select/delete behavior (highlight nearest stroke, or delete if re-tapping
  // the already-highlighted one). A promoted press commits the lasso, which
  // deletes the enclosed strokes immediately.
  //
  // The tap hit-test uses the press-DOWN point (pend.startWorld), NOT the
  // release point: a tap's target is where the finger landed, and using the
  // lift point would let a sub-threshold drift select a different (or no)
  // stroke than the one under the initial contact. It also means callers
  // don't compute a release world point at all (no per-release layout read).
  const endErasePending = useCallback(() => {
    const pend = erasePendingRef.current;
    if (pend) {
      erasePendingRef.current = null;
      const index = strokeManager.findNearestStroke(pend.startWorld, ERASER_THRESHOLD / getCurrentScale());
      if (index !== null && index === highlightedStrokeIndex) {
        onDeleteHighlightedStroke?.();
      }
      else {
        onHighlightStroke(index);
      }
      return;
    }
    if (lassoPointsRef.current) {
      finishLasso();
    }
  }, [strokeManager, getCurrentScale, highlightedStrokeIndex, onDeleteHighlightedStroke, onHighlightStroke, finishLasso]);

  // Touch handlers — registered as native listeners (see effect below) with
  // { passive: false } so preventDefault works. React 18 attaches synthetic
  // touch handlers as passive by default, which would silently ignore our
  // preventDefault calls and emit "Unable to preventDefault inside passive
  // event listener" warnings.
  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();

    if (DIAG_ENABLED) {
      diag.touchstart++;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const tt = (e.changedTouches[i] as Touch & { touchType?: string }).touchType;
        if (tt === 'stylus') diag.touchTypeStylus++;
        else if (tt === undefined) diag.touchTypeUndefined++;
        else diag.touchTypeDirect++;
      }
      const t0 = e.changedTouches[0] as Touch & { touchType?: string };
      logEvent('start', {
        mode,
        changed: e.changedTouches.length,
        touches: e.touches.length,
        touchType: t0?.touchType,
        // Radius lets us check whether a misclassified-as-'direct' Pencil touch
        // is distinguishable from a finger (Pencil ~1-2px, finger ~20-40px).
        rX: t0 ? Math.round((t0.radiusX ?? 0) * 10) / 10 : undefined,
        force: t0 ? Math.round((t0.force ?? 0) * 100) / 100 : undefined,
      });
    }

    // Gesture-session swap window: reject the new touch entirely (no stroke
    // start, no pinch arming) so a reflexive post-swap tap is dropped. We
    // still preventDefault above so the browser doesn't fall back to default
    // touch behavior (scroll, etc.).
    if (inputFrozenRef.current) {
      if (DIAG_ENABLED) { diag.rejInputFrozen++; logEvent('rej', { reason: 'inputFrozen' }); }
      return;
    }

    syncActiveTouchesFromEvent(e);
    clearStalePinchAfterTouchSync();

    // Detect stylus
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i] as Touch & { touchType?: string };
      if (touch.touchType === 'stylus') {
        if (DIAG_ENABLED && !hasStylusRef.current) logEvent('stylusFlagSet', {});
        hasStylusRef.current = true;
      }
    }

    // 2-finger pinch
    if (activeTouchesRef.current.size >= 2) {
      // Cancel any in-progress single-finger stroke. On iPhone the second
      // finger often lands a few frames after the first, and the small
      // amount of motion in between would otherwise commit a stray line
      // when the pinch ends.
      if (mode === 'pen' && strokeManager.getCurrentStroke()) {
        if (DIAG_ENABLED) diag.cancelStroke++;
        strokeManager.cancelStroke();
        onCurrentStrokeChange?.(null);
        requestRedraw();
      }
      // Same idea for an in-progress lasso (or an armed-but-not-yet-promoted
      // erase press): a second finger means the user is starting to pinch, not
      // closing a selection. Drop both so camera control wins.
      if (mode === 'erase') {
        erasePendingRef.current = null;
        if (lassoPointsRef.current) {
          cancelLasso();
        }
      }

      const ids = Array.from(activeTouchesRef.current.keys());
      const t1 = activeTouchesRef.current.get(ids[0])!;
      const t2 = activeTouchesRef.current.get(ids[1])!;
      const dx = t2.x - t1.x;
      const dy = t2.y - t1.y;
      pinchRef.current = {
        id1: ids[0],
        id2: ids[1],
        lastDist: Math.sqrt(dx * dx + dy * dy),
        lastMidX: (t1.x + t2.x) / 2,
        lastMidY: (t1.y + t2.y) / 2,
      };
      pinchRectRef.current = canvasRef.current!.getBoundingClientRect();
      if (DIAG_ENABLED) {
        diag.rejPinch++;
        const tp = e.changedTouches[0] as Touch & { touchType?: string };
        logEvent('pinchArmed', {
          mode,
          size: activeTouchesRef.current.size,
          newTouchType: tp?.touchType,
          newRX: tp ? Math.round((tp.radiusX ?? 0) * 10) / 10 : undefined,
        });
      }
      return;
    }

    // Single touch: drawing
    const touch = e.changedTouches[0] as Touch & { touchType?: string };
    if (hasStylusRef.current && touch.touchType !== 'stylus') {
      if (DIAG_ENABLED) { diag.rejStylusFilterStart++; logEvent('rej', { reason: 'stylusFilterStart', touchType: touch.touchType, rX: Math.round((touch.radiusX ?? 0) * 10) / 10 }); }
      return;
    }

    const point = getCanvasPoint(touch.clientX, touch.clientY);

    if (mode === 'erase') {
      // Arm pending state only — tap vs lasso is decided on move/up.
      beginErasePending(touch.clientX, touch.clientY, point);
    }
    else {
      // Fire onStrokeStart BEFORE startStroke so the trace-scoring context
      // can clear its lingering feedback in the same React batch as the
      // first redraw — the user sees the red bands disappear the instant
      // their pen touches down.
      onStrokeStart?.();
      strokeManager.startStroke(point);
      if (DIAG_ENABLED) diag.startStroke++;
    }
  }, [mode, getCanvasPoint, strokeManager, onCurrentStrokeChange, requestRedraw, cancelLasso, beginErasePending, onStrokeStart, syncActiveTouchesFromEvent, clearStalePinchAfterTouchSync]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();

    if (DIAG_ENABLED) {
      diag.touchmove++;
      // Delivery latency: how stale is this event by the time our handler runs.
      // Climbing latency = WebKit's event queue backing up (backpressure), the
      // suspected cause of the sustained-input freeze. Guard against the legacy
      // epoch-based timeStamp (would yield a large negative value).
      const lat = performance.now() - e.timeStamp;
      if (lat >= 0 && lat < 60000) {
        diag.moveLatencyLast = lat;
        if (lat > diag.moveLatencyMax) diag.moveLatencyMax = lat;
      }
    }

    // Update tracked touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    // Pinch zoom/pan
    if (pinchRef.current) {
      const t1 = activeTouchesRef.current.get(pinchRef.current.id1);
      const t2 = activeTouchesRef.current.get(pinchRef.current.id2);
      if (!t1 || !t2) return;

      const dx = t2.x - t1.x;
      const dy = t2.y - t1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const midX = (t1.x + t2.x) / 2;
      const midY = (t1.y + t2.y) / 2;

      const rect = pinchRectRef.current!;
      let focalX = midX - rect.left;
      const focalY = midY - rect.top;
      if (isFlipped) {
        focalX = rect.width - focalX;
      }

      const scaleDelta = dist / pinchRef.current.lastDist;
      const rawTranslateX = midX - pinchRef.current.lastMidX;
      const translateX = isFlipped ? -rawTranslateX : rawTranslateX;
      const translateY = midY - pinchRef.current.lastMidY;

      viewTransformRef.current.applyGesture(focalX, focalY, scaleDelta, translateX, translateY, containerSizeRef.current, getBaseScale());

      pinchRef.current.lastDist = dist;
      pinchRef.current.lastMidX = midX;
      pinchRef.current.lastMidY = midY;

      requestRedraw();
      return;
    }

    // Erase mode: drive the tap-vs-lasso decision (pending) or extend an
    // already-promoted lasso path.
    if (mode === 'erase' && (erasePendingRef.current || lassoPointsRef.current)) {
      const touch = e.changedTouches[0] as Touch & { touchType?: string };
      if (hasStylusRef.current && touch.touchType !== 'stylus') {
        if (DIAG_ENABLED) diag.rejStylusFilterMove++;
        return;
      }
      const point = getCanvasPoint(touch.clientX, touch.clientY);
      advanceErasePending(touch.clientX, touch.clientY, point);
      return;
    }

    // Drawing
    if (mode !== 'pen') return;
    const touch = e.changedTouches[0] as Touch & { touchType?: string };
    if (hasStylusRef.current && touch.touchType !== 'stylus') {
      if (DIAG_ENABLED) { diag.rejStylusFilterMove++; logEvent('rej', { reason: 'stylusFilterMove', touchType: touch.touchType, rX: Math.round((touch.radiusX ?? 0) * 10) / 10 }); }
      return;
    }

    const point = getCanvasPoint(touch.clientX, touch.clientY);
    if (!strokeManager.appendStroke(point)) {
      if (DIAG_ENABLED) { diag.appendSkip++; diag.rejMoveAppendFalse++; }
      return;
    }
    if (DIAG_ENABLED) diag.appendOk++;
    onCurrentStrokeChange?.(strokeManager.getCurrentStroke());
    requestRedraw();
  }, [mode, getCanvasPoint, requestRedraw, strokeManager, isFlipped, onCurrentStrokeChange, getBaseScale, advanceErasePending]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // touchend can fire with cancelable=false during scrolling; guard so we
    // don't trip an "Ignored attempt to cancel a touchend" intervention
    // warning (the preventDefault would be a no-op anyway).
    if (e.cancelable) e.preventDefault();

    if (DIAG_ENABLED) {
      if (e.type === 'touchcancel') diag.touchcancel++;
      else diag.touchend++;
      logEvent(e.type, { changed: e.changedTouches.length, remaining: e.touches.length });
      persistLog();
    }

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.delete(touch.identifier);
    }

    // Clear pinch if one of the pinch fingers lifted
    if (pinchRef.current) {
      if (!activeTouchesRef.current.has(pinchRef.current.id1)
        || !activeTouchesRef.current.has(pinchRef.current.id2)) {
        pinchRef.current = null;
        pinchRectRef.current = null;
      }
    }

    if (mode === 'pen') {
      // Read tentative state BEFORE endStroke — endStroke clears the flag as
      // part of committing.
      const wasTentative = strokeManager.isTentativeClearActive();
      const stroke = strokeManager.endStroke();
      if (stroke) {
        if (DIAG_ENABLED) diag.endCommit++;
        onCurrentStrokeChange?.(null);
        // onStrokeFinalized runs FIRST so trace-template scoring can
        // synchronously discard (rejected) or replace (re-trace) the just-
        // committed stroke. Without this ordering, notifyStrokeCount would
        // start the timer based on a stroke that's about to vanish, and
        // autosave would capture the pre-scoring stroke set.
        onStrokeFinalized?.(stroke);
        notifyStrokeCount({ committedTentativeClear: wasTentative });
        redrawAll();
      }
    }
    else if (mode === 'erase' && (erasePendingRef.current || lassoPointsRef.current)) {
      if (e.type === 'touchcancel') {
        // A system-cancelled touch (palm rejection, incoming call, OS edge
        // gesture) is NOT a deliberate tap/lasso — discard the pending state
        // instead of resolving it, or it could select/delete a stroke the
        // user never lifted on. cancelLasso is a no-op when no lasso is live.
        erasePendingRef.current = null;
        cancelLasso();
      }
      // Only resolve when the last finger lifts; intermediate touchends from
      // multi-finger gestures are handled by the pinch-cancel branch above.
      // endErasePending decides: still pending → tap-select (using the press-
      // down point); promoted → commit (delete enclosed) the lasso.
      else if (activeTouchesRef.current.size === 0) {
        endErasePending();
      }
    }
  }, [mode, notifyStrokeCount, redrawAll, strokeManager, onCurrentStrokeChange, endErasePending, cancelLasso, onStrokeFinalized]);

  // Latest-handler refs so the native listeners below can stay attached for
  // the life of the canvas. The handlers themselves have many transitive
  // useCallback deps (mode, fitSize, redrawAll, …) and would otherwise churn
  // on every photo swap / prop change, causing the listener-attach effect to
  // detach and re-attach. The ref-bridge keeps listener identity stable.
  const handleTouchStartRef = useRef(handleTouchStart);
  const handleTouchMoveRef = useRef(handleTouchMove);
  const handleTouchEndRef = useRef(handleTouchEnd);
  useEffect(() => { handleTouchStartRef.current = handleTouchStart; });
  useEffect(() => { handleTouchMoveRef.current = handleTouchMove; });
  useEffect(() => { handleTouchEndRef.current = handleTouchEnd; });

  // Register touch listeners natively (not via React's synthetic onTouch*
  // props) so we can pass { passive: false } and actually preventDefault.
  // Without this, browsers warn "Unable to preventDefault inside passive
  // event listener" on every move during a stroke.
  // Effect deps are intentionally [] so the listeners are attached exactly
  // once per canvas mount; the ref bridge above forwards to the latest
  // handler closure on each event.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onStart = (e: Event) => handleTouchStartRef.current(e as TouchEvent);
    const onMove = (e: Event) => handleTouchMoveRef.current(e as TouchEvent);
    const onEnd = (e: Event) => handleTouchEndRef.current(e as TouchEvent);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  useEffect(() => {
    const onBlur = () => resetTouchSession('blur');
    const onPageHide = () => resetTouchSession('pagehide');
    const resetWhenHidden = () => {
      if (document.visibilityState === 'hidden') resetTouchSession('visibility');
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', resetWhenHidden);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', resetWhenHidden);
    };
  }, [resetTouchSession]);

  // --- Diagnostics wiring (only when ?diag=touch) -----------------------------
  // All four effects below are independent of the native-listener attach effect
  // (deps []), so they never cause the touch listeners to detach/re-attach.

  // Expose live ref state to the overlay via a pull-based probe (no re-render).
  // `mode` is in deps so the closure sees the live mode (the watchdog uses it to
  // ignore eraser/lasso moves that legitimately never append).
  useEffect(() => {
    if (!DIAG_ENABLED) return;
    registerStateProbe(() => ({
      hasStylus: hasStylusRef.current,
      activeTouchCount: activeTouchesRef.current.size,
      activeTouchIds: Array.from(activeTouchesRef.current.keys()),
      pinchActive: pinchRef.current !== null,
      strokeCount: strokeManager.getStrokes().length,
      mode,
      drawing: strokeManager.getCurrentStroke() !== null,
    }));
    return () => registerStateProbe(null);
  }, [strokeManager, mode]);

  // Expose recovery actions to the overlay's buttons — each isolates one
  // candidate layer so tapping them one at a time pinpoints what was stuck.
  useEffect(() => {
    if (!DIAG_ENABLED) return;
    registerRecoveryActions({
      resetSession: () => resetTouchSession('manual'),
      clearStylus: () => { hasStylusRef.current = false; logEvent('recovery', { action: 'clearStylus' }); },
      forceRedraw: () => { logEvent('recovery', { action: 'forceRedraw' }); redrawAll(); },
      nudgeCompositor: () => {
        // Mimic the layout-touching DOM change a tab switch causes, to force a
        // recomposite without changing app state.
        const c = canvasRef.current;
        if (!c) return;
        logEvent('recovery', { action: 'nudgeCompositor' });
        const prev = c.style.height;
        const base = c.getBoundingClientRect().height;
        c.style.height = `${base + 1}px`;
        requestAnimationFrame(() => { c.style.height = prev; });
      },
    });
    return () => registerRecoveryActions(null);
  }, [resetTouchSession, redrawAll]);

  // Free-running rAF tick — advances every frame regardless of redraws, so the
  // overlay can tell "main thread / rAF stalled" apart from "rAF runs but the
  // compositor won't present the canvas".
  useEffect(() => {
    if (!DIAG_ENABLED) return;
    let id = 0;
    const tick = () => {
      diag.rafTick++;
      diag.lastRafAt = performance.now();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // Document-level passive observation of touch arrival. Compared against the
  // canvas-listener counters, this reveals whether the canvas lost its event
  // target (doc counts climb, canvas counts don't) vs. the OS not delivering
  // events at all (neither climbs). Pure observation: passive, no preventDefault.
  useEffect(() => {
    if (!DIAG_ENABLED) return;
    const onStart = () => { diag.docTouchstart++; };
    const onMove = () => { diag.docTouchmove++; };
    const onEnd = () => { diag.docTouchend++; };
    const onCancel = () => { diag.docTouchcancel++; };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('touchstart', onStart, opts);
    document.addEventListener('touchmove', onMove, opts);
    document.addEventListener('touchend', onEnd, opts);
    document.addEventListener('touchcancel', onCancel, opts);
    return () => {
      document.removeEventListener('touchstart', onStart, opts);
      document.removeEventListener('touchmove', onMove, opts);
      document.removeEventListener('touchend', onEnd, opts);
      document.removeEventListener('touchcancel', onCancel, opts);
    };
  }, []);

  // Cross-channel input observation. The freeze is confirmed to suspend *touch*
  // delivery page-wide (canvas + DOM both go dead). Pointer and click events are
  // a separate WebKit pathway; if they keep firing during the touch-gap a
  // non-touch channel survives and could anchor a recovery. Pure observation:
  // passive, capture, no preventDefault — does not touch the canvas pipeline.
  useEffect(() => {
    if (!DIAG_ENABLED) return;
    const onPointerDown = (e: PointerEvent) => {
      diag.docPointerdown++;
      if (e.pointerType === 'pen') diag.docPointerPen++;
    };
    const onPointerMove = (e: PointerEvent) => {
      diag.docPointermove++;
      if (e.pointerType === 'pen') diag.docPointerPen++;
    };
    const onClick = () => { diag.docClick++; };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('pointermove', onPointerMove, opts);
    document.addEventListener('click', onClick, opts);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, opts);
      document.removeEventListener('pointermove', onPointerMove, opts);
      document.removeEventListener('click', onClick, opts);
    };
  }, []);

  // Mouse fallback handlers
  const isMouseDownRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (hasStylusRef.current) return;
    if (inputFrozenRef.current) return;
    isMouseDownRef.current = true;

    const point = getCanvasPoint(e.clientX, e.clientY);

    if (mode === 'erase') {
      beginErasePending(e.clientX, e.clientY, point);
    }
    else {
      // See handleTouchStart — fire onStrokeStart before startStroke so the
      // trace-scoring feedback clears on pointer-down.
      onStrokeStart?.();
      strokeManager.startStroke(point);
      if (DIAG_ENABLED) diag.startStroke++;
    }
  }, [mode, getCanvasPoint, strokeManager, beginErasePending, onStrokeStart]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isMouseDownRef.current) return;
    if (mode === 'erase' && (erasePendingRef.current || lassoPointsRef.current)) {
      const point = getCanvasPoint(e.clientX, e.clientY);
      advanceErasePending(e.clientX, e.clientY, point);
      return;
    }
    if (mode !== 'pen') return;

    const point = getCanvasPoint(e.clientX, e.clientY);
    if (!strokeManager.appendStroke(point)) {
      if (DIAG_ENABLED) { diag.appendSkip++; diag.rejMoveAppendFalse++; }
      return;
    }
    if (DIAG_ENABLED) diag.appendOk++;
    onCurrentStrokeChange?.(strokeManager.getCurrentStroke());
    requestRedraw();
  }, [mode, getCanvasPoint, requestRedraw, strokeManager, onCurrentStrokeChange, advanceErasePending]);

  const handleMouseUp = useCallback(() => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;

    if (mode === 'pen') {
      const wasTentative = strokeManager.isTentativeClearActive();
      const stroke = strokeManager.endStroke();
      if (stroke) {
        if (DIAG_ENABLED) diag.endCommit++;
        onCurrentStrokeChange?.(null);
        // See the touchend branch — onStrokeFinalized must observe the
        // stroke before notifyStrokeCount runs so timer/autosave don't fire
        // on a stroke that scoring is about to discard.
        onStrokeFinalized?.(stroke);
        notifyStrokeCount({ committedTentativeClear: wasTentative });
        redrawAll();
      }
    }
    else if (mode === 'erase' && (erasePendingRef.current || lassoPointsRef.current)) {
      endErasePending();
    }
  }, [mode, notifyStrokeCount, redrawAll, strokeManager, onCurrentStrokeChange, endErasePending, onStrokeFinalized]);

  // Leaving the canvas mid-press abandons a still-pending erase tap rather
  // than resolving it as a select/delete at the exit coordinate (which could
  // delete the highlighted stroke the user never lifted on). A promoted lasso
  // or an in-progress pen stroke commits like a normal release.
  const handleMouseLeave = useCallback(() => {
    if (!isMouseDownRef.current) return;
    if (mode === 'erase' && erasePendingRef.current && !lassoPointsRef.current) {
      erasePendingRef.current = null;
      isMouseDownRef.current = false;
      return;
    }
    handleMouseUp();
  }, [mode, handleMouseUp]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        cursor: mode === 'erase' ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
          // iOS Safari workaround: promote the canvas to its own composited
          // layer so updates to its bitmap are always pushed to the screen.
          // Without this hint, after some sequence of events (gesture-session
          // photo swap + many strokes seems to trigger it) the compositor
          // stops pulling new canvas content even though redrawAll() is
          // running and writing pixels — manifesting as "drawing committed
          // but nothing visible". Any layout-touching DOM change (tapping a
          // button, OS task switch) restored the display, confirming a
          // compositor issue rather than a draw-pipeline one.
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      />
    </Box>
  );
}
