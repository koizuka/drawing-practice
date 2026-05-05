import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Alert, Snackbar } from '@mui/material';
import { useOrientation } from '../hooks/useOrientation';
import { useTimer } from '../hooks/useTimer';
import { useAutosave } from '../hooks/useAutosave';
import { useSessionLock } from '../hooks/useSessionLock';
import { GuideProvider } from '../guides/GuideContext';
import { useGuides } from '../guides/useGuides';
import { ReferencePanel, type ReferenceSetters } from './ReferencePanel';
import { DrawingPanel } from './DrawingPanel';
import { StrokeManager } from '../drawing/StrokeManager';
import { ViewTransform } from '../drawing/ViewTransform';
import { loadDraft } from '../storage/sessionStore';
import { cleanupStalePrDatabases, COORD_VERSION_CURRENT } from '../storage/db';
import { shiftStrokes, shiftGuideState } from '../storage/coordMigration';
import { addUrlHistory, getUrlHistoryEntry } from '../storage/urlHistoryStore';
import { buildYouTubeCanonicalUrl } from '../utils/youtube';
import { canonicalSketchfabUrl } from '../utils/sketchfab';
import { dataUrlToJpegBlob } from '../utils/imageResize';
import type { SketchfabModelMeta } from './SketchfabViewer';
import { t } from '../i18n';
import type { Stroke, ReferenceSnapshot } from '../drawing/types';
import type { GuideState } from '../guides/types';
import type { ReferenceInfo, ReferenceSource, ReferenceMode } from '../types';

function SplitLayoutInner() {
  const hasSessionLock = useSessionLock();
  const orientation = useOrientation();
  const isLandscape = orientation === 'landscape';
  const [overlayStrokes, setOverlayStrokes] = useState<readonly Stroke[] | null>(null);
  const [overlayActive, setOverlayActive] = useState(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const overlayRedrawFnRef = useRef<(() => void) | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [referenceSize, setReferenceSize] = useState<{ width: number; height: number } | null>(null);
  const [referenceInfo, setReferenceInfo] = useState<ReferenceInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const strokeManagerRef = useRef<StrokeManager | null>(null);

  // Shared ViewTransform instance for zoom/pan sync between ReferencePanel and DrawingPanel.
  // useState's lazy initializer ensures only one instance is constructed for the lifetime
  // of the component (useRef(new ViewTransform()) re-evaluates `new` every render).
  const [viewTransform] = useState(() => new ViewTransform());

  // Lifted state from ReferencePanel
  const [source, setSource] = useState<ReferenceSource>('none');
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('browse');
  const [fixedImageUrl, setFixedImageUrl] = useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  // Whether the Sketchfab 3D viewer iframe is currently mounted. While true,
  // the reference panel must stay at half-screen so the preview matches the
  // aspect ratio that "Fix This Angle" will capture.
  // SketchfabViewer is unmounted when source leaves 'sketchfab' and its unmount
  // cannot push a "showViewer:false" notification, so reset on source change
  // (via prev-state-in-render) to avoid a stale-active flicker on reopen.
  const [sketchfabViewerActive, setSketchfabViewerActive] = useState(false);
  const [sfActiveTrackedSource, setSfActiveTrackedSource] = useState(source);
  if (sfActiveTrackedSource !== source) {
    setSfActiveTrackedSource(source);
    if (source !== 'sketchfab' && sketchfabViewerActive) {
      setSketchfabViewerActive(false);
    }
  }

  // The reference side can drive the fit when a fit-capable viewer is rendering
  // (ImageViewer for fixed-image sources, or YouTubeViewer which maps its iframe
  // to the shared ViewTransform). Otherwise (Sketchfab browse / no reference) the
  // drawing canvas leads.
  const fitLeader: 'reference' | 'drawing'
    = source === 'youtube'
      || (referenceMode === 'fixed' && (source === 'image' || source === 'url' || source === 'pexels' || source === 'sketchfab'))
      ? 'reference'
      : 'drawing';

  // In portrait the split is top/bottom and the reference panel only gets
  // half the height. While searching Sketchfab/Pexels (browse mode), give the
  // reference panel the whole viewport so the result grid is browsable. The
  // drawing panel is hidden via display:none rather than unmounted so its
  // canvas/ViewTransform state survives the toggle.
  // Sketchfab's browse mode covers two screens (search results and the 3D
  // viewer iframe); only the search-results screen should go fullscreen — the
  // 3D viewer must stay half-height so the captured screenshot matches the
  // visible camera framing.
  const isSearchFullscreen
    = !isLandscape
      && referenceMode === 'browse'
      && (
        (source === 'sketchfab' && !sketchfabViewerActive)
        || source === 'pexels'
      );

  // Free-drawing layout: hide the reference panel so the drawing canvas spans
  // the full viewport. Independent of isSearchFullscreen (which is the inverse:
  // hides drawing while browsing on portrait). When both are true (would only
  // happen on a portrait collapse during search, but isSearchFullscreen wins on
  // entering browse) we prefer showing reference for the active browse flow.
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);

  // Timer (lifted from DrawingPanel for autosave access)
  const timer = useTimer();
  const timerElapsedRef = useRef(timer.elapsedMs);
  useEffect(() => {
    timerElapsedRef.current = timer.elapsedMs;
  });

  // Guide state (from context)
  const { grid, lines, version: guideVersion, restoreGuides, guideManagerRef } = useGuides();

  // Ref for loading Sketchfab model by UID (registered by ReferencePanel)
  const loadSketchfabModelFnRef = useRef<((uid: string, meta?: SketchfabModelMeta) => void) | null>(null);
  // Ref for refreshing the URL history dropdown after parent-initiated adds
  // (e.g. Gallery "use this reference" reload).
  const reloadUrlHistoryFnRef = useRef<(() => void) | null>(null);

  // Change version counter for autosave debouncing
  const [changeVersion, setChangeVersion] = useState(0);
  // Flush version: bumped on reference changes to bypass the 2s debounce and
  // queue saveDraft immediately (so a fast reload after a reference swap
  // doesn't restore the previous reference). The IndexedDB write is still
  // async but starts right away.
  const [flushVersion, setFlushVersion] = useState(0);
  // Restore version to notify DrawingPanel after draft restore
  const [restoreVersion, setRestoreVersion] = useState(0);
  // History sync version: incremented when the StrokeManager's undo/redo
  // stacks change outside DrawingPanel (e.g. SplitLayout records a reference
  // change). DrawingPanel listens to this to refresh its canUndo/canRedo UI.
  const [historySyncVersion, setHistorySyncVersion] = useState(0);
  const incrementChangeVersion = useCallback(() => {
    setChangeVersion(v => v + 1);
  }, []);

  const incrementFlushVersion = useCallback(() => {
    setFlushVersion(v => v + 1);
  }, []);

  const handleToggleReferenceCollapsed = useCallback(() => {
    setReferenceCollapsed(v => !v);
    // Immediate flush: a fast reload after toggling shouldn't lose the layout
    // intent. Same rationale as reference changes — the user explicitly asked
    // for a layout state and expects it to survive a reload.
    incrementFlushVersion();
  }, [incrementFlushVersion]);

  // Pause timer whenever the reference changes — the timer should only advance
  // during active drawing. The next stroke will resume it via handleStrokeCountChange.
  const pauseAndIncrementVersion = useCallback(() => {
    timer.pause();
    setChangeVersion(v => v + 1);
  }, [timer]);

  // Suppress autosave during restore or when another tab holds the lock
  const suppressAutosaveRef = useRef(true);
  useEffect(() => {
    if (!hasSessionLock) {
      suppressAutosaveRef.current = true;
    }
  }, [hasSessionLock]);

  // Keep a ref to the latest reference state so `captureReferenceSnapshot` can
  // remain a stable callback (prevents unnecessary child re-renders).
  const referenceStateRef = useRef({ source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo });
  useEffect(() => {
    referenceStateRef.current = { source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo };
  });

  const captureReferenceSnapshot = useCallback((): ReferenceSnapshot => ({
    ...referenceStateRef.current,
  }), []);

  // Restorer invoked by StrokeManager when undo/redo pops a reference entry.
  // Keep it on a ref so we can register a stable callback with StrokeManager.
  const applyReferenceSnapshotRef = useRef<(snap: ReferenceSnapshot) => void>(() => {});
  useEffect(() => {
    applyReferenceSnapshotRef.current = (snap: ReferenceSnapshot) => {
      setSource(snap.source);
      setReferenceMode(snap.referenceMode);
      setFixedImageUrl(snap.fixedImageUrl);
      setLocalImageUrl(snap.localImageUrl);
      setReferenceInfo(snap.referenceInfo);
      pauseAndIncrementVersion();
      incrementFlushVersion();
    };
  });

  // Defers the legacy-draft strokes/guides until the reference's natural size
  // is known (handleReferenceImageSize), so the (-W/2, -H/2) shift to the new
  // center-origin convention can be applied in a single step — avoiding a
  // brief flash of mis-positioned strokes.
  const pendingMigrationRef = useRef<{
    strokes: Stroke[];
    redoStack: Stroke[];
    guides: GuideState;
  } | null>(null);

  // Camera state captured from the autosave draft, applied AFTER the active
  // viewer fires its `setHome(0,0,1)` on first reference load (which would
  // otherwise stomp the restored camera). Cleared on first apply.
  const pendingCameraRef = useRef<{ viewCenterX: number; viewCenterY: number; zoom: number } | null>(null);

  /**
   * Record the current reference state as an undoable entry, then apply the
   * mutation. Used for all user-initiated reference changes (Fix Angle, image
   * swap, Close, Gallery load). Routing every mutation through this helper
   * ensures individual setter calls can't bypass history recording.
   */
  const changeReference = useCallback((mutate: (setters: ReferenceSetters) => void) => {
    // Cancel any pending coord migration: the legacy strokes were sized to
    // the OUTGOING reference. The next onReferenceImageSize will report the
    // new reference's dimensions, which would shift the legacy strokes by
    // the wrong amount.
    pendingMigrationRef.current = null;
    const prev = captureReferenceSnapshot();
    strokeManagerRef.current?.recordReferenceChange(prev);
    mutate({
      setSource,
      setReferenceMode,
      setFixedImageUrl,
      setLocalImageUrl,
      setReferenceInfo,
    });
    pauseAndIncrementVersion();
    setHistorySyncVersion(v => v + 1);
    incrementFlushVersion();
  }, [captureReferenceSnapshot, pauseAndIncrementVersion, incrementFlushVersion]);

  /**
   * Error-path reset. NOT recorded as an undoable entry — undoing back to a
   * broken reference (e.g. a URL that failed to load) would just trigger the
   * same error again. Pauses the timer like every other reference-change path
   * so time doesn't keep ticking after the reference silently reverts.
   */
  const resetReferenceOnError = useCallback(() => {
    // Cancel any pending coord migration: with no reference, the size
    // callback that would have applied it never fires, and we don't want the
    // legacy-coord arrays held forever.
    pendingMigrationRef.current = null;
    setSource('none');
    setReferenceMode('browse');
    setFixedImageUrl(null);
    setLocalImageUrl(null);
    setReferenceInfo(null);
    pauseAndIncrementVersion();
    incrementFlushVersion();
  }, [pauseAndIncrementVersion, incrementFlushVersion]);

  const handleReferenceImageSize = useCallback((width: number, height: number) => {
    // Bail when the size hasn't actually changed. YouTubeViewer fires
    // onFitSize with the constant 1920x1080 on every mount, so without this
    // guard a remount triggers a wasted setState + re-render.
    setReferenceSize(prev => (prev && prev.width === width && prev.height === height) ? prev : { width, height });

    const pending = pendingMigrationRef.current;
    if (pending && width > 0 && height > 0) {
      pendingMigrationRef.current = null;
      // If the user has already started drawing in the gap between draft
      // restore and the size callback (e.g. image load lagged), abandon the
      // migration rather than overwrite their work. Their session has
      // effectively diverged from the legacy draft; the next autosave will
      // tag the new state with the current coord version. Read via refs so
      // this callback's identity doesn't churn on every guide update.
      const userHasStarted
        = (strokeManagerRef.current?.canUndo() ?? false)
          || (guideManagerRef.current?.getLines().length ?? 0) > 0;
      if (userHasStarted) return;
      const dx = -width / 2;
      const dy = -height / 2;
      const migratedStrokes = shiftStrokes(pending.strokes, dx, dy);
      const migratedRedo = shiftStrokes(pending.redoStack, dx, dy);
      const migratedGuides = shiftGuideState(pending.guides, dx, dy);
      if (strokeManagerRef.current && (migratedStrokes.length > 0 || migratedRedo.length > 0)) {
        strokeManagerRef.current.loadState(migratedStrokes, migratedRedo);
      }
      restoreGuides(migratedGuides);
      // Debounced autosave is fine — the next user interaction will persist
      // the migrated coords; no need to bypass it via flushVersion.
      setRestoreVersion(v => v + 1);
      incrementChangeVersion();
    }
  }, [restoreGuides, incrementChangeVersion, guideManagerRef]);

  // When the user closes the reference, the stored `referenceSize` is stale.
  // Pass null in that case so DrawingCanvas falls back to free-drawing
  // semantics (baseScale=1, home + grid centered at world origin) instead of
  // staying anchored to the previous image's dimensions.
  const drawingFitSize = source === 'none' ? null : referenceSize;

  // True while the Sketchfab 3D iframe is being used for framing — Fix Angle
  // captures whatever the user sees, so the panel must stay at half-screen.
  // Used to both block the collapse layout and disable the toggle button so
  // the two stay in sync.
  const collapseLocked = sketchfabViewerActive && referenceMode === 'browse';

  const handleToggleFlip = useCallback(() => {
    setIsFlipped(prev => !prev);
  }, []);

  const handleToggleOverlay = useCallback(() => {
    setOverlayActive((prev) => {
      const next = !prev;
      if (next && strokeManagerRef.current) {
        setOverlayStrokes([...strokeManagerRef.current.getStrokes()]);
      }
      else {
        setOverlayStrokes(null);
      }
      return next;
    });
  }, []);

  const handleStrokeManagerReady = useCallback((sm: StrokeManager) => {
    strokeManagerRef.current = sm;
    // Register a stable restorer that always reads the latest closure via ref
    sm.setReferenceRestorer(snap => applyReferenceSnapshotRef.current(snap));
  }, []);

  const handleStrokesChanged = useCallback(() => {
    if (overlayActive && strokeManagerRef.current) {
      setOverlayStrokes([...strokeManagerRef.current.getStrokes()]);
    }
    incrementChangeVersion();
  }, [overlayActive, incrementChangeVersion]);

  const handleCurrentStrokeChange = useCallback((stroke: Stroke | null) => {
    currentStrokeRef.current = stroke;
    if (overlayActive) {
      overlayRedrawFnRef.current?.();
    }
  }, [overlayActive]);

  const handleRegisterOverlayRedraw = useCallback((fn: () => void) => {
    overlayRedrawFnRef.current = fn;
  }, []);

  const handleRegisterLoadSketchfabModel = useCallback((fn: (uid: string, meta?: SketchfabModelMeta) => void) => {
    loadSketchfabModelFnRef.current = fn;
  }, []);

  const handleRegisterReloadUrlHistory = useCallback((fn: () => void) => {
    reloadUrlHistoryFnRef.current = fn;
  }, []);

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
        const historyKey = info.url;
        if (!historyKey) return;
        const entry = await getUrlHistoryEntry(historyKey).catch(() => undefined);
        if (!entry?.imageBlob) {
          setToast(t('imageReferenceEvicted'));
          return;
        }
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(entry.imageBlob as Blob);
        });
        if (!dataUrl) {
          setToast(t('imageReferenceEvicted'));
          return;
        }
        changeReference((s) => {
          s.setSource('image');
          s.setReferenceMode('fixed');
          s.setFixedImageUrl(null);
          s.setLocalImageUrl(dataUrl);
          s.setReferenceInfo(info);
        });
        // Upsert with the Blob we already loaded so the call is self-
        // contained: no redundant DB read, and an evicted row between reads
        // can't recreate a blobless entry.
        await addUrlHistory(historyKey, 'image', {
          fileName: entry.fileName ?? info.fileName,
          imageBlob: entry.imageBlob,
        });
        reloadUrlHistoryFnRef.current?.();
      })();
      return;
    }

    changeReference((s) => {
      if (info.source === 'sketchfab' && info.sketchfabUid) {
        s.setSource('sketchfab');
        s.setLocalImageUrl(null);
        if (info.imageUrl) {
          // The Sketchfab iframe stays mounted in fixed mode (display:none),
          // so loadSketchfabModelFnRef below still readies "Change angle".
          s.setReferenceMode('fixed');
          s.setFixedImageUrl(info.imageUrl);
          s.setReferenceInfo(info);
        }
        else {
          s.setReferenceMode('browse');
          s.setFixedImageUrl(null);
          s.setReferenceInfo(null);
        }
        // Pass title/author to the viewer so Fix Angle from "Change angle"
        // produces a non-empty ReferenceInfo even on legacy records.
        const sfMeta: SketchfabModelMeta | undefined = (info.title || info.author)
          ? { name: info.title, author: info.author }
          : undefined;
        loadSketchfabModelFnRef.current?.(info.sketchfabUid, sfMeta);
      }
      else if (info.source === 'url' && info.imageUrl) {
        s.setSource('url');
        s.setReferenceMode('fixed');
        s.setFixedImageUrl(info.imageUrl);
        s.setLocalImageUrl(null);
        s.setReferenceInfo(info);
      }
      else if (info.source === 'youtube' && info.youtubeVideoId) {
        s.setSource('youtube');
        s.setReferenceMode('browse');
        s.setFixedImageUrl(null);
        s.setLocalImageUrl(null);
        s.setReferenceInfo(info);
      }
      else if (info.source === 'pexels' && info.pexelsImageUrl) {
        s.setSource('pexels');
        s.setReferenceMode('fixed');
        s.setFixedImageUrl(info.pexelsImageUrl);
        s.setLocalImageUrl(null);
        s.setReferenceInfo(info);
      }
    });

    let historyAdd: Promise<void> | null = null;
    if (info.source === 'url' && info.imageUrl) {
      historyAdd = addUrlHistory(info.imageUrl, 'url', info.title);
    }
    else if (info.source === 'youtube' && info.youtubeVideoId) {
      historyAdd = addUrlHistory(buildYouTubeCanonicalUrl(info.youtubeVideoId), 'youtube', info.title);
    }
    else if (info.source === 'pexels' && info.pexelsPageUrl) {
      historyAdd = addUrlHistory(info.pexelsPageUrl, 'pexels', info.title);
    }
    else if (info.source === 'sketchfab' && info.sketchfabUid) {
      // Bump lastUsedAt so reopening the same Sketchfab reference from the
      // gallery surfaces it at the top of the URL-history dropdown. If the
      // gallery record has a screenshot, convert it to a Blob and persist
      // — this lets a later URL-history selection restore directly into
      // fixed mode (matching the gallery "Use this reference" UX) even for
      // entries that were never opened via Fix Angle in this device's
      // history.
      const sketchfabKey = canonicalSketchfabUrl(info.sketchfabUid);
      const galleryImageUrl = info.imageUrl;
      historyAdd = (galleryImageUrl
        ? dataUrlToJpegBlob(galleryImageUrl).then(blob => addUrlHistory(
            sketchfabKey,
            'sketchfab',
            { title: info.title, ...(blob ? { imageBlob: blob } : {}) },
          ))
        : addUrlHistory(sketchfabKey, 'sketchfab', info.title)
      );
    }
    if (historyAdd) {
      historyAdd.then(() => reloadUrlHistoryFnRef.current?.()).catch(() => { /* ignore */ });
    }
  }, [changeReference]);

  // Autosave: read timer.elapsedMs via ref to avoid recreating this callback every frame
  const getAutosaveState = useCallback(() => ({
    strokes: strokeManagerRef.current?.getStrokes() ?? [],
    redoStack: strokeManagerRef.current?.getRedoStack() ?? [],
    elapsedMs: timerElapsedRef.current,
    source,
    referenceInfo,
    referenceImageData: (source === 'image' && localImageUrl)
      ? localImageUrl
      : (source === 'sketchfab' && fixedImageUrl)
          ? fixedImageUrl
          : null,
    grid,
    lines,
    referenceCollapsed,
    camera: viewTransform.getCamera(),
  }), [source, referenceInfo, localImageUrl, fixedImageUrl, grid, lines, referenceCollapsed, viewTransform]);

  useAutosave(getAutosaveState, changeVersion, flushVersion, suppressAutosaveRef);

  // Persist camera changes without wiring pointer-up across the three viewers
  // + DrawingCanvas. Two paths:
  //   - Continuous gestures (pinch/wheel) — tail-debounce a flushVersion bump
  //     after ~250ms of stillness so saves fire once per gesture.
  //   - Discrete reset (toolbar reset button / Cmd+0) — camera lands exactly
  //     at home, detected via `!isDirty()`, flush immediately so the reset
  //     persists without the 250ms wait.
  // Avoid bumping changeVersion — that would trigger a SplitLayout re-render
  // on every notify (60fps during a pinch). Suppressed during restore.
  const cameraFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsubscribe = viewTransform.subscribe(() => {
      if (suppressAutosaveRef.current) return;
      if (cameraFlushTimerRef.current) {
        clearTimeout(cameraFlushTimerRef.current);
        cameraFlushTimerRef.current = null;
      }
      if (!viewTransform.isDirty()) {
        incrementFlushVersion();
        return;
      }
      cameraFlushTimerRef.current = setTimeout(() => {
        cameraFlushTimerRef.current = null;
        incrementFlushVersion();
      }, 250);
    });
    return () => {
      unsubscribe();
      if (cameraFlushTimerRef.current) {
        clearTimeout(cameraFlushTimerRef.current);
        cameraFlushTimerRef.current = null;
      }
    };
  }, [viewTransform, incrementFlushVersion]);

  // Trigger autosave when guide state changes. Use the render-time prev-prop
  // pattern instead of an effect so we don't violate react-hooks/set-state-in-effect.
  const [prevGuideVersion, setPrevGuideVersion] = useState(guideVersion);
  if (prevGuideVersion !== guideVersion) {
    setPrevGuideVersion(guideVersion);
    if (guideVersion > 0) {
      incrementChangeVersion();
    }
  }

  // Clean up stale PR databases on mount
  useEffect(() => {
    cleanupStalePrDatabases();
  }, []);

  // Apply the restored camera once the active viewer has reported its size.
  // Ordering: ImageViewer runs setHome synchronously after onImageLoaded in
  // its image-onload callback, so React commits referenceSize and runs this
  // parent effect after setHome has already snapped to home. YouTubeViewer's
  // setHome lives in a child useEffect, which in current React runs before
  // parent effects on the same commit. If that child-before-parent ordering
  // ever changes, the pendingCameraRef apply would race with setHome —
  // re-evaluate then. Cleared on first apply so later reference-size changes
  // (user-driven swaps) don't re-stomp the camera.
  useEffect(() => {
    const pending = pendingCameraRef.current;
    if (!pending || !referenceSize) return;
    pendingCameraRef.current = null;
    viewTransform.setCamera(pending.viewCenterX, pending.viewCenterY, pending.zoom);
  }, [viewTransform, referenceSize, restoreVersion]);

  // Restore draft when session lock is acquired
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!hasSessionLock || restoredRef.current) return;
    restoredRef.current = true;

    let cancelled = false;
    loadDraft().then((draft) => {
      if (cancelled || !draft) {
        suppressAutosaveRef.current = false;
        return;
      }

      // True when the active source will mount a viewer that both reports
      // onReferenceImageSize and calls setHome(0, 0, 1) on first load. Used
      // for two purposes downstream: (1) deferring legacy stroke migration
      // until the viewer's size is known, (2) deferring camera restore until
      // after the viewer's setHome would have stomped a directly-applied
      // camera. Sketchfab browse without a captured screenshot does neither,
      // and its strokes were drawn against an unscaled panel coord space that
      // already matches the new convention.
      const referenceWillSize
        = draft.source === 'image'
          || draft.source === 'url'
          || draft.source === 'pexels'
          || draft.source === 'youtube'
          || (draft.source === 'sketchfab' && draft.referenceImageData !== null);
      const isLegacyCoords = (draft.coordVersion ?? 1) < COORD_VERSION_CURRENT;
      const deferStrokesForMigration = isLegacyCoords && referenceWillSize;

      if (deferStrokesForMigration) {
        pendingMigrationRef.current = {
          strokes: draft.strokes,
          redoStack: draft.redoStack,
          guides: draft.guideState ?? { grid: { mode: 'none' }, lines: [] },
        };
      }
      else {
        if (strokeManagerRef.current && (draft.strokes.length > 0 || draft.redoStack.length > 0)) {
          strokeManagerRef.current.loadState(draft.strokes, draft.redoStack);
        }
        if (draft.guideState) {
          restoreGuides(draft.guideState);
        }
      }

      // Restore timer
      if (draft.elapsedMs > 0) {
        timer.restore(draft.elapsedMs);
      }

      // Restore collapsed layout state
      setReferenceCollapsed(draft.referenceCollapsed ?? false);

      // Restore camera. When a viewer with setHome will mount, defer; the
      // pending-camera effect re-applies it after the viewer's setHome has
      // run. Otherwise apply directly — nothing later will overwrite it.
      if (draft.camera) {
        const cam = draft.camera;
        if (referenceWillSize) {
          pendingCameraRef.current = cam;
        }
        else {
          viewTransform.setCamera(cam.viewCenterX, cam.viewCenterY, cam.zoom);
        }
      }

      // Restore reference state
      if (draft.source !== 'none') {
        setSource(draft.source);
        setReferenceInfo(draft.referenceInfo);

        const info = draft.referenceInfo;
        if (draft.source === 'image' && draft.referenceImageData) {
          setLocalImageUrl(draft.referenceImageData);
          setReferenceMode('fixed');
        }
        else if (draft.source === 'sketchfab' && draft.referenceImageData) {
          setFixedImageUrl(draft.referenceImageData);
          setReferenceMode('fixed');
        }
        else if (info?.source === 'url') {
          setFixedImageUrl(info.imageUrl);
          setReferenceMode('fixed');
        }
        else if (info?.source === 'youtube') {
          setReferenceMode('browse');
        }
        else if (info?.source === 'pexels') {
          setFixedImageUrl(info.pexelsImageUrl);
          setReferenceMode('fixed');
        }
      }

      suppressAutosaveRef.current = false;
      setRestoreVersion(v => v + 1);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSessionLock]);

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
        {/* `collapseLocked` keeps the reference panel visible even when the user
          asked to collapse it; the toggle button is also disabled in that
          state so the user gets a tooltip instead of a no-op click. */}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: (referenceCollapsed && !isSearchFullscreen && !collapseLocked) ? 'none' : 'block' }}>
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
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: isSearchFullscreen ? 'none' : 'block' }}>
          <DrawingPanel
            referenceSize={drawingFitSize}
            referenceInfo={referenceInfo}
            onStrokeManagerReady={handleStrokeManagerReady}
            onStrokesChanged={handleStrokesChanged}
            onCurrentStrokeChange={handleCurrentStrokeChange}
            onOverlayClear={() => { setOverlayStrokes(null); }}
            onLoadReference={handleLoadReference}
            captureReferenceSnapshot={captureReferenceSnapshot}
            timer={timer}
            restoreVersion={restoreVersion}
            historySyncVersion={historySyncVersion}
            isFlipped={isFlipped}
            viewTransform={viewTransform}
            fitLeader={fitLeader}
            orientation={orientation}
            referenceCollapsed={referenceCollapsed}
            onToggleReferenceCollapsed={handleToggleReferenceCollapsed}
            collapseLocked={collapseLocked}
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
  );
}

export function SplitLayout() {
  return (
    <GuideProvider>
      <SplitLayoutInner />
    </GuideProvider>
  );
}
