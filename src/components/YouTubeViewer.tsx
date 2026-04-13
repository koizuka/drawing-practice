import { useRef, useEffect, useCallback, useState } from 'react'
import { Box } from '@mui/material'
import { buildYouTubeEmbedUrl } from '../utils/youtube'
import { drawGrid, drawGuideLines } from '../guides/drawGuides'
import type { GridSettings, GuideLine } from '../guides/types'
import type { Stroke, Point } from '../drawing/types'
import type { GuideInteractionMode } from './ImageViewer'

const LOGICAL_WIDTH = 1920
const LOGICAL_HEIGHT = 1080

const OVERLAY_COLOR = 'rgba(0, 100, 255, 0.7)'
const OVERLAY_HALO_COLOR = 'rgba(255, 255, 255, 0.8)'
const GUIDE_HIT_THRESHOLD = 15

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

  const fitWrapper = useCallback(() => {
    const container = containerRef.current
    const wrapper = wrapperRef.current
    if (!container || !wrapper) return
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const fit = Math.min(rect.width / LOGICAL_WIDTH, rect.height / LOGICAL_HEIGHT)
    const w = LOGICAL_WIDTH * fit
    const h = LOGICAL_HEIGHT * fit
    wrapper.style.width = `${w}px`
    wrapper.style.height = `${h}px`
    wrapper.style.left = `${(rect.width - w) / 2}px`
    wrapper.style.top = `${(rect.height - h) / 2}px`
    redraw()
  }, [redraw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => fitWrapper())
    observer.observe(container)
    fitWrapper()
    return () => observer.disconnect()
  }, [fitWrapper])

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
      const threshold = GUIDE_HIT_THRESHOLD
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
  }, [guideMode, getLogicalPoint, guideLines, onHighlightGuide])

  const updateGuideInteraction = useCallback((clientX: number, clientY: number) => {
    if (guideMode !== 'add' || !dragStart) return
    setDragEnd(getLogicalPoint(clientX, clientY))
    requestRedraw()
  }, [guideMode, dragStart, getLogicalPoint, requestRedraw])

  const endGuideInteraction = useCallback(() => {
    if (guideMode !== 'add' || !dragStart || !dragEnd) return
    const dx = dragEnd.x - dragStart.x
    const dy = dragEnd.y - dragStart.y
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      onAddGuideLine?.(dragStart.x, dragStart.y, dragEnd.x, dragEnd.y)
    }
    setDragStart(null)
    setDragEnd(null)
  }, [guideMode, dragStart, dragEnd, onAddGuideLine])

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
    <Box ref={containerRef} sx={{ position: 'absolute', inset: 0, bgcolor: '#000' }}>
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
