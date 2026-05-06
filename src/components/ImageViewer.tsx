import { useRef, useEffect, useCallback, useState } from 'react';
import { Box } from '@mui/material';
import { OVERLAY_HALO_MULTIPLIER, STROKE_WIDTH, TRACKPAD_ZOOM_SPEED } from '../drawing/constants';
import { ViewTransform, type ContainerSize } from '../drawing/ViewTransform';
import { computeBaseScale, drawOverlayStrokePath, GRID_CENTER } from '../drawing/canvasUtils';
import { drawGrid, drawGuideLines } from '../guides/drawGuides';
import { pointToSegmentDistance } from '../guides/GuideManager';
import type { GridSettings, GuideLine } from '../guides/types';
import type { Stroke, Point } from '../drawing/types';

export type GuideInteractionMode = 'none' | 'add' | 'delete';

interface ImageViewerProps {
  imageUrl: string;
  viewResetVersion: number;
  grid: GridSettings;
  guideLines: readonly GuideLine[];
  guideVersion: number;
  overlayStrokes?: readonly Stroke[];
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>;
  onRegisterOverlayRedraw?: (redraw: () => void) => void;
  onImageLoaded?: (width: number, height: number) => void;
  onImageError?: () => void;
  /** Guide line interaction mode */
  guideMode: GuideInteractionMode;
  onAddGuideLine?: (x1: number, y1: number, x2: number, y2: number) => void;
  onDeleteGuideLine?: (id: string) => void;
  /** ID of the guide line currently highlighted for deletion */
  highlightedGuideId?: string | null;
  onHighlightGuide?: (id: string | null) => void;
  isFlipped?: boolean;
  /** Optional shared ViewTransform instance. If provided, used instead of a private one (enables zoom sync with DrawingPanel). */
  viewTransform?: ViewTransform;
  /** When false, this panel doesn't own the home registration (another panel does). */
  isFitLeader?: boolean;
}

const OVERLAY_COLOR = 'rgba(0, 100, 255, 0.7)';
const OVERLAY_HALO_COLOR = 'rgba(255, 255, 255, 0.8)';
const GUIDE_HIT_THRESHOLD = 15;

function imageContent(img: HTMLImageElement | null): { width: number; height: number } | null {
  return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
}

export function ImageViewer({
  imageUrl, viewResetVersion, grid, guideLines, guideVersion,
  overlayStrokes, overlayCurrentStrokeRef, onRegisterOverlayRedraw,
  onImageLoaded, onImageError,
  guideMode, onAddGuideLine,
  highlightedGuideId, onHighlightGuide,
  isFlipped,
  viewTransform,
  isFitLeader = true,
}: ImageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Lazy-init: useRef's argument runs every render, so a plain default would
  // allocate a throw-away ViewTransform on each render.
  const viewTransformRef = useRef<ViewTransform>(null!);
  if (viewTransformRef.current === null) {
    viewTransformRef.current = viewTransform ?? new ViewTransform();
  }
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafIdRef = useRef<number>(0);
  const containerSizeRef = useRef<ContainerSize>({ width: 0, height: 0 });

  // Guide line drawing state
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);

  const pinchRef = useRef<{
    id1: number;
    id2: number;
    lastDist: number;
    lastMidX: number;
    lastMidY: number;
  } | null>(null);
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRectRef = useRef<DOMRect | null>(null);

  const getBaseScale = useCallback(() => computeBaseScale(containerSizeRef.current, imageContent(imageRef.current)), []);
  const getCurrentScale = useCallback(() => viewTransformRef.current.getScale(getBaseScale()), [getBaseScale]);

  const getCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    if (isFlipped) {
      screenX = rect.width - screenX;
    }
    return viewTransformRef.current.screenToCanvas(screenX, screenY, containerSizeRef.current, getBaseScale());
  }, [isFlipped, getBaseScale]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const container = containerSizeRef.current;
    const baseScale = getBaseScale();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const projected = viewTransformRef.current.project(container, baseScale);
    ctx.setTransform(
      dpr * projected.scale, 0,
      0, dpr * projected.scale,
      dpr * projected.offsetX, dpr * projected.offsetY,
    );

    // Draw the image centered at world origin so the grid/center anchor
    // (always (0, 0)) sits on the image's geometric center. See GRID_CENTER.
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

    // Draw grid and guide lines in canvas coordinate space
    const topLeft = viewTransformRef.current.screenToCanvas(0, 0, container, baseScale);
    const bottomRight = viewTransformRef.current.screenToCanvas(container.width, container.height, container, baseScale);
    drawGrid(ctx, grid, topLeft, bottomRight, projected.scale, GRID_CENTER);
    drawGuideLines(ctx, guideLines, projected.scale, highlightedGuideId);

    // Draw in-progress guide line
    if (dragStart && dragEnd) {
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.lineWidth = 1.5 / projected.scale;
      ctx.setLineDash([6 / projected.scale, 4 / projected.scale]);
      ctx.beginPath();
      ctx.moveTo(dragStart.x, dragStart.y);
      ctx.lineTo(dragEnd.x, dragEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw overlay strokes (completed + in-progress) with glow effect
    const currentStroke = overlayCurrentStrokeRef?.current;
    const allOverlayPoints: (readonly Point[])[] = [];
    if (overlayStrokes) {
      for (const stroke of overlayStrokes) allOverlayPoints.push(stroke.points);
    }
    if (currentStroke) allOverlayPoints.push(currentStroke.points);

    if (allOverlayPoints.length > 0) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const passes = [
        { color: OVERLAY_HALO_COLOR, width: (STROKE_WIDTH * OVERLAY_HALO_MULTIPLIER) / projected.scale },
        { color: OVERLAY_COLOR, width: STROKE_WIDTH / projected.scale },
      ];
      for (const pass of passes) {
        ctx.strokeStyle = pass.color;
        ctx.lineWidth = pass.width;
        for (const points of allOverlayPoints) {
          drawOverlayStrokePath(ctx, points);
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [grid, guideLines, overlayStrokes, overlayCurrentStrokeRef, highlightedGuideId, dragStart, dragEnd, getBaseScale]);

  const requestRedraw = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      redraw();
    });
  }, [redraw]);

  // Subscribe via a ref-stable indirection so the subscription survives
  // requestRedraw identity changes; otherwise we'd unsubscribe + resubscribe
  // on every prop change and miss notifications fired during the swap window.
  const requestRedrawRef = useRef(requestRedraw);
  useEffect(() => { requestRedrawRef.current = requestRedraw; });

  useEffect(() => {
    if (!viewTransform) return;
    return viewTransform.subscribe(() => requestRedrawRef.current());
  }, [viewTransform]);

  // Buffer-only resize — leaves the camera alone so resize events don't
  // clobber the user's manual zoom/pan. The camera projects against the new
  // container size automatically, preserving the visual center.
  const resizeCanvas = useCallback(() => {
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

    redraw();
  }, [redraw]);

  // Latest-ref bridge for resizeCanvas / onImageLoaded / onImageError so the
  // image-load effect doesn't churn whenever grid/guides change.
  const resizeCanvasRef = useRef(resizeCanvas);
  const onImageLoadedRef = useRef(onImageLoaded);
  const onImageErrorRef = useRef(onImageError);
  useEffect(() => {
    resizeCanvasRef.current = resizeCanvas;
    onImageLoadedRef.current = onImageLoaded;
    onImageErrorRef.current = onImageError;
  });

  // Load image: try without CORS first, then upgrade to CORS if possible.
  // Re-runs only when the URL changes.
  useEffect(() => {
    let cancelled = false;

    const applyImage = (loadedImg: HTMLImageElement) => {
      if (cancelled) return;
      imageRef.current = loadedImg;
      onImageLoadedRef.current?.(loadedImg.naturalWidth, loadedImg.naturalHeight);
      // World origin is the image center, so home is always (0, 0). Reset /
      // first-load therefore lands on image center regardless of dimensions.
      if (isFitLeader) {
        viewTransformRef.current.loadContent(0, 0, 1);
      }
      resizeCanvasRef.current();
    };

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const corsImg = new Image();
      corsImg.crossOrigin = 'anonymous';
      corsImg.onload = () => applyImage(corsImg);
      corsImg.onerror = () => applyImage(img);
      corsImg.src = imageUrl;
    };
    img.onerror = () => {
      if (!cancelled) onImageErrorRef.current?.();
    };
    img.src = imageUrl;

    return () => { cancelled = true; };
  }, [imageUrl, isFitLeader]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(container);
    return () => observer.disconnect();
  }, [resizeCanvas]);

  // Reset view (button click in toolbar).
  useEffect(() => {
    if (viewResetVersion > 0) {
      viewTransformRef.current.userResetToHome();
      redraw();
    }
  }, [viewResetVersion, redraw]);

  // Redraw when guides or overlay change
  useEffect(() => {
    redraw();
  }, [guideVersion, overlayStrokes, redraw]);

  // Register overlay redraw callback for direct invocation (avoids re-render cascade)
  useEffect(() => {
    onRegisterOverlayRedraw?.(requestRedraw);
  }, [onRegisterOverlayRedraw, requestRedraw]);

  // Wheel zoom/pan (only when not in guide mode)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      if (guideMode !== 'none') return;
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
        const scaleDelta = 1 - e.deltaY * TRACKPAD_ZOOM_SPEED;
        viewTransformRef.current.applyGesture(focalX, focalY, scaleDelta, 0, 0, container, baseScale);
      }
      else {
        const deltaX = isFlipped ? e.deltaX : -e.deltaX;
        viewTransformRef.current.applyGesture(focalX, focalY, 1, deltaX, -e.deltaY, container, baseScale);
      }
      requestRedraw();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [requestRedraw, guideMode, isFlipped, getBaseScale]);

  // Mouse handlers for guide line interaction
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (guideMode === 'none') return;
    const point = getCanvasPoint(e.clientX, e.clientY);

    if (guideMode === 'add') {
      setDragStart(point);
      setDragEnd(point);
    }
    else if (guideMode === 'delete') {
      // Find nearest guide line
      const threshold = GUIDE_HIT_THRESHOLD / getCurrentScale();
      let best: GuideLine | null = null;
      let bestDist = threshold;
      for (const line of guideLines) {
        const dist = pointToSegmentDistance(point.x, point.y, line.x1, line.y1, line.x2, line.y2);
        if (dist < bestDist) {
          bestDist = dist;
          best = line;
        }
      }
      onHighlightGuide?.(best?.id ?? null);
    }
  }, [guideMode, getCanvasPoint, guideLines, onHighlightGuide, getCurrentScale]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (guideMode !== 'add' || !dragStart) return;
    setDragEnd(getCanvasPoint(e.clientX, e.clientY));
    requestRedraw();
  }, [guideMode, dragStart, getCanvasPoint, requestRedraw]);

  const handleMouseUp = useCallback(() => {
    if (guideMode !== 'add' || !dragStart || !dragEnd) return;
    const dx = dragEnd.x - dragStart.x;
    const dy = dragEnd.y - dragStart.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5 / getCurrentScale()) {
      onAddGuideLine?.(dragStart.x, dragStart.y, dragEnd.x, dragEnd.y);
    }
    setDragStart(null);
    setDragEnd(null);
  }, [guideMode, dragStart, dragEnd, onAddGuideLine, getCurrentScale]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    if (activeTouchesRef.current.size >= 2) {
      e.preventDefault();
      if (dragStart || dragEnd) {
        setDragStart(null);
        setDragEnd(null);
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
      return;
    }

    if (guideMode === 'none') return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const point = getCanvasPoint(touch.clientX, touch.clientY);

    if (guideMode === 'add') {
      setDragStart(point);
      setDragEnd(point);
    }
    else if (guideMode === 'delete') {
      const threshold = GUIDE_HIT_THRESHOLD / getCurrentScale();
      let best: GuideLine | null = null;
      let bestDist = threshold;
      for (const line of guideLines) {
        const dist = pointToSegmentDistance(point.x, point.y, line.x1, line.y1, line.x2, line.y2);
        if (dist < bestDist) {
          bestDist = dist;
          best = line;
        }
      }
      onHighlightGuide?.(best?.id ?? null);
    }
  }, [guideMode, getCanvasPoint, guideLines, onHighlightGuide, dragStart, dragEnd, getCurrentScale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    if (pinchRef.current) {
      const t1 = activeTouchesRef.current.get(pinchRef.current.id1);
      const t2 = activeTouchesRef.current.get(pinchRef.current.id2);
      if (!t1 || !t2) return;
      e.preventDefault();

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

    if (guideMode !== 'add' || !dragStart) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    setDragEnd(getCanvasPoint(touch.clientX, touch.clientY));
    requestRedraw();
  }, [guideMode, dragStart, getCanvasPoint, requestRedraw, isFlipped, getBaseScale]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      activeTouchesRef.current.delete(e.changedTouches[i].identifier);
    }

    if (pinchRef.current) {
      if (!activeTouchesRef.current.has(pinchRef.current.id1)
        || !activeTouchesRef.current.has(pinchRef.current.id2)) {
        pinchRef.current = null;
        pinchRectRef.current = null;
      }
      e.preventDefault();
      return;
    }

    if (guideMode !== 'add' || !dragStart || !dragEnd) return;
    e.preventDefault();
    const dx = dragEnd.x - dragStart.x;
    const dy = dragEnd.y - dragStart.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5 / getCurrentScale()) {
      onAddGuideLine?.(dragStart.x, dragStart.y, dragEnd.x, dragEnd.y);
    }
    setDragStart(null);
    setDragEnd(null);
  }, [guideMode, dragStart, dragEnd, onAddGuideLine, getCurrentScale]);

  const cursor = guideMode === 'add' ? 'crosshair' : guideMode === 'delete' ? 'pointer' : 'default';

  return (
    <Box
      ref={containerRef}
      sx={{ width: '100%', height: '100%' }}
      style={isFlipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor,
        }}
      />
    </Box>
  );
}
