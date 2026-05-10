import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Alert, Snackbar } from '@mui/material';
import { useOrientation } from '../hooks/useOrientation';
import { useTimer } from '../hooks/useTimer';
import { useAutosave } from '../hooks/useAutosave';
import { useSessionLock } from '../hooks/useSessionLock';
import { useGestureSession } from '../hooks/useGestureSession';
import { GuideProvider } from '../guides/GuideContext';
import { useGuides } from '../guides/useGuides';
import { ReferencePanel, type ReferenceSetters } from './ReferencePanel';
import { DrawingPanel } from './DrawingPanel';
import { GestureHUD } from './GestureHUD';
import { computeFitLeader, resolveDrawingFitSize } from './splitLayoutHelpers';
import { StrokeManager } from '../drawing/StrokeManager';
import { ViewTransform } from '../drawing/ViewTransform';
import { loadDraft } from '../storage/sessionStore';
import { cleanupStalePrDatabases, COORD_VERSION_CURRENT } from '../storage/db';
import { shiftStrokes, shiftGuideState } from '../storage/coordMigration';
import { addUrlHistory, getUrlHistoryEntry } from '../storage/urlHistoryStore';
import { saveDrawing } from '../storage';
import { generateThumbnail } from '../storage/generateThumbnail';
import { buildYouTubeCanonicalUrl } from '../utils/youtube';
import { canonicalSketchfabUrl } from '../utils/sketchfab';
import { dataUrlToJpegBlob } from '../utils/imageResize';
import { buildPexelsReferenceInfo, searchPhotos, type PexelsOrientationFilter, type PexelsPhoto } from '../utils/pexels';
import type { SketchfabModelMeta } from './SketchfabViewer';
import type { PexelsGestureSessionConfig } from './PexelsSearcher';
import { t } from '../i18n';
import type { Stroke, ReferenceSnapshot } from '../drawing/types';
import type { GuideState } from '../guides/types';
import type { ReferenceInfo, ReferenceSource, ReferenceMode } from '../types';

function SplitLayoutInner() {
  const sessionLockStatus = useSessionLock();
  // `hasSessionLock` reflects optimism: `pending` and `acquired` both look
  // "ok-to-render" to UI gates that simply ask "should we show the panels?".
  // The "another tab" Alert and the autosave write-gate use the stricter
  // `'acquired'` / `'denied'` checks below to avoid races during the
  // acquisition window.
  const hasSessionLock = sessionLockStatus !== 'denied';
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
  // StrokeManager owned by SplitLayout (not DrawingPanel) so it exists from
  // mount and can receive `loadState` during draft restore even before the
  // DrawingPanel is mounted. Conditional-rendering DrawingPanel until
  // restoreCompleted (to avoid CSS-transition flicker on toolbar buttons)
  // would otherwise leave loadDraft with no manager to populate.
  const [strokeManager] = useState(() => new StrokeManager());

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

  // The reference side leads when a fit-capable viewer is rendering
  // (ImageViewer for fixed-image sources, or YouTubeViewer which maps its
  // iframe to the shared ViewTransform). Otherwise (Sketchfab browse / no
  // reference) the drawing canvas leads. Pure function — see
  // splitLayoutHelpers.ts for the rationale.
  const fitLeader = computeFitLeader(source, referenceMode);

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
    incrementFlushVersion();
    // setReferenceCollapsed listed only to satisfy React Compiler's
    // preserve-manual-memoization check; setState identities are stable so
    // it's a no-op for callback identity.
  }, [incrementFlushVersion, setReferenceCollapsed]);

  // Pause timer whenever the reference changes — the timer should only advance
  // during active drawing. The next stroke will resume it via handleStrokeCountChange.
  const pauseAndIncrementVersion = useCallback(() => {
    timer.pause();
    setChangeVersion(v => v + 1);
  }, [timer]);

  // Autosave suppression: stays true while restore is in flight AND while
  // the session lock is still `pending`. Setting it false before the lock
  // confirms could let the restore-triggered `flushVersion` bump (via the
  // guideVersion render-time pattern below) write to IndexedDB while
  // another tab still holds the lock — the kind of last-writer-wins race
  // useSessionLock exists to prevent. loadDraft.then itself no longer
  // touches this ref; the effect below is the single owner.
  const suppressAutosaveRef = useRef(true);

  // Gate panel mount until restore completes. Earlier attempts with
  // `visibility: hidden` failed because hidden DOM still runs CSS
  // transitions on prop changes (e.g. Save button's `color 0.3s` would
  // animate from disabled-gray to enabled-color the moment the gate
  // flipped). Conditional rendering means panels mount fresh after
  // restore, so first paint has every prop at its final value and no
  // transition kicks off. `restored` falls open when the lock is
  // definitively denied so the user can still use the app (autosave
  // disabled) without staring at a blank screen.
  const [restoreCompleted, setRestoreCompleted] = useState(false);
  const restored = restoreCompleted || sessionLockStatus === 'denied';

  // Single source of truth for autosave suppression: false only when restore
  // is done AND the lock is confirmed acquired.
  useEffect(() => {
    suppressAutosaveRef.current = !(restoreCompleted && sessionLockStatus === 'acquired');
  }, [restoreCompleted, sessionLockStatus]);

  // Keep a ref to the latest reference state so `captureReferenceSnapshot` can
  // remain a stable callback (prevents unnecessary child re-renders).
  const referenceStateRef = useRef({ source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo });
  useEffect(() => {
    referenceStateRef.current = { source, referenceMode, fixedImageUrl, localImageUrl, referenceInfo };
  });

  const captureReferenceSnapshot = useCallback((): ReferenceSnapshot => ({
    ...referenceStateRef.current,
  }), []);

  // Forward declaration for the gesture-session exit callback. Wired up in
  // an effect once `gestureSession` exists below; changeReference uses it
  // to auto-end an active session whenever the user navigates the reference
  // (Back to search, Close, source switch). The hook's `exit()` is a no-op
  // when no session is active, so unconditional calls are safe.
  const gestureSessionExitRef = useRef<() => void>(() => {});

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
    gallerySaveDirty: boolean;
  } | null>(null);

  // Camera state captured from the autosave draft, applied AFTER the active
  // viewer fires its `loadContent(0,0,1)` on first reference load (which
  // would otherwise stomp the restored camera). Cleared on first apply.
  const pendingCameraRef = useRef<{ viewCenterX: number; viewCenterY: number; zoom: number } | null>(null);

  /**
   * Record the current reference state as an undoable entry, then apply the
   * mutation. Used for all user-initiated reference changes (Fix Angle, image
   * swap, Close, Gallery load). Routing every mutation through this helper
   * ensures individual setter calls can't bypass history recording.
   *
   * Pass `{ recordUndo: false }` for non-undoable swaps (e.g. the gesture
   * session, which advances through dozens of photos — recording each as
   * an undoable swap would let Undo walk back through arbitrary photos and
   * also blow past the 20-entry reference-history cap within seconds).
   */
  const changeReference = useCallback((
    mutate: (setters: ReferenceSetters) => void,
    opts?: { recordUndo?: boolean },
  ) => {
    // Cancel any pending coord migration: the legacy strokes were sized to
    // the OUTGOING reference. The next onReferenceImageSize will report the
    // new reference's dimensions, which would shift the legacy strokes by
    // the wrong amount.
    pendingMigrationRef.current = null;
    const recordUndo = opts?.recordUndo !== false;
    if (recordUndo) {
      // User-initiated reference change → end any active gesture session so
      // the user isn't left with the HUD over an unrelated reference. The
      // hook's exit() is a no-op when nothing is active.
      gestureSessionExitRef.current();
      const prev = captureReferenceSnapshot();
      strokeManager.recordReferenceChange(prev);
      setHistorySyncVersion(v => v + 1);
    }
    mutate({
      setSource,
      setReferenceMode,
      setFixedImageUrl,
      setLocalImageUrl,
      setReferenceInfo,
    });
    pauseAndIncrementVersion();
    incrementFlushVersion();
    // setState identities are stable; listed only to satisfy React Compiler's
    // preserve-manual-memoization check.
  }, [strokeManager, captureReferenceSnapshot, pauseAndIncrementVersion, incrementFlushVersion, setHistorySyncVersion]);

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
        = strokeManager.canUndo()
          || (guideManagerRef.current?.getLines().length ?? 0) > 0;
      if (userHasStarted) return;
      const dx = -width / 2;
      const dy = -height / 2;
      const migratedStrokes = shiftStrokes(pending.strokes, dx, dy);
      const migratedRedo = shiftStrokes(pending.redoStack, dx, dy);
      const migratedGuides = shiftGuideState(pending.guides, dx, dy);
      if (migratedStrokes.length > 0 || migratedRedo.length > 0) {
        strokeManager.loadState(migratedStrokes, migratedRedo);
        if (!pending.gallerySaveDirty) {
          strokeManager.markSavedToGallery();
        }
      }
      restoreGuides(migratedGuides);
      // Debounced autosave is fine — the next user interaction will persist
      // the migrated coords; no need to bypass it via flushVersion.
      setRestoreVersion(v => v + 1);
      incrementChangeVersion();
    }
    // setRestoreVersion listed only for React Compiler's
    // preserve-manual-memoization check (stable identity, harmless).
  }, [strokeManager, restoreGuides, incrementChangeVersion, guideManagerRef, setRestoreVersion]);

  // DrawingCanvas fits only when a viewer is actively the fit leader; raw
  // referenceSize would otherwise leak the previous reference's dimensions
  // on browse/picker screens. See splitLayoutHelpers.ts.
  const drawingFitSize = resolveDrawingFitSize(fitLeader, referenceSize);

  // True while the Sketchfab 3D iframe is being used for framing — Fix Angle
  // captures whatever the user sees, so the panel must stay at half-screen.
  // Used to both block the collapse layout and disable the toggle button so
  // the two stay in sync.
  const collapseLocked = sketchfabViewerActive && referenceMode === 'browse';

  const handleToggleFlip = useCallback(() => {
    setIsFlipped(prev => !prev);
    incrementFlushVersion();
  }, [incrementFlushVersion]);

  const handleToggleOverlay = useCallback(() => {
    setOverlayActive((prev) => {
      const next = !prev;
      if (next) {
        setOverlayStrokes([...strokeManager.getStrokes()]);
      }
      else {
        setOverlayStrokes(null);
      }
      return next;
    });
  }, [strokeManager]);

  // Register a stable reference restorer on the StrokeManager. The restorer
  // reads applyReferenceSnapshotRef.current at call time so it picks up the
  // latest closure without re-registering on every render.
  useEffect(() => {
    strokeManager.setReferenceRestorer(snap => applyReferenceSnapshotRef.current(snap));
  }, [strokeManager]);

  const handleStrokesChanged = useCallback(() => {
    if (overlayActive) {
      setOverlayStrokes([...strokeManager.getStrokes()]);
    }
    incrementChangeVersion();
  }, [strokeManager, overlayActive, incrementChangeVersion]);

  // ── Gesture-drawing session ───────────────────────────────────────────────
  // Driven by useGestureSession. Sequence per pose: countdown → onTimeUp
  // (save current drawing) → onAdvance (clear strokes + reset timer) →
  // onPhotoChange (swap reference without undo entry).

  /** Wipe strokes / timer / overlay so a fresh pose starts on a clean canvas.
   *  Bumps restoreVersion so DrawingPanel's canvas re-runs its initial-draw
   *  effect with the empty stroke set. Shared by session start and per-pose
   *  advance. */
  const resetForNextPose = useCallback(() => {
    strokeManager.clear();
    timer.reset();
    setOverlayStrokes(null);
    setRestoreVersion(v => v + 1);
    setHistorySyncVersion(v => v + 1);
  }, [strokeManager, timer, setRestoreVersion, setHistorySyncVersion, setOverlayStrokes]);

  /** referenceInfo is the source of truth for what we save: the hook awaits
   *  onTimeUp BEFORE calling onPhotoChange, so this closure still sees the
   *  previous photo's info. Read elapsed via ref to keep the callback stable
   *  across the per-RAF timer.elapsedMs updates. */
  const handleGestureTimeUp = useCallback(async () => {
    const strokes = strokeManager.getStrokes();
    if (strokes.length === 0) return;
    if (!strokeManager.isDirtySinceGallerySave()) return;
    try {
      const thumbnail = generateThumbnail(strokes);
      await saveDrawing(strokes, thumbnail, referenceInfo ?? null, timerElapsedRef.current);
      strokeManager.markSavedToGallery();
    }
    catch (err) {
      console.error('Gesture session save failed:', err);
    }
  }, [strokeManager, referenceInfo]);

  const handleGesturePhotoChange = useCallback((photo: PexelsPhoto) => {
    const info = buildPexelsReferenceInfo(photo);
    changeReference((s) => {
      s.setSource('pexels');
      s.setReferenceMode('fixed');
      s.setFixedImageUrl(info.pexelsImageUrl);
      s.setLocalImageUrl(null);
      s.setReferenceInfo(info);
    }, { recordUndo: false });
  }, [changeReference]);

  const handleGestureFetchMore = useCallback(async (
    query: string,
    orientation: PexelsOrientationFilter,
    nextPage: number,
  ) => {
    const res = await searchPhotos({
      query,
      page: nextPage,
      orientation: orientation === 'all' ? undefined : orientation,
    });
    return {
      photos: res.photos,
      page: nextPage,
      hasMore: !!res.next_page && res.photos.length > 0,
    };
  }, []);

  const gestureSession = useGestureSession({
    onPhotoChange: handleGesturePhotoChange,
    onTimeUp: handleGestureTimeUp,
    onAdvance: resetForNextPose,
    fetchMore: handleGestureFetchMore,
  });

  // Expose exit() to the changeReference path (declared above gestureSession,
  // so it reads the callback through this ref).
  useEffect(() => {
    gestureSessionExitRef.current = gestureSession.exit;
  });

  // Destructure stable callbacks (useCallback'd inside the hook) so they
  // don't keep handleStartGestureSession's deps changing every render.
  const { start: startGestureSessionRaw } = gestureSession;
  const handleStartGestureSession = useCallback((config: PexelsGestureSessionConfig) => {
    resetForNextPose();
    startGestureSessionRaw(config);
  }, [startGestureSessionRaw, resetForNextPose]);

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
    strokes: strokeManager.getStrokes(),
    redoStack: strokeManager.getRedoStack(),
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
    flipped: isFlipped,
    // Read at call time — the dirty flag deliberately is not in the deps.
    // `useAutosave` re-invokes this getter when `changeVersion` (bumped by
    // stroke mutations) or `flushVersion` (bumped by `onGallerySaved`)
    // advances, so the latest value is captured without re-memoizing.
    gallerySaveDirty: strokeManager.isDirtySinceGallerySave(),
  }), [strokeManager, source, referenceInfo, localImageUrl, fixedImageUrl, grid, lines, referenceCollapsed, viewTransform, isFlipped]);

  useAutosave(getAutosaveState, changeVersion, flushVersion, suppressAutosaveRef);

  // Persist camera changes by dispatching from the intent rather than
  // inferring from state: 'gesture' tail-debounces 250ms (one save per
  // gesture, not per frame); 'userReset'/'contentLoad' flush immediately;
  // 'restore' is gated off by suppressAutosaveRef. adjustForUnfit notifies
  // with intent null and is ignored here.
  const cameraFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsubscribe = viewTransform.subscribe((intent) => {
      if (intent === null) return;
      if (suppressAutosaveRef.current) return;
      if (cameraFlushTimerRef.current) {
        clearTimeout(cameraFlushTimerRef.current);
        cameraFlushTimerRef.current = null;
      }
      if (intent === 'gesture') {
        cameraFlushTimerRef.current = setTimeout(() => {
          cameraFlushTimerRef.current = null;
          incrementFlushVersion();
        }, 250);
        return;
      }
      incrementFlushVersion();
    });
    return () => {
      unsubscribe();
      if (cameraFlushTimerRef.current) {
        clearTimeout(cameraFlushTimerRef.current);
        cameraFlushTimerRef.current = null;
      }
    };
  }, [viewTransform, incrementFlushVersion]);

  // Trigger autosave when guide state changes. Guide changes (grid mode, line
  // add/remove/clear) are discrete user actions, so flush immediately rather
  // than wait the 2s debounce — same rationale as collapse-toggle and
  // reference change. Restore-time bumps are gated by suppressAutosaveRef in
  // the flush path. Render-time prev-prop pattern instead of an effect so we
  // don't violate react-hooks/set-state-in-effect.
  const [prevGuideVersion, setPrevGuideVersion] = useState(guideVersion);
  if (prevGuideVersion !== guideVersion) {
    setPrevGuideVersion(guideVersion);
    if (guideVersion > 0) {
      incrementFlushVersion();
    }
  }

  // Clean up stale PR databases on mount
  useEffect(() => {
    cleanupStalePrDatabases();
  }, []);

  // Apply the restored camera once the active viewer has reported its size.
  // Ordering: ImageViewer runs loadContent synchronously after onImageLoaded
  // in its image-onload callback, so React commits referenceSize and runs
  // this parent effect after loadContent has already snapped to home.
  // YouTubeViewer's loadContent lives in a child useEffect, which in current
  // React runs before parent effects on the same commit. If that
  // child-before-parent ordering ever changes, the pendingCameraRef apply
  // would race with loadContent — re-evaluate then. Cleared on first apply
  // so later reference-size changes (user-driven swaps) don't re-stomp the
  // camera. restoreCamera emits intent 'restore', which the subscribe-based
  // flush listener ignores while suppressAutosaveRef is up.
  useEffect(() => {
    const pending = pendingCameraRef.current;
    if (!pending || !referenceSize) return;
    pendingCameraRef.current = null;
    viewTransform.restoreCamera(pending.viewCenterX, pending.viewCenterY, pending.zoom);
  }, [viewTransform, referenceSize, restoreVersion]);

  // Restore draft when session lock is acquired
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!hasSessionLock || restoredRef.current) return;
    restoredRef.current = true;

    let cancelled = false;
    loadDraft().then((draft) => {
      if (cancelled) return;
      if (!draft) {
        setRestoreCompleted(true);
        return;
      }

      // True when the active source will mount a viewer that both reports
      // onReferenceImageSize and calls loadContent(0, 0, 1) on first load.
      // Used for two purposes downstream: (1) deferring legacy stroke
      // migration until the viewer's size is known, (2) deferring camera
      // restore until after the viewer's loadContent would have stomped a
      // directly-applied camera. Sketchfab browse without a captured
      // screenshot does neither, and its strokes were drawn against an
      // unscaled panel coord space that already matches the new convention.
      const referenceWillSize
        = draft.source === 'image'
          || draft.source === 'url'
          || draft.source === 'pexels'
          || draft.source === 'youtube'
          || (draft.source === 'sketchfab' && draft.referenceImageData !== null);
      const isLegacyCoords = (draft.coordVersion ?? 1) < COORD_VERSION_CURRENT;
      const deferStrokesForMigration = isLegacyCoords && referenceWillSize;

      // Pre-feature drafts have no `gallerySaveDirty` field. Default to dirty
      // so a returning user can still save (matches behavior before the
      // dirty-tracking feature shipped — never silently disable Save). Only
      // an explicit `false` disables the button across reload.
      const restoredDirty = draft.gallerySaveDirty ?? true;

      if (deferStrokesForMigration) {
        pendingMigrationRef.current = {
          strokes: draft.strokes,
          redoStack: draft.redoStack,
          guides: draft.guideState ?? { grid: { mode: 'none' }, lines: [] },
          gallerySaveDirty: restoredDirty,
        };
      }
      else {
        if (draft.strokes.length > 0 || draft.redoStack.length > 0) {
          strokeManager.loadState(draft.strokes, draft.redoStack);
          // loadState bumps mutationCount, so isDirtySinceGallerySave() is
          // true here unless we explicitly mark the restored state as saved.
          if (!restoredDirty) {
            strokeManager.markSavedToGallery();
          }
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

      // Restore flipped state
      if (draft.flipped !== undefined) {
        setIsFlipped(draft.flipped);
      }

      // Restore camera. When a viewer with loadContent will mount, defer;
      // the pending-camera effect re-applies it after the viewer's
      // loadContent has run. Otherwise apply directly — nothing later will
      // overwrite it. restoreCamera emits intent 'restore', ignored by the
      // flush listener while suppressAutosaveRef is up (set below).
      if (draft.camera) {
        const cam = draft.camera;
        if (referenceWillSize) {
          pendingCameraRef.current = cam;
        }
        else {
          viewTransform.restoreCamera(cam.viewCenterX, cam.viewCenterY, cam.zoom);
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

      setRestoreVersion(v => v + 1);
      setRestoreCompleted(true);
    }).catch((err) => {
      // loadDraft is async IndexedDB — if it rejects, surface the panels
      // anyway so the user isn't stuck on a blank screen.
      console.error('loadDraft failed:', err);
      if (cancelled) return;
      setRestoreCompleted(true);
    });

    return () => {
      cancelled = true;
      // Reset the gate so a remount (StrictMode dev double-mount, or
      // hasSessionLock flapping true→false→true) can re-attempt loadDraft.
      // Without this, the cancelled mount never sets restoreCompleted and the
      // remount short-circuits, leaving the visibility gate permanently hidden.
      restoredRef.current = false;
    };
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
      {/* Gesture HUD sits above both panels as a normal flex row so the
          drawing canvas keeps the same height as the reference panel — an
          earlier overlay-style HUD blocked the top of the canvas. */}
      <GestureHUD
        active={gestureSession.active}
        paused={gestureSession.paused}
        loadingMore={gestureSession.loadingMore}
        durationMs={gestureSession.durationMs}
        remainingMs={gestureSession.remainingMs}
        completedCount={gestureSession.completedCount}
        currentIndex={gestureSession.totalShownCount}
        queueRemaining={gestureSession.queueRemaining}
        hasMoreInBackend={gestureSession.hasMoreInBackend}
        onSkip={gestureSession.skip}
        onPause={gestureSession.pause}
        onResume={gestureSession.resume}
        onExit={gestureSession.exit}
      />
      {/* Don't render the panels until restore completes. Earlier attempts
          with `visibility: 'hidden'` failed because CSS transitions (e.g. the
          Save button's `transition: color 0.3s`) still fired while hidden —
          once visible, the partial gray-to-color transition was visible.
          Mounting the panels fresh after restore ensures every prop is at its
          final value at first paint, so no transition kicks off. */}
      {restored && (
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
              onPexelsStartSession={handleStartGestureSession}
              collapseInfoOverlayByDefault={gestureSession.active}
              suppressGuideEditing={gestureSession.active}
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
              strokeManager={strokeManager}
              onStrokesChanged={handleStrokesChanged}
              onGallerySaved={incrementFlushVersion}
              onCurrentStrokeChange={handleCurrentStrokeChange}
              onOverlayClear={() => { setOverlayStrokes(null); }}
              onLoadReference={handleLoadReference}
              captureReferenceSnapshot={captureReferenceSnapshot}
              timer={timer}
              restoreVersion={restoreVersion}
              historySyncVersion={historySyncVersion}
              isFlipped={isFlipped}
              viewTransform={viewTransform}
              orientation={orientation}
              referenceCollapsed={referenceCollapsed}
              onToggleReferenceCollapsed={handleToggleReferenceCollapsed}
              collapseLocked={collapseLocked}
              inputFrozen={gestureSession.transitioning}
            />
          </Box>
        </Box>
      )}
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
