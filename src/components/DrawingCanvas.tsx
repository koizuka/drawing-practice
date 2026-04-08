import { useRef, useEffect, useCallback } from 'react'
import { Box } from '@mui/material'
import { StrokeManager } from '../drawing/StrokeManager'
import { CanvasRenderer } from '../drawing/CanvasRenderer'
import { ViewTransform } from '../drawing/ViewTransform'
import { drawGrid, drawGuideLines } from '../guides/drawGuides'
import type { Point } from '../drawing/types'
import type { GridSettings, GuideLine } from '../guides/types'

export type DrawingMode = 'pen' | 'eraser'

interface DrawingCanvasProps {
  mode: DrawingMode
  highlightedStrokeIndex: number | null
  onHighlightStroke: (index: number | null) => void
  onStrokeCountChange: () => void
  strokeManagerRef: React.RefObject<StrokeManager>
  /** Increment this to force a canvas redraw (e.g. after undo/redo/clear). */
  redrawVersion: number
  /** Increment this to reset zoom/pan to identity. */
  viewResetVersion: number
  grid: GridSettings
  guideLines: readonly GuideLine[]
  guideVersion: number
  /** If provided, initialize view transform to fit this size (match reference panel scale) */
  fitSize?: { width: number; height: number }
  isFlipped?: boolean
}

const ERASER_THRESHOLD = 20
const TRACKPAD_ZOOM_SPEED = 0.01

export function DrawingCanvas({
  mode,
  highlightedStrokeIndex,
  onHighlightStroke,
  onStrokeCountChange,
  strokeManagerRef,
  redrawVersion,
  viewResetVersion,
  grid,
  guideLines,
  guideVersion,
  fitSize,
  isFlipped,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const viewTransformRef = useRef(new ViewTransform())
  const hasStylusRef = useRef(false)
  const drawingPointCountRef = useRef(0)
  const rafIdRef = useRef<number>(0)

  // Pinch state
  const pinchRef = useRef<{ id1: number; id2: number; lastDist: number; lastMidX: number; lastMidY: number } | null>(null)
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  const notifyStrokeCount = useCallback(() => {
    onStrokeCountChange()
  }, [onStrokeCountChange])

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    if (!canvas || !renderer) return

    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1

    // Reset to identity and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    renderer.clear()

    // Apply DPR scaling first, then view transform on top
    const vt = viewTransformRef.current.get()
    ctx.setTransform(
      dpr * vt.scale, 0,
      0, dpr * vt.scale,
      dpr * vt.offsetX, dpr * vt.offsetY,
    )

    renderer.drawStrokes(strokeManagerRef.current.getStrokes())

    // Draw highlighted stroke
    if (highlightedStrokeIndex !== null) {
      const strokes = strokeManagerRef.current.getStrokes()
      if (highlightedStrokeIndex < strokes.length) {
        renderer.drawHighlightedStroke(strokes[highlightedStrokeIndex])
      }
    }

    // Draw current in-progress stroke
    const current = strokeManagerRef.current.getCurrentStroke()
    if (current && current.points.length >= 2) {
      renderer.drawStroke(current)
    }

    // Draw grid and guide lines in canvas coordinate space (moves with zoom/pan)
    const cssWidth = canvas.width / dpr
    const cssHeight = canvas.height / dpr
    const topLeft = viewTransformRef.current.screenToCanvas(0, 0)
    const bottomRight = viewTransformRef.current.screenToCanvas(cssWidth, cssHeight)
    const gridCenter = fitSize
      ? { x: fitSize.width / 2, y: fitSize.height / 2 }
      : viewTransformRef.current.screenToCanvas(cssWidth / 2, cssHeight / 2)
    drawGrid(ctx, grid, topLeft, bottomRight, vt.scale, gridCenter)
    drawGuideLines(ctx, guideLines, vt.scale)

    // Reset to DPR-only transform
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [highlightedStrokeIndex, strokeManagerRef, grid, guideLines, fitSize])

  const fitToSize = useCallback(() => {
    const container = containerRef.current
    if (!container || !fitSize) return
    const rect = container.getBoundingClientRect()
    const scaleX = rect.width / fitSize.width
    const scaleY = rect.height / fitSize.height
    const scale = Math.min(scaleX, scaleY)
    const offsetX = (rect.width - fitSize.width * scale) / 2
    const offsetY = (rect.height - fitSize.height * scale) / 2
    viewTransformRef.current.reset()
    viewTransformRef.current.applyPinch(0, 0, scale, offsetX, offsetY)
  }, [fitSize])

  // Setup canvas with DPR
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    rendererRef.current = new CanvasRenderer(ctx)
    redrawAll()
  }, [redrawAll])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      setupCanvas()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [setupCanvas])

  // Redraw when highlighted stroke, redrawVersion, or guides change
  useEffect(() => {
    redrawAll()
  }, [highlightedStrokeIndex, redrawVersion, guideVersion, redrawAll])

  // Reset view when viewResetVersion changes
  useEffect(() => {
    if (viewResetVersion > 0) {
      if (fitSize) {
        fitToSize()
      } else {
        viewTransformRef.current.reset()
      }
      redrawAll()
    }
  }, [viewResetVersion, redrawAll, fitSize, fitToSize])

  // Re-fit when fitSize changes
  useEffect(() => {
    if (fitSize) {
      fitToSize()
      redrawAll()
    }
  }, [fitSize, fitToSize, redrawAll])

  const getCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    let screenX = clientX - rect.left
    const screenY = clientY - rect.top
    // When CSS scaleX(-1) is applied, mirror the X coordinate
    if (isFlipped) {
      screenX = rect.width - screenX
    }
    return viewTransformRef.current.screenToCanvas(screenX, screenY)
  }, [isFlipped])

  const requestRedraw = useCallback(() => {
    if (rafIdRef.current) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0
      redrawAll()
    })
  }, [redrawAll])

  // Wheel event for trackpad zoom/pan
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = canvas.getBoundingClientRect()
      let focalX = e.clientX - rect.left
      const focalY = e.clientY - rect.top
      if (isFlipped) {
        focalX = rect.width - focalX
      }

      if (e.ctrlKey) {
        // Pinch zoom on trackpad (ctrlKey is set by the browser for pinch gestures)
        const scaleDelta = 1 - e.deltaY * TRACKPAD_ZOOM_SPEED
        viewTransformRef.current.applyPinch(focalX, focalY, scaleDelta, 0, 0)
      } else {
        // Pan — flip horizontal delta when flipped
        const deltaX = isFlipped ? e.deltaX : -e.deltaX
        viewTransformRef.current.applyPinch(focalX, focalY, 1, deltaX, -e.deltaY)
      }

      requestRedraw()
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [requestRedraw, isFlipped])

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()

    // Track all touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Detect stylus
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i] as Touch & { touchType?: string }
      if (touch.touchType === 'stylus') {
        hasStylusRef.current = true
      }
    }

    // 2-finger pinch
    if (activeTouchesRef.current.size >= 2) {
      const ids = Array.from(activeTouchesRef.current.keys())
      const t1 = activeTouchesRef.current.get(ids[0])!
      const t2 = activeTouchesRef.current.get(ids[1])!
      const dx = t2.x - t1.x
      const dy = t2.y - t1.y
      pinchRef.current = {
        id1: ids[0],
        id2: ids[1],
        lastDist: Math.sqrt(dx * dx + dy * dy),
        lastMidX: (t1.x + t2.x) / 2,
        lastMidY: (t1.y + t2.y) / 2,
      }
      return
    }

    // Single touch: drawing
    const touch = e.changedTouches[0] as Touch & { touchType?: string }
    if (hasStylusRef.current && touch.touchType !== 'stylus') return

    const point = getCanvasPoint(touch.clientX, touch.clientY)

    if (mode === 'eraser') {
      const index = strokeManagerRef.current.findNearestStroke(point, ERASER_THRESHOLD / viewTransformRef.current.get().scale)
      onHighlightStroke(index)
    } else {
      strokeManagerRef.current.startStroke(point)
      drawingPointCountRef.current = 1
    }
  }, [mode, getCanvasPoint, onHighlightStroke, strokeManagerRef])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()

    // Update tracked touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Pinch zoom/pan
    if (pinchRef.current) {
      const t1 = activeTouchesRef.current.get(pinchRef.current.id1)
      const t2 = activeTouchesRef.current.get(pinchRef.current.id2)
      if (!t1 || !t2) return

      const dx = t2.x - t1.x
      const dy = t2.y - t1.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const midX = (t1.x + t2.x) / 2
      const midY = (t1.y + t2.y) / 2

      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      let focalX = midX - rect.left
      const focalY = midY - rect.top
      if (isFlipped) {
        focalX = rect.width - focalX
      }

      const scaleDelta = dist / pinchRef.current.lastDist
      const rawTranslateX = midX - pinchRef.current.lastMidX
      const translateX = isFlipped ? -rawTranslateX : rawTranslateX
      const translateY = midY - pinchRef.current.lastMidY

      viewTransformRef.current.applyPinch(focalX, focalY, scaleDelta, translateX, translateY)

      pinchRef.current.lastDist = dist
      pinchRef.current.lastMidX = midX
      pinchRef.current.lastMidY = midY

      requestRedraw()
      return
    }

    // Drawing
    if (mode !== 'pen') return
    const touch = e.changedTouches[0] as Touch & { touchType?: string }
    if (hasStylusRef.current && touch.touchType !== 'stylus') return

    const point = getCanvasPoint(touch.clientX, touch.clientY)
    strokeManagerRef.current.appendStroke(point)
    requestRedraw()
  }, [mode, getCanvasPoint, requestRedraw, strokeManagerRef, isFlipped])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      activeTouchesRef.current.delete(touch.identifier)
    }

    // Clear pinch if one of the pinch fingers lifted
    if (pinchRef.current) {
      if (!activeTouchesRef.current.has(pinchRef.current.id1) ||
          !activeTouchesRef.current.has(pinchRef.current.id2)) {
        pinchRef.current = null
      }
    }

    if (mode === 'pen') {
      const stroke = strokeManagerRef.current.endStroke()
      if (stroke) {
        notifyStrokeCount()
        redrawAll()
      }
    }
  }, [mode, notifyStrokeCount, redrawAll, strokeManagerRef])

  // Mouse fallback handlers
  const isMouseDownRef = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (hasStylusRef.current) return
    isMouseDownRef.current = true

    const point = getCanvasPoint(e.clientX, e.clientY)

    if (mode === 'eraser') {
      const index = strokeManagerRef.current.findNearestStroke(point, ERASER_THRESHOLD / viewTransformRef.current.get().scale)
      onHighlightStroke(index)
    } else {
      strokeManagerRef.current.startStroke(point)
      drawingPointCountRef.current = 1
    }
  }, [mode, getCanvasPoint, onHighlightStroke, strokeManagerRef])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isMouseDownRef.current || mode !== 'pen') return

    const point = getCanvasPoint(e.clientX, e.clientY)
    strokeManagerRef.current.appendStroke(point)
    requestRedraw()
  }, [mode, getCanvasPoint, requestRedraw, strokeManagerRef])

  const handleMouseUp = useCallback(() => {
    if (!isMouseDownRef.current) return
    isMouseDownRef.current = false

    if (mode === 'pen') {
      const stroke = strokeManagerRef.current.endStroke()
      if (stroke) {
        notifyStrokeCount()
        redrawAll()
      }
    }
  }, [mode, notifyStrokeCount, redrawAll, strokeManagerRef])

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        cursor: mode === 'eraser' ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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
  )
}
