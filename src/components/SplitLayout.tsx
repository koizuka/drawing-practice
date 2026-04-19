import { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Alert } from '@mui/material'
import { useOrientation } from '../hooks/useOrientation'
import { useTimer } from '../hooks/useTimer'
import { useAutosave } from '../hooks/useAutosave'
import { useSessionLock } from '../hooks/useSessionLock'
import { GuideProvider } from '../guides/GuideContext'
import { useGuides } from '../guides/useGuides'
import { ReferencePanel, type ReferenceSetters } from './ReferencePanel'
import { DrawingPanel } from './DrawingPanel'
import { StrokeManager } from '../drawing/StrokeManager'
import { loadDraft } from '../storage/sessionStore'
import { cleanupStalePrDatabases } from '../storage/db'
import { t } from '../i18n'
import type { Stroke, ReferenceSnapshot } from '../drawing/types'
import type { ReferenceInfo } from './SketchfabViewer'
import type { ReferenceSource, ReferenceMode } from '../types'

function SplitLayoutInner() {
  const hasSessionLock = useSessionLock()
  const orientation = useOrientation()
  const isLandscape = orientation === 'landscape'
  const [overlayStrokes, setOverlayStrokes] = useState<readonly Stroke[] | null>(null)
  const [overlayActive, setOverlayActive] = useState(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const overlayRedrawFnRef = useRef<(() => void) | null>(null)
  const [isFlipped, setIsFlipped] = useState(false)
  const [referenceSize, setReferenceSize] = useState<{ width: number; height: number } | null>(null)
  const [referenceInfo, setReferenceInfo] = useState<ReferenceInfo | null>(null)
  const strokeManagerRef = useRef<StrokeManager | null>(null)

  // Lifted state from ReferencePanel
  const [source, setSource] = useState<ReferenceSource>('none')
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse')
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null)
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null)

  // Timer (lifted from DrawingPanel for autosave access)
  const timer = useTimer()
  const timerElapsedRef = useRef(timer.elapsedMs)
  timerElapsedRef.current = timer.elapsedMs

  // Guide state (from context)
  const { grid, lines, version: guideVersion, restoreGuides } = useGuides()

  // Ref for loading Sketchfab model by UID (registered by ReferencePanel)
  const loadSketchfabModelFnRef = useRef<((uid: string) => void) | null>(null)

  // Change version counter for autosave debouncing
  const [changeVersion, setChangeVersion] = useState(0)
  // Restore version to notify DrawingPanel after draft restore
  const [restoreVersion, setRestoreVersion] = useState(0)
  // History sync version: incremented when the StrokeManager's undo/redo
  // stacks change outside DrawingPanel (e.g. SplitLayout records a reference
  // change). DrawingPanel listens to this to refresh its canUndo/canRedo UI.
  const [historySyncVersion, setHistorySyncVersion] = useState(0)
  const incrementChangeVersion = useCallback(() => {
    setChangeVersion(v => v + 1)
  }, [])

  // Pause timer whenever the reference changes — the timer should only advance
  // during active drawing. The next stroke will resume it via handleStrokeCountChange.
  const pauseAndIncrementVersion = useCallback(() => {
    timer.pause()
    setChangeVersion(v => v + 1)
  }, [timer])

  // Suppress autosave during restore or when another tab holds the lock
  const suppressAutosaveRef = useRef(true)
  useEffect(() => {
    if (!hasSessionLock) {
      suppressAutosaveRef.current = true
    }
  }, [hasSessionLock])

  // Keep a ref to the latest reference state so `captureReferenceSnapshot` can
  // remain a stable callback (prevents unnecessary child re-renders).
  const referenceStateRef = useRef({ source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo })
  referenceStateRef.current = { source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo }

  const captureReferenceSnapshot = useCallback((): ReferenceSnapshot => ({
    ...referenceStateRef.current,
  }), [])

  // Restorer invoked by StrokeManager when undo/redo pops a reference entry.
  // Keep it on a ref so we can register a stable callback with StrokeManager.
  const applyReferenceSnapshotRef = useRef<(snap: ReferenceSnapshot) => void>(() => {})
  applyReferenceSnapshotRef.current = (snap: ReferenceSnapshot) => {
    setSource(snap.source)
    setReferenceMode(snap.referenceMode)
    setFixedImageUrl(snap.fixedImageUrl)
    setLocalImageUrl(snap.localImageUrl)
    setReferenceInfo(snap.referenceInfo)
    pauseAndIncrementVersion()
  }

  /**
   * Record the current reference state as an undoable entry, then apply the
   * mutation. Used for all user-initiated reference changes (Fix Angle, image
   * swap, Close, Gallery load). Routing every mutation through this helper
   * ensures individual setter calls can't bypass history recording.
   */
  const changeReference = useCallback((mutate: (setters: ReferenceSetters) => void) => {
    const prev = captureReferenceSnapshot()
    strokeManagerRef.current?.recordReferenceChange(prev)
    mutate({
      setSource,
      setReferenceMode,
      setFixedImageUrl,
      setLocalImageUrl,
      setReferenceInfo,
    })
    pauseAndIncrementVersion()
    setHistorySyncVersion(v => v + 1)
  }, [captureReferenceSnapshot, pauseAndIncrementVersion])

  /**
   * Error-path reset. NOT recorded as an undoable entry — undoing back to a
   * broken reference (e.g. a URL that failed to load) would just trigger the
   * same error again. Pauses the timer like every other reference-change path
   * so time doesn't keep ticking after the reference silently reverts.
   */
  const resetReferenceOnError = useCallback(() => {
    setSource('none')
    setReferenceMode('browse')
    setFixedImageUrl(null)
    setLocalImageUrl(null)
    setReferenceInfo(null)
    pauseAndIncrementVersion()
  }, [pauseAndIncrementVersion])

  const handleReferenceImageSize = useCallback((width: number, height: number) => {
    setReferenceSize({ width, height })
  }, [])

  const handleToggleFlip = useCallback(() => {
    setIsFlipped(prev => !prev)
  }, [])

  const handleToggleOverlay = useCallback(() => {
    setOverlayActive(prev => {
      const next = !prev
      if (next && strokeManagerRef.current) {
        setOverlayStrokes([...strokeManagerRef.current.getStrokes()])
      } else {
        setOverlayStrokes(null)
      }
      return next
    })
  }, [])

  const handleStrokeManagerReady = useCallback((sm: StrokeManager) => {
    strokeManagerRef.current = sm
    // Register a stable restorer that always reads the latest closure via ref
    sm.setReferenceRestorer(snap => applyReferenceSnapshotRef.current(snap))
  }, [])

  const handleStrokesChanged = useCallback(() => {
    if (overlayActive && strokeManagerRef.current) {
      setOverlayStrokes([...strokeManagerRef.current.getStrokes()])
    }
    incrementChangeVersion()
  }, [overlayActive, incrementChangeVersion])

  const handleCurrentStrokeChange = useCallback((stroke: Stroke | null) => {
    currentStrokeRef.current = stroke
    if (overlayActive) {
      overlayRedrawFnRef.current?.()
    }
  }, [overlayActive])

  const handleRegisterOverlayRedraw = useCallback((fn: () => void) => {
    overlayRedrawFnRef.current = fn
  }, [])

  const handleRegisterLoadSketchfabModel = useCallback((fn: (uid: string) => void) => {
    loadSketchfabModelFnRef.current = fn
  }, [])

  // Gallery "load reference" handler — routed through changeReference so the
  // user can undo back to the previously-loaded reference.
  const handleLoadReference = useCallback((info: ReferenceInfo) => {
    changeReference(s => {
      if (info.source === 'sketchfab' && info.sketchfabUid) {
        s.setSource('sketchfab')
        s.setReferenceMode('browse')
        s.setFixedImageUrl(null)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(null)
        loadSketchfabModelFnRef.current?.(info.sketchfabUid)
      } else if (info.source === 'url' && info.imageUrl) {
        s.setSource('url')
        s.setReferenceMode('fixed')
        s.setFixedImageUrl(info.imageUrl)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
      } else if (info.source === 'youtube' && info.youtubeVideoId) {
        s.setSource('youtube')
        s.setReferenceMode('browse')
        s.setFixedImageUrl(null)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
      } else if (info.source === 'pexels' && info.pexelsImageUrl) {
        s.setSource('pexels')
        s.setReferenceMode('fixed')
        s.setFixedImageUrl(info.pexelsImageUrl)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
      }
    })
  }, [changeReference])

  // Autosave: read timer.elapsedMs via ref to avoid recreating this callback every frame
  const getAutosaveState = useCallback(() => ({
    strokes: strokeManagerRef.current?.getStrokes() ?? [],
    redoStack: strokeManagerRef.current?.getRedoStack() ?? [],
    elapsedMs: timerElapsedRef.current,
    source,
    referenceInfo,
    referenceImageData: (source === 'image' && localImageUrl) ? localImageUrl
      : (source === 'sketchfab' && fixedImageUrl) ? fixedImageUrl
      : null,
    grid,
    lines,
  }), [source, referenceInfo, localImageUrl, fixedImageUrl, grid, lines])

  useAutosave(getAutosaveState, changeVersion, suppressAutosaveRef)

  // Trigger autosave when guide state changes
  useEffect(() => {
    if (guideVersion > 0) {
      incrementChangeVersion()
    }
  }, [guideVersion, incrementChangeVersion])

  // Clean up stale PR databases on mount
  useEffect(() => {
    cleanupStalePrDatabases()
  }, [])

  // Restore draft when session lock is acquired
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!hasSessionLock || restoredRef.current) return
    restoredRef.current = true

    let cancelled = false
    loadDraft().then(draft => {
      if (cancelled || !draft) {
        suppressAutosaveRef.current = false
        return
      }

      // Restore strokes
      if (strokeManagerRef.current && (draft.strokes.length > 0 || draft.redoStack.length > 0)) {
        strokeManagerRef.current.loadState(draft.strokes, draft.redoStack)
      }

      // Restore timer
      if (draft.elapsedMs > 0) {
        timer.restore(draft.elapsedMs)
      }

      // Restore guides
      if (draft.guideState) {
        restoreGuides(draft.guideState)
      }

      // Restore reference state
      if (draft.source !== 'none') {
        setSource(draft.source)
        setReferenceInfo(draft.referenceInfo)

        if (draft.source === 'image' && draft.referenceImageData) {
          setLocalImageUrl(draft.referenceImageData)
          setReferenceMode('fixed')
        } else if (draft.source === 'sketchfab' && draft.referenceImageData) {
          setFixedImageUrl(draft.referenceImageData)
          setReferenceMode('fixed')
        } else if (draft.source === 'url' && draft.referenceInfo?.imageUrl) {
          setFixedImageUrl(draft.referenceInfo.imageUrl)
          setReferenceMode('fixed')
        } else if (draft.source === 'youtube' && draft.referenceInfo?.youtubeVideoId) {
          setReferenceMode('browse')
        } else if (draft.source === 'pexels' && draft.referenceInfo?.pexelsImageUrl) {
          setFixedImageUrl(draft.referenceInfo.pexelsImageUrl)
          setReferenceMode('fixed')
        }
      }

      suppressAutosaveRef.current = false
      setRestoreVersion(v => v + 1)
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSessionLock])

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      {!hasSessionLock && (
        <Alert severity="warning" sx={{ py: 0, borderRadius: 0, flexShrink: 0 }}>
          {t('autosaveDisabled')}
        </Alert>
      )}
      <Box sx={{ display: 'flex', flexDirection: isLandscape ? 'row' : 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <ReferencePanel
          overlayStrokes={overlayStrokes}
          overlayCurrentStrokeRef={currentStrokeRef}
          onRegisterOverlayRedraw={handleRegisterOverlayRedraw}
          onReferenceImageSize={handleReferenceImageSize}
          overlayActive={overlayActive}
          onToggleOverlay={handleToggleOverlay}
          source={source}
          referenceMode={referenceMode}
          fixedImageUrl={fixedImageUrl}
          localImageUrl={localImageUrl}
          refInfo={referenceInfo}
          onReferenceChange={changeReference}
          onReferenceResetOnError={resetReferenceOnError}
          onRegisterLoadSketchfabModel={handleRegisterLoadSketchfabModel}
          isFlipped={isFlipped}
          onToggleFlip={handleToggleFlip}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <DrawingPanel
          referenceSize={referenceSize}
          referenceInfo={referenceInfo}
          onStrokeManagerReady={handleStrokeManagerReady}
          onStrokesChanged={handleStrokesChanged}
          onCurrentStrokeChange={handleCurrentStrokeChange}
          onOverlayClear={() => { setOverlayActive(false); setOverlayStrokes(null) }}
          onLoadReference={handleLoadReference}
          captureReferenceSnapshot={captureReferenceSnapshot}
          timer={timer}
          restoreVersion={restoreVersion}
          historySyncVersion={historySyncVersion}
          isFlipped={isFlipped}
        />
      </Box>
      </Box>
    </Box>
  )
}

export function SplitLayout() {
  return (
    <GuideProvider>
      <SplitLayoutInner />
    </GuideProvider>
  )
}
