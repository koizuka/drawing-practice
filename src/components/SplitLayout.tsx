import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import { Box } from '@mui/material'
import { useOrientation } from '../hooks/useOrientation'
import { useTimer } from '../hooks/useTimer'
import { useAutosave } from '../hooks/useAutosave'
import { GuideProvider } from '../guides/GuideContext'
import { useGuides } from '../guides/useGuides'
import { ReferencePanel } from './ReferencePanel'
import { DrawingPanel } from './DrawingPanel'
import { StrokeManager } from '../drawing/StrokeManager'
import { loadDraft } from '../storage/sessionStore'
import { cleanupStalePrDatabases } from '../storage/db'
import type { Stroke } from '../drawing/types'
import type { ReferenceInfo } from './SketchfabViewer'
import type { ReferenceSource, ReferenceMode } from '../types'

/** Wraps a setState so it also bumps the change-version counter. */
function useTrackedSetter<T>(
  setter: Dispatch<SetStateAction<T>>,
  bump: () => void,
): (value: T) => void {
  return useCallback((value: T) => { setter(value); bump() }, [setter, bump])
}

function SplitLayoutInner() {
  const orientation = useOrientation()
  const isLandscape = orientation === 'landscape'
  const [overlayStrokes, setOverlayStrokes] = useState<readonly Stroke[] | null>(null)
  const [overlayActive, setOverlayActive] = useState(false)
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
  const incrementChangeVersion = useCallback(() => {
    setChangeVersion(v => v + 1)
  }, [])

  // Suppress autosave during restore
  const suppressAutosaveRef = useRef(true)

  // Tracked setters: setState + incrementChangeVersion in one call
  const handleSourceChange = useTrackedSetter(setSource, incrementChangeVersion)
  const handleReferenceModeChange = useTrackedSetter(setReferenceMode, incrementChangeVersion)
  const handleFixedImageUrlChange = useTrackedSetter(setFixedImageUrl, incrementChangeVersion)
  const handleLocalImageUrlChange = useTrackedSetter(setLocalImageUrl, incrementChangeVersion)

  const handleReferenceInfoChange = useCallback((info: ReferenceInfo | null) => {
    setReferenceInfo(info)
    incrementChangeVersion()
  }, [incrementChangeVersion])

  const handleReferenceImageSize = useCallback((width: number, height: number) => {
    setReferenceSize({ width, height })
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
  }, [])

  const handleStrokesChanged = useCallback(() => {
    if (overlayActive && strokeManagerRef.current) {
      setOverlayStrokes([...strokeManagerRef.current.getStrokes()])
    }
    incrementChangeVersion()
  }, [overlayActive, incrementChangeVersion])

  const handleRegisterLoadSketchfabModel = useCallback((fn: (uid: string) => void) => {
    loadSketchfabModelFnRef.current = fn
  }, [])

  // Gallery "load reference" handler
  const handleLoadReference = useCallback((info: ReferenceInfo) => {
    if (info.source === 'sketchfab' && info.sketchfabUid) {
      setSource('sketchfab')
      setReferenceMode('browse')
      setFixedImageUrl(null)
      setReferenceInfo(null)
      loadSketchfabModelFnRef.current?.(info.sketchfabUid)
    } else if (info.source === 'url' && info.imageUrl) {
      setSource('url')
      setReferenceMode('fixed')
      setFixedImageUrl(info.imageUrl)
      setReferenceInfo(info)
    }
    incrementChangeVersion()
  }, [incrementChangeVersion])

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

  // Restore draft on mount and clean up stale PR databases
  useEffect(() => {
    cleanupStalePrDatabases()

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
        }
      }

      suppressAutosaveRef.current = false
      setRestoreVersion(v => v + 1)
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isLandscape ? 'row' : 'column',
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <ReferencePanel
          overlayStrokes={overlayStrokes}
          onReferenceImageSize={handleReferenceImageSize}
          overlayActive={overlayActive}
          onToggleOverlay={handleToggleOverlay}
          onReferenceInfoChange={handleReferenceInfoChange}
          source={source}
          onSourceChange={handleSourceChange}
          referenceMode={referenceMode}
          onReferenceModeChange={handleReferenceModeChange}
          fixedImageUrl={fixedImageUrl}
          onFixedImageUrlChange={handleFixedImageUrlChange}
          localImageUrl={localImageUrl}
          onLocalImageUrlChange={handleLocalImageUrlChange}
          refInfo={referenceInfo}
          onRegisterLoadSketchfabModel={handleRegisterLoadSketchfabModel}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <DrawingPanel
          referenceSize={referenceSize}
          referenceInfo={referenceInfo}
          onStrokeManagerReady={handleStrokeManagerReady}
          onStrokesChanged={handleStrokesChanged}
          onOverlayClear={() => { setOverlayActive(false); setOverlayStrokes(null) }}
          onLoadReference={handleLoadReference}
          timer={timer}
          restoreVersion={restoreVersion}
        />
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
