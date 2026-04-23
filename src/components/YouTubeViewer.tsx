import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { Box } from '@mui/material'
import { buildYouTubeEmbedUrl, YOUTUBE_ORIGIN } from '../utils/youtube'
import { drawGrid, drawGuideLines } from '../guides/drawGuides'
import type { GridSettings, GuideLine } from '../guides/types'
import type { Stroke, Point } from '../drawing/types'
import type { GuideInteractionMode } from './ImageViewer'
import type { ViewTransform } from '../drawing/ViewTransform'

const LOGICAL_WIDTH = 1920
const LOGICAL_HEIGHT = 1080

const TRACKPAD_ZOOM_SPEED = 0.01

// Tap threshold: release within this radius and duration counts as a tap and
// switches to video-interact mode.
const TAP_MAX_MOVE_PX = 10
const TAP_MAX_DURATION_MS = 400

const OVERLAY_COLOR = 'rgba(0, 100, 255, 0.7)'
const OVERLAY_HALO_COLOR = 'rgba(255, 255, 255, 0.8)'
const GUIDE_HIT_THRESHOLD_PX = 15
const GUIDE_MIN_DRAG_PX = 5

// YouTube IFrame Player API postMessage protocol.
// See https://developers.google.com/youtube/iframe_api_reference
const YT_EVENT_LISTENING = 'listening'
const YT_EVENT_COMMAND = 'command'
const YT_EVENT_INFO_DELIVERY = 'infoDelivery'
const YT_EVENT_STATE_CHANGE = 'onStateChange'
const YT_CMD_PLAY = 'playVideo'
const YT_CMD_PAUSE = 'pauseVideo'
const YT_PLAYER_STATE_PLAYING = 1

export interface YouTubePlayerHandle {
  play(): void
  pause(): void
}

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
  /**
   * When true, the overlay is made transparent to input so the iframe itself
   * receives pointer events (seek bar, subtitles, settings). Zoom/pan on the
   * canvas and tap-detection are disabled in this mode.
   */
  videoInteractMode?: boolean
  /**
   * Called when a single tap is detected on the overlay in zoom mode. The
   * parent should switch to video-interact mode so the next tap reaches the
   * iframe.
   */
  onRequestVideoInteract?: () => void
  /** Emits true when the player starts playing, false when it pauses/ends. */
  onPlayerStateChange?: (isPlaying: boolean) => void
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

export const YouTubeViewer = forwardRef<YouTubePlayerHandle, YouTubeViewerProps>(function YouTubeViewer({
  videoId, grid, guideLines, guideVersion,
  overlayStrokes, overlayCurrentStrokeRef, onRegisterOverlayRedraw,
  onFitSize,
  guideMode, onAddGuideLine, highlightedGuideId, onHighlightGuide,
  viewTransform,
  isFitLeader = false,
  videoInteractMode = false,
  onRequestVideoInteract,
  onPlayerStateChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const rafRef = useRef(0)

  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [dragEnd, setDragEnd] = useState<Point | null>(null)

  const pinchRef = useRef<{
    id1: number
    id2: number
    lastDist: number
    lastMidX: number
    lastMidY: number
  } | null>(null)
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  // Cached at pinch start; reused each touchmove to avoid forcing a synchronous
  // layout at ~60fps.
  const pinchRectRef = useRef<DOMRect | null>(null)
  // Tracks a single-pointer session that might still qualify as a tap.
  const tapCandidateRef = useRef<{ time: number; x: number; y: number } | null>(null)

  useEffect(() => {
    onFitSize?.(LOGICAL_WIDTH, LOGICAL_HEIGHT)
  }, [onFitSize])

  // Resolves logical→container transform, falling back to a center-fit when
  // no shared ViewTransform is provided (kept in sync with applyPlacement's
  // fallback branch).
  const getViewTransformState = useCallback((containerRect: DOMRect): { scale: number; offsetX: number; offsetY: number } => {
    if (viewTransform) {
      const vt = viewTransform.get()
      return { scale: vt.scale, offsetX: vt.offsetX, offsetY: vt.offsetY }
    }
    const scale = Math.min(containerRect.width / LOGICAL_WIDTH, containerRect.height / LOGICAL_HEIGHT)
    return {
      scale,
      offsetX: (containerRect.width - LOGICAL_WIDTH * scale) / 2,
      offsetY: (containerRect.height - LOGICAL_HEIGHT * scale) / 2,
    }
  }, [viewTransform])

  const getLogicalPoint = useCallback((clientX: number, clientY: number): Point => {
    const container = containerRef.current
    if (!container) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    const { scale, offsetX, offsetY } = getViewTransformState(rect)
    if (scale === 0) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    }
  }, [getViewTransformState])

  /** Current screen pixels per logical unit; 0 if the container is not laid out yet.
   *  Callers divide screen-pixel thresholds (e.g. GUIDE_HIT_THRESHOLD_PX) by this
   *  to convert them into logical units. */
  const getLogicalScale = useCallback((): number => {
    const container = containerRef.current
    if (!container) return 0
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return 0
    return getViewTransformState(rect).scale
  }, [getViewTransformState])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(rect.width * dpr)
    const targetH = Math.round(rect.height * dpr)
    if (canvas.width !== targetW) canvas.width = targetW
    if (canvas.height !== targetH) canvas.height = targetH

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const { scale, offsetX, offsetY } = getViewTransformState(rect)
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY)

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
  }, [grid, guideLines, overlayStrokes, overlayCurrentStrokeRef, highlightedGuideId, dragStart, dragEnd, getViewTransformState])

  const requestRedraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      redraw()
    })
  }, [redraw])

  // Position the wrapper to match the shared ViewTransform (or a self-fit
  // center when not provided). Repaint the overlay canvas via rAF so bursts
  // of notify()s during pinch coalesce to one redraw per frame.
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
    requestRedraw()
  }, [requestRedraw, viewTransform])

  // When this viewer owns the initial fit, push it into the shared transform
  // so the other panel lines up. Subsequent resizes are intentionally not
  // re-fit — that would clobber a user-driven zoom.
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e: WheelEvent) => {
      if (videoInteractMode) return
      if (guideMode !== 'none') return
      // Suppress browser page-zoom even when there's no ViewTransform to
      // update — otherwise ctrl+wheel / trackpad pinch would fall through.
      e.preventDefault()
      if (!viewTransform) return
      const rect = canvas.getBoundingClientRect()
      const focalX = e.clientX - rect.left
      const focalY = e.clientY - rect.top
      if (e.ctrlKey) {
        const scaleDelta = 1 - e.deltaY * TRACKPAD_ZOOM_SPEED
        viewTransform.applyPinch(focalX, focalY, scaleDelta, 0, 0)
      } else {
        viewTransform.applyPinch(focalX, focalY, 1, -e.deltaX, -e.deltaY)
      }
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [videoInteractMode, guideMode, viewTransform])

  // Per-transition dedup of the player's frequent infoDelivery ticks. Reset
  // to null on video change (below) so the first state the new player reports
  // always emits — otherwise a match with the previous video's final state
  // would be suppressed and the toolbar icon would lag.
  const lastPlayingRef = useRef<boolean | null>(null)

  // IFrame API handshake: register as a listener once the player loads.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    lastPlayingRef.current = null
    const handleLoad = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: YT_EVENT_LISTENING, id: videoId, channel: 'widget' }),
        YOUTUBE_ORIGIN,
      )
    }
    iframe.addEventListener('load', handleLoad)
    return () => iframe.removeEventListener('load', handleLoad)
  }, [videoId])
  useEffect(() => {
    if (!onPlayerStateChange) return
    const emit = (next: boolean) => {
      if (lastPlayingRef.current === next) return
      lastPlayingRef.current = next
      onPlayerStateChange(next)
    }
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== YOUTUBE_ORIGIN) return
      if (e.source !== iframeRef.current?.contentWindow) return
      if (typeof e.data !== 'string') return
      let payload: unknown
      try {
        payload = JSON.parse(e.data)
      } catch {
        return
      }
      if (!payload || typeof payload !== 'object') return
      const data = payload as Record<string, unknown>
      if (data.event === YT_EVENT_INFO_DELIVERY && data.info && typeof data.info === 'object') {
        const state = (data.info as Record<string, unknown>).playerState
        if (typeof state === 'number') emit(state === YT_PLAYER_STATE_PLAYING)
      } else if (data.event === YT_EVENT_STATE_CHANGE && typeof data.info === 'number') {
        emit(data.info === YT_PLAYER_STATE_PLAYING)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onPlayerStateChange])

  useImperativeHandle(ref, () => ({
    play() {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: YT_EVENT_COMMAND, func: YT_CMD_PLAY, args: [] }),
        YOUTUBE_ORIGIN,
      )
    },
    pause() {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: YT_EVENT_COMMAND, func: YT_CMD_PAUSE, args: [] }),
        YOUTUBE_ORIGIN,
      )
    },
  }), [])

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

  const commitTapIfValid = useCallback(() => {
    const tap = tapCandidateRef.current
    tapCandidateRef.current = null
    if (!tap) return
    if (videoInteractMode) return
    if (guideMode !== 'none') return
    if (Date.now() - tap.time > TAP_MAX_DURATION_MS) return
    onRequestVideoInteract?.()
  }, [videoInteractMode, guideMode, onRequestVideoInteract])

  const maybeInvalidateTap = useCallback((clientX: number, clientY: number) => {
    const tap = tapCandidateRef.current
    if (!tap) return
    const dx = clientX - tap.x
    const dy = clientY - tap.y
    if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_MOVE_PX) {
      tapCandidateRef.current = null
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!videoInteractMode && guideMode === 'none') {
      tapCandidateRef.current = { time: Date.now(), x: e.clientX, y: e.clientY }
    }
    beginGuideInteraction(e.clientX, e.clientY)
  }, [videoInteractMode, guideMode, beginGuideInteraction])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    maybeInvalidateTap(e.clientX, e.clientY)
    updateGuideInteraction(e.clientX, e.clientY)
  }, [maybeInvalidateTap, updateGuideInteraction])

  const handleMouseUp = useCallback(() => {
    commitTapIfValid()
    endGuideInteraction()
  }, [commitTapIfValid, endGuideInteraction])

  const handleMouseLeave = useCallback(() => {
    tapCandidateRef.current = null
    endGuideInteraction()
  }, [endGuideInteraction])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    if (activeTouchesRef.current.size >= 2) {
      e.preventDefault()
      tapCandidateRef.current = null
      if (dragStart || dragEnd) {
        setDragStart(null)
        setDragEnd(null)
      }
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
      pinchRectRef.current = canvasRef.current!.getBoundingClientRect()
      return
    }

    const touch = e.changedTouches[0]
    if (!videoInteractMode && guideMode === 'none') {
      tapCandidateRef.current = { time: Date.now(), x: touch.clientX, y: touch.clientY }
    }

    if (guideMode === 'none') return
    e.preventDefault()
    beginGuideInteraction(touch.clientX, touch.clientY)
  }, [videoInteractMode, guideMode, beginGuideInteraction, dragStart, dragEnd])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      activeTouchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    if (pinchRef.current) {
      const t1 = activeTouchesRef.current.get(pinchRef.current.id1)
      const t2 = activeTouchesRef.current.get(pinchRef.current.id2)
      if (!t1 || !t2) return
      e.preventDefault()

      if (viewTransform) {
        const dx = t2.x - t1.x
        const dy = t2.y - t1.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const midX = (t1.x + t2.x) / 2
        const midY = (t1.y + t2.y) / 2

        const rect = pinchRectRef.current!
        const focalX = midX - rect.left
        const focalY = midY - rect.top

        const scaleDelta = dist / pinchRef.current.lastDist
        const translateX = midX - pinchRef.current.lastMidX
        const translateY = midY - pinchRef.current.lastMidY

        viewTransform.applyPinch(focalX, focalY, scaleDelta, translateX, translateY)

        pinchRef.current.lastDist = dist
        pinchRef.current.lastMidX = midX
        pinchRef.current.lastMidY = midY
      }
      return
    }

    const touch = e.changedTouches[0]
    maybeInvalidateTap(touch.clientX, touch.clientY)

    if (guideMode !== 'add' || !dragStart) return
    e.preventDefault()
    updateGuideInteraction(touch.clientX, touch.clientY)
  }, [viewTransform, guideMode, dragStart, maybeInvalidateTap, updateGuideInteraction])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      activeTouchesRef.current.delete(e.changedTouches[i].identifier)
    }

    if (pinchRef.current) {
      if (!activeTouchesRef.current.has(pinchRef.current.id1) ||
          !activeTouchesRef.current.has(pinchRef.current.id2)) {
        pinchRef.current = null
        pinchRectRef.current = null
      }
      tapCandidateRef.current = null
      e.preventDefault()
      return
    }

    commitTapIfValid()

    if (guideMode !== 'add') return
    e.preventDefault()
    endGuideInteraction()
  }, [commitTapIfValid, guideMode, endGuideInteraction])

  const handleTouchCancel = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      activeTouchesRef.current.delete(e.changedTouches[i].identifier)
    }
    tapCandidateRef.current = null
    if (pinchRef.current) {
      pinchRef.current = null
      pinchRectRef.current = null
    }
    if (guideMode === 'add' && (dragStart || dragEnd)) {
      setDragStart(null)
      setDragEnd(null)
    }
  }, [guideMode, dragStart, dragEnd])

  const overlayActive = !videoInteractMode
  const cursor =
    guideMode === 'add' ? 'crosshair' :
    guideMode === 'delete' ? 'pointer' :
    overlayActive ? 'zoom-in' :
    'default'

  return (
    <Box ref={containerRef} sx={{ position: 'absolute', inset: 0, bgcolor: '#000', overflow: 'hidden' }}>
      <Box ref={wrapperRef} sx={{ position: 'absolute' }}>
        <iframe
          ref={iframeRef}
          key={videoId}
          src={buildYouTubeEmbedUrl(videoId)}
          title="YouTube reference"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </Box>
      {/* Spans the whole container — not just the 16:9 player — so pinch/
          wheel over the letterbox doesn't fall through to browser page zoom. */}
      <canvas
        ref={canvasRef}
        onMouseDown={overlayActive ? handleMouseDown : undefined}
        onMouseMove={overlayActive ? handleMouseMove : undefined}
        onMouseUp={overlayActive ? handleMouseUp : undefined}
        onMouseLeave={overlayActive ? handleMouseLeave : undefined}
        onTouchStart={overlayActive ? handleTouchStart : undefined}
        onTouchMove={overlayActive ? handleTouchMove : undefined}
        onTouchEnd={overlayActive ? handleTouchEnd : undefined}
        onTouchCancel={overlayActive ? handleTouchCancel : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: overlayActive ? 'auto' : 'none',
          touchAction: overlayActive ? 'none' : 'auto',
          cursor,
        }}
      />
    </Box>
  )
})
