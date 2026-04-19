import { useRef, useEffect, useCallback, useState } from 'react'
import { Box } from '@mui/material'
import { ViewTransform } from '../drawing/ViewTransform'
import { drawGrid, drawGuideLines } from '../guides/drawGuides'
import type { GridSettings, GuideLine } from '../guides/types'
import type { Stroke, Point } from '../drawing/types'

export type GuideInteractionMode = 'none' | 'add' | 'delete'

interface ImageViewerProps {
  imageUrl: string
  viewResetVersion: number
  grid: GridSettings
  guideLines: readonly GuideLine[]
  guideVersion: number
  overlayStrokes?: readonly Stroke[]
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>
  onRegisterOverlayRedraw?: (redraw: () => void) => void
  onImageLoaded?: (width: number, height: number) => void
  onImageError?: () => void
  /** Guide line interaction mode */
  guideMode: GuideInteractionMode
  onAddGuideLine?: (x1: number, y1: number, x2: number, y2: number) => void
  onDeleteGuideLine?: (id: string) => void
  /** ID of the guide line currently highlighted for deletion */
  highlightedGuideId?: string | null
  onHighlightGuide?: (id: string | null) => void
  isFlipped?: boolean
  /** Optional shared ViewTransform instance. If provided, used instead of a private one (enables zoom sync with DrawingPanel). */
  viewTransform?: ViewTransform
  /** When false, skip automatic fit on image load / resize. Defaults to true. */
  isFitLeader?: boolean
}

const TRACKPAD_ZOOM_SPEED = 0.01
const OVERLAY_COLOR = 'rgba(0, 100, 255, 0.7)'
const OVERLAY_HALO_COLOR = 'rgba(255, 255, 255, 0.8)'
const GUIDE_HIT_THRESHOLD = 15

function drawOverlayStrokePath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // The shared viewTransform (if any) is created once in SplitLayout and stable for the component's lifetime.
  const viewTransformRef = useRef<ViewTransform>(viewTransform ?? new ViewTransform())
  const imageRef = useRef<HTMLImageElement | null>(null)
  const rafIdRef = useRef<number>(0)

  // Guide line drawing state
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [dragEnd, setDragEnd] = useState<Point | null>(null)

  const getCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    let screenX = clientX - rect.left
    const screenY = clientY - rect.top
    if (isFlipped) {
      screenX = rect.width - screenX
    }
    return viewTransformRef.current.screenToCanvas(screenX, screenY)
  }, [isFlipped])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return

    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f5f5f5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const vt = viewTransformRef.current.get()
    ctx.setTransform(
      dpr * vt.scale, 0,
      0, dpr * vt.scale,
      dpr * vt.offsetX, dpr * vt.offsetY,
    )

    ctx.drawImage(img, 0, 0)

    // Draw grid and guide lines in canvas coordinate space
    const cssWidth = canvas.width / dpr
    const cssHeight = canvas.height / dpr
    const topLeft = viewTransformRef.current.screenToCanvas(0, 0)
    const bottomRight = viewTransformRef.current.screenToCanvas(cssWidth, cssHeight)
    const imgCenter = { x: img.naturalWidth / 2, y: img.naturalHeight / 2 }
    drawGrid(ctx, grid, topLeft, bottomRight, vt.scale, imgCenter)
    drawGuideLines(ctx, guideLines, vt.scale, highlightedGuideId)

    // Draw in-progress guide line
    if (dragStart && dragEnd) {
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)'
      ctx.lineWidth = 1.5 / vt.scale
      ctx.setLineDash([6 / vt.scale, 4 / vt.scale])
      ctx.beginPath()
      ctx.moveTo(dragStart.x, dragStart.y)
      ctx.lineTo(dragEnd.x, dragEnd.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Draw overlay strokes (completed + in-progress) with glow effect
    const currentStroke = overlayCurrentStrokeRef?.current
    const allOverlayPoints: (readonly Point[])[] = []
    if (overlayStrokes) {
      for (const stroke of overlayStrokes) allOverlayPoints.push(stroke.points)
    }
    if (currentStroke) allOverlayPoints.push(currentStroke.points)

    if (allOverlayPoints.length > 0) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const passes = [
        { color: OVERLAY_HALO_COLOR, width: 5 / vt.scale },
        { color: OVERLAY_COLOR, width: 2 / vt.scale },
      ]
      for (const pass of passes) {
        ctx.strokeStyle = pass.color
        ctx.lineWidth = pass.width
        for (const points of allOverlayPoints) {
          drawOverlayStrokePath(ctx, points)
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [grid, guideLines, overlayStrokes, overlayCurrentStrokeRef, highlightedGuideId, dragStart, dragEnd])

  const requestRedraw = useCallback(() => {
    if (rafIdRef.current) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0
      redraw()
    })
  }, [redraw])

  // When a shared ViewTransform is provided, redraw whenever the other panel mutates it.
  useEffect(() => {
    if (!viewTransform) return
    return viewTransform.subscribe(requestRedraw)
  }, [viewTransform, requestRedraw])

  // Fit image to canvas on load. Canvas size is updated regardless of fit ownership;
  // only the ViewTransform write is gated by isFitLeader.
  const fitImage = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const img = imageRef.current
    if (!canvas || !container || !img) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    if (isFitLeader) {
      viewTransformRef.current.fitTo(
        { width: rect.width, height: rect.height },
        { width: img.naturalWidth, height: img.naturalHeight },
      )
    }

    redraw()
  }, [redraw, isFitLeader])

  // Load image: try without CORS first, then upgrade to CORS if possible
  // Only depends on imageUrl to avoid re-triggering on prop changes
  useEffect(() => {
    let cancelled = false

    const applyImage = (loadedImg: HTMLImageElement) => {
      if (cancelled) return
      imageRef.current = loadedImg
      onImageLoaded?.(loadedImg.naturalWidth, loadedImg.naturalHeight)
      fitImage()
    }

    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      // Try CORS version for untainted canvas
      const corsImg = new Image()
      corsImg.crossOrigin = 'anonymous'
      corsImg.onload = () => applyImage(corsImg)
      corsImg.onerror = () => applyImage(img)
      corsImg.src = imageUrl
    }
    img.onerror = () => {
      if (!cancelled) onImageError?.()
    }
    img.src = imageUrl

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when URL changes
  }, [imageUrl])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => fitImage())
    observer.observe(container)
    return () => observer.disconnect()
  }, [fitImage])

  // Reset view
  useEffect(() => {
    if (viewResetVersion > 0) fitImage()
  }, [viewResetVersion, fitImage])

  // Redraw when guides or overlay change
  useEffect(() => {
    redraw()
  }, [guideVersion, overlayStrokes, redraw])

  // Register overlay redraw callback for direct invocation (avoids re-render cascade)
  useEffect(() => {
    onRegisterOverlayRedraw?.(requestRedraw)
  }, [onRegisterOverlayRedraw, requestRedraw])

  // Wheel zoom/pan (only when not in guide mode)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e: WheelEvent) => {
      if (guideMode !== 'none') return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      let focalX = e.clientX - rect.left
      const focalY = e.clientY - rect.top
      if (isFlipped) {
        focalX = rect.width - focalX
      }

      if (e.ctrlKey) {
        const scaleDelta = 1 - e.deltaY * TRACKPAD_ZOOM_SPEED
        viewTransformRef.current.applyPinch(focalX, focalY, scaleDelta, 0, 0)
      } else {
        const deltaX = isFlipped ? e.deltaX : -e.deltaX
        viewTransformRef.current.applyPinch(focalX, focalY, 1, deltaX, -e.deltaY)
      }
      requestRedraw()
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [requestRedraw, guideMode, isFlipped])

  // Mouse handlers for guide line interaction
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (guideMode === 'none') return
    const point = getCanvasPoint(e.clientX, e.clientY)

    if (guideMode === 'add') {
      setDragStart(point)
      setDragEnd(point)
    } else if (guideMode === 'delete') {
      // Find nearest guide line
      const threshold = GUIDE_HIT_THRESHOLD / viewTransformRef.current.get().scale
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
  }, [guideMode, getCanvasPoint, guideLines, onHighlightGuide])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (guideMode !== 'add' || !dragStart) return
    setDragEnd(getCanvasPoint(e.clientX, e.clientY))
    requestRedraw()
  }, [guideMode, dragStart, getCanvasPoint, requestRedraw])

  const handleMouseUp = useCallback(() => {
    if (guideMode !== 'add' || !dragStart || !dragEnd) return
    const dx = dragEnd.x - dragStart.x
    const dy = dragEnd.y - dragStart.y
    if (Math.sqrt(dx * dx + dy * dy) > 5 / viewTransformRef.current.get().scale) {
      onAddGuideLine?.(dragStart.x, dragStart.y, dragEnd.x, dragEnd.y)
    }
    setDragStart(null)
    setDragEnd(null)
  }, [guideMode, dragStart, dragEnd, onAddGuideLine])

  // Touch handlers for guide line interaction
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (guideMode === 'none') return
    e.preventDefault()
    const touch = e.changedTouches[0]
    const point = getCanvasPoint(touch.clientX, touch.clientY)

    if (guideMode === 'add') {
      setDragStart(point)
      setDragEnd(point)
    } else if (guideMode === 'delete') {
      const threshold = GUIDE_HIT_THRESHOLD / viewTransformRef.current.get().scale
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
  }, [guideMode, getCanvasPoint, guideLines, onHighlightGuide])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (guideMode !== 'add' || !dragStart) return
    e.preventDefault()
    const touch = e.changedTouches[0]
    setDragEnd(getCanvasPoint(touch.clientX, touch.clientY))
    requestRedraw()
  }, [guideMode, dragStart, getCanvasPoint, requestRedraw])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (guideMode !== 'add' || !dragStart || !dragEnd) return
    e.preventDefault()
    const dx = dragEnd.x - dragStart.x
    const dy = dragEnd.y - dragStart.y
    if (Math.sqrt(dx * dx + dy * dy) > 5 / viewTransformRef.current.get().scale) {
      onAddGuideLine?.(dragStart.x, dragStart.y, dragEnd.x, dragEnd.y)
    }
    setDragStart(null)
    setDragEnd(null)
  }, [guideMode, dragStart, dragEnd, onAddGuideLine])

  const cursor = guideMode === 'add' ? 'crosshair' : guideMode === 'delete' ? 'pointer' : 'default'

  return (
    <Box ref={containerRef} sx={{ width: '100%', height: '100%' }}>
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
          touchAction: guideMode !== 'none' ? 'none' : 'auto',
          cursor,
        }}
      />
    </Box>
  )
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
