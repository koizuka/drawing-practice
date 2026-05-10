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

export type DrawingMode = 'pen' | 'eraser' | 'lasso';

/** Snapshot of internal touch / mode state for the diagnostic overlay used
 *  during gesture-session debugging. Only consumed by `GestureDebugBar` —
 *  not part of the regular drawing API. */
export interface DrawingCanvasDebugSnapshot {
  mode: DrawingMode;
  inputFrozen: boolean;
  activeTouchesSize: number;
  pinchActive: boolean;
  hasStylus: boolean;
  /** `touchType` string of the most recent touchstart, or '-' when none. */
  lastTouchType: string;
}

interface DrawingCanvasProps {
  mode: DrawingMode;
  highlightedStrokeIndex: number | null;
  onHighlightStroke: (index: number | null) => void;
  onDeleteHighlightedStroke?: () => void;
  onStrokeCountChange: () => void;
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
  /** Diagnostic-only: parent passes a ref slot that DrawingCanvas fills with
   *  a snapshot getter. Used by `GestureDebugBar` to read internal state
   *  (active touch count, pinch flag, last touchType) without needing to
   *  expose individual refs. Optional — never used in production paths. */
  debugSnapshotRef?: React.RefObject<(() => DrawingCanvasDebugSnapshot) | null>;
}

const ERASER_THRESHOLD = 20;

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
  debugSnapshotRef,
}: DrawingCanvasProps) {
  const inputFrozenRef = useRef(inputFrozen);
  useEffect(() => {
    inputFrozenRef.current = inputFrozen;
  });
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
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
  // Diagnostic only — written by handleTouchStart, read by GestureDebugBar.
  const lastTouchTypeRef = useRef<string>('-');
  // Diagnostic-only mirrors of `pinchRef !== null` and `activeTouchesRef.size`.
  // Kept as separate primitive refs so the snapshot getter does not capture
  // the underlying mutable refs — referencing `pinchRef` from a closure that
  // gets passed to `useEffect` would trigger the React Compiler immutability
  // rule on every existing `pinchRef.current = ...` assignment.
  const pinchActiveDiagRef = useRef(false);
  const activeTouchesCountDiagRef = useRef(0);
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
  // Latest container size in CSS pixels — refreshed on every ResizeObserver
  // tick. The camera transform projects against this on every read so layout
  // changes (collapse, rotate, window resize) all preserve view center
  // automatically without ad-hoc compensation.
  const containerSizeRef = useRef<ContainerSize>({ width: 0, height: 0 });
  const fitSizeRef = useRef(fitSize);
  useEffect(() => { fitSizeRef.current = fitSize; });

  // Diagnostic snapshot getter built once and installed via the parent ref
  // when present. Defined as `useCallback` (not inside an effect) so the
  // React Compiler immutability rule does not treat pinchRef / activeTouchesRef
  // as "read in an effect" — those refs are mutated heavily elsewhere in this
  // file, and reading them inside an effect would lock down those writes.
  const getDebugSnapshot = useCallback((): DrawingCanvasDebugSnapshot => ({
    mode: modeRef.current,
    inputFrozen: inputFrozenRef.current,
    activeTouchesSize: activeTouchesCountDiagRef.current,
    pinchActive: pinchActiveDiagRef.current,
    hasStylus: hasStylusRef.current,
    lastTouchType: lastTouchTypeRef.current,
  }), []);
  useEffect(() => {
    if (!debugSnapshotRef) return;
    debugSnapshotRef.current = getDebugSnapshot;
    return () => {
      debugSnapshotRef.current = null;
    };
  }, [debugSnapshotRef, getDebugSnapshot]);

  const getBaseScale = useCallback(() => computeBaseScale(containerSizeRef.current, fitSizeRef.current), []);

  // Pinch state
  const pinchRef = useRef<{ id1: number; id2: number; lastDist: number; lastMidX: number; lastMidY: number } | null>(null);
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Cached canvas rect captured at pinch start; reused each touchmove to avoid
  // forcing a synchronous layout at 60fps.
  const pinchRectRef = useRef<DOMRect | null>(null);

  const notifyStrokeCount = useCallback(() => {
    onStrokeCountChange();
  }, [onStrokeCountChange]);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

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

    const strokes = strokeManager.getStrokes();
    const lassoSelected = lassoSelectedRef.current;
    if (lassoSelected && lassoSelected.size > 0) {
      // Draw enclosed strokes in the highlight color so the user can see what
      // releasing the lasso right now would delete.
      for (let i = 0; i < strokes.length; i++) {
        if (lassoSelected.has(i)) {
          renderer.drawHighlightedStroke(strokes[i]);
        }
        else {
          renderer.drawStroke(strokes[i]);
        }
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
  }, [highlightedStrokeIndex, strokeManager, grid, guideLines, fitSize]);

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
    lassoPointsRef.current = null;
    lassoBboxRef.current = null;
    lassoSelectedRef.current = null;
    stopMarching();
    requestRedraw();
  }, [stopMarching, requestRedraw]);

  /** Begin a new lasso path at the given world-space point. */
  const startLasso = useCallback((point: Point) => {
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
    notifyStrokeCount();
    redrawAll();
  }, [stopMarching, requestRedraw, strokeManager, notifyStrokeCount, redrawAll]);

  // Stop the marching animation if the component unmounts mid-lasso.
  useEffect(() => () => stopMarching(), [stopMarching]);

  // If the user toggles out of lasso mode mid-draw, abandon the partial path
  // so it doesn't linger on screen.
  useEffect(() => {
    if (mode !== 'lasso' && lassoPointsRef.current) {
      cancelLasso();
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

  // Touch handlers — registered as native listeners (see effect below) with
  // { passive: false } so preventDefault works. React 18 attaches synthetic
  // touch handlers as passive by default, which would silently ignore our
  // preventDefault calls and emit "Unable to preventDefault inside passive
  // event listener" warnings.
  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();

    // Gesture-session swap window: reject the new touch entirely (no stroke
    // start, no pinch arming) so a reflexive post-swap tap is dropped. We
    // still preventDefault above so the browser doesn't fall back to default
    // touch behavior (scroll, etc.).
    if (inputFrozenRef.current) return;

    // Track all touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    activeTouchesCountDiagRef.current = activeTouchesRef.current.size;

    // Detect stylus
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i] as Touch & { touchType?: string };
      if (touch.touchType === 'stylus') {
        hasStylusRef.current = true;
      }
      lastTouchTypeRef.current = touch.touchType ?? 'direct';
    }

    // 2-finger pinch
    if (activeTouchesRef.current.size >= 2) {
      // Cancel any in-progress single-finger stroke. On iPhone the second
      // finger often lands a few frames after the first, and the small
      // amount of motion in between would otherwise commit a stray line
      // when the pinch ends.
      if (mode === 'pen' && strokeManager.getCurrentStroke()) {
        strokeManager.cancelStroke();
        onCurrentStrokeChange?.(null);
        requestRedraw();
      }
      // Same idea for an in-progress lasso: a second finger means the user
      // is starting to pinch, not closing a selection.
      if (mode === 'lasso' && lassoPointsRef.current) {
        cancelLasso();
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
      pinchActiveDiagRef.current = true;
      pinchRectRef.current = canvasRef.current!.getBoundingClientRect();
      return;
    }

    // Single touch: drawing
    const touch = e.changedTouches[0] as Touch & { touchType?: string };
    if (hasStylusRef.current && touch.touchType !== 'stylus') return;

    const point = getCanvasPoint(touch.clientX, touch.clientY);

    if (mode === 'eraser') {
      const index = strokeManager.findNearestStroke(point, ERASER_THRESHOLD / getCurrentScale());
      if (index !== null && index === highlightedStrokeIndex) {
        onDeleteHighlightedStroke?.();
      }
      else {
        onHighlightStroke(index);
      }
    }
    else if (mode === 'lasso') {
      startLasso(point);
      startMarching();
      requestRedraw();
    }
    else {
      strokeManager.startStroke(point);
    }
  }, [mode, getCanvasPoint, onHighlightStroke, onDeleteHighlightedStroke, highlightedStrokeIndex, strokeManager, getCurrentScale, onCurrentStrokeChange, requestRedraw, startMarching, cancelLasso, startLasso]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();

    // Update tracked touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    activeTouchesCountDiagRef.current = activeTouchesRef.current.size;

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

    // Lasso path drawing
    if (mode === 'lasso' && lassoPointsRef.current) {
      const touch = e.changedTouches[0] as Touch & { touchType?: string };
      if (hasStylusRef.current && touch.touchType !== 'stylus') return;
      const point = getCanvasPoint(touch.clientX, touch.clientY);
      appendLasso(point);
      recomputeLassoSelection();
      requestRedraw();
      return;
    }

    // Drawing
    if (mode !== 'pen') return;
    const touch = e.changedTouches[0] as Touch & { touchType?: string };
    if (hasStylusRef.current && touch.touchType !== 'stylus') return;

    const point = getCanvasPoint(touch.clientX, touch.clientY);
    if (!strokeManager.appendStroke(point)) return;
    onCurrentStrokeChange?.(strokeManager.getCurrentStroke());
    requestRedraw();
  }, [mode, getCanvasPoint, requestRedraw, strokeManager, isFlipped, onCurrentStrokeChange, getBaseScale, recomputeLassoSelection, appendLasso]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // touchend can fire with cancelable=false during scrolling; guard so we
    // don't trip an "Ignored attempt to cancel a touchend" intervention
    // warning (the preventDefault would be a no-op anyway).
    if (e.cancelable) e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.delete(touch.identifier);
    }
    activeTouchesCountDiagRef.current = activeTouchesRef.current.size;

    // Clear pinch if one of the pinch fingers lifted
    if (pinchRef.current) {
      if (!activeTouchesRef.current.has(pinchRef.current.id1)
        || !activeTouchesRef.current.has(pinchRef.current.id2)) {
        pinchRef.current = null;
        pinchActiveDiagRef.current = false;
        pinchRectRef.current = null;
      }
    }

    if (mode === 'pen') {
      const stroke = strokeManager.endStroke();
      if (stroke) {
        onCurrentStrokeChange?.(null);
        notifyStrokeCount();
        redrawAll();
      }
    }
    else if (mode === 'lasso' && lassoPointsRef.current) {
      // Only commit when the last finger lifts; intermediate touchends from
      // multi-finger gestures are handled by the cancelLasso call above.
      if (activeTouchesRef.current.size === 0) {
        finishLasso();
      }
    }
  }, [mode, notifyStrokeCount, redrawAll, strokeManager, onCurrentStrokeChange, finishLasso]);

  // Register touch listeners natively (not via React's synthetic onTouch*
  // props) so we can pass { passive: false } and actually preventDefault.
  // Without this, browsers warn "Unable to preventDefault inside passive
  // event listener" on every move during a stroke.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Mouse fallback handlers
  const isMouseDownRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (hasStylusRef.current) return;
    if (inputFrozenRef.current) return;
    isMouseDownRef.current = true;

    const point = getCanvasPoint(e.clientX, e.clientY);

    if (mode === 'eraser') {
      const index = strokeManager.findNearestStroke(point, ERASER_THRESHOLD / getCurrentScale());
      if (index !== null && index === highlightedStrokeIndex) {
        onDeleteHighlightedStroke?.();
      }
      else {
        onHighlightStroke(index);
      }
    }
    else if (mode === 'lasso') {
      startLasso(point);
      startMarching();
      requestRedraw();
    }
    else {
      strokeManager.startStroke(point);
    }
  }, [mode, getCanvasPoint, onHighlightStroke, onDeleteHighlightedStroke, highlightedStrokeIndex, strokeManager, getCurrentScale, startMarching, requestRedraw, startLasso]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isMouseDownRef.current) return;
    if (mode === 'lasso' && lassoPointsRef.current) {
      const point = getCanvasPoint(e.clientX, e.clientY);
      appendLasso(point);
      recomputeLassoSelection();
      requestRedraw();
      return;
    }
    if (mode !== 'pen') return;

    const point = getCanvasPoint(e.clientX, e.clientY);
    if (!strokeManager.appendStroke(point)) return;
    onCurrentStrokeChange?.(strokeManager.getCurrentStroke());
    requestRedraw();
  }, [mode, getCanvasPoint, requestRedraw, strokeManager, onCurrentStrokeChange, recomputeLassoSelection, appendLasso]);

  const handleMouseUp = useCallback(() => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;

    if (mode === 'pen') {
      const stroke = strokeManager.endStroke();
      if (stroke) {
        onCurrentStrokeChange?.(null);
        notifyStrokeCount();
        redrawAll();
      }
    }
    else if (mode === 'lasso' && lassoPointsRef.current) {
      finishLasso();
    }
  }, [mode, notifyStrokeCount, redrawAll, strokeManager, onCurrentStrokeChange, finishLasso]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        cursor: mode === 'eraser' || mode === 'lasso' ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
        }}
      />
    </Box>
  );
}
