import { useCallback, useEffect, useState } from 'react';
import type { ReferenceSetters } from '../components/ReferencePanel';
import type { SketchfabModelMeta } from '../components/SketchfabViewer';
import { loadedReference } from '../components/splitLayoutHelpers';
import { t } from '../i18n';
import type { ReferenceInfo } from '../types';
import {
  addUrlHistory,
  deleteUrlHistory,
  getUrlHistory,
  getUrlHistoryEntry,
  type AddUrlHistoryOptions,
  type UrlHistoryEntry,
  type UrlHistoryType,
} from '../storage';
import { blobToDataUrl, resizeImageForHistory, sha256Hex } from '../utils/imageResize';
import {
  buildPexelsReferenceInfo,
  getPhoto,
  mapPexelsErrorKey,
  parsePexelsPhotoUrl,
  type PexelsOrientationFilter,
} from '../utils/pexels';
import {
  canonicalSketchfabUrl,
  parseSketchfabModelUrl,
  type SketchfabCategorySlug,
  type SketchfabTimeFilter,
} from '../utils/sketchfab';
import { fetchYouTubeTitle, parseYouTubeVideoId } from '../utils/youtube';
import { useUrlHistoryThumbnails } from './useUrlHistoryThumbnails';

interface UseUrlReferenceLoaderOptions {
  /** Undo-recorded reference mutation (see ReferencePanel `onReferenceChange`). */
  onReferenceChange: (mutate: (setters: ReferenceSetters) => void) => void;
  /** Remount the Sketchfab search on a URL-history entry's saved context. */
  applySketchfabRestore: (ctx: {
    query: string;
    category?: SketchfabCategorySlug;
    timeFilter: SketchfabTimeFilter;
  }) => void;
  /** Remount the Pexels search on a URL-history entry's saved context. */
  applyPexelsRestore: (ctx: { query: string; orientation: PexelsOrientationFilter }) => void;
  /** Load a model into the (already mounted next frame) Sketchfab iframe. */
  loadSketchfabModel: (uid: string, meta?: SketchfabModelMeta) => void;
  /** Hand the history reload to the parent (gallery "Use this reference" adds entries). */
  onRegisterReloadUrlHistory?: (fn: () => void) => void;
}

/**
 * The source picker's load flows: local image file, URL (auto-routed to
 * Sketchfab / YouTube / Pexels / plain image), URL-history selection and
 * deletion — plus the URL input / error / loading state and the history list
 * (with its dropdown thumbnails).
 *
 * Every successful load is exactly ONE `onReferenceChange` (= one undo entry).
 */
export function useUrlReferenceLoader({
  onReferenceChange,
  applySketchfabRestore,
  applyPexelsRestore,
  loadSketchfabModel,
  onRegisterReloadUrlHistory,
}: UseUrlReferenceLoaderOptions) {
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlHistory, setUrlHistory] = useState<UrlHistoryEntry[]>([]);
  // Lives at ReferencePanel's lifetime (not in the picker) so failed-thumbnail
  // suppression survives leaving and re-entering the source picker.
  const urlHistoryThumbnails = useUrlHistoryThumbnails(urlHistory);
  const { pruneThumbErrors } = urlHistoryThumbnails;

  const reloadUrlHistory = useCallback(() => {
    getUrlHistory()
      .then((list) => {
        setUrlHistory(list);
        pruneThumbErrors(list);
      })
      .catch(() => {
        /* ignore storage errors */
      });
  }, [pruneThumbErrors]);

  const addAndReloadHistory = useCallback(
    (url: string, type: UrlHistoryType, titleOrOptions?: string | AddUrlHistoryOptions) => {
      return addUrlHistory(url, type, titleOrOptions)
        .then(reloadUrlHistory)
        .catch(() => {
          /* ignore */
        });
    },
    [reloadUrlHistory],
  );

  useEffect(() => {
    reloadUrlHistory();
  }, [reloadUrlHistory]);

  useEffect(() => {
    onRegisterReloadUrlHistory?.(reloadUrlHistory);
  }, [onRegisterReloadUrlHistory, reloadUrlHistory]);

  const handleLoadLocalImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      // Compute the content hash in parallel with FileReader. The result feeds
      // ReferenceInfo.url (so saved drawings can be reloaded from the gallery)
      // and the URL-history key (so repeat opens dedupe to one entry).
      const hashPromise = sha256Hex(file).catch(() => null);

      // Read as data URL so it survives page reload (for autosave)
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const hash = await hashPromise;
        const url = hash ? `local:${hash}` : undefined;
        const info: ReferenceInfo = {
          title: file.name,
          author: '',
          source: 'image',
          fileName: file.name,
          url,
        };
        onReferenceChange((s) =>
          s.setAll(loadedReference(info, 'fixed', { localImageUrl: dataUrl })),
        );
      };
      reader.readAsDataURL(file);

      // Fire-and-forget history upsert. Hashed by content so repeat opens of
      // the same image (even from a different path or with a different mtime)
      // dedupe to a single entry and reuse the already-stored Blob.
      void (async () => {
        try {
          const hash = await hashPromise;
          if (!hash) return;
          const key = `local:${hash}`;
          const existing = await getUrlHistoryEntry(key);
          if (existing?.imageBlob) {
            // Same content already stored — skip the expensive resize. Pass
            // the Blob through so the upsert is self-contained: no redundant
            // read inside addUrlHistory, and if the row was evicted between
            // our get and the put we still end up with a complete entry.
            await addAndReloadHistory(key, 'image', {
              fileName: file.name,
              imageBlob: existing.imageBlob,
            });
            return;
          }
          const blob = await resizeImageForHistory(file);
          await addAndReloadHistory(key, 'image', { fileName: file.name, imageBlob: blob });
        } catch {
          // Image is already displayed; history add is best-effort.
        }
      })();
    };
    input.click();
  }, [onReferenceChange, addAndReloadHistory]);

  const handleLoadFromUrl = useCallback(
    (rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url) return;
      setUrlError(null);
      setUrlLoading(true);

      // Validate URL format
      try {
        new URL(url);
      } catch {
        setUrlError(t('urlLoadFailed'));
        setUrlLoading(false);
        return;
      }

      // Sketchfab URL: extract UID and route to the SketchfabViewer in browse
      // mode. The viewer iframe takes over loading; URL-history is added when
      // the user "Fix Angle"s the model so the entry carries a screenshot.
      const sketchfabMatch = parseSketchfabModelUrl(url);
      if (sketchfabMatch) {
        const uid = sketchfabMatch.uid;
        onReferenceChange((s) =>
          s.setAll(
            loadedReference(
              { title: '', author: '', source: 'sketchfab', sketchfabUid: uid },
              'browse',
            ),
          ),
        );
        setUrlInput('');
        setUrlLoading(false);
        // Resolve the URL-history entry once: it carries both the search context
        // (for "Back to search" restoration) and the title (so the viewer can
        // skip the redundant Sketchfab Data API call inside loadModel).
        getUrlHistoryEntry(canonicalSketchfabUrl(uid))
          .then((entry) => {
            const ctx = entry?.sketchfabSearchContext;
            if (ctx) {
              applySketchfabRestore({
                query: ctx.query,
                category: ctx.category,
                timeFilter: ctx.timeFilter,
              });
            }
            const meta: SketchfabModelMeta | undefined = entry?.title
              ? { name: entry.title, author: '' }
              : undefined;
            loadSketchfabModel(uid, meta);
          })
          .catch(() => {
            // History lookup failed — still load the model; the viewer will
            // fetch metadata itself.
            loadSketchfabModel(uid);
          });
        return;
      }

      // YouTube URL: switch to YouTube reference mode without image preload
      const ytId = parseYouTubeVideoId(url);
      if (ytId) {
        const info: ReferenceInfo = {
          title: ytId,
          author: '',
          source: 'youtube',
          youtubeVideoId: ytId,
        };
        onReferenceChange((s) => s.setAll(loadedReference(info, 'browse')));
        setUrlInput('');
        setUrlLoading(false);
        fetchYouTubeTitle(ytId)
          .catch(() => null)
          .then((title) => addAndReloadHistory(url, 'youtube', title ?? undefined))
          .catch(() => {
            /* ignore */
          });
        return;
      }

      // Pexels photo URL: resolve via API to fetch the CDN URL + photographer.
      const pexelsMatch = parsePexelsPhotoUrl(url);
      if (pexelsMatch) {
        getPhoto(pexelsMatch.id)
          .then((photo) => {
            const info = buildPexelsReferenceInfo(photo);
            onReferenceChange((s) =>
              s.setAll(loadedReference(info, 'fixed', { fixedImageUrl: photo.src.large2x })),
            );
            setUrlInput('');
            // Don't pass pexelsSearchContext — addUrlHistory's preservation
            // semantics keep the original context attached to this entry.
            void addAndReloadHistory(url, 'pexels', {
              title: info.title,
              thumbnailUrl: photo.src.tiny,
            });
            // Restore the per-entry search context fire-and-forget so a slow /
            // failing urlHistory read doesn't gate the reference state update.
            getUrlHistoryEntry(url)
              .then((entry) => {
                const ctx = entry?.pexelsSearchContext;
                if (!ctx) return;
                applyPexelsRestore({ query: ctx.query, orientation: ctx.orientation });
              })
              .catch(() => {
                /* best-effort */
              });
          })
          .catch((e) => setUrlError(t(mapPexelsErrorKey(e))))
          .finally(() => setUrlLoading(false));
        return;
      }

      const onFail = () => {
        setUrlError(t('urlLoadFailed'));
        setUrlLoading(false);
      };

      const onSuccess = () => {
        setUrlLoading(false);
        const title = url.split('/').pop()?.split('?')[0] ?? url;
        const info: ReferenceInfo = { title, author: '', source: 'url', imageUrl: url };
        onReferenceChange((s) => s.setAll(loadedReference(info, 'fixed', { fixedImageUrl: url })));
        setUrlInput('');
        void addAndReloadHistory(url, 'url');
      };

      // Preload image: try CORS first, then without, check naturalWidth
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (img.naturalWidth > 0) {
          onSuccess();
        } else {
          onFail();
        }
      };
      img.onerror = () => {
        const retry = new Image();
        retry.onload = () => {
          if (retry.naturalWidth > 0) {
            onSuccess();
          } else {
            onFail();
          }
        };
        retry.onerror = onFail;
        retry.src = url;
      };
      img.src = url;
    },
    [
      onReferenceChange,
      addAndReloadHistory,
      applySketchfabRestore,
      applyPexelsRestore,
      loadSketchfabModel,
    ],
  );

  // URL-history dropdown selection. Blob-backed image / sketchfab entries
  // restore straight from the stored Blob; everything else goes through the
  // normal URL flow.
  const handleSelectHistoryEntry = useCallback(
    (entry: UrlHistoryEntry) => {
      setUrlError(null);
      if (entry.type === 'image' && entry.imageBlob) {
        const reader = new FileReader();
        const blob = entry.imageBlob;
        const fileName = entry.fileName ?? 'image';
        const historyKey = entry.url;
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const info: ReferenceInfo = {
            title: fileName,
            author: '',
            source: 'image',
            fileName,
            url: historyKey,
          };
          onReferenceChange((s) =>
            s.setAll(loadedReference(info, 'fixed', { localImageUrl: dataUrl })),
          );
          setUrlInput('');
          // Bump lastUsedAt with the Blob in hand so the upsert
          // is self-contained (no redundant db read, and an
          // evicted row between reads can't recreate a blobless
          // entry).
          void addAndReloadHistory(historyKey, 'image', {
            fileName,
            imageBlob: blob,
          });
        };
        reader.readAsDataURL(blob);
        return;
      }
      if (entry.type === 'sketchfab' && entry.imageBlob) {
        // Mirror the gallery "Use this reference" UX: jump
        // straight to fixed mode with the saved screenshot, and
        // load the iframe in the background so "Change angle"
        // still works.
        const sketchfabUid = parseSketchfabModelUrl(entry.url)?.uid;
        if (!sketchfabUid) {
          // Malformed history key — fall through to URL flow
          setUrlInput(entry.url);
          handleLoadFromUrl(entry.url);
          return;
        }
        const blob = entry.imageBlob;
        const historyKey = entry.url;
        const title = entry.title ?? '';
        const ctx = entry.sketchfabSearchContext;
        void blobToDataUrl(blob).then((dataUrl) => {
          if (!dataUrl) return;
          const info: ReferenceInfo = {
            title,
            author: '',
            source: 'sketchfab',
            sketchfabUid,
            imageUrl: dataUrl,
          };
          onReferenceChange((s) =>
            s.setAll(loadedReference(info, 'fixed', { fixedImageUrl: dataUrl })),
          );
          setUrlInput('');
          if (ctx) {
            applySketchfabRestore({
              query: ctx.query,
              category: ctx.category,
              timeFilter: ctx.timeFilter,
            });
          }
          // Load the iframe in the background so "Change Angle"
          // can transition to browse with the model already
          // ready, just like the gallery path.
          loadSketchfabModel(sketchfabUid, title ? { name: title, author: '' } : undefined);
          // Bump lastUsedAt with the Blob in hand so the upsert
          // is self-contained.
          void addAndReloadHistory(historyKey, 'sketchfab', {
            title: title || undefined,
            imageBlob: blob,
          });
        });
        return;
      }
      setUrlInput(entry.url);
      handleLoadFromUrl(entry.url);
    },
    [
      onReferenceChange,
      addAndReloadHistory,
      applySketchfabRestore,
      handleLoadFromUrl,
      loadSketchfabModel,
    ],
  );

  const handleDeleteHistoryEntry = useCallback(
    (url: string) => {
      deleteUrlHistory(url)
        .then(reloadUrlHistory)
        .catch(() => {
          /* ignore */
        });
    },
    [reloadUrlHistory],
  );

  /** User typed in the URL box (clears a stale error). */
  const changeUrlInput = useCallback((value: string) => {
    setUrlInput(value);
    setUrlError(null);
  }, []);

  /** A loaded reference failed to display (e.g. a URL that 404s after preload). */
  const reportLoadError = useCallback(() => setUrlError(t('urlLoadFailed')), []);

  return {
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
  };
}
