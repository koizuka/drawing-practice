# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Drawing Practice is a line-drawing practice tool designed for iPad + Apple Pencil. Users view a reference (3D model from Sketchfab or local image) on one side and draw on the other side, with synchronized grid and guide lines for alignment.

**Live deployment**: https://koizuka.github.io/drawing-practice/

## Common Commands

```bash
npm run dev        # Development server
npm run build      # Build for production
npm run preview    # Preview production build
npm run lint       # Lint the codebase
npm run test       # Run tests
npm run test:watch # Run tests in watch mode
```

## Architecture

### Screen Layout

- **Split layout**: Two equal panels, landscape (left/right) or portrait (top/bottom), auto-switching
- **Reference Panel** (left/top): Sketchfab 3D model viewer or local image, with grid overlay
- **Drawing Panel** (right/bottom): Canvas for drawing with pen/eraser tools, with grid overlay

### Key Components

**SplitLayout** - Root layout with GuideProvider context, connects overlay strokes between panels. Manages lifted reference state (source, mode, image URLs), timer, autosave/restore, and the `changeReference(mutate)` helper that records reference mutations into the StrokeManager undo history. Inner component (`SplitLayoutInner`) uses `useAutosave` hook for debounced draft persistence.

**ReferencePanel** - Reference source selection (Sketchfab/Local File/URL), toolbar with grid toggle, guide line tools (add/delete/clear), zoom reset, fullscreen toggle. The URL input auto-detects YouTube URLs via `parseYouTubeVideoId`, Pexels photo URLs via `parsePexelsPhotoUrl`, and Sketchfab model URLs (`/3d-models/<slug>-<uid>` and `/models/<uid>`) via `parseSketchfabModelUrl` — each routes to its dedicated source path instead of image preload. Sketchfab URL paste resolves the URL-history entry once for both `sketchfabSearchContext` (search restoration via `applySketchfabRestore`) and `title` (passed to `loadModelByUid` to skip the redundant Data API fetch). Reference state is read-only from props; all mutations are routed through `onReferenceChange(setters => ...)` so every change is recorded as an undoable entry. Image-load errors use a separate non-undoable `onReferenceResetOnError` path. URL-history dropdown selection of a sketchfab entry with an `imageBlob` mirrors the gallery "Use this reference" UX: jump straight to fixed mode with the saved screenshot Blob (FileReader → data URL), restore the search context, and load the iframe in the background. `handleOpenSketchfab` clears `sketchfabRestore` to prevent leftover state from a prior URL-history reopen leaking into a fresh top-screen entry.

**DrawingPanel** - Drawing tools toolbar (pen, eraser, undo/redo, clear, overlay compare, zoom reset, save, gallery), timer display, canvas. Undo/redo handles both strokes and reference changes (the parent's `captureReferenceSnapshot` is passed to `StrokeManager.undo/redo` so the restorer can swap back the previous reference). Timer and grid toggle are provided by parent (SplitLayout).

**DrawingCanvas** - Main canvas component with:
- DPR-aware rendering
- Apple Pencil stylus detection and palm rejection
- Pinch zoom/pan (touch) and trackpad zoom/scroll (wheel events)
- Grid and guide lines drawn in canvas coordinate space (moves with zoom/pan)

**SketchfabViewer** - Sketchfab API integration:
- Model search by category or keyword via Data API. The keyword input is an MUI `Autocomplete` whose options are `getSketchfabSearchHistory()` — past searches (keyword and category-only) appear in a dropdown with per-row delete, mirroring the Pexels search-history pattern. Category-only browses are deduped under `|<slug>` keys; the dropdown labels them with the translated category name (italic) so the empty-query case is distinguishable. `getOptionLabel` returns the translated category name for category-only entries to avoid an empty-string match against an empty input that would suppress the dropdown.
- Categories: a static row of `[All, Animals, Vehicles, ...]` buttons. The "All" button (`handleClearCategory`) is the escape hatch from a sticky category — it clears `activeCategory` and re-fetches `/v3/models` without a category filter so the user can return to "all works" view. Clicking a specific category re-rolls a random subset (`handleRandomFromCategory`).
- `initialQuery` / `initialTimeFilter` / `initialCategory` props auto-restore a saved search context on mount (URL-history reopen flow); the parent (`ReferencePanel`) bumps `sketchfabRestore.token` to remount the viewer with these props. `applySketchfabRestore` skips the bump when the new context equals the current one to avoid a wasteful iframe + state remount.
- Viewer API embedding with screenshot capture ("Fix This Angle"). `loadModelByUid(uid, meta?: SketchfabModelMeta)`: when `meta` is omitted (URL paste, gallery legacy records), the viewer fetches model metadata via `/v3/models/<uid>` so Fix Angle has a non-empty title/author. Search-grid clicks pass `meta` directly to skip the fetch.
- `onFixAngle(screenshot, info, extras: SketchfabFixAngleExtras)` carries the originating `searchContext` and the model CDN `thumbnailUrl` so `ReferencePanel` can attach them to the URL-history entry without round-tripping through the localStorage `lastSearch` snapshot.
- Screenshot becomes fixed image for drawing reference and is also persisted on `ReferenceInfo.imageUrl` so the gallery can show a per-drawing thumbnail and "Use this reference" can restore the exact same angle directly into `fixed` mode. The screenshot is *also* re-encoded as a 1024x1024 JPEG Blob (`dataUrlToJpegBlob`) and stored on the URL-history entry's `imageBlob` field so the URL-history dropdown can restore directly into fixed mode (same UX as gallery "Use this reference").
- **Thumbnail timing**: the screenshot is captured at Fix Angle time (not at save time). The same data URL is stored in both `fixedImageUrl` (for drawing) and `ReferenceInfo.imageUrl` (for persistence). Retaking the angle overwrites both. Save simply writes whatever `imageUrl` is already in `ReferenceInfo` to IndexedDB — no resize or re-encode happens at save, so the gallery thumbnail always reflects the exact angle the user was drawing on. Drawings with no `imageUrl` exist only as legacy records from before this change.

**ImageViewer** - Canvas-based image viewer with zoom/pan, grid/guide overlay, stroke overlay for comparison, and guide line interaction (drag to add, tap to select for deletion). Loads images with non-CORS fallback for cross-origin URLs.

**YouTubeViewer** - iframe embed of a YouTube video with a transparent canvas overlay (spanning the full container, including 16:9 letterbox) for grid, guide lines, compare strokes, and gesture capture. Uses a fixed 16:9 logical coordinate space (1920x1080) reported via `onFitSize` so the drawing panel's grid aligns. Two modes control the overlay:
- **Zoom mode** (default): overlay `pointer-events: auto`, captures wheel/trackpad pinch/2-finger pinch and drives the shared `ViewTransform` (same pattern as `ImageViewer`). This prevents the browser's page-zoom default from firing on `ctrlKey` wheel or iframe pinch. A single tap on the overlay auto-promotes to video mode.
- **Video interact mode**: overlay `pointer-events: none` so the iframe handles clicks directly (seek bar, subtitles, settings). Exited via a toolbar button in `ReferencePanel`.

Play/pause is exposed via the YouTube IFrame Player API (`enablejsapi=1` + postMessage — see `YT_EVENT_*` / `YT_CMD_*` constants). `YouTubeViewer` is a `forwardRef` exposing a `YouTubePlayerHandle` (`{ play(), pause() }`), and emits `onPlayerStateChange(isPlaying)` with per-transition de-duplication (`lastPlayingRef`) so the toolbar icon flips without thrash. Cross-origin iframe isolation means wheel/touch events inside the iframe are unreachable from the parent; the overlay-and-tap model is the deliberate workaround. No video-frame capture is done (YouTube iframe content is CORS-protected); the Fix/still-frame use case is intentionally unsupported.

**PexelsSearcher** - Pexels photo search UI (search input, orientation filter, preset query chips, result grid, pagination). On photo selection, the image loads in `fixed` mode via the existing ImageViewer using the Pexels CDN `src.large2x` URL. Also used indirectly when a `https://www.pexels.com/photo/...-12345/` URL is pasted into the URL field — `parsePexelsPhotoUrl` detects it and `getPhoto(id)` resolves it. API calls go to `api.pexels.com/v1` with an `Authorization` header; the key is stored per-user in `localStorage['pexelsApiKey']` (set via `PexelsApiKeyDialog`). `buildPexelsReferenceInfo` preserves photographer name + pexelsPageUrl so the reference-info overlay can render a "Photo by ... · via Pexels" attribution.

**Gallery** - Modal gallery showing saved drawings with thumbnails, reference title/author, timestamps, delete, per-card export menu (SVG/PNG/JPEG via `exportDrawing`), and "Use this reference" to reload the same reference (Sketchfab model, image URL, YouTube video, or Pexels photo). A `ToggleButtonGroup` in the header switches between three grouping modes: `date` (default; year-month buckets ordered newest-first using `Intl.DateTimeFormat`), `ref-first` (one section per reference via `referenceKey()`, ordered by oldest first-use), and `ref-recent` (same but ordered by most-recent use). The selection is persisted in `localStorage['gallery.groupMode']`. Groups render as labeled sections with a divider above each non-first group — they are not collapsible. The "Use this reference" button appears next to a small reference thumbnail; in date mode it lives on each card, in ref modes it lives only on the group label (the per-card label/button are redundant when every card in the group shares the same reference). Reference thumbnails resolve sync for `sketchfab` (uses the saved `imageUrl` screenshot captured by Fix Angle), `url`, `youtube` (gallery uses `mqdefault.jpg` 320x180 via `buildYouTubeGalleryThumbnailUrl`; the URL-history dropdown still uses the smaller `default.jpg` 120x90), and `pexels` (uses `pexelsImageUrl`); `image` references resolve async by reading the Blob from `urlHistory` via `getUrlHistoryEntry`, with ObjectURLs cached per `referenceKey` and revoked on unmount. Drawings without a structured `reference` field fall into a single legacy `その他 / Other` bucket in ref modes. The header also shows a collapsible storage usage breakdown (see Storage section).

### Drawing System (`src/drawing/`)

- **StrokeManager** - Stroke recording + chronological undo/redo stack shared by strokes and reference changes. Discriminated union entries cover `add` / `delete` / `reference`. Reference entries are restored via an injected `ReferenceRestorer` callback; `undo(captureCurrentRef)` / `redo(captureCurrentRef)` callbacks pass in a snapshot factory so the opposite stack can record the "current" reference. `MAX_REFERENCE_HISTORY` (20) caps reference entries via `undoReferenceCount` for O(1) pruning.
- **CanvasRenderer** - Stroke rendering with highlight support
- **ViewTransform** - Pinch zoom/pan coordinate transformation (scale 0.25x-8x)

### Guide System (`src/guides/`)

- **GuideManager** - Grid settings and arbitrary guide line management
- **GuideContext/useGuides** - Shared state between both panels via React context
- **drawGuides** - Grid and guide line rendering in canvas coordinate space
- Grid has 3 modes (`GridMode`): `none` (off), `normal` (100px spacing), `large` (200px spacing), cycled by button click
- Grid lines are anchored to the center point (image center or viewport center) so center lines always align
- Grid and guide lines are in a shared coordinate system between panels

### Storage (`src/storage/`)

- **Dexie.js** wrapping IndexedDB for persistent storage (schema v9)
- Database name is scoped by `BASE_URL` to isolate PR preview deployments. Main deployment uses `DrawingPracticeDB`; PR previews use `DrawingPracticeDB_{basePath}`.
- On main deployment startup, stale PR preview databases are automatically cleaned up via `indexedDB.databases()`.
- `drawings` table: each record has strokes, thumbnail PNG, structured `ReferenceInfo` (title, author, source, sketchfabUid), timestamp, elapsed time. `saveDrawing` runs strokes through `quantizeStrokesForStorage` (snaps coordinates to 0.1px and drops points that collapse onto the previous one after quantization) to cap per-stroke JSON cost — in-memory strokes and the autosave session draft are unchanged, so the quantization only applies to persisted drawings.
- `session` table: singleton draft record for autosave (strokes, redo stack, reference state, guide state, timer elapsed)
- `urlHistory` table: dropdown history for URL-input references. Entries are `{url, type, title?, lastUsedAt, fileName?, imageBlob?, thumbnailUrl?, pexelsSearchContext?, sketchfabSearchContext?}` keyed by `url`. Types are `youtube | pexels | url | image | sketchfab`. Non-image entries are capped at 50; image entries are capped separately at 10 so a burst of image opens cannot evict other history. Image entries store a resized JPEG Blob (max 2048px, quality 0.85) under the synthetic key `local:<sha256>` so byte-identical files dedupe across paths/renames and a repeat open skips the resize. Sketchfab entries are keyed by `https://sketchfab.com/models/<uid>` (canonical via `canonicalSketchfabUrl`) and store the Fix-Angle screenshot as a 1024x1024 JPEG Blob (`dataUrlToJpegBlob`, ~200KB) so URL-history reopen can restore directly into fixed mode. The dropdown shows a per-entry preview thumbnail: `image` and `sketchfab` use the stored Blob (ObjectURL via `blobThumbUrls` Map), `youtube` derives `https://i.ytimg.com/vi/<id>/default.jpg` from the video id, `url` uses the entry url itself, `pexels` stores `photo.src.tiny` in `thumbnailUrl` at add time, and `sketchfab` falls back to `thumbnailUrl` (model CDN URL) only if the Blob is missing.
- `pexelsSearchHistory` and `sketchfabSearchHistory` tables: per-source search-history dropdown entries (deduped by `query.toLowerCase()` for Pexels and `query|category` for Sketchfab so a category-only browse with empty query gets its own row). Each store has its own 50-entry cap and uses `historyEviction.selectKeysToEvict` for FIFO eviction.
- **sessionStore** - Draft CRUD: `saveDraft`, `loadDraft`, `clearDraft`
- **urlHistoryStore** - `addUrlHistory(url, type, string | AddUrlHistoryOptions)` upserts with field-preservation semantics (omitted title/fileName/imageBlob/thumbnailUrl/pexelsSearchContext/sketchfabSearchContext fall back to the existing row; the `thumbnailUrl` fallback path is scoped to `pexels`/`sketchfab` to avoid an unnecessary DB read for url/youtube types that derive the thumbnail at render time; the Blob lookup applies to both `image` and `sketchfab`); `getUrlHistory()`, `getUrlHistoryEntry(url)`, `deleteUrlHistory(url)`.
- **storageUsage** - `computeStorageUsage(drawings)` returns a per-category breakdown (drawings: strokes / thumbnails / sketchfabImages bytes plus `drawingCount` / `strokeCount` / `pointCount` for triage; urlHistory image bytes; session bytes; `navigator.storage.estimate()`). The gallery derives averages (points/stroke, bytes/stroke, strokes/drawing) from these counters when expanded so users can tell whether stroke bloat comes from many strokes or many points per stroke. Takes the drawings array as input so the gallery can reuse its already-loaded records and avoid a duplicate DB walk; the urlHistory/session/estimate reads run in parallel via `Promise.all`. `formatBytes` produces a B/KB/MB/GB string.
- Gallery shows reference title/author, and "Use this reference" button to reload the same reference. For `'image'` source this resolves the Blob from `urlHistory` via `ReferenceInfo.url` (the `local:<sha256>` key); if the entry has been evicted, `SplitLayout` surfaces a Snackbar warning instead. For `'sketchfab'` with `imageUrl` set, the saved screenshot is restored directly into `fixed` mode (the iframe stays mounted in fixed mode so "Change angle" can still switch back into browse with the model already loaded). Legacy Sketchfab drawings without `imageUrl` fall back to the original browse-only restore.
- Gallery header shows a collapsible storage usage row (default collapsed; expanded state persisted in `localStorage['gallery.storageUsageExpanded']`).
- Designed for 1000+ records
- **Pexels API key** is stored separately in `localStorage['pexelsApiKey']` (not in IndexedDB). Each user supplies their own free key (registered at pexels.com/api) — no dev key is bundled into the build.

### Timer (`src/hooks/useTimer.ts`)

- Auto-starts on first stroke completion, resumes on next stroke after any pause. Also auto-starts on redo when strokes are restored while the timer is stopped (e.g. after undo emptied the history).
- Pauses on: app backgrounded (visibilitychange API), save, opening the gallery, and any reference change (source / mode / fixed image / local image / Sketchfab angle / gallery "use this reference"). Reference-related pausing is wired through a `pauseAndIncrementVersion` helper in `SplitLayout` that `changeReference` calls after recording the undo entry and applying the mutation.
- Resets on clear, or when undo drains the history stack (`!canUndo()`). Treating a fully-undone session as "pre-drawing" keeps the reset path reachable even though the trash button is disabled while strokeCount is 0. Erase and redo do not touch the timer.
- `restore(ms)` sets elapsed time without starting (used by autosave restore)

### Autosave (`src/hooks/useAutosave.ts`)

- Debounced (2s) persistence of session state to IndexedDB `session` table
- Tracks changes via a version counter incremented by state setters in SplitLayout
- Suppressed during draft restore to avoid overwriting with partial state
- Clears draft when session is empty (no strokes and no reference)

### Key Patterns

- **Canvas coordinate space**: Grid, guide lines, strokes, and overlay all share the same coordinate space. Each panel applies its own ViewTransform independently.
- **Initial view sync**: When a reference image is loaded, its dimensions are passed to DrawingCanvas via `fitSize` so both panels start with the same scale, ensuring grid alignment.
- **Grid center line**: Grid is anchored to the exact center point (image center or viewport center when no reference is loaded). The center grid line is drawn thicker as a visual anchor for alignment.
- **Overlay comparison**: Drawing strokes are passed as data (not screenshot) to the reference panel, rendered in the reference panel's coordinate space so grid positions align.
- **DPR handling**: All canvas operations multiply by `window.devicePixelRatio`.
- **Viewport sizing**: Uses `100dvh` instead of `100vh` to handle iPad Safari's dynamic toolbar correctly.
- **Autosave/Restore**: Session state (strokes, redo stack, reference, guides, timer) is persisted to IndexedDB on change. On reload, state is restored from draft. Local file images are stored as data URLs (via `FileReader.readAsDataURL`) to survive page reload. URL references store only the URL. Sketchfab references store the screenshot as a data URL.
- **Reference undo history**: Reference changes (Fix Angle retake, image swap, Close, Gallery load, initial load) are recorded into the same undo stack as strokes, so the user can undo a misclick that replaced a reference while strokes were already drawn. History is session-only (not persisted in the draft) to keep IndexedDB usage bounded — after a reload only the current reference plus strokes are restored. The `SplitLayout`-owned `captureReferenceSnapshot` / `applyReferenceSnapshot` (registered via `StrokeManager.setReferenceRestorer`) handle the capture+restore roundtrip. `historySyncVersion` is bumped by `changeReference` to refresh DrawingPanel's `canUndo`/`canRedo` UI after an external history push.

### File Structure

```
src/
├── main.tsx
├── App.tsx
├── index.css
├── types.ts                # Shared types (ReferenceSource, ReferenceMode)
├── components/
│   ├── SplitLayout.tsx
│   ├── ReferencePanel.tsx
│   ├── DrawingPanel.tsx
│   ├── DrawingCanvas.tsx
│   ├── SketchfabViewer.tsx
│   ├── ImageViewer.tsx
│   ├── YouTubeViewer.tsx
│   ├── PexelsSearcher.tsx
│   ├── PexelsApiKeyDialog.tsx
│   └── Gallery.tsx
├── drawing/
│   ├── types.ts
│   ├── constants.ts        # Shared stroke width / overlay halo multiplier
│   ├── StrokeManager.ts
│   ├── CanvasRenderer.ts
│   ├── ViewTransform.ts
│   └── index.ts
├── guides/
│   ├── types.ts
│   ├── GuideManager.ts
│   ├── GuideContext.tsx
│   ├── useGuides.ts
│   ├── drawGuides.ts
│   └── index.ts
├── storage/
│   ├── db.ts
│   ├── drawingStore.ts
│   ├── sessionStore.ts     # Autosave draft CRUD
│   ├── urlHistoryStore.ts  # URL-input dropdown history (incl. local image + sketchfab screenshot Blobs)
│   ├── pexelsSearchHistoryStore.ts
│   ├── sketchfabSearchHistoryStore.ts
│   ├── historyEviction.ts  # Shared FIFO eviction helper
│   ├── storageUsage.ts     # Per-category byte breakdown for the gallery storage row
│   ├── exportDrawing.ts    # Gallery file export (SVG / PNG / JPEG) with auto filename
│   ├── generateThumbnail.ts
│   └── index.ts
├── hooks/
│   ├── useOrientation.ts
│   ├── useTimer.ts
│   ├── useAutosave.ts      # Debounced session autosave
│   ├── useFullscreen.ts
│   └── useKeyboardShortcuts.ts  # Keyboard shortcuts (Undo/Redo, tool switch, save)
├── utils/
│   ├── youtube.ts          # YouTube URL parsing and embed URL helpers
│   ├── pexels.ts           # Pexels API client, URL parsing, API key management
│   ├── sketchfab.ts        # Sketchfab URL parsing, Data API client, search-context types/storage
│   └── imageResize.ts      # Canvas-based image resize, dataUrlToJpegBlob, blobToDataUrl, SHA-256 hash
└── test/
    └── setup.ts
```

### Build & Deploy

- **Vite** with React plugin, TypeScript strict mode
- **Vitest** + React Testing Library for unit tests
- **Material-UI** for UI components
- **GitHub Pages** deployment via GitHub Actions
