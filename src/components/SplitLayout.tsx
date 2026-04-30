import { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Alert, Snackbar } from '@mui/material'
import { useOrientation } from '../hooks/useOrientation'
import { useTimer } from '../hooks/useTimer'
import { useAutosave } from '../hooks/useAutosave'
import { useSessionLock } from '../hooks/useSessionLock'
import { GuideProvider } from '../guides/GuideContext'
import { useGuides } from '../guides/useGuides'
import { ReferencePanel, type ReferenceSetters } from './ReferencePanel'
import { DrawingPanel } from './DrawingPanel'
import { StrokeManager } from '../drawing/StrokeManager'
import { ViewTransform } from '../drawing/ViewTransform'
import { loadDraft } from '../storage/sessionStore'
import { cleanupStalePrDatabases } from '../storage/db'
import { addUrlHistory, getUrlHistoryEntry } from '../storage/urlHistoryStore'
import { buildYouTubeCanonicalUrl } from '../utils/youtube'
import { canonicalSketchfabUrl } from '../utils/sketchfab'
import { dataUrlToJpegBlob } from '../utils/imageResize'
import type { SketchfabModelMeta } from './SketchfabViewer'
import { t } from '../i18n'
import type { Stroke, ReferenceSnapshot } from '../drawing/types'
import type { ReferenceInfo, ReferenceSource, ReferenceMode } from '../types'

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
  const [toast, setToast] = useState<string | null>(null)
  const strokeManagerRef = useRef<StrokeManager | null>(null)

  // Shared ViewTransform instance for zoom/pan sync between ReferencePanel and DrawingPanel.
  // useState's lazy initializer ensures only one instance is constructed for the lifetime
  // of the component (useRef(new ViewTransform()) re-evaluates `new` every render).
  const [viewTransform] = useState(() => new ViewTransform())

  // Lifted state from ReferencePanel
  const [source, setSource] = useState<ReferenceSource>('none')
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse')
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null)
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null)
  // Whether the Sketchfab 3D viewer iframe is currently mounted. While true,
  // the reference panel must stay at half-screen so the preview matches the
  // aspect ratio that "Fix This Angle" will capture.
  // SketchfabViewer is unmounted when source leaves 'sketchfab' and its unmount
  // cannot push a "showViewer:false" notification, so reset on source change
  // (via prev-state-in-render) to avoid a stale-active flicker on reopen.
  const [sketchfabViewerActive, setSketchfabViewerActive] = useState(false)
  const [sfActiveTrackedSource, setSfActiveTrackedSource] = useState(source)
  if (sfActiveTrackedSource !== source) {
    setSfActiveTrackedSource(source)
    if (source !== 'sketchfab' && sketchfabViewerActive) {
      setSketchfabViewerActive(false)
    }
  }

  // The reference side can drive the fit when a fit-capable viewer is rendering
  // (ImageViewer for fixed-image sources, or YouTubeViewer which maps its iframe
  // to the shared ViewTransform). Otherwise (Sketchfab browse / no reference) the
  // drawing canvas leads.
  const fitLeader: 'reference' | 'drawing' =
    source === 'youtube' ||
    (referenceMode === 'fixed' && (source === 'image' || source === 'url' || source === 'pexels' || source === 'sketchfab'))
      ? 'reference'
      : 'drawing'

  // In portrait the split is top/bottom and the reference panel only gets
  // half the height. While searching Sketchfab/Pexels (browse mode), give the
  // reference panel the whole viewport so the result grid is browsable. The
  // drawing panel is hidden via display:none rather than unmounted so its
  // canvas/ViewTransform state survives the toggle.
  // Sketchfab's browse mode covers two screens (search results and the 3D
  // viewer iframe); only the search-results screen should go fullscreen — the
  // 3D viewer must stay half-height so the captured screenshot matches the
  // visible camera framing.
  const isSearchFullscreen =
    !isLandscape &&
    referenceMode === 'browse' &&
    (
      (source === 'sketchfab' && !sketchfabViewerActive) ||
      source === 'pexels'
    )

  // Timer (lifted from DrawingPanel for autosave access)
  const timer = useTimer()
  const timerElapsedRef = useRef(timer.elapsedMs)
  useEffect(() => {
    timerElapsedRef.current = timer.elapsedMs
  })

  // Guide state (from context)
  const { grid, lines, version: guideVersion, restoreGuides } = useGuides()

  // Ref for loading Sketchfab model by UID (registered by ReferencePanel)
  const loadSketchfabModelFnRef = useRef<((uid: string, meta?: SketchfabModelMeta) => void) | null>(null)
  // Ref for refreshing the URL history dropdown after parent-initiated adds
  // (e.g. Gallery "use this reference" reload).
  const reloadUrlHistoryFnRef = useRef<(() => void) | null>(null)

  // Change version counter for autosave debouncing
  const [changeVersion, setChangeVersion] = useState(0)
  // Flush version: bumped on reference changes to bypass the 2s debounce and
  // persist the draft synchronously (so a fast reload after a reference swap
  // doesn't restore the previous reference).
  const [flushVersion, setFlushVersion] = useState(0)
  // Restore version to notify DrawingPanel after draft restore
  const [restoreVersion, setRestoreVersion] = useState(0)
  // Explicit refit trigger on rotation — ResizeObservers don't auto-refit so
  // user zoom survives incidental resizes, but rotation flips the layout hard
  // enough that a refit is still wanted.
  const [orientationResetVersion, setOrientationResetVersion] = useState(0)
  const prevOrientationRef = useRef(orientation)
  useEffect(() => {
    if (prevOrientationRef.current !== orientation) {
      prevOrientationRef.current = orientation
      setOrientationResetVersion(v => v + 1)
    }
  }, [orientation])
  // History sync version: incremented when the StrokeManager's undo/redo
  // stacks change outside DrawingPanel (e.g. SplitLayout records a reference
  // change). DrawingPanel listens to this to refresh its canUndo/canRedo UI.
  const [historySyncVersion, setHistorySyncVersion] = useState(0)
  const incrementChangeVersion = useCallback(() => {
    setChangeVersion(v => v + 1)
  }, [])

  const incrementFlushVersion = useCallback(() => {
    setFlushVersion(v => v + 1)
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
  useEffect(() => {
    referenceStateRef.current = { source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo }
  })

  const captureReferenceSnapshot = useCallback((): ReferenceSnapshot => ({
    ...referenceStateRef.current,
  }), [])

  // Restorer invoked by StrokeManager when undo/redo pops a reference entry.
  // Keep it on a ref so we can register a stable callback with StrokeManager.
  const applyReferenceSnapshotRef = useRef<(snap: ReferenceSnapshot) => void>(() => {})
  useEffect(() => {
    applyReferenceSnapshotRef.current = (snap: ReferenceSnapshot) => {
      setSource(snap.source)
      setReferenceMode(snap.referenceMode)
      setFixedImageUrl(snap.fixedImageUrl)
      setLocalImageUrl(snap.localImageUrl)
      setReferenceInfo(snap.referenceInfo)
      pauseAndIncrementVersion()
      incrementFlushVersion()
    }
  })

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
    incrementFlushVersion()
  }, [captureReferenceSnapshot, pauseAndIncrementVersion, incrementFlushVersion])

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
    incrementFlushVersion()
  }, [pauseAndIncrementVersion, incrementFlushVersion])

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

  const handleRegisterLoadSketchfabModel = useCallback((fn: (uid: string, meta?: SketchfabModelMeta) => void) => {
    loadSketchfabModelFnRef.current = fn
  }, [])

  const handleRegisterReloadUrlHistory = useCallback((fn: () => void) => {
    reloadUrlHistoryFnRef.current = fn
  }, [])

  // Gallery "load reference" handler — routed through changeReference so the
  // user can undo back to the previously-loaded reference. URL-representable
  // sources (url / youtube / pexels) are also recorded into the URL history
  // dropdown so reopening from the gallery surfaces them next to URL-pasted
  // entries. Sketchfab is UID-based so it's added directly. Local-file images
  // resolve their Blob from URL history (keyed by content hash) and apply it
  // as a data URL so autosave/restore continues to work.
  const handleLoadReference = useCallback((info: ReferenceInfo) => {
    if (info.source === 'image' && info.url) {
      // Async lookup — the button was only enabled because info.url exists at
      // gallery render time, but the URL-history entry may have been evicted
      // since then. Surface a toast so the user understands why nothing loaded.
      void (async () => {
        const historyKey = info.url
        if (!historyKey) return
        const entry = await getUrlHistoryEntry(historyKey).catch(() => undefined)
        if (!entry?.imageBlob) {
          setToast(t('imageReferenceEvicted'))
          return
        }
        const dataUrl = await new Promise<string | null>(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(entry.imageBlob as Blob)
        })
        if (!dataUrl) {
          setToast(t('imageReferenceEvicted'))
          return
        }
        changeReference(s => {
          s.setSource('image')
          s.setReferenceMode('fixed')
          s.setFixedImageUrl(null)
          s.setLocalImageUrl(dataUrl)
          s.setReferenceInfo(info)
        })
        // Upsert with the Blob we already loaded so the call is self-
        // contained: no redundant DB read, and an evicted row between reads
        // can't recreate a blobless entry.
        await addUrlHistory(historyKey, 'image', {
          fileName: entry.fileName ?? info.fileName,
          imageBlob: entry.imageBlob,
        })
        reloadUrlHistoryFnRef.current?.()
      })()
      return
    }

    changeReference(s => {
      if (info.source === 'sketchfab' && info.sketchfabUid) {
        s.setSource('sketchfab')
        s.setLocalImageUrl(null)
        if (info.imageUrl) {
          // The Sketchfab iframe stays mounted in fixed mode (display:none),
          // so loadSketchfabModelFnRef below still readies "Change angle".
          s.setReferenceMode('fixed')
          s.setFixedImageUrl(info.imageUrl)
          s.setReferenceInfo(info)
        } else {
          s.setReferenceMode('browse')
          s.setFixedImageUrl(null)
          s.setReferenceInfo(null)
        }
        // Pass title/author to the viewer so Fix Angle from "Change angle"
        // produces a non-empty ReferenceInfo even on legacy records.
        const sfMeta: SketchfabModelMeta | undefined = (info.title || info.author)
          ? { name: info.title, author: info.author }
          : undefined
        loadSketchfabModelFnRef.current?.(info.sketchfabUid, sfMeta)
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

    let historyAdd: Promise<void> | null = null
    if (info.source === 'url' && info.imageUrl) {
      historyAdd = addUrlHistory(info.imageUrl, 'url', info.title)
    } else if (info.source === 'youtube' && info.youtubeVideoId) {
      historyAdd = addUrlHistory(buildYouTubeCanonicalUrl(info.youtubeVideoId), 'youtube', info.title)
    } else if (info.source === 'pexels' && info.pexelsPageUrl) {
      historyAdd = addUrlHistory(info.pexelsPageUrl, 'pexels', info.title)
    } else if (info.source === 'sketchfab' && info.sketchfabUid) {
      // Bump lastUsedAt so reopening the same Sketchfab reference from the
      // gallery surfaces it at the top of the URL-history dropdown. If the
      // gallery record has a screenshot, convert it to a Blob and persist
      // — this lets a later URL-history selection restore directly into
      // fixed mode (matching the gallery "Use this reference" UX) even for
      // entries that were never opened via Fix Angle in this device's
      // history.
      const sketchfabKey = canonicalSketchfabUrl(info.sketchfabUid)
      const galleryImageUrl = info.imageUrl
      historyAdd = (galleryImageUrl
        ? dataUrlToJpegBlob(galleryImageUrl).then(blob => addUrlHistory(
            sketchfabKey,
            'sketchfab',
            { title: info.title, ...(blob ? { imageBlob: blob } : {}) },
          ))
        : addUrlHistory(sketchfabKey, 'sketchfab', info.title)
      )
    }
    if (historyAdd) {
      historyAdd.then(() => reloadUrlHistoryFnRef.current?.()).catch(() => { /* ignore */ })
    }
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

  useAutosave(getAutosaveState, changeVersion, flushVersion, suppressAutosaveRef)

  // Trigger autosave when guide state changes. Use the render-time prev-prop
  // pattern instead of an effect so we don't violate react-hooks/set-state-in-effect.
  const [prevGuideVersion, setPrevGuideVersion] = useState(guideVersion)
  if (prevGuideVersion !== guideVersion) {
    setPrevGuideVersion(guideVersion)
    if (guideVersion > 0) {
      incrementChangeVersion()
    }
  }

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

        const info = draft.referenceInfo
        if (draft.source === 'image' && draft.referenceImageData) {
          setLocalImageUrl(draft.referenceImageData)
          setReferenceMode('fixed')
        } else if (draft.source === 'sketchfab' && draft.referenceImageData) {
          setFixedImageUrl(draft.referenceImageData)
          setReferenceMode('fixed')
        } else if (info?.source === 'url') {
          setFixedImageUrl(info.imageUrl)
          setReferenceMode('fixed')
        } else if (info?.source === 'youtube') {
          setReferenceMode('browse')
        } else if (info?.source === 'pexels') {
          setFixedImageUrl(info.pexelsImageUrl)
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
          onRegisterReloadUrlHistory={handleRegisterReloadUrlHistory}
          onSketchfabViewerStateChange={setSketchfabViewerActive}
          isFlipped={isFlipped}
          onToggleFlip={handleToggleFlip}
          viewTransform={viewTransform}
          fitLeader={fitLeader}
          externalResetVersion={orientationResetVersion}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: isSearchFullscreen ? 'none' : 'block' }}>
        <DrawingPanel
          referenceSize={referenceSize}
          referenceInfo={referenceInfo}
          onStrokeManagerReady={handleStrokeManagerReady}
          onStrokesChanged={handleStrokesChanged}
          onCurrentStrokeChange={handleCurrentStrokeChange}
          onOverlayClear={() => { setOverlayStrokes(null) }}
          onLoadReference={handleLoadReference}
          captureReferenceSnapshot={captureReferenceSnapshot}
          timer={timer}
          restoreVersion={restoreVersion}
          historySyncVersion={historySyncVersion}
          isFlipped={isFlipped}
          viewTransform={viewTransform}
          fitLeader={fitLeader}
          externalResetVersion={orientationResetVersion}
        />
      </Box>
      </Box>
      <Snackbar
        open={toast !== null}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setToast(null)} sx={{ width: '100%' }}>
          {toast}
        </Alert>
      </Snackbar>
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
