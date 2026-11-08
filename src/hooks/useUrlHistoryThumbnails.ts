import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UrlHistoryEntry } from '../storage';

export interface UrlHistoryThumbnails {
  /** ObjectURLs for Blob-backed (image / sketchfab) entries, keyed by entry url. */
  blobThumbUrls: Map<string, string>;
  /** Entry urls whose thumbnail failed to load — shown as the type icon instead. */
  thumbErrors: ReadonlySet<string>;
  markThumbError: (url: string) => void;
  /**
   * Drop suppression for entries no longer in `list`; keep it for entries
   * still present so a known-404 thumbnail isn't re-fetched on every reload.
   * Call with each freshly loaded history list.
   */
  pruneThumbErrors: (list: readonly UrlHistoryEntry[]) => void;
}

/**
 * Thumbnail state for the URL-history dropdown (`UrlHistoryAutocomplete`).
 * Call it from ReferencePanel, which outlives the source picker, so the
 * failed-thumbnail suppression survives leaving / re-entering the picker.
 *
 * The ObjectURLs are minted in useMemo and revoked by the effect cleanup.
 * Under StrictMode the dev-only mount→cleanup→mount would revoke the URLs of
 * the first render; that is harmless here because the history is still empty
 * when ReferencePanel mounts (it loads asynchronously afterwards), so keep
 * this hook at ReferencePanel's lifetime rather than inside the picker.
 */
export function useUrlHistoryThumbnails(history: readonly UrlHistoryEntry[]): UrlHistoryThumbnails {
  const [thumbErrors, setThumbErrors] = useState<ReadonlySet<string>>(() => new Set());

  const blobThumbUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of history) {
      if ((e.type === 'image' || e.type === 'sketchfab') && e.imageBlob) {
        map.set(e.url, URL.createObjectURL(e.imageBlob));
      }
    }
    return map;
  }, [history]);
  useEffect(() => {
    return () => {
      for (const u of blobThumbUrls.values()) URL.revokeObjectURL(u);
    };
  }, [blobThumbUrls]);

  const markThumbError = useCallback((url: string) => {
    setThumbErrors((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const pruneThumbErrors = useCallback((list: readonly UrlHistoryEntry[]) => {
    setThumbErrors((prev) => {
      if (prev.size === 0) return prev;
      const urls = new Set(list.map((e) => e.url));
      const stillPresent = new Set([...prev].filter((u) => urls.has(u)));
      return stillPresent.size === prev.size ? prev : stillPresent;
    });
  }, []);

  return { blobThumbUrls, thumbErrors, markThumbError, pruneThumbErrors };
}
