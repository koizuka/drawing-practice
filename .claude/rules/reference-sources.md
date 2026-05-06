---
paths:
  - "src/components/ReferencePanel.tsx"
  - "src/components/SketchfabViewer.tsx"
  - "src/components/ImageViewer.tsx"
  - "src/components/YouTubeViewer.tsx"
  - "src/components/PexelsSearcher.tsx"
  - "src/utils/sketchfab.ts"
  - "src/utils/pexels.ts"
  - "src/utils/youtube.ts"
---

# Reference source rules

Reference sources: Sketchfab 3D model, local image file, URL (auto-routed), YouTube video, Pexels photo.

## ReferencePanel

- Reference state is **read-only from props**. All mutations route through `onReferenceChange(setters => ...)` so each change is recorded as an undo entry. (See `drawing-undo.md`.)
- URL input auto-detects: YouTube (`parseYouTubeVideoId`), Pexels photo (`parsePexelsPhotoUrl`), Sketchfab model (`parseSketchfabModelUrl` — supports `/3d-models/<slug>-<uid>` and `/models/<uid>`). Each routes to its dedicated source path instead of plain image preload.
- **Sketchfab URL paste**: resolves the URL-history entry once and reuses it for both `sketchfabSearchContext` (search restoration) and `title` (passed to `loadModelByUid` to skip the redundant Data API fetch).
- **URL-history dropdown sketchfab entry with `imageBlob`**: jumps straight to fixed mode with the saved screenshot Blob (FileReader → data URL), restores the search context, and loads the iframe in the background. Mirrors gallery "Use this reference" UX.
- `handleOpenSketchfab` clears `sketchfabRestore`. **Why:** prevents leftover state from a prior URL-history reopen leaking into a fresh top-screen entry.

## SketchfabViewer

- Search via Data API. Keyword input is MUI `Autocomplete` populated from `getSketchfabSearchHistory()` — past keyword + category-only searches with per-row delete.
- **Unified search/UID input**: the same Autocomplete classifies its value via `classifySketchfabQuery()` — a 32-char UID (`isValidUid`) or a Sketchfab model URL (`parseSketchfabModelUrl`) routes Enter/submit to `loadModel(uid)` and flips the button label to `Load`; anything else stays a keyword search. **Why:** keeps the surface to one box without losing direct UID/URL paste, and avoids polluting search history with UID/URL entries (the UID branch never calls `recordSearch`).
- Category-only browses dedupe under `|<slug>` keys. Dropdown labels them with the translated category name (italic) so the empty-query case is distinguishable. `getOptionLabel` returns the translated category name for category-only entries — **why:** an empty-string match against an empty input would otherwise suppress the dropdown.
- Categories: static `[All, Animals, Vehicles, ...]` button row. **"All" (`handleClearCategory`) is the escape hatch** from a sticky category — clears `activeCategory` and re-fetches `/v3/models` without a category filter. Specific categories re-roll a random subset (`handleRandomFromCategory`).
- `initialQuery` / `initialTimeFilter` / `initialCategory` props auto-restore a saved search context on mount. Parent bumps `sketchfabRestore.token` to remount the viewer. `applySketchfabRestore` skips the bump when the new context equals the current one — **why:** avoids a wasteful iframe + state remount.
- `loadModelByUid(uid, meta?: SketchfabModelMeta)`: when `meta` is omitted (URL paste, gallery legacy records), the viewer fetches `/v3/models/<uid>` so Fix Angle has a non-empty title/author. Search-grid clicks pass `meta` directly to skip the fetch.
- `onFixAngle(screenshot, info, extras)`: `extras` carries `searchContext` + model CDN `thumbnailUrl` so `ReferencePanel` attaches them to the URL-history entry without round-tripping through the localStorage `lastSearch` snapshot.

## Sketchfab Fix Angle: triple persistence (non-obvious)

A single screenshot is captured at Fix Angle time and stored in **three** places:
1. `fixedImageUrl` (in-memory) — used for drawing.
2. `ReferenceInfo.imageUrl` — saved to IndexedDB so the gallery shows a per-drawing thumbnail and "Use this reference" can restore the exact angle directly into `fixed` mode.
3. URL-history entry's `imageBlob` (1024x1024 JPEG via `dataUrlToJpegBlob`, ~200KB) — so URL-history dropdown reopen can also restore directly into fixed mode.

**Thumbnail timing:** capture happens at Fix Angle time, NOT save time. Retake overwrites all three. Save just writes the existing `imageUrl` to IndexedDB — no resize/re-encode at save. **Why:** gallery thumbnail must reflect the exact angle the user drew on, not some later-loaded angle. Drawings without `imageUrl` are legacy records from before this change.

## ImageViewer

Canvas-based image viewer with zoom/pan, grid/guide overlay, stroke overlay for comparison, and guide line interaction (drag to add, tap to select for deletion). Loads images with non-CORS fallback for cross-origin URLs.

## YouTubeViewer

iframe embed with a transparent canvas overlay spanning the full container (incl. 16:9 letterbox). Fixed 16:9 logical coordinate space (1920x1080) reported via `onFitSize` so drawing-panel grid aligns.

Two overlay modes:
- **Zoom mode (default)**: `pointer-events: auto`, captures wheel/trackpad/2-finger pinch and drives shared `ViewTransform`. **Why:** prevents browser page-zoom default on `ctrlKey` wheel or iframe pinch. Single tap auto-promotes to video mode.
- **Video interact mode**: `pointer-events: none` so iframe handles clicks (seek bar, subtitles, settings). Exited via toolbar button in `ReferencePanel`.

Play/pause via YouTube IFrame Player API (`enablejsapi=1` + postMessage; see `YT_EVENT_*` / `YT_CMD_*`). `YouTubeViewer` is `forwardRef` exposing `YouTubePlayerHandle` (`{ play(), pause() }`). Emits `onPlayerStateChange(isPlaying)` with per-transition de-dup (`lastPlayingRef`) so the toolbar icon flips without thrash.

**No video-frame capture** — YouTube iframe content is CORS-protected. Fix/still-frame is intentionally unsupported. **Why:** cross-origin iframe isolation makes wheel/touch events inside the iframe unreachable from the parent; the overlay-and-tap model is the deliberate workaround.

## PexelsSearcher

Search input, orientation filter, preset query chips, result grid, pagination. On photo selection, image loads in `fixed` mode via ImageViewer using Pexels CDN `src.large2x`. Also used indirectly when `https://www.pexels.com/photo/...-12345/` is pasted (`parsePexelsPhotoUrl` + `getPhoto(id)`).

API: `api.pexels.com/v1` with `Authorization` header; key in `localStorage['pexelsApiKey']` (set via `PexelsApiKeyDialog`). `buildPexelsReferenceInfo` preserves photographer name + pexelsPageUrl for the "Photo by ... · via Pexels" attribution overlay (Pexels TOS requirement).

**Missing/invalid key is handled modally by the parent, not in-screen.** When `needsKey` flips true (mount with empty key, post-Clear `apiKeyVersion` bump, or 401 from `searchPhotos`), `PexelsSearcher` fires `onApiKeyMissing`; `ReferencePanel` opens `PexelsApiKeyDialog` and, on Cancel/Clear, calls `handleClose` to exit the Pexels source. **Why:** every searcher control is `disabled={needsKey}` — without the modal recovery the user would be stranded on a fully-disabled screen with no way off. Do not re-introduce a modeless in-screen Alert for this path.

The notification is gated on the `active` prop (parent passes `referenceMode === 'browse'`). The searcher stays mounted in fixed mode (preserves search state across browse↔fixed transitions), but in fixed mode the user is viewing/drawing on a CDN-loaded photo that doesn't need the API key — firing `onApiKeyMissing` there would yank them out of their work.
