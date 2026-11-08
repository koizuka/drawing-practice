import { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { Box, Button, CircularProgress, IconButton, Typography } from '@mui/material';
import { MaskRevealButton } from './MaskRevealButton';
import { browseReference, loadedReference, resolveFixedImageUrl } from './splitLayoutHelpers';
import type { ReferenceSnapshot } from '../drawing/types';
import { ToolbarTooltip } from './ToolbarTooltip';
import {
  X,
  PenLine,
  CircleX,
  Trash2,
  Layers,
  FlipHorizontal2,
  LocateFixed,
  Maximize,
  Minimize,
  Play,
  Pause,
  ZoomIn,
  SquareDashed,
  SquareX,
} from 'lucide-react';
import type {
  SketchfabActions,
  SketchfabFixAngleExtras,
  SketchfabModelMeta,
} from './SketchfabViewer';
import { ImageViewer, type GuideInteractionMode } from './ImageViewer';
import { TraceTemplateViewer } from './TraceTemplateViewer';
import { BundledTemplatePicker } from './BundledTemplatePicker';
import { getBundledTemplate } from '../templates/bundled';
import type { TraceTemplate } from '../templates/types';
import type { TraceFeedback } from '../trace/types';
import type { ViewTransform } from '../drawing/ViewTransform';
import { YouTubeViewer, type YouTubePlayerHandle } from './YouTubeViewer';
import type { VideoSyncBridge } from '../utils/videoSyncBridge';
import { PexelsApiKeyDialog } from './PexelsApiKeyDialog';
import { AnthropicApiKeyDialog } from './AnthropicApiKeyDialog';
import { LazyErrorBoundary } from './LazyErrorBoundary';
import type { PoseSourceActions } from './PoseSourcePanel';

// Heavy on-demand panels — only mounted when the user picks the matching
// reference source. Splitting them out keeps them off the initial bundle.
const SketchfabViewer = lazy(() =>
  import('./SketchfabViewer').then((m) => ({ default: m.SketchfabViewer })),
);
const PexelsSearcher = lazy(() =>
  import('./PexelsSearcher').then((m) => ({ default: m.PexelsSearcher })),
);
// Pulls in three.js + @pixiv/three-vrm — must stay a lazy chunk.
const PoseSourcePanel = lazy(() => import('./PoseSourcePanel'));

function LazyPanelFallback() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, my: 2 }}>
      <CircularProgress />
    </Box>
  );
}
import { ReferenceInfoOverlay } from './ReferenceInfoOverlay';
import { SourcePicker } from './SourcePicker';
import { UrlHistoryAutocomplete } from './UrlHistoryAutocomplete';
import { useUrlReferenceLoader } from '../hooks/useUrlReferenceLoader';
import {
  getPexelsApiKey,
  getPexelsLastSearch,
  type PexelsOrientationFilter,
} from '../utils/pexels';
import { dataUrlToJpegBlob } from '../utils/imageResize';
import { resetPageZoom } from '../utils/resetPageZoom';
import {
  canonicalSketchfabUrl,
  type SketchfabCategorySlug,
  type SketchfabTimeFilter,
} from '../utils/sketchfab';

import { useGuides } from '../guides/useGuides';
import { GridModePopoverButton } from './GridModePopoverButton';
import { useFullscreen } from '../hooks/useFullscreen';
import { t } from '../i18n';
import type { Stroke } from '../drawing/types';
import {
  referenceKey,
  type ReferenceSource,
  type ReferenceMode,
  type ReferenceInfo,
} from '../types';

/**
 * Raw setters for the reference-related state living in SplitLayout. Exposed
 * through `onReferenceChange(setters => ...)` so that every user-initiated
 * mutation is routed through the undo history recording path.
 */
export interface ReferenceSetters {
  setSource: (source: ReferenceSource) => void;
  setReferenceMode: (mode: ReferenceMode) => void;
  setFixedImageUrl: (url: string | null) => void;
  setLocalImageUrl: (url: string | null) => void;
  setReferenceInfo: (info: ReferenceInfo | null) => void;
  /**
   * Replace the whole reference state at once — preferred for source
   * switches so no field can be left stale. Build the argument with
   * `browseReference` / `loadedReference` (splitLayoutHelpers).
   */
  setAll: (state: ReferenceSnapshot) => void;
}

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null;
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>;
  onRegisterOverlayRedraw?: (redraw: () => void) => void;
  /** Rotoscope bridge: the YouTube player attaches its control here. */
  videoBridge?: VideoSyncBridge;
  onReferenceImageSize?: (width: number, height: number) => void;
  overlayActive?: boolean;
  onToggleOverlay?: () => void;
  // Read-only reference state (source of truth is SplitLayout)
  source: ReferenceSource;
  referenceMode: ReferenceMode;
  fixedImageUrl: string | null;
  localImageUrl: string | null;
  refInfo: ReferenceInfo | null;
  /** Apply a reference-state mutation with undo history recording. */
  onReferenceChange: (mutate: (setters: ReferenceSetters) => void) => void;
  /** Non-undoable reset used when an image fails to load. */
  onReferenceResetOnError: () => void;
  onRegisterLoadSketchfabModel?: (fn: (uid: string, meta?: SketchfabModelMeta) => void) => void;
  /**
   * Allows the parent to trigger a refresh of the URL history dropdown after
   * it adds an entry itself (e.g. Gallery "use this reference" reload).
   */
  onRegisterReloadUrlHistory?: (fn: () => void) => void;
  /** Notifies the parent when the Sketchfab 3D viewer iframe is mounted/unmounted. */
  onSketchfabViewerStateChange?: (active: boolean) => void;
  /** Optional: enables the "Start gesture session" control inside Pexels
   *  search. The parent owns the session state (useGestureSession). */
  onPexelsStartSession?: (config: import('./PexelsSearcher').PexelsGestureSessionConfig) => void;
  /** When true, the photographer/title overlay starts collapsed each time it
   *  mounts — used during a gesture session so the overlay doesn't cover
   *  the bottom of the reference image while the user is drawing. */
  collapseInfoOverlayByDefault?: boolean;
  /** When true, suppress guide-line drag interactions on the reference
   *  viewer for the duration of a session — guide editing doesn't fit a
   *  rapid-pose flow, and a leftover-from-before guide-add mode would
   *  otherwise interpret a reflexive reference-panel stroke as a guide.
   *  Also disables the guide-add/delete toolbar buttons so the user can't
   *  accidentally toggle into guide mode mid-session. */
  suppressGuideEditing?: boolean;
  isFlipped?: boolean;
  onToggleFlip?: () => void;
  /** Optional shared ViewTransform for zoom sync with DrawingPanel. */
  viewTransform?: ViewTransform;
  /** Which panel owns the fit calculation. */
  fitLeader?: 'reference' | 'drawing';
  /** Latest trace-template scoring feedback for the active template stroke. */
  traceFeedback?: TraceFeedback | null;
}

export function ReferencePanel({
  overlayStrokes,
  overlayCurrentStrokeRef,
  onRegisterOverlayRedraw,
  videoBridge,
  onReferenceImageSize,
  overlayActive,
  onToggleOverlay,
  source,
  referenceMode,
  fixedImageUrl,
  localImageUrl,
  refInfo,
  onReferenceChange,
  onReferenceResetOnError,
  onRegisterLoadSketchfabModel,
  onRegisterReloadUrlHistory,
  onSketchfabViewerStateChange,
  onPexelsStartSession,
  collapseInfoOverlayByDefault = false,
  suppressGuideEditing = false,
  isFlipped,
  onToggleFlip,
  viewTransform,
  fitLeader,
  traceFeedback = null,
}: ReferencePanelProps) {
  const {
    grid,
    lines,
    version: guideVersion,
    setGridMode,
    addLine,
    removeLine,
    clearLines,
    placingCenter,
    placePerspectiveCenter,
    masks,
    masksHidden,
    addMask,
    removeMask,
    clearMasks,
    setMasksHidden,
    masksPeeking,
    setMasksPeeking,
  } = useGuides();
  // Viewers render the EFFECTIVE hidden state: a hold-to-peek reveals without
  // touching the persisted masksHidden (so no autosave fires).
  const effectiveMasksHidden = masksHidden && !masksPeeking;
  const { isFullscreen, toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen();
  const [viewResetVersion, setViewResetVersion] = useState(0);
  const [, setViewTick] = useState(0);
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('none');
  // Effective guide mode passed to viewers — forced to 'none' while a gesture
  // session is active so any reflexive reference-panel stroke can't be
  // interpreted as a guide-line drag. The user's selected guideMode is
  // preserved in state and restored automatically when the session ends.
  // The perspective-anchor placement mode (armed from the drawing-side
  // controller) takes precedence over the local guide-line modes so the next
  // tap on either panel places the anchor.
  const effectiveGuideMode: GuideInteractionMode = suppressGuideEditing
    ? 'none'
    : placingCenter
      ? 'place-center'
      : guideMode;
  const [highlightedGuideId, setHighlightedGuideId] = useState<string | null>(null);

  // Re-render when the shared ViewTransform changes so the reset button can
  // reflect the current dirty state.
  useEffect(() => {
    if (!viewTransform) return;
    return viewTransform.subscribe(() => setViewTick((t) => t + 1));
  }, [viewTransform]);

  const resetDisabled = viewTransform ? !viewTransform.isDirty() : false;

  // Sketchfab viewer state (reported by child)
  const [sfShowViewer, setSfShowViewer] = useState(false);
  const [sfIsReady, setSfIsReady] = useState(false);
  const sfActionsRef = useRef<SketchfabActions | null>(null);

  // Pexels API key dialog state
  const [pexelsKeyDialogOpen, setPexelsKeyDialogOpen] = useState(false);
  const [pexelsKeyVersion, setPexelsKeyVersion] = useState(0);
  // Set when the user clicked the Pexels source button without an API key
  // configured: we open the key dialog first and, on successful save, finish
  // the original "open Pexels" intent. Cleared on cancel/clear so the next
  // dialog opening (e.g. from the gear icon) doesn't get hijacked. Ref instead
  // of state — no UI depends on it, and avoiding a re-render between the two
  // setStates in handleOpenPexels keeps the dialog open path single-frame.
  const pendingPexelsOpenRef = useRef(false);
  // Distinguishes "dialog opened because the searcher is stranded on a
  // disabled screen" from other dialog opens — only this case bounces out
  // on Cancel. (Every searcher control is `disabled={needsKey}`, so without
  // an exit the user has no way off the screen.)
  const pendingPexelsRecoveryRef = useRef(false);

  // Anthropic (pose generation) API key dialog state. The pending-generate
  // handling lives inside PoseSourcePanel, keyed off anthropicKeyVersion.
  const [anthropicKeyDialogOpen, setAnthropicKeyDialogOpen] = useState(false);
  const [anthropicKeyVersion, setAnthropicKeyVersion] = useState(0);
  const poseActionsRef = useRef<PoseSourceActions | null>(null);
  const [poseViewerReady, setPoseViewerReady] = useState(false);

  // Per-URL-history-entry Pexels search context restore. Bumping `token`
  // remounts PexelsSearcher with the entry's saved query+orientation so
  // "back to search" returns to the search that originally produced this
  // photo, not the most recent global search.
  const [pexelsRestore, setPexelsRestore] = useState<{
    token: number;
    query: string;
    orientation: PexelsOrientationFilter;
  } | null>(null);

  // Sketchfab equivalent — bumping `token` remounts SketchfabViewer with the
  // saved query/category/timeFilter so URL-history loads land on the search
  // that originally produced the model.
  const [sketchfabRestore, setSketchfabRestore] = useState<{
    token: number;
    query: string;
    category?: SketchfabCategorySlug;
    timeFilter: SketchfabTimeFilter;
  } | null>(null);

  const applySketchfabRestore = useCallback(
    (ctx: { query: string; category?: SketchfabCategorySlug; timeFilter: SketchfabTimeFilter }) => {
      setSketchfabRestore((prev) => {
        // Skip the remount when the user re-selects an entry with the exact same
        // search context — bumping token would dump the iframe + searchResults
        // for nothing.
        if (
          prev &&
          prev.query === ctx.query &&
          prev.category === ctx.category &&
          prev.timeFilter === ctx.timeFilter
        )
          return prev;
        return { token: (prev?.token ?? 0) + 1, ...ctx };
      });
    },
    [],
  );

  const applyPexelsRestore = useCallback(
    (ctx: { query: string; orientation: PexelsOrientationFilter }) => {
      setPexelsRestore((prev) => ({ token: (prev?.token ?? 0) + 1, ...ctx }));
    },
    [],
  );

  // Load a Sketchfab model by UID. The rAF lets a just-switched-to Sketchfab
  // source mount its viewer (and register sfActionsRef) first. Also exposed to
  // the parent for gallery "Use this reference".
  const loadSketchfabModel = useCallback((uid: string, meta?: SketchfabModelMeta) => {
    requestAnimationFrame(() => {
      sfActionsRef.current?.loadModelByUid(uid, meta);
    });
  }, []);

  const {
    urlInput,
    changeUrlInput,
    urlError,
    reportLoadError,
    urlLoading,
    urlHistory,
    urlHistoryThumbnails,
    addAndReloadHistory,
    loadLocalImage: handleLoadLocalImage,
    loadFromUrl: handleLoadFromUrl,
    selectHistoryEntry: handleSelectHistoryEntry,
    deleteHistoryEntry: handleDeleteHistoryEntry,
  } = useUrlReferenceLoader({
    onReferenceChange,
    applySketchfabRestore,
    applyPexelsRestore,
    loadSketchfabModel,
    onRegisterReloadUrlHistory,
  });

  // videoInteractMode: overlay steps aside so the iframe receives clicks.
  // Entered automatically on single-tap, exited via the toolbar button.
  // playing: mirrors the iframe's own player state for the toolbar icon.
  const [youtubeVideoInteractMode, setYoutubeVideoInteractMode] = useState(false);
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const youtubePlayerRef = useRef<YouTubePlayerHandle | null>(null);

  // Swapping videos must drop stale interaction/playback UI state so the new
  // player opens in zoom mode and the toolbar icon doesn't briefly reflect the
  // previous video. React recommends resetting state on prop change during
  // render (see https://react.dev/reference/react/useState#storing-information-from-previous-renders);
  // moving this into an effect would trip react-hooks/set-state-in-effect.
  const youtubeVideoId = refInfo?.source === 'youtube' ? refInfo.youtubeVideoId : null;
  const [prevYoutubeKey, setPrevYoutubeKey] = useState<string | null>(null);
  const nextYoutubeKey = source === 'youtube' && youtubeVideoId ? youtubeVideoId : null;
  if (prevYoutubeKey !== nextYoutubeKey) {
    setPrevYoutubeKey(nextYoutubeKey);
    setYoutubeVideoInteractMode(false);
    setYoutubePlaying(false);
  }

  // Leaving the pose source unmounts PoseSourcePanel without a ready=false
  // callback; reset during render (same pattern as the YouTube state above)
  // so re-entering doesn't show "Fix This Angle" before the viewer loads.
  if (source !== 'pose' && poseViewerReady) {
    setPoseViewerReady(false);
  }

  const handleFixAngle = useCallback(
    (screenshotUrl: string, info: ReferenceInfo, extras: SketchfabFixAngleExtras) => {
      onReferenceChange((s) => {
        s.setFixedImageUrl(screenshotUrl);
        s.setReferenceInfo(info);
        s.setReferenceMode('fixed');
      });
      if (info.source !== 'sketchfab' || !info.sketchfabUid) return;
      const historyKey = canonicalSketchfabUrl(info.sketchfabUid);
      const titleForHistory = info.title || undefined;
      const sketchfabSearchContext = extras.searchContext ?? undefined;
      // Convert the 1024x1024 PNG screenshot to a ~200KB JPEG Blob so URL-
      // history sketchfab selection can restore directly into fixed mode (the
      // same UX as gallery "Use this reference"). Falls back to the model CDN
      // thumbnail URL if the encode fails — at least the dropdown still shows
      // something.
      void dataUrlToJpegBlob(screenshotUrl)
        .then((blob) => {
          void addAndReloadHistory(historyKey, 'sketchfab', {
            title: titleForHistory,
            ...(blob ? { imageBlob: blob } : {}),
            ...(blob ? {} : { thumbnailUrl: extras.modelThumbnailUrl ?? undefined }),
            sketchfabSearchContext,
          });
        })
        .catch(() => {
          /* best-effort */
        });
    },
    [onReferenceChange, addAndReloadHistory],
  );

  // Shared by Sketchfab and pose fixed mode: back to the live 3D view.
  const handleChangeAngle = useCallback(() => {
    onReferenceChange((s) => {
      s.setReferenceMode('browse');
      s.setFixedImageUrl(null);
    });
  }, [onReferenceChange]);

  const handleClose = useCallback(() => {
    resetPageZoom();
    onReferenceChange((s) => s.setAll(browseReference('none')));
    setGuideMode('none');
    setHighlightedGuideId(null);
  }, [onReferenceChange]);

  const handleOpenSketchfab = useCallback(() => {
    // Clear any leftover URL-history restoration so re-entering Sketchfab
    // from the top screen starts with no category preselected — otherwise
    // the SketchfabViewer would remount with stale initialCategory and the
    // user can't get back to "all works" browsing.
    setSketchfabRestore(null);
    onReferenceChange((s) => s.setAll(browseReference('sketchfab')));
  }, [onReferenceChange]);

  const enterPexelsBrowse = useCallback(() => {
    onReferenceChange((s) => s.setAll(browseReference('pexels')));
  }, [onReferenceChange]);

  const handleOpenPexels = useCallback(() => {
    if (getPexelsApiKey() === '') {
      // No key yet — open the settings dialog and remember we wanted Pexels
      // so the save handler can finish the navigation.
      pendingPexelsOpenRef.current = true;
      setPexelsKeyDialogOpen(true);
      return;
    }
    enterPexelsBrowse();
  }, [enterPexelsBrowse]);

  // Stable identity required: the searcher's effect deps include this, so a
  // new identity each render would re-fire while needsKey stays true.
  const handlePexelsApiKeyMissing = useCallback(() => {
    pendingPexelsRecoveryRef.current = true;
    setPexelsKeyDialogOpen(true);
  }, []);

  const handleSelectPexelsPhoto = useCallback(
    (info: Extract<ReferenceInfo, { source: 'pexels' }>, thumbnailUrl: string) => {
      onReferenceChange((s) =>
        s.setAll(loadedReference(info, 'fixed', { fixedImageUrl: info.pexelsImageUrl })),
      );
      if (info.pexelsPageUrl) {
        // runSearch saves to localStorage right before yielding the result list,
        // so getPexelsLastSearch() here reflects the search that produced this
        // photo. Persisting it per-entry lets URL-history loads restore the
        // originating search context independently of the global last search.
        void addAndReloadHistory(info.pexelsPageUrl, 'pexels', {
          title: info.title,
          thumbnailUrl,
          pexelsSearchContext: getPexelsLastSearch() ?? undefined,
        });
      }
    },
    [onReferenceChange, addAndReloadHistory],
  );

  const handleBackToPexelsSearch = useCallback(() => {
    onReferenceChange((s) => {
      s.setReferenceMode('browse');
      s.setFixedImageUrl(null);
    });
  }, [onReferenceChange]);

  // Hierarchical Esc for Sketchfab/Pexels: viewer/fixed → search → picker.
  // Other sources (image, youtube, sketchfab fixed after Fix Angle) are
  // intentionally excluded — closing the reference would be a destructive
  // surprise (strokes survive but undo would be required).
  useEffect(() => {
    const action: (() => void) | null = (() => {
      if (source === 'sketchfab' && referenceMode === 'browse') {
        return sfShowViewer ? () => sfActionsRef.current?.back() : handleClose;
      }
      if (source === 'pexels') {
        return referenceMode === 'fixed' ? handleBackToPexelsSearch : handleClose;
      }
      return null;
    })();
    if (!action) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // MUI Autocomplete preventDefault()s Esc when its dropdown is open
      // (closing the popper). Defer to that and don't escape the screen.
      if (e.defaultPrevented) return;
      // Backstop: the popper is portaled to body, so we can detect an open
      // dropdown directly. Covers MUI version differences in preventDefault
      // behavior.
      if (document.querySelector('.MuiAutocomplete-popper')) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [source, referenceMode, sfShowViewer, handleClose, handleBackToPexelsSearch]);

  const handleSfStateChange = useCallback(
    (state: { showViewer: boolean; isReady: boolean }) => {
      setSfShowViewer(state.showViewer);
      setSfIsReady(state.isReady);
      onSketchfabViewerStateChange?.(state.showViewer);
    },
    [onSketchfabViewerStateChange],
  );

  // Expose loadSketchfabModel to parent
  useEffect(() => {
    onRegisterLoadSketchfabModel?.(loadSketchfabModel);
  }, [onRegisterLoadSketchfabModel, loadSketchfabModel]);

  const handleImageError = useCallback(() => {
    reportLoadError();
    // Non-undoable reset — undoing back to a broken URL would just trigger
    // the same error again.
    onReferenceResetOnError();
  }, [onReferenceResetOnError, reportLoadError]);

  const handleAddGuideLine = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      addLine(x1, y1, x2, y2);
    },
    [addLine],
  );

  const handleAddMask = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      addMask(x1, y1, x2, y2);
    },
    [addMask],
  );

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedGuideId) {
      removeLine(highlightedGuideId);
      // 削除後、削除した線の一つ前を自動選択
      const idx = lines.findIndex((l) => l.id === highlightedGuideId);
      const prevIdx = idx - 1;
      setHighlightedGuideId(prevIdx >= 0 ? lines[prevIdx].id : null);
    }
  }, [highlightedGuideId, removeLine, lines]);

  const handleCancelHighlight = useCallback(() => {
    setHighlightedGuideId(null);
  }, []);

  const toggleGuideMode = useCallback(
    (mode: GuideInteractionMode) => {
      setGuideMode((prev) => {
        const nextMode = prev === mode ? 'none' : mode;
        // deleteモードに入る時、最新の補助線を自動選択
        if (nextMode === 'delete' && lines.length > 0) {
          setHighlightedGuideId(lines[lines.length - 1].id);
        } else {
          setHighlightedGuideId(null);
        }
        return nextMode;
      });
    },
    [lines],
  );

  const displayImageUrl = source === 'image' ? localImageUrl : fixedImageUrl; // 'sketchfab', 'url', 'pexels' use fixedImageUrl
  // The URL ImageViewer mounts on. Shared predicate with the drawing-canvas
  // underlay (splitLayoutHelpers) so the underlay is available exactly when
  // this fixed image is on screen.
  const imageViewerUrl = resolveFixedImageUrl(source, referenceMode, fixedImageUrl, localImageUrl);
  const traceTemplateInfo = refInfo?.source === 'trace-template' ? refInfo : null;
  const activeTraceTemplate: TraceTemplate | null =
    source === 'trace-template' && referenceMode === 'fixed' && traceTemplateInfo
      ? (getBundledTemplate(traceTemplateInfo.templateId) ?? null)
      : null;
  const isTraceFixed = !!activeTraceTemplate;
  const isFixed = (referenceMode === 'fixed' && !!displayImageUrl) || isTraceFixed;
  const isNone = source === 'none';
  const isTraceBrowse = source === 'trace-template' && referenceMode === 'browse';

  const handleOpenTraceTemplate = useCallback(() => {
    onReferenceChange((s) => s.setAll(browseReference('trace-template')));
  }, [onReferenceChange]);

  const handleSelectTraceTemplate = useCallback(
    (tmpl: TraceTemplate) => {
      onReferenceChange((s) => {
        s.setAll(
          loadedReference(
            {
              title: t(tmpl.titleKey),
              author: 'Drawing Practice',
              source: 'trace-template',
              templateId: tmpl.id,
            },
            'fixed',
          ),
        );
      });
    },
    [onReferenceChange],
  );

  const handleBackToTraceTemplatePicker = useCallback(() => {
    onReferenceChange((s) => {
      s.setReferenceMode('browse');
      s.setReferenceInfo(null);
    });
  }, [onReferenceChange]);

  const handleOpenPose = useCallback(() => {
    // Unlike Pexels, entering without an API key is fine — the user can
    // sketch first; generation prompts for the key when actually needed.
    onReferenceChange((s) => s.setAll(browseReference('pose')));
  }, [onReferenceChange]);

  const handleRequestAnthropicKey = useCallback(() => {
    setAnthropicKeyDialogOpen(true);
  }, []);
  // Sketchfab browse mode: either searching or viewing a model
  const isSfBrowse = source === 'sketchfab' && referenceMode === 'browse';
  const isPoseBrowse = source === 'pose' && referenceMode === 'browse';
  const poseInfo = refInfo?.source === 'pose' ? refInfo : null;
  const isYouTube = source === 'youtube';
  // Canvas-bound tools are hidden while the overlay is transparent — they
  // have nothing to act on in that mode.
  const inYouTubeVideoMode = isYouTube && youtubeVideoInteractMode;

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid #ddd',
          bgcolor: '#fafafa',
          minHeight: 40,
        }}
      >
        {/* Close button (when source is set) */}
        {!isNone && (
          <ToolbarTooltip title={t('cancel')}>
            <IconButton size="small" onClick={handleClose}>
              <X size={20} />
            </IconButton>
          </ToolbarTooltip>
        )}

        {/* Search-screen title — only on Sketchfab/Pexels browse screens, where
            the bare search UI doesn't otherwise reveal which service it is. */}
        {isSfBrowse && !sfShowViewer && (
          <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ ml: 0.5 }}>
            {t('sketchfab')}
          </Typography>
        )}
        {source === 'pexels' && referenceMode === 'browse' && (
          <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ ml: 0.5 }}>
            {t('pexels')}
          </Typography>
        )}

        {/* Sketchfab model viewer: Back to search results */}
        {isSfBrowse && sfShowViewer && (
          <Button size="small" variant="outlined" onClick={() => sfActionsRef.current?.back()}>
            {t('back')}
          </Button>
        )}

        {/* Sketchfab model viewer: Fix This Angle button */}
        {isSfBrowse && sfShowViewer && sfIsReady && (
          <Button
            size="small"
            variant="contained"
            color="success"
            onClick={() => sfActionsRef.current?.fixAngle()}
          >
            {t('fixThisAngle')}
          </Button>
        )}

        {/* Fixed mode: Change Angle (Sketchfab only) */}
        {isFixed && source === 'sketchfab' && (
          <Button size="small" variant="outlined" onClick={handleChangeAngle}>
            {t('changeAngle')}
          </Button>
        )}

        {/* Fixed mode: Back to Pexels search */}
        {isFixed && source === 'pexels' && (
          <Button size="small" variant="outlined" onClick={handleBackToPexelsSearch}>
            {t('pexelsBackToSearch')}
          </Button>
        )}

        {/* Pose browse: title + Fix This Angle */}
        {isPoseBrowse && (
          <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ ml: 0.5 }}>
            {t('pose')}
          </Typography>
        )}
        {isPoseBrowse && poseViewerReady && (
          <Button
            size="small"
            variant="contained"
            color="success"
            onClick={() => poseActionsRef.current?.fixAngle()}
          >
            {t('fixThisAngle')}
          </Button>
        )}

        {/* Fixed mode: Change Angle (pose) */}
        {isFixed && source === 'pose' && (
          <Button size="small" variant="outlined" onClick={handleChangeAngle}>
            {t('changeAngle')}
          </Button>
        )}

        {/* Trace template picker title (browse mode) */}
        {isTraceBrowse && (
          <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ ml: 0.5 }}>
            {t('traceTemplate')}
          </Typography>
        )}

        {/* Fixed mode: Back to trace template picker */}
        {isTraceFixed && (
          <Button size="small" variant="outlined" onClick={handleBackToTraceTemplatePicker}>
            {t('backToTemplatePicker')}
          </Button>
        )}

        {/* Works in both modes — pausing shouldn't require giving up zoom. */}
        {isYouTube && (
          <ToolbarTooltip title={youtubePlaying ? t('youtubePause') : t('youtubePlay')}>
            <IconButton
              size="small"
              onClick={() => {
                if (youtubePlaying) {
                  youtubePlayerRef.current?.pause();
                } else {
                  youtubePlayerRef.current?.play();
                }
              }}
            >
              {youtubePlaying ? <Pause size={20} /> : <Play size={20} />}
            </IconButton>
          </ToolbarTooltip>
        )}

        {isYouTube && youtubeVideoInteractMode && (
          <ToolbarTooltip title={t('youtubeReturnToZoom')}>
            <IconButton
              size="small"
              aria-label={t('youtubeReturnToZoom')}
              onClick={() => setYoutubeVideoInteractMode(false)}
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              <ZoomIn size={20} />
            </IconButton>
          </ToolbarTooltip>
        )}

        {/* Guide line tools — add/delete-mode require a viewer to interact with. */}
        {(isFixed || isYouTube) && !inYouTubeVideoMode && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

            <ToolbarTooltip title={t('addGuideLine')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => toggleGuideMode('add')}
                  disabled={suppressGuideEditing}
                  sx={{
                    bgcolor: effectiveGuideMode === 'add' ? 'error.main' : 'transparent',
                    color: effectiveGuideMode === 'add' ? 'white' : 'inherit',
                    '&:hover': {
                      bgcolor: effectiveGuideMode === 'add' ? 'error.dark' : 'action.hover',
                    },
                  }}
                >
                  <PenLine size={20} />
                </IconButton>
              </span>
            </ToolbarTooltip>

            <ToolbarTooltip title={t('deleteGuideLine')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => toggleGuideMode('delete')}
                  disabled={lines.length === 0 || suppressGuideEditing}
                  sx={{
                    bgcolor: effectiveGuideMode === 'delete' ? 'error.main' : 'transparent',
                    color: effectiveGuideMode === 'delete' ? 'white' : 'inherit',
                    '&:hover': {
                      bgcolor: effectiveGuideMode === 'delete' ? 'error.dark' : 'action.hover',
                    },
                  }}
                >
                  <CircleX size={20} />
                </IconButton>
              </span>
            </ToolbarTooltip>

            <ToolbarTooltip title={t('clearGuideLines')}>
              <span>
                <IconButton size="small" onClick={clearLines} disabled={lines.length === 0}>
                  <Trash2 size={20} />
                </IconButton>
              </span>
            </ToolbarTooltip>
          </>
        )}

        {/* Reference masks — hide part of the reference to draw it from
            inference. Same visibility rule as the guide-line tools. */}
        {(isFixed || isYouTube) && !inYouTubeVideoMode && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />

            <ToolbarTooltip title={t('addMask')}>
              <span>
                {/* The Tooltip labels the wrapping <span>, not the button, so
                    name the button itself for assistive tech. */}
                <IconButton
                  size="small"
                  aria-label={t('addMask')}
                  onClick={() => toggleGuideMode('mask')}
                  disabled={suppressGuideEditing}
                  sx={{
                    bgcolor: effectiveGuideMode === 'mask' ? 'error.main' : 'transparent',
                    color: effectiveGuideMode === 'mask' ? 'white' : 'inherit',
                    '&:hover': {
                      bgcolor: effectiveGuideMode === 'mask' ? 'error.dark' : 'action.hover',
                    },
                  }}
                >
                  <SquareDashed size={20} />
                </IconButton>
              </span>
            </ToolbarTooltip>

            {masks.length > 0 && (
              <MaskRevealButton
                masksHidden={masksHidden}
                peeking={masksPeeking}
                onToggle={() => setMasksHidden(!masksHidden)}
                onPeekStart={() => setMasksPeeking(true)}
                onPeekEnd={() => setMasksPeeking(false)}
              />
            )}

            {masks.length > 0 && (
              <ToolbarTooltip title={t('clearMasks')}>
                <IconButton size="small" onClick={clearMasks}>
                  <SquareX size={20} />
                </IconButton>
              </ToolbarTooltip>
            )}
          </>
        )}

        {/* Clear-all works on guide state alone, so stay available even with no
            reference loaded — otherwise stale guides / masks become undeletable. */}
        {!(isFixed || isYouTube) && (lines.length > 0 || masks.length > 0) && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
            {lines.length > 0 && (
              <ToolbarTooltip title={t('clearGuideLines')}>
                <IconButton size="small" onClick={clearLines}>
                  <Trash2 size={20} />
                </IconButton>
              </ToolbarTooltip>
            )}
            {masks.length > 0 && (
              <ToolbarTooltip title={t('clearMasks')}>
                <IconButton size="small" onClick={clearMasks}>
                  <SquareX size={20} />
                </IconButton>
              </ToolbarTooltip>
            )}
          </>
        )}

        {/* Delete confirmation */}
        {highlightedGuideId && !inYouTubeVideoMode && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
            <ToolbarTooltip title={t('delete')}>
              <IconButton
                size="small"
                onClick={handleDeleteHighlighted}
                sx={{
                  bgcolor: 'error.main',
                  color: 'white',
                  '&:hover': { bgcolor: 'error.dark' },
                }}
              >
                <Trash2 size={20} />
              </IconButton>
            </ToolbarTooltip>
            <ToolbarTooltip title={t('cancel')}>
              <IconButton size="small" onClick={handleCancelHighlight}>
                <X size={20} />
              </IconButton>
            </ToolbarTooltip>
          </>
        )}

        <Box sx={{ flex: 1 }} />

        {/* View controls (always visible) */}
        {(isFixed || isYouTube) && !inYouTubeVideoMode && (
          <ToolbarTooltip title={t('compare')}>
            <IconButton
              size="small"
              onClick={onToggleOverlay}
              sx={{
                bgcolor: overlayActive ? 'warning.main' : 'transparent',
                color: overlayActive ? 'white' : 'inherit',
                '&:hover': { bgcolor: overlayActive ? 'warning.dark' : 'action.hover' },
              }}
            >
              <Layers size={20} />
            </IconButton>
          </ToolbarTooltip>
        )}

        <GridModePopoverButton grid={grid} onSetGridMode={setGridMode} />

        {!isYouTube && (
          <ToolbarTooltip title={t('flipHorizontal')}>
            <IconButton
              size="small"
              onClick={onToggleFlip}
              sx={{
                bgcolor: isFlipped ? 'info.main' : 'transparent',
                color: isFlipped ? 'white' : 'inherit',
                '&:hover': { bgcolor: isFlipped ? 'info.dark' : 'action.hover' },
              }}
            >
              <FlipHorizontal2 size={20} />
            </IconButton>
          </ToolbarTooltip>
        )}

        {isFixed && (
          <ToolbarTooltip title={t('resetZoom')}>
            <span>
              <IconButton
                size="small"
                onClick={() => setViewResetVersion((v) => v + 1)}
                disabled={resetDisabled}
              >
                <LocateFixed size={20} />
              </IconButton>
            </span>
          </ToolbarTooltip>
        )}

        {fullscreenSupported && (
          <ToolbarTooltip title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}>
            <IconButton size="small" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </IconButton>
          </ToolbarTooltip>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* No source: show selection buttons in center */}
        {isNone && (
          <SourcePicker
            onOpenSketchfab={handleOpenSketchfab}
            onOpenPexels={handleOpenPexels}
            onOpenPexelsKeySettings={() => setPexelsKeyDialogOpen(true)}
            onLoadLocalImage={handleLoadLocalImage}
            onOpenTraceTemplate={handleOpenTraceTemplate}
            onOpenPose={handleOpenPose}
            onOpenAnthropicKeySettings={() => setAnthropicKeyDialogOpen(true)}
            urlLoading={urlLoading}
            urlError={urlError}
            urlInput={
              <UrlHistoryAutocomplete
                history={urlHistory}
                thumbnails={urlHistoryThumbnails}
                inputValue={urlInput}
                onInputChange={changeUrlInput}
                onSelectEntry={handleSelectHistoryEntry}
                onSubmit={handleLoadFromUrl}
                onDeleteEntry={handleDeleteHistoryEntry}
                loading={urlLoading}
              />
            }
          />
        )}

        {/* Sketchfab viewer (kept mounted when source is sketchfab).
            Bumping sketchfabRestore.token via key remounts with the per-entry
            search context restored from the URL-history entry. */}
        {source === 'sketchfab' && (
          <Box sx={{ display: referenceMode === 'browse' ? 'contents' : 'none' }}>
            <LazyErrorBoundary>
              <Suspense fallback={<LazyPanelFallback />}>
                <SketchfabViewer
                  key={sketchfabRestore?.token ?? 0}
                  onFixAngle={handleFixAngle}
                  onStateChange={handleSfStateChange}
                  actionsRef={sfActionsRef}
                  initialQuery={sketchfabRestore?.query}
                  initialTimeFilter={sketchfabRestore?.timeFilter}
                  initialCategory={sketchfabRestore?.category}
                />
              </Suspense>
            </LazyErrorBoundary>
          </Box>
        )}

        {/* Pexels searcher — kept mounted while source is 'pexels' so the
            search state (query, results, pagination, scroll) persists across
            browse ↔ fixed transitions. Hidden when a photo is being viewed.
            Bumping pexelsRestore.token via key remounts with the per-photo
            search context restored from the URL-history entry. */}
        {source === 'pexels' && (
          <Box sx={{ display: referenceMode === 'browse' ? 'contents' : 'none' }}>
            <LazyErrorBoundary>
              <Suspense fallback={<LazyPanelFallback />}>
                <PexelsSearcher
                  key={pexelsRestore?.token ?? 0}
                  onSelectPhoto={handleSelectPexelsPhoto}
                  onApiKeyMissing={handlePexelsApiKeyMissing}
                  active={referenceMode === 'browse'}
                  apiKeyVersion={pexelsKeyVersion}
                  initialQuery={pexelsRestore?.query}
                  initialOrientation={pexelsRestore?.orientation}
                  onStartSession={onPexelsStartSession}
                />
              </Suspense>
            </LazyErrorBoundary>
          </Box>
        )}

        {/* Pose mannequin panel — kept mounted while source is 'pose' so the
            generated pose, sketch, and orbit camera survive fixed ↔ browse
            transitions ("Change Angle"), same as the Pexels searcher. */}
        {source === 'pose' && (
          <Box sx={{ height: '100%', display: referenceMode === 'browse' ? 'block' : 'none' }}>
            <LazyErrorBoundary>
              <Suspense fallback={<LazyPanelFallback />}>
                <PoseSourcePanel
                  poseInfo={poseInfo}
                  onReferenceChange={onReferenceChange}
                  onRequestApiKey={handleRequestAnthropicKey}
                  apiKeyVersion={anthropicKeyVersion}
                  active={referenceMode === 'browse'}
                  actionsRef={poseActionsRef}
                  onViewerReadyChange={setPoseViewerReady}
                />
              </Suspense>
            </LazyErrorBoundary>
          </Box>
        )}

        {/* YouTube viewer */}
        {refInfo?.source === 'youtube' && (
          <YouTubeViewer
            ref={youtubePlayerRef}
            videoId={refInfo.youtubeVideoId}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            overlayCurrentStrokeRef={overlayCurrentStrokeRef}
            onRegisterOverlayRedraw={onRegisterOverlayRedraw}
            onFitSize={onReferenceImageSize}
            guideMode={effectiveGuideMode}
            onAddGuideLine={handleAddGuideLine}
            onPlaceCenter={placePerspectiveCenter}
            masks={masks}
            masksHidden={effectiveMasksHidden}
            onAddMask={handleAddMask}
            onRemoveMask={removeMask}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
            videoInteractMode={youtubeVideoInteractMode}
            onRequestVideoInteract={() => setYoutubeVideoInteractMode(true)}
            onPlayerStateChange={setYoutubePlaying}
            videoBridge={videoBridge}
          />
        )}

        {/* Reference info overlay */}
        {isFixed && refInfo && (refInfo.title || refInfo.author) && (
          <ReferenceInfoOverlay
            key={referenceKey(refInfo)}
            refInfo={refInfo}
            initialCollapsed={collapseInfoOverlayByDefault}
          />
        )}

        {/* Trace template picker (browse mode) */}
        {isTraceBrowse && <BundledTemplatePicker onSelect={handleSelectTraceTemplate} />}

        {/* Trace template viewer (fixed mode) */}
        {activeTraceTemplate && (
          <TraceTemplateViewer
            template={activeTraceTemplate}
            viewResetVersion={viewResetVersion}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            overlayCurrentStrokeRef={overlayCurrentStrokeRef}
            onRegisterOverlayRedraw={onRegisterOverlayRedraw}
            onTemplateLoaded={onReferenceImageSize}
            guideMode={effectiveGuideMode}
            onAddGuideLine={handleAddGuideLine}
            onPlaceCenter={placePerspectiveCenter}
            masks={masks}
            masksHidden={effectiveMasksHidden}
            onAddMask={handleAddMask}
            onRemoveMask={removeMask}
            onDeleteGuideLine={removeLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            isFlipped={isFlipped}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
            traceFeedback={traceFeedback}
          />
        )}

        {/* Fixed image */}
        {imageViewerUrl && (
          <ImageViewer
            imageUrl={imageViewerUrl}
            viewResetVersion={viewResetVersion}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            overlayCurrentStrokeRef={overlayCurrentStrokeRef}
            onRegisterOverlayRedraw={onRegisterOverlayRedraw}
            onImageLoaded={onReferenceImageSize}
            onImageError={handleImageError}
            guideMode={effectiveGuideMode}
            onAddGuideLine={handleAddGuideLine}
            onPlaceCenter={placePerspectiveCenter}
            masks={masks}
            masksHidden={effectiveMasksHidden}
            onAddMask={handleAddMask}
            onRemoveMask={removeMask}
            onDeleteGuideLine={removeLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            isFlipped={isFlipped}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
          />
        )}
      </Box>

      <AnthropicApiKeyDialog
        open={anthropicKeyDialogOpen}
        onClose={() => {
          setAnthropicKeyDialogOpen(false);
          // Bump on EVERY close (save, clear, or cancel) — PoseSourcePanel
          // resolves its pending-generate intent on this signal, and a
          // cancelled dialog must clear the intent rather than leave it armed
          // for a later unrelated key save.
          setAnthropicKeyVersion((v) => v + 1);
        }}
      />

      <PexelsApiKeyDialog
        open={pexelsKeyDialogOpen}
        onClose={() => {
          setPexelsKeyDialogOpen(false);
          // Cancel drops the pending intent so the next gear-icon opening
          // doesn't get hijacked into navigating to Pexels.
          pendingPexelsOpenRef.current = false;
          // Recovery flag still set ⇒ user did NOT save a valid key (Cancel or
          // Clear). Exit via handleClose so it routes through onReferenceChange
          // and is recorded in undo history.
          if (pendingPexelsRecoveryRef.current) {
            pendingPexelsRecoveryRef.current = false;
            handleClose();
          }
        }}
        onKeyChanged={() => {
          setPexelsKeyVersion((v) => v + 1);
          // Clear-with-empty-key keeps the user where they are; Save fires
          // only with a non-empty key (the dialog disables Save otherwise).
          if (pendingPexelsOpenRef.current) {
            pendingPexelsOpenRef.current = false;
            if (getPexelsApiKey() !== '') enterPexelsBrowse();
          }
          // Save with a valid key resolves recovery — clear the flag so the
          // following onClose doesn't bounce the user out. Clear leaves it set,
          // and onClose will exit (the "give up" path).
          if (pendingPexelsRecoveryRef.current && getPexelsApiKey() !== '') {
            pendingPexelsRecoveryRef.current = false;
          }
        }}
      />
    </Box>
  );
}
