import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Box, Button, IconButton, Typography, TextField, Link as MuiLink, Autocomplete } from '@mui/material'
import { ToolbarTooltip } from './ToolbarTooltip'
import { X, PenLine, CircleX, Trash2, Layers, FlipHorizontal2, LocateFixed, Maximize, Minimize, Info, Film, Camera, Image as ImageIcon, Play, Pause, ZoomIn, Boxes, FolderOpen, KeyRound } from 'lucide-react'
import { SketchfabViewer, type SketchfabActions, type SketchfabFixAngleExtras, type SketchfabModelMeta } from './SketchfabViewer'
import { ImageViewer, type GuideInteractionMode } from './ImageViewer'
import type { ViewTransform } from '../drawing/ViewTransform'
import { YouTubeViewer, type YouTubePlayerHandle } from './YouTubeViewer'
import { PexelsSearcher } from './PexelsSearcher'
import { PexelsApiKeyDialog } from './PexelsApiKeyDialog'
import { GitHubIcon } from './GitHubIcon'
import { parseYouTubeVideoId, fetchYouTubeTitle } from '../utils/youtube'
import {
  buildPexelsReferenceInfo,
  getPexelsLastSearch,
  getPhoto,
  mapPexelsErrorKey,
  parsePexelsPhotoUrl,
  type PexelsOrientationFilter,
} from '../utils/pexels'
import { addUrlHistory, getUrlHistory, getUrlHistoryEntry, deleteUrlHistory, type UrlHistoryEntry, type UrlHistoryType, type AddUrlHistoryOptions } from '../storage'
import { resizeImageForHistory, dataUrlToJpegBlob, blobToDataUrl, sha256Hex } from '../utils/imageResize'
import { resolveHistoryThumbnailSrc } from './urlHistoryThumbnail'
import {
  canonicalSketchfabUrl,
  parseSketchfabModelUrl,
  type SketchfabCategorySlug,
  type SketchfabTimeFilter,
} from '../utils/sketchfab'

function describeHistoryUrl(entry: UrlHistoryEntry): { primary: string; secondary: string } {
  if (entry.type === 'image') {
    return { primary: entry.fileName ?? entry.title ?? t('localImage'), secondary: t('localImage') }
  }
  if (entry.title) return { primary: entry.title, secondary: entry.url }
  if (entry.type === 'youtube') {
    const id = parseYouTubeVideoId(entry.url)
    return { primary: id ? `YouTube · ${id}` : entry.url, secondary: entry.url }
  }
  let parsed: URL
  try {
    parsed = new URL(entry.url)
  } catch {
    return { primary: entry.url, secondary: '' }
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (entry.type === 'pexels') {
    const photoIndex = segments.indexOf('photo')
    const slug = photoIndex >= 0 ? segments[photoIndex + 1] : undefined
    return { primary: slug ? `Pexels · ${slug}` : entry.url, secondary: entry.url }
  }
  if (entry.type === 'sketchfab') {
    const parsed = parseSketchfabModelUrl(entry.url)
    return { primary: parsed ? `Sketchfab · ${parsed.uid.slice(0, 8)}` : entry.url, secondary: entry.url }
  }
  const filename = segments.pop()
  return { primary: filename || parsed.hostname, secondary: parsed.hostname }
}

function HistoryTypeIcon({ type }: { type: UrlHistoryType }) {
  if (type === 'youtube') return <Film size={14} />
  if (type === 'pexels') return <Camera size={14} />
  if (type === 'sketchfab') return <Boxes size={14} />
  // 'image' and 'url' both render with the generic image glyph.
  return <ImageIcon size={14} />
}

import { useGuides } from '../guides/useGuides'
import type { GridMode } from '../guides/types'
import { useFullscreen } from '../hooks/useFullscreen'
import { t } from '../i18n'
import type { Stroke } from '../drawing/types'
import { referenceKey, type ReferenceSource, type ReferenceMode, type ReferenceInfo } from '../types'

/**
 * Raw setters for the reference-related state living in SplitLayout. Exposed
 * through `onReferenceChange(setters => ...)` so that every user-initiated
 * mutation is routed through the undo history recording path.
 */
export interface ReferenceSetters {
  setSource: (source: ReferenceSource) => void
  setReferenceMode: (mode: ReferenceMode) => void
  setFixedImageUrl: (url: string | null) => void
  setLocalImageUrl: (url: string | null) => void
  setReferenceInfo: (info: ReferenceInfo | null) => void
}

function GridIcon({ mode }: { mode: GridMode }) {
  const size = 20
  const color = 'currentColor'
  if (mode === 'none') {
    // Empty square outline — no grid
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5">
        <rect x="1" y="1" width="18" height="18" rx="1" />
      </svg>
    )
  }
  if (mode === 'large') {
    // 2x2 grid with thick center lines
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
        <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
        <line x1="10" y1="1" x2="10" y2="19" strokeWidth="2.5" />
        <line x1="1" y1="10" x2="19" y2="10" strokeWidth="2.5" />
      </svg>
    )
  }
  // normal: 4x4 grid with thick center lines
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}>
      <rect x="1" y="1" width="18" height="18" rx="1" strokeWidth="1.5" />
      {/* Thin grid lines */}
      <line x1="5.5" y1="1" x2="5.5" y2="19" strokeWidth="0.7" />
      <line x1="14.5" y1="1" x2="14.5" y2="19" strokeWidth="0.7" />
      <line x1="1" y1="5.5" x2="19" y2="5.5" strokeWidth="0.7" />
      <line x1="1" y1="14.5" x2="19" y2="14.5" strokeWidth="0.7" />
      {/* Thick center lines */}
      <line x1="10" y1="1" x2="10" y2="19" strokeWidth="2" />
      <line x1="1" y1="10" x2="19" y2="10" strokeWidth="2" />
    </svg>
  )
}

/**
 * Reference-source attribution pill shown over the bottom-left of the
 * reference image. Collapses to a small info icon on user tap so it doesn't
 * cover the lower portion of the reference while drawing. Parent keys this
 * component by reference identity, so a new reference remounts it in the
 * expanded state.
 */
function ReferenceInfoOverlay({ refInfo }: { refInfo: ReferenceInfo }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Box sx={{
      position: 'absolute',
      bottom: 8,
      left: 8,
      // Cap the overall overlay width so long titles / author lines can't
      // push the collapse button off-screen on narrow viewports. The 16px
      // budget accounts for the 8px left offset plus an 8px right gutter.
      maxWidth: 'calc(100% - 16px)',
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      {collapsed ? (
        <ToolbarTooltip title={t('expandReferenceInfo')}>
          <IconButton
            size="small"
            onClick={() => setCollapsed(false)}
            aria-label={t('expandReferenceInfo')}
            sx={{
              pointerEvents: 'auto',
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
            }}
          >
            <Info size={18} />
          </IconButton>
        </ToolbarTooltip>
      ) : (
        <Box sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.5,
          pointerEvents: 'auto',
          bgcolor: 'rgba(0,0,0,0.5)',
          color: 'white',
          pl: 1,
          pr: 0.5,
          py: 0.5,
          borderRadius: 1,
        }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {refInfo.title && (
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {refInfo.title}
              </Typography>
            )}
            {refInfo.author && (
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {refInfo.source === 'pexels' && refInfo.pexelsPhotographerUrl ? (
                  <>
                    {t('pexelsPhotoBy')}{' '}
                    <MuiLink href={refInfo.pexelsPhotographerUrl} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                      {refInfo.author}
                    </MuiLink>
                    {refInfo.pexelsPageUrl && (
                      <>
                        {' · '}
                        <MuiLink href={refInfo.pexelsPageUrl} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                          {t('pexelsViaPexels')}
                        </MuiLink>
                      </>
                    )}
                  </>
                ) : refInfo.author}
              </Typography>
            )}
          </Box>
          <ToolbarTooltip title={t('collapseReferenceInfo')}>
            <IconButton
              size="small"
              onClick={() => setCollapsed(true)}
              aria-label={t('collapseReferenceInfo')}
              sx={{
                flexShrink: 0,
                color: 'white',
                p: 0.25,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
              }}
            >
              <X size={14} />
            </IconButton>
          </ToolbarTooltip>
        </Box>
      )}
    </Box>
  )
}

interface ReferencePanelProps {
  overlayStrokes?: readonly Stroke[] | null
  overlayCurrentStrokeRef?: React.RefObject<Stroke | null>
  onRegisterOverlayRedraw?: (redraw: () => void) => void
  onReferenceImageSize?: (width: number, height: number) => void
  overlayActive?: boolean
  onToggleOverlay?: () => void
  // Read-only reference state (source of truth is SplitLayout)
  source: ReferenceSource
  referenceMode: ReferenceMode
  fixedImageUrl: string | null
  localImageUrl: string | null
  refInfo: ReferenceInfo | null
  /** Apply a reference-state mutation with undo history recording. */
  onReferenceChange: (mutate: (setters: ReferenceSetters) => void) => void
  /** Non-undoable reset used when an image fails to load. */
  onReferenceResetOnError: () => void
  onRegisterLoadSketchfabModel?: (fn: (uid: string, meta?: SketchfabModelMeta) => void) => void
  /**
   * Allows the parent to trigger a refresh of the URL history dropdown after
   * it adds an entry itself (e.g. Gallery "use this reference" reload).
   */
  onRegisterReloadUrlHistory?: (fn: () => void) => void
  /** Notifies the parent when the Sketchfab 3D viewer iframe is mounted/unmounted. */
  onSketchfabViewerStateChange?: (active: boolean) => void
  isFlipped?: boolean
  onToggleFlip?: () => void
  /** Optional shared ViewTransform for zoom sync with DrawingPanel. */
  viewTransform?: ViewTransform
  /** Which panel owns the fit calculation. */
  fitLeader?: 'reference' | 'drawing'
  /**
   * Incremented by the parent to trigger an external view reset (e.g. on
   * device orientation change). Bumps the internal viewResetVersion.
   */
  externalResetVersion?: number
}

export function ReferencePanel({
  overlayStrokes, overlayCurrentStrokeRef, onRegisterOverlayRedraw,
  onReferenceImageSize, overlayActive, onToggleOverlay,
  source, referenceMode, fixedImageUrl, localImageUrl, refInfo,
  onReferenceChange, onReferenceResetOnError,
  onRegisterLoadSketchfabModel, onRegisterReloadUrlHistory,
  onSketchfabViewerStateChange,
  isFlipped, onToggleFlip,
  viewTransform, fitLeader, externalResetVersion,
}: ReferencePanelProps) {
  const { grid, lines, version: guideVersion, cycleGridMode, addLine, removeLine, clearLines } = useGuides()
  const { isFullscreen, toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen()
  const [viewResetVersion, setViewResetVersion] = useState(0)
  const [, setViewTick] = useState(0)
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('none')
  const [highlightedGuideId, setHighlightedGuideId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlHistory, setUrlHistory] = useState<UrlHistoryEntry[]>([])
  const [thumbErrors, setThumbErrors] = useState<Set<string>>(() => new Set())

  const reloadUrlHistory = useCallback(() => {
    getUrlHistory().then(list => {
      setUrlHistory(list)
      // Drop suppression for entries no longer in history; keep it for entries
      // still present so a known-404 thumbnail isn't re-fetched on every reload.
      setThumbErrors(prev => {
        if (prev.size === 0) return prev
        const stillPresent = new Set<string>()
        const urls = new Set(list.map(e => e.url))
        for (const u of prev) if (urls.has(u)) stillPresent.add(u)
        return stillPresent
      })
    }).catch(() => { /* ignore storage errors */ })
  }, [])

  const blobThumbUrls = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of urlHistory) {
      if ((e.type === 'image' || e.type === 'sketchfab') && e.imageBlob) {
        map.set(e.url, URL.createObjectURL(e.imageBlob))
      }
    }
    return map
  }, [urlHistory])
  useEffect(() => {
    return () => {
      for (const u of blobThumbUrls.values()) URL.revokeObjectURL(u)
    }
  }, [blobThumbUrls])

  const addAndReloadHistory = useCallback((
    url: string,
    type: UrlHistoryType,
    titleOrOptions?: string | AddUrlHistoryOptions,
  ) => {
    return addUrlHistory(url, type, titleOrOptions).then(reloadUrlHistory).catch(() => { /* ignore */ })
  }, [reloadUrlHistory])

  useEffect(() => {
    reloadUrlHistory()
  }, [reloadUrlHistory])

  useEffect(() => {
    onRegisterReloadUrlHistory?.(reloadUrlHistory)
  }, [onRegisterReloadUrlHistory, reloadUrlHistory])

  const combinedResetVersion = viewResetVersion + (externalResetVersion ?? 0)

  // Re-render when the shared ViewTransform changes so the reset button can
  // reflect the current dirty state.
  useEffect(() => {
    if (!viewTransform) return
    return viewTransform.subscribe(() => setViewTick(t => t + 1))
  }, [viewTransform])

  const resetDisabled = viewTransform ? !viewTransform.isDirty() : false

  // Sketchfab viewer state (reported by child)
  const [sfShowViewer, setSfShowViewer] = useState(false)
  const [sfIsReady, setSfIsReady] = useState(false)
  const sfActionsRef = useRef<SketchfabActions | null>(null)

  // Pexels API key dialog state
  const [pexelsKeyDialogOpen, setPexelsKeyDialogOpen] = useState(false)
  const [pexelsKeyVersion, setPexelsKeyVersion] = useState(0)

  // Per-URL-history-entry Pexels search context restore. Bumping `token`
  // remounts PexelsSearcher with the entry's saved query+orientation so
  // "back to search" returns to the search that originally produced this
  // photo, not the most recent global search.
  const [pexelsRestore, setPexelsRestore] = useState<{
    token: number
    query: string
    orientation: PexelsOrientationFilter
  } | null>(null)

  // Sketchfab equivalent — bumping `token` remounts SketchfabViewer with the
  // saved query/category/timeFilter so URL-history loads land on the search
  // that originally produced the model.
  const [sketchfabRestore, setSketchfabRestore] = useState<{
    token: number
    query: string
    category?: SketchfabCategorySlug
    timeFilter: SketchfabTimeFilter
  } | null>(null)

  const applySketchfabRestore = useCallback((ctx: {
    query: string
    category?: SketchfabCategorySlug
    timeFilter: SketchfabTimeFilter
  }) => {
    setSketchfabRestore(prev => {
      // Skip the remount when the user re-selects an entry with the exact same
      // search context — bumping token would dump the iframe + searchResults
      // for nothing.
      if (
        prev
        && prev.query === ctx.query
        && prev.category === ctx.category
        && prev.timeFilter === ctx.timeFilter
      ) return prev
      return { token: (prev?.token ?? 0) + 1, ...ctx }
    })
  }, [])

  // videoInteractMode: overlay steps aside so the iframe receives clicks.
  // Entered automatically on single-tap, exited via the toolbar button.
  // playing: mirrors the iframe's own player state for the toolbar icon.
  const [youtubeVideoInteractMode, setYoutubeVideoInteractMode] = useState(false)
  const [youtubePlaying, setYoutubePlaying] = useState(false)
  const youtubePlayerRef = useRef<YouTubePlayerHandle | null>(null)

  // Swapping videos must drop stale interaction/playback UI state so the new
  // player opens in zoom mode and the toolbar icon doesn't briefly reflect the
  // previous video. React recommends resetting state on prop change during
  // render (see https://react.dev/reference/react/useState#storing-information-from-previous-renders);
  // moving this into an effect would trip react-hooks/set-state-in-effect.
  const youtubeVideoId = refInfo?.source === 'youtube' ? refInfo.youtubeVideoId : null
  const [prevYoutubeKey, setPrevYoutubeKey] = useState<string | null>(null)
  const nextYoutubeKey = source === 'youtube' && youtubeVideoId ? youtubeVideoId : null
  if (prevYoutubeKey !== nextYoutubeKey) {
    setPrevYoutubeKey(nextYoutubeKey)
    setYoutubeVideoInteractMode(false)
    setYoutubePlaying(false)
  }

  const handleLoadLocalImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return

      // Compute the content hash in parallel with FileReader. The result feeds
      // ReferenceInfo.url (so saved drawings can be reloaded from the gallery)
      // and the URL-history key (so repeat opens dedupe to one entry).
      const hashPromise = sha256Hex(file).catch(() => null)

      // Read as data URL so it survives page reload (for autosave)
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = reader.result as string
        const hash = await hashPromise
        const url = hash ? `local:${hash}` : undefined
        const info: ReferenceInfo = { title: file.name, author: '', source: 'image', fileName: file.name, url }
        onReferenceChange(s => {
          s.setLocalImageUrl(dataUrl)
          s.setFixedImageUrl(null)
          s.setReferenceInfo(info)
          s.setSource('image')
          s.setReferenceMode('fixed')
        })
      }
      reader.readAsDataURL(file)

      // Fire-and-forget history upsert. Hashed by content so repeat opens of
      // the same image (even from a different path or with a different mtime)
      // dedupe to a single entry and reuse the already-stored Blob.
      void (async () => {
        try {
          const hash = await hashPromise
          if (!hash) return
          const key = `local:${hash}`
          const existing = await getUrlHistoryEntry(key)
          if (existing?.imageBlob) {
            // Same content already stored — skip the expensive resize. Pass
            // the Blob through so the upsert is self-contained: no redundant
            // read inside addUrlHistory, and if the row was evicted between
            // our get and the put we still end up with a complete entry.
            await addAndReloadHistory(key, 'image', { fileName: file.name, imageBlob: existing.imageBlob })
            return
          }
          const blob = await resizeImageForHistory(file)
          await addAndReloadHistory(key, 'image', { fileName: file.name, imageBlob: blob })
        } catch {
          // Image is already displayed; history add is best-effort.
        }
      })()
    }
    input.click()
  }, [onReferenceChange, addAndReloadHistory])

  const [urlLoading, setUrlLoading] = useState(false)

  const handleLoadFromUrl = useCallback((rawUrl: string) => {
    const url = rawUrl.trim()
    if (!url) return
    setUrlError(null)
    setUrlLoading(true)

    // Validate URL format
    try {
      new URL(url)
    } catch {
      setUrlError(t('urlLoadFailed'))
      setUrlLoading(false)
      return
    }

    // Sketchfab URL: extract UID and route to the SketchfabViewer in browse
    // mode. The viewer iframe takes over loading; URL-history is added when
    // the user "Fix Angle"s the model so the entry carries a screenshot.
    const sketchfabMatch = parseSketchfabModelUrl(url)
    if (sketchfabMatch) {
      const uid = sketchfabMatch.uid
      onReferenceChange(s => {
        s.setSource('sketchfab')
        s.setReferenceMode('browse')
        s.setFixedImageUrl(null)
        s.setLocalImageUrl(null)
        s.setReferenceInfo({ title: '', author: '', source: 'sketchfab', sketchfabUid: uid })
      })
      setUrlInput('')
      setUrlLoading(false)
      // Resolve the URL-history entry once: it carries both the search context
      // (for "Back to search" restoration) and the title (so the viewer can
      // skip the redundant Sketchfab Data API call inside loadModel).
      getUrlHistoryEntry(canonicalSketchfabUrl(uid))
        .then(entry => {
          const ctx = entry?.sketchfabSearchContext
          if (ctx) {
            applySketchfabRestore({
              query: ctx.query,
              category: ctx.category,
              timeFilter: ctx.timeFilter,
            })
          }
          const meta: SketchfabModelMeta | undefined = entry?.title
            ? { name: entry.title, author: '' }
            : undefined
          requestAnimationFrame(() => {
            sfActionsRef.current?.loadModelByUid(uid, meta)
          })
        })
        .catch(() => {
          // History lookup failed — still load the model; the viewer will
          // fetch metadata itself.
          requestAnimationFrame(() => {
            sfActionsRef.current?.loadModelByUid(uid)
          })
        })
      return
    }

    // YouTube URL: switch to YouTube reference mode without image preload
    const ytId = parseYouTubeVideoId(url)
    if (ytId) {
      const info: ReferenceInfo = {
        title: ytId,
        author: '',
        source: 'youtube',
        youtubeVideoId: ytId,
      }
      onReferenceChange(s => {
        s.setSource('youtube')
        s.setReferenceMode('browse')
        s.setFixedImageUrl(null)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
      })
      setUrlInput('')
      setUrlLoading(false)
      fetchYouTubeTitle(ytId)
        .catch(() => null)
        .then(title => addAndReloadHistory(url, 'youtube', title ?? undefined))
        .catch(() => { /* ignore */ })
      return
    }

    // Pexels photo URL: resolve via API to fetch the CDN URL + photographer.
    const pexelsMatch = parsePexelsPhotoUrl(url)
    if (pexelsMatch) {
      getPhoto(pexelsMatch.id)
        .then(photo => {
          const info = buildPexelsReferenceInfo(photo)
          onReferenceChange(s => {
            s.setSource('pexels')
            s.setReferenceMode('fixed')
            s.setFixedImageUrl(photo.src.large2x)
            s.setLocalImageUrl(null)
            s.setReferenceInfo(info)
          })
          setUrlInput('')
          // Don't pass pexelsSearchContext — addUrlHistory's preservation
          // semantics keep the original context attached to this entry.
          void addAndReloadHistory(url, 'pexels', {
            title: info.title,
            thumbnailUrl: photo.src.tiny,
          })
          // Restore the per-entry search context fire-and-forget so a slow /
          // failing urlHistory read doesn't gate the reference state update.
          getUrlHistoryEntry(url)
            .then(entry => {
              const ctx = entry?.pexelsSearchContext
              if (!ctx) return
              setPexelsRestore(prev => ({
                token: (prev?.token ?? 0) + 1,
                query: ctx.query,
                orientation: ctx.orientation,
              }))
            })
            .catch(() => { /* best-effort */ })
        })
        .catch(e => setUrlError(t(mapPexelsErrorKey(e))))
        .finally(() => setUrlLoading(false))
      return
    }

    const onFail = () => {
      setUrlError(t('urlLoadFailed'))
      setUrlLoading(false)
    }

    const onSuccess = () => {
      setUrlLoading(false)
      const title = url.split('/').pop()?.split('?')[0] ?? url
      const info: ReferenceInfo = { title, author: '', source: 'url', imageUrl: url }
      onReferenceChange(s => {
        s.setFixedImageUrl(url)
        s.setLocalImageUrl(null)
        s.setReferenceInfo(info)
        s.setSource('url')
        s.setReferenceMode('fixed')
      })
      setUrlInput('')
      void addAndReloadHistory(url, 'url')
    }

    // Preload image: try CORS first, then without, check naturalWidth
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (img.naturalWidth > 0) { onSuccess() } else { onFail() }
    }
    img.onerror = () => {
      const retry = new Image()
      retry.onload = () => {
        if (retry.naturalWidth > 0) { onSuccess() } else { onFail() }
      }
      retry.onerror = onFail
      retry.src = url
    }
    img.src = url
  }, [onReferenceChange, addAndReloadHistory, applySketchfabRestore])

  const handleFixAngle = useCallback((screenshotUrl: string, info: ReferenceInfo, extras: SketchfabFixAngleExtras) => {
    onReferenceChange(s => {
      s.setFixedImageUrl(screenshotUrl)
      s.setReferenceInfo(info)
      s.setReferenceMode('fixed')
    })
    if (info.source !== 'sketchfab' || !info.sketchfabUid) return
    const historyKey = canonicalSketchfabUrl(info.sketchfabUid)
    const titleForHistory = info.title || undefined
    const sketchfabSearchContext = extras.searchContext ?? undefined
    // Convert the 1024x1024 PNG screenshot to a ~200KB JPEG Blob so URL-
    // history sketchfab selection can restore directly into fixed mode (the
    // same UX as gallery "Use this reference"). Falls back to the model CDN
    // thumbnail URL if the encode fails — at least the dropdown still shows
    // something.
    void dataUrlToJpegBlob(screenshotUrl).then(blob => {
      void addAndReloadHistory(historyKey, 'sketchfab', {
        title: titleForHistory,
        ...(blob ? { imageBlob: blob } : {}),
        ...(blob ? {} : { thumbnailUrl: extras.modelThumbnailUrl ?? undefined }),
        sketchfabSearchContext,
      })
    }).catch(() => { /* best-effort */ })
  }, [onReferenceChange, addAndReloadHistory])

  const handleChangeAngle = useCallback(() => {
    onReferenceChange(s => {
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
    })
  }, [onReferenceChange])

  const handleClose = useCallback(() => {
    onReferenceChange(s => {
      s.setSource('none')
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(null)
    })
    setGuideMode('none')
    setHighlightedGuideId(null)
  }, [onReferenceChange])

  const handleOpenSketchfab = useCallback(() => {
    // Clear any leftover URL-history restoration so re-entering Sketchfab
    // from the top screen starts with no category preselected — otherwise
    // the SketchfabViewer would remount with stale initialCategory and the
    // user can't get back to "all works" browsing.
    setSketchfabRestore(null)
    onReferenceChange(s => {
      s.setSource('sketchfab')
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(null)
    })
  }, [onReferenceChange])

  const handleOpenPexels = useCallback(() => {
    onReferenceChange(s => {
      s.setSource('pexels')
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(null)
    })
  }, [onReferenceChange])

  const handleSelectPexelsPhoto = useCallback((
    info: Extract<ReferenceInfo, { source: 'pexels' }>,
    thumbnailUrl: string,
  ) => {
    onReferenceChange(s => {
      s.setSource('pexels')
      s.setReferenceMode('fixed')
      s.setFixedImageUrl(info.pexelsImageUrl)
      s.setLocalImageUrl(null)
      s.setReferenceInfo(info)
    })
    if (info.pexelsPageUrl) {
      // runSearch saves to localStorage right before yielding the result list,
      // so getPexelsLastSearch() here reflects the search that produced this
      // photo. Persisting it per-entry lets URL-history loads restore the
      // originating search context independently of the global last search.
      void addAndReloadHistory(info.pexelsPageUrl, 'pexels', {
        title: info.title,
        thumbnailUrl,
        pexelsSearchContext: getPexelsLastSearch() ?? undefined,
      })
    }
  }, [onReferenceChange, addAndReloadHistory])

  const handleBackToPexelsSearch = useCallback(() => {
    onReferenceChange(s => {
      s.setReferenceMode('browse')
      s.setFixedImageUrl(null)
    })
  }, [onReferenceChange])

  const handleSfStateChange = useCallback((state: { showViewer: boolean; isReady: boolean }) => {
    setSfShowViewer(state.showViewer)
    setSfIsReady(state.isReady)
    onSketchfabViewerStateChange?.(state.showViewer)
  }, [onSketchfabViewerStateChange])

  // Load a Sketchfab model by UID (called from parent for gallery "load reference")
  const loadSketchfabModel = useCallback((uid: string, meta?: SketchfabModelMeta) => {
    requestAnimationFrame(() => {
      sfActionsRef.current?.loadModelByUid(uid, meta)
    })
  }, [])

  // Expose loadSketchfabModel to parent
  useEffect(() => {
    onRegisterLoadSketchfabModel?.(loadSketchfabModel)
  }, [onRegisterLoadSketchfabModel, loadSketchfabModel])

  const handleImageError = useCallback(() => {
    setUrlError(t('urlLoadFailed'))
    // Non-undoable reset — undoing back to a broken URL would just trigger
    // the same error again.
    onReferenceResetOnError()
  }, [onReferenceResetOnError])

  const handleAddGuideLine = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    addLine(x1, y1, x2, y2)
  }, [addLine])

  const handleDeleteHighlighted = useCallback(() => {
    if (highlightedGuideId) {
      removeLine(highlightedGuideId)
      // 削除後、削除した線の一つ前を自動選択
      const idx = lines.findIndex(l => l.id === highlightedGuideId)
      const prevIdx = idx - 1
      setHighlightedGuideId(prevIdx >= 0 ? lines[prevIdx].id : null)
    }
  }, [highlightedGuideId, removeLine, lines])

  const handleCancelHighlight = useCallback(() => {
    setHighlightedGuideId(null)
  }, [])

  const toggleGuideMode = useCallback((mode: GuideInteractionMode) => {
    setGuideMode(prev => {
      const nextMode = prev === mode ? 'none' : mode
      // deleteモードに入る時、最新の補助線を自動選択
      if (nextMode === 'delete' && lines.length > 0) {
        setHighlightedGuideId(lines[lines.length - 1].id)
      } else {
        setHighlightedGuideId(null)
      }
      return nextMode
    })
  }, [lines])

  const displayImageUrl = source === 'image' ? localImageUrl : fixedImageUrl  // 'sketchfab', 'url', 'pexels' use fixedImageUrl
  const isFixed = referenceMode === 'fixed' && !!displayImageUrl
  const isNone = source === 'none'
  // Sketchfab browse mode: either searching or viewing a model
  const isSfBrowse = source === 'sketchfab' && referenceMode === 'browse'
  const isYouTube = source === 'youtube'
  // Canvas-bound tools are hidden while the overlay is transparent — they
  // have nothing to act on in that mode.
  const inYouTubeVideoMode = isYouTube && youtubeVideoInteractMode

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

        {/* Sketchfab model viewer: Back to search results */}
        {isSfBrowse && sfShowViewer && (
          <Button size="small" variant="outlined" onClick={() => sfActionsRef.current?.back()}>
            {t('back')}
          </Button>
        )}

        {/* Sketchfab model viewer: Fix This Angle button */}
        {isSfBrowse && sfShowViewer && sfIsReady && (
          <Button size="small" variant="contained" color="success" onClick={() => sfActionsRef.current?.fixAngle()}>
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

        {/* Works in both modes — pausing shouldn't require giving up zoom. */}
        {isYouTube && (
          <ToolbarTooltip title={youtubePlaying ? t('youtubePause') : t('youtubePlay')}>
            <IconButton
              size="small"
              onClick={() => {
                if (youtubePlaying) {
                  youtubePlayerRef.current?.pause()
                } else {
                  youtubePlayerRef.current?.play()
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
              <IconButton
                size="small"
                onClick={() => toggleGuideMode('add')}
                sx={{
                  bgcolor: guideMode === 'add' ? 'error.main' : 'transparent',
                  color: guideMode === 'add' ? 'white' : 'inherit',
                  '&:hover': { bgcolor: guideMode === 'add' ? 'error.dark' : 'action.hover' },
                }}
              >
                <PenLine size={20} />
              </IconButton>
            </ToolbarTooltip>

            <ToolbarTooltip title={t('deleteGuideLine')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => toggleGuideMode('delete')}
                  disabled={lines.length === 0}
                  sx={{
                    bgcolor: guideMode === 'delete' ? 'error.main' : 'transparent',
                    color: guideMode === 'delete' ? 'white' : 'inherit',
                    '&:hover': { bgcolor: guideMode === 'delete' ? 'error.dark' : 'action.hover' },
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

        {/* Clear-all works on guide state alone, so stay available even with no
            reference loaded — otherwise stale guides become undeletable. */}
        {!(isFixed || isYouTube) && lines.length > 0 && (
          <>
            <Box sx={{ width: '1px', height: 24, bgcolor: '#ddd', mx: 0.5 }} />
            <ToolbarTooltip title={t('clearGuideLines')}>
              <IconButton size="small" onClick={clearLines}>
                <Trash2 size={20} />
              </IconButton>
            </ToolbarTooltip>
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

        <ToolbarTooltip title={t('cycleGrid')}>
          <IconButton
            size="small"
            onClick={cycleGridMode}
            sx={{
              bgcolor: grid.mode !== 'none' ? 'info.main' : 'transparent',
              color: grid.mode !== 'none' ? 'white' : 'inherit',
              '&:hover': { bgcolor: grid.mode !== 'none' ? 'info.dark' : 'action.hover' },
            }}
          >
            <GridIcon mode={grid.mode} />
          </IconButton>
        </ToolbarTooltip>

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
                onClick={() => setViewResetVersion(v => v + 1)}
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
          <Box sx={{ height: '100%', overflowY: 'auto' }}>
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100%',
            gap: 1.5,
            px: 2,
            py: 2,
          }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: '100%', maxWidth: 480 }}>
              <Button
                variant="outlined"
                fullWidth
                onClick={handleOpenSketchfab}
                startIcon={<Boxes size={20} />}
                sx={{ justifyContent: 'flex-start', py: 1, px: 2 }}
              >
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="body1" sx={{ fontWeight: 500, lineHeight: 1.2 }}>{t('sketchfab')}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                    {t('sketchfabDescription')}
                  </Typography>
                </Box>
              </Button>
              <Button
                variant="outlined"
                fullWidth
                onClick={handleLoadLocalImage}
                startIcon={<FolderOpen size={20} />}
                sx={{ justifyContent: 'flex-start', py: 1, px: 2 }}
              >
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="body1" sx={{ fontWeight: 500, lineHeight: 1.2 }}>{t('image')}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                    {t('imageDescription')}
                  </Typography>
                </Box>
              </Button>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleOpenPexels}
                  startIcon={<Camera size={20} />}
                  sx={{ justifyContent: 'flex-start', py: 1, px: 2 }}
                >
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="body1" sx={{ fontWeight: 500, lineHeight: 1.2 }}>{t('pexels')}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                      {t('pexelsDescription')}
                    </Typography>
                  </Box>
                </Button>
                <ToolbarTooltip title={t('pexelsApiKeySettings')}>
                  <IconButton
                    onClick={() => setPexelsKeyDialogOpen(true)}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5 }}
                  >
                    <KeyRound size={18} />
                  </IconButton>
                </ToolbarTooltip>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%', maxWidth: 480 }}>
              <Typography variant="caption" color="text.secondary">{t('urlSectionLabel')}</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
              <Autocomplete<UrlHistoryEntry, false, false, true>
                freeSolo
                size="small"
                sx={{ flex: 1 }}
                fullWidth
                options={urlHistory}
                filterOptions={x => x}
                getOptionLabel={option => {
                  if (typeof option === 'string') return option
                  // Synthetic `local:<hash>` keys are not meaningful to the
                  // user; show the file name instead.
                  if (option.type === 'image') return option.fileName ?? ''
                  return option.url
                }}
                isOptionEqualToValue={(a, b) => typeof a !== 'string' && typeof b !== 'string' && a.url === b.url}
                inputValue={urlInput}
                onInputChange={(_, value, reason) => {
                  if (reason === 'input' || reason === 'clear') {
                    setUrlInput(value)
                    setUrlError(null)
                  }
                }}
                onChange={(_, value, reason) => {
                  if (reason === 'selectOption' && value && typeof value !== 'string') {
                    setUrlError(null)
                    if (value.type === 'image' && value.imageBlob) {
                      const reader = new FileReader()
                      const blob = value.imageBlob
                      const fileName = value.fileName ?? 'image'
                      const historyKey = value.url
                      reader.onload = () => {
                        const dataUrl = reader.result as string
                        const info: ReferenceInfo = {
                          title: fileName,
                          author: '',
                          source: 'image',
                          fileName,
                          url: historyKey,
                        }
                        onReferenceChange(s => {
                          s.setLocalImageUrl(dataUrl)
                          s.setFixedImageUrl(null)
                          s.setReferenceInfo(info)
                          s.setSource('image')
                          s.setReferenceMode('fixed')
                        })
                        setUrlInput('')
                        // Bump lastUsedAt with the Blob in hand so the upsert
                        // is self-contained (no redundant db read, and an
                        // evicted row between reads can't recreate a blobless
                        // entry).
                        void addAndReloadHistory(historyKey, 'image', { fileName, imageBlob: blob })
                      }
                      reader.readAsDataURL(blob)
                      return
                    }
                    if (value.type === 'sketchfab' && value.imageBlob) {
                      // Mirror the gallery "Use this reference" UX: jump
                      // straight to fixed mode with the saved screenshot, and
                      // load the iframe in the background so "Change angle"
                      // still works.
                      const sketchfabUid = parseSketchfabModelUrl(value.url)?.uid
                      if (!sketchfabUid) {
                        // Malformed history key — fall through to URL flow
                        setUrlInput(value.url)
                        handleLoadFromUrl(value.url)
                        return
                      }
                      const blob = value.imageBlob
                      const historyKey = value.url
                      const title = value.title ?? ''
                      const ctx = value.sketchfabSearchContext
                      void blobToDataUrl(blob).then(dataUrl => {
                        if (!dataUrl) return
                        const info: ReferenceInfo = {
                          title,
                          author: '',
                          source: 'sketchfab',
                          sketchfabUid,
                          imageUrl: dataUrl,
                        }
                        onReferenceChange(s => {
                          s.setSource('sketchfab')
                          s.setReferenceMode('fixed')
                          s.setFixedImageUrl(dataUrl)
                          s.setLocalImageUrl(null)
                          s.setReferenceInfo(info)
                        })
                        setUrlInput('')
                        if (ctx) {
                          applySketchfabRestore({
                            query: ctx.query,
                            category: ctx.category,
                            timeFilter: ctx.timeFilter,
                          })
                        }
                        // Load the iframe in the background so "Change Angle"
                        // can transition to browse with the model already
                        // ready, just like the gallery path.
                        requestAnimationFrame(() => {
                          sfActionsRef.current?.loadModelByUid(
                            sketchfabUid,
                            title ? { name: title, author: '' } : undefined,
                          )
                        })
                        // Bump lastUsedAt with the Blob in hand so the upsert
                        // is self-contained.
                        void addAndReloadHistory(historyKey, 'sketchfab', {
                          title: title || undefined,
                          imageBlob: blob,
                        })
                      })
                      return
                    }
                    setUrlInput(value.url)
                    handleLoadFromUrl(value.url)
                  }
                }}
                renderOption={(props, option) => {
                  const { key, ...rest } = props as typeof props & { key: string }
                  const { primary, secondary } = describeHistoryUrl(option)
                  const thumbSrc = resolveHistoryThumbnailSrc(option, blobThumbUrls)
                  const showThumb = thumbSrc !== null && !thumbErrors.has(option.url)
                  return (
                    <li key={key} {...rest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'text.secondary',
                          bgcolor: showThumb ? 'action.hover' : 'transparent',
                          borderRadius: 0.5,
                          overflow: 'hidden',
                        }}
                      >
                        {showThumb ? (
                          <Box
                            component="img"
                            src={thumbSrc}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => {
                              setThumbErrors(prev => {
                                if (prev.has(option.url)) return prev
                                const next = new Set(prev)
                                next.add(option.url)
                                return next
                              })
                            }}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <HistoryTypeIcon type={option.type} />
                        )}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {primary}
                        </Typography>
                        {secondary && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {secondary}
                          </Typography>
                        )}
                      </Box>
                      <ToolbarTooltip title={t('urlHistoryDelete')}>
                        <IconButton
                          size="small"
                          aria-label={t('urlHistoryDelete')}
                          // Touch devices commit option selection on pointerdown
                          // (before click), so we have to stop propagation there
                          // too — not just on click.
                          onPointerDown={e => { e.stopPropagation(); e.preventDefault() }}
                          onClick={e => {
                            e.stopPropagation()
                            deleteUrlHistory(option.url).then(reloadUrlHistory).catch(() => { /* ignore */ })
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </ToolbarTooltip>
                    </li>
                  )
                }}
                renderInput={params => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder={t('urlPlaceholder')}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && urlInput) {
                        e.preventDefault()
                        handleLoadFromUrl(urlInput)
                      }
                    }}
                  />
                )}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleLoadFromUrl(urlInput)}
                disabled={!urlInput || urlLoading}
              >
                {t('loadUrl')}
              </Button>
            </Box>
            </Box>
            {urlLoading && (
              <Typography variant="caption" color="text.secondary">{t('loading')}</Typography>
            )}
            {urlError && (
              <Typography variant="caption" color="error">{urlError}</Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.disabled">
                {t('buildDate')}: {new Date(import.meta.env.BUILD_DATE as string).toLocaleString()}
              </Typography>
              <a
                href="https://github.com/koizuka/drawing-practice"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', color: '#888' }}
              >
                <GitHubIcon />
              </a>
            </Box>
          </Box>
          </Box>
        )}

        {/* Sketchfab viewer (kept mounted when source is sketchfab).
            Bumping sketchfabRestore.token via key remounts with the per-entry
            search context restored from the URL-history entry. */}
        {source === 'sketchfab' && (
          <Box sx={{ display: referenceMode === 'browse' ? 'contents' : 'none' }}>
            <SketchfabViewer
              key={sketchfabRestore?.token ?? 0}
              onFixAngle={handleFixAngle}
              onStateChange={handleSfStateChange}
              actionsRef={sfActionsRef}
              initialQuery={sketchfabRestore?.query}
              initialTimeFilter={sketchfabRestore?.timeFilter}
              initialCategory={sketchfabRestore?.category}
            />
          </Box>
        )}

        {/* Pexels searcher — kept mounted while source is 'pexels' so the
            search state (query, results, pagination, scroll) persists across
            browse ↔ fixed transitions. Hidden when a photo is being viewed.
            Bumping pexelsRestore.token via key remounts with the per-photo
            search context restored from the URL-history entry. */}
        {source === 'pexels' && (
          <Box sx={{ display: referenceMode === 'browse' ? 'contents' : 'none' }}>
            <PexelsSearcher
              key={pexelsRestore?.token ?? 0}
              onSelectPhoto={handleSelectPexelsPhoto}
              onOpenApiKeySettings={() => setPexelsKeyDialogOpen(true)}
              apiKeyVersion={pexelsKeyVersion}
              initialQuery={pexelsRestore?.query}
              initialOrientation={pexelsRestore?.orientation}
            />
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
            guideMode={guideMode}
            onAddGuideLine={handleAddGuideLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
            videoInteractMode={youtubeVideoInteractMode}
            onRequestVideoInteract={() => setYoutubeVideoInteractMode(true)}
            onPlayerStateChange={setYoutubePlaying}
          />
        )}

        {/* Reference info overlay */}
        {isFixed && refInfo && (refInfo.title || refInfo.author) && (
          <ReferenceInfoOverlay
            key={referenceKey(refInfo)}
            refInfo={refInfo}
          />
        )}

        {/* Fixed image */}
        {isFixed && displayImageUrl && (
          <ImageViewer
            imageUrl={displayImageUrl}
            viewResetVersion={combinedResetVersion}
            grid={grid}
            guideLines={lines}
            guideVersion={guideVersion}
            overlayStrokes={overlayStrokes ?? undefined}
            overlayCurrentStrokeRef={overlayCurrentStrokeRef}
            onRegisterOverlayRedraw={onRegisterOverlayRedraw}
            onImageLoaded={onReferenceImageSize}
            onImageError={handleImageError}
            guideMode={guideMode}
            onAddGuideLine={handleAddGuideLine}
            onDeleteGuideLine={removeLine}
            highlightedGuideId={highlightedGuideId}
            onHighlightGuide={setHighlightedGuideId}
            isFlipped={isFlipped}
            viewTransform={viewTransform}
            isFitLeader={fitLeader === 'reference'}
          />
        )}
      </Box>

      <PexelsApiKeyDialog
        open={pexelsKeyDialogOpen}
        onClose={() => setPexelsKeyDialogOpen(false)}
        onKeyChanged={() => setPexelsKeyVersion(v => v + 1)}
      />
    </Box>
  )
}
