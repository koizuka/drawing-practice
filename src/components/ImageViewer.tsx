import { useRef, useEffect, useCallback } from 'react'
import { Box } from '@mui/material'
import { ViewTransform } from '../drawing/ViewTransform'
import { drawGrid, drawGuideLines } from '../guides/drawGuides'
import type { GridSettings, GuideLine } from '../guides/types'
import type { Stroke } from '../drawing/types'

interface ImageViewerProps {
  imageUrl: string
  viewResetVersion: number
  grid: GridSettings
  guideLines: readonly GuideLine[]
  guideVersion: number
  /** Overlay strokes from the drawing panel */
  overlayStrokes?: readonly Stroke[]
  /** Called when image is loaded with its natural dimensions */
  onImageLoaded?: (width: number, height: number) => void
}

const TRACKPAD_ZOOM_SPEED = 0.01
const OVERLAY_COLOR = 'rgba(0, 0, 255, 0.4)'

export function ImageViewer({ imageUrl, viewResetVersion, grid, guideLines, guideVersion, overlayStrokes, onImageLoaded }: ImageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewTransformRef = useRef(new ViewTransform())
  const imageRef = useRef<HTMLImageElement | null>(null)
  const rafIdRef = useRef<number>(0)

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
    const imgCenter = img ? { x: img.naturalWidth / 2, y: img.naturalHeight / 2 } : undefined
    drawGrid(ctx, grid, topLeft, bottomRight, vt.scale, imgCenter)
    drawGuideLines(ctx, guideLines, vt.scale)

    // Draw overlay strokes in canvas coordinate space (same grid coordinates as drawing panel)
    if (overlayStrokes && overlayStrokes.length > 0) {
      ctx.strokeStyle = OVERLAY_COLOR
      ctx.lineWidth = 2 / vt.scale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const stroke of overlayStrokes) {
        if (stroke.points.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
        }
        ctx.stroke()
      }
    }

    // Reset to DPR-only transform
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [grid, guideLines, overlayStrokes])

  const requestRedraw = useCallback(() => {
    if (rafIdRef.current) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0
      redraw()
    })
  }, [redraw])

  // Fit image to canvas on load
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

    const scaleX = rect.width / img.naturalWidth
    const scaleY = rect.height / img.naturalHeight
    const scale = Math.min(scaleX, scaleY)

    const offsetX = (rect.width - img.naturalWidth * scale) / 2
    const offsetY = (rect.height - img.naturalHeight * scale) / 2

    viewTransformRef.current.reset()
    viewTransformRef.current.applyPinch(0, 0, scale, offsetX, offsetY)

    redraw()
  }, [redraw])

  // Load image
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imageRef.current = img
      onImageLoaded?.(img.naturalWidth, img.naturalHeight)
      fitImage()
    }
    img.src = imageUrl
  }, [imageUrl, fitImage, onImageLoaded])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      fitImage()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [fitImage])

  // Reset view
  useEffect(() => {
    if (viewResetVersion > 0) {
      fitImage()
    }
  }, [viewResetVersion, fitImage])

  // Redraw when guides or overlay change
  useEffect(() => {
    redraw()
  }, [guideVersion, overlayStrokes, redraw])

  // Wheel zoom/pan
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const focalX = e.clientX - rect.left
      const focalY = e.clientY - rect.top

      if (e.ctrlKey) {
        const scaleDelta = 1 - e.deltaY * TRACKPAD_ZOOM_SPEED
        viewTransformRef.current.applyPinch(focalX, focalY, scaleDelta, 0, 0)
      } else {
        viewTransformRef.current.applyPinch(focalX, focalY, 1, -e.deltaX, -e.deltaY)
      }
      requestRedraw()
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [requestRedraw])

  return (
    <Box ref={containerRef} sx={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
      />
    </Box>
  )
}
