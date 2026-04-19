import { useRef, useEffect, useCallback, useState } from 'react'
import { Box } from '@mui/material'
import { buildYouTubeEmbedUrl } from '../utils/youtube'
import { drawGrid, drawGuideLines } from '../guides/drawGuides'
import type { GridSettings, GuideLine } from '../guides/types'
import type { Stroke, Point } from '../drawing/types'
import type { GuideInteractionMode } from './ImageViewer'
import type { ViewTransform } from '../drawing/ViewTransform'

const LOGICAL_WIDTH = 1920
const LOGICAL_HEIGHT = 1080

const OVERLAY_COLOR = 'rgba(0, 100, 255, 0.7)'
const OVERLAY_HALO_COLOR = 'rgba(255, 255, 255, 0.8)'
const GUIDE_HIT_THRESHOLD_PX = 15
const GUIDE_MIN_DRAG_PX = 5

interface YouTubeViewerProps {
  videoId: string
  grid: GridSettings
  guideLines: readonly GuideLine[]
  guideVersion: number
  overlayStrokes?: readonly Stroke[] | null
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>
  onRegisterOverlayRedraw?: (redraw: () => void) => void
  onFitSize?: (width: number, height: number) => void
  guideMode: GuideInteractionMode
  onAddGuideLine?: (x1: number, y1: number, x2: number, y2: number) => void
  highlightedGuideId?: string | null
  onHighlightGuide?: (id: string | null) => void
  /** Optional shared ViewTransform to sync iframe placement with the drawing canvas. */
  viewTransform?: ViewTransform
  /** When true, this viewer writes the initial fit to the shared ViewTransform on mount/resize. */
  isFitLeader?: boolean
}

function drawOverlayStrokePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
}

function pointToSegmentDist(p: Point, line: GuideLine): number {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ex = p.x - line.x1
    const ey = p.y - line.y1
    return Math.sqrt(ex * ex + ey * ey)
  }
  let t = ((p.x - line.x1) * dx + (p.y - line.y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = line.x1 + t * dx
  const cy = line.y1 + t * dy
  return Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
}

export function YouTubeViewer({
  videoId, grid, guideLines, guideVersion,
  overlayStrokes, overlayCurrentStrokeRef, onRegisterOverlayRedraw,
  onFitSize,
  guideMode, onAddGuideLine, highlightedGuideId, onHighlightGuide,
  viewTransform,
  isFitLeader = false,
}: YouTubeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)

  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [dragEnd, setDragEnd] = useState<Point | null>(null)

  useEffect(() => {
    onFitSize?.(LOGICAL_WIDTH, LOGICAL_HEIGHT)
  }, [onFitSize])

  const getLogicalPoint = useCallback((clientX: number, clientY: number): Point => {
    const wrapper = wrapperRef.current
    if (!wrapper) return { x: 0, y: 0 }
    const rect = wrapper.getBoundingClientRect()
    const scale = rect.width / LOGICAL_WIDTH
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    }
  }, [])

  /** Current logical units per screen pixel; 0 if the wrapper is not laid out yet. */
  const getLogicalScale = useCallback((): number => {
    const wrapper = wrapperRef.current
    if (!wrapper) return 0
    const rect = wrapper.getBoundingClientRect()
    if (rect.width === 0) return 0
    return rect.width / LOGICAL_WIDTH
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return

    const rect = wrapper.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)
    if (canvas.width !== targetW) canvas.width = targetW
    if (canvas.height !== targetH) canvas.height = targetH

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const scale = rect.width / LOGICAL_WIDTH
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)

    const topLeft: Point = { x: 0, y: 0 }
    const bottomRight: Point = { x: LOGICAL_WIDTH, y: LOGICAL_HEIGHT }
    const center: Point = { x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT / 2 }
    drawGrid(ctx, grid, topLeft, bottomRight, scale, center)
    drawGuideLines(ctx, guideLines, scale, highlightedGuideId)

    if (dragStart && dragEnd) {
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)'
      ctx.lineWidth = 1.5 / scale
      ctx.setLineDash([6 / scale, 4 / scale])
      ctx.beginPath()
      ctx.moveTo(dragStart.x, dragStart.y)
      ctx.lineTo(dragEnd.x, dragEnd.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    const currentStroke = overlayCurrentStrokeRef?.current
    const allPoints: (readonly Point[])[] = []
    if (overlayStrokes) for (const s of overlayStrokes) allPoints.push(s.points)
    if (currentStroke) allPoints.push(currentStroke.points)
    if (allPoints.length > 0) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const passes = [
        { color: OVERLAY_HALO_COLOR, width: 5 / scale },
        { color: OVERLAY_COLOR, width: 2 / scale },
      ]
      for (const pass of passes) {
        ctx.strokeStyle = pass.color
        ctx.lineWidth = pass.width
        for (const points of allPoints) drawOverlayStrokePath(ctx, points)
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [grid, guideLines, overlayStrokes, overlayCurrentStrokeRef, highlightedGuideId, dragStart, dragEnd])

  const requestRedraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      redraw()
    })
  }, [redraw])

  // Position the wrapper. When a shared ViewTransform is provided, its
  // (offsetX, offsetY, scale) drives the iframe placement so YouTube zoom/pan
  // stays in lockstep with the drawing canvas. Otherwise fall back to a
  // self-fit that centers the 16:9 wrapper in the container.
  const applyPlacement = useCallback(() => {
    const container = containerRef.current
    const wrapper = wrapperRef.current
    if (!container || !wrapper) return
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    if (viewTransform) {
      const vt = viewTransform.get()
      wrapper.style.left = `${vt.offsetX}px`
      wrapper.style.top = `${vt.offsetY}px`
      wrapper.style.width = `${LOGICAL_WIDTH * vt.scale}px`
      wrapper.style.height = `${LOGICAL_HEIGHT * vt.scale}px`
    } else {
      const fit = Math.min(rect.width / LOGICAL_WIDTH, rect.height / LOGICAL_HEIGHT)
      const w = LOGICAL_WIDTH * fit
      const h = LOGICAL_HEIGHT * fit
      wrapper.style.width = `${w}px`
      wrapper.style.height = `${h}px`
      wrapper.style.left = `${(rect.width - w) / 2}px`
      wrapper.style.top = `${(rect.height - h) / 2}px`
    }
    redraw()
  }, [redraw, viewTransform])

  // When this viewer owns the fit, compute it from the container rect and push
  // it into the shared ViewTransform. The placement subscriber will then react.
  const writeFitToTransform = useCallback(() => {
    const container = containerRef.current
    if (!container || !viewTransform || !isFitLeader) return
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    viewTransform.fitTo(
      { width: rect.width, height: rect.height },
      { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
    )
  }, [viewTransform, isFitLeader])

  // Initial fit only — resize is handled by the placement-only observer below
  // so the ViewTransform survives incidental resizes.
  useEffect(() => {
    writeFitToTransform()
  }, [writeFitToTransform])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      applyPlacement()
    })
    observer.observe(container)
    applyPlacement()
    return () => observer.disconnect()
  }, [applyPlacement])

  // Subscribe to transform changes driven by the drawing canvas so the iframe
  // follows along when the user zooms/pans on the other panel.
  useEffect(() => {
    if (!viewTransform) return
    return viewTransform.subscribe(applyPlacement)
  }, [viewTransform, applyPlacement])

  useEffect(() => {
    redraw()
  }, [guideVersion, overlayStrokes, redraw])

  useEffect(() => {
    onRegisterOverlayRedraw?.(requestRedraw)
  }, [onRegisterOverlayRedraw, requestRedraw])

  const beginGuideInteraction = useCallback((clientX: number, clientY: number) => {
    if (guideMode === 'none') return
    const point = getLogicalPoint(clientX, clientY)
    if (guideMode === 'add') {
      setDragStart(point)
      setDragEnd(point)
    } else if (guideMode === 'delete') {
      // Hit threshold is a fixed screen-pixel distance; convert to logical units.
      const scale = getLogicalScale()
      if (scale === 0) return
      const threshold = GUIDE_HIT_THRESHOLD_PX / scale
      let best: GuideLine | null = null
      let bestDist = threshold
      for (const line of guideLines) {
        const dist = pointToSegmentDist(point, line)
        if (dist < bestDist) {
          bestDist = dist
          best = line
        }
      }
      onHighlightGuide?.(best?.id ?? null)
    }
  }, [guideMode, getLogicalPoint, getLogicalScale, guideLines, onHighlightGuide])

  const updateGuideInteraction = useCallback((clientX: number, clientY: number) => {
    if (guideMode !== 'add' || !dragStart) return
    setDragEnd(getLogicalPoint(clientX, clientY))
    requestRedraw()
  }, [guideMode, dragStart, getLogicalPoint, requestRedraw])

  const endGuideInteraction = useCallback(() => {
    if (guideMode !== 'add' || !dragStart || !dragEnd) return
    const dx = dragEnd.x - dragStart.x
    const dy = dragEnd.y - dragStart.y
    // Min drag length is a screen-pixel threshold, converted to logical units.
    const scale = getLogicalScale()
    const minLenLogical = scale > 0 ? GUIDE_MIN_DRAG_PX / scale : GUIDE_MIN_DRAG_PX
    if (Math.sqrt(dx * dx + dy * dy) > minLenLogical) {
      onAddGuideLine?.(dragStart.x, dragStart.y, dragEnd.x, dragEnd.y)
    }
    setDragStart(null)
    setDragEnd(null)
  }, [guideMode, dragStart, dragEnd, getLogicalScale, onAddGuideLine])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    beginGuideInteraction(e.clientX, e.clientY)
  }, [beginGuideInteraction])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    updateGuideInteraction(e.clientX, e.clientY)
  }, [updateGuideInteraction])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (guideMode === 'none') return
    e.preventDefault()
    const touch = e.changedTouches[0]
    beginGuideInteraction(touch.clientX, touch.clientY)
  }, [guideMode, beginGuideInteraction])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (guideMode !== 'add' || !dragStart) return
    e.preventDefault()
    const touch = e.changedTouches[0]
    updateGuideInteraction(touch.clientX, touch.clientY)
  }, [guideMode, dragStart, updateGuideInteraction])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (guideMode !== 'add') return
    e.preventDefault()
    endGuideInteraction()
  }, [guideMode, endGuideInteraction])

  const interactive = guideMode !== 'none'
  const cursor = guideMode === 'add' ? 'crosshair' : guideMode === 'delete' ? 'pointer' : 'default'

  return (
    <Box ref={containerRef} sx={{ position: 'absolute', inset: 0, bgcolor: '#000', overflow: 'hidden' }}>
      <Box ref={wrapperRef} sx={{ position: 'absolute' }}>
        <iframe
          key={videoId}
          src={buildYouTubeEmbedUrl(videoId)}
          title="YouTube reference"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }}
        />
        <canvas
          ref={canvasRef}
          onMouseDown={interactive ? handleMouseDown : undefined}
          onMouseMove={interactive ? handleMouseMove : undefined}
          onMouseUp={interactive ? endGuideInteraction : undefined}
          onMouseLeave={interactive ? endGuideInteraction : undefined}
          onTouchStart={interactive ? handleTouchStart : undefined}
          onTouchMove={interactive ? handleTouchMove : undefined}
          onTouchEnd={interactive ? handleTouchEnd : undefined}
          onTouchCancel={interactive ? handleTouchEnd : undefined}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: interactive ? 'auto' : 'none',
            touchAction: interactive ? 'none' : 'auto',
            cursor,
          }}
        />
      </Box>
    </Box>
  )
}
