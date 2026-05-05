---
paths:
  - "src/storage/**"
---

# Storage layer rules

Dexie.js wraps IndexedDB (schema v9). DB name is scoped by `BASE_URL` so PR previews don't collide with main: main uses `DrawingPracticeDB`, previews use `DrawingPracticeDB_{basePath}`. On main-deployment startup, stale preview DBs are cleaned up via `indexedDB.databases()`. Designed for 1000+ records.

## Tables

- **`drawings`** — strokes, thumbnail PNG, structured `ReferenceInfo` (title, author, source, sketchfabUid, imageUrl, pexelsImageUrl, pexelsPageUrl, etc.), timestamp, elapsed time. Quantization (snap to 0.1px + drop collapsed points) happens at `StrokeManager` entry points (`startStroke` / `appendStroke` / `loadState`) so in-memory strokes and the autosave session draft are *also* quantized. `saveDrawing` still runs `quantizeStrokesForStorage` (in `src/storage/drawingStore.ts`, delegating to `quantizeStroke` in `src/drawing/quantize.ts`) as defense-in-depth — it's idempotent on already-quantized input.
- **`session`** — singleton draft for autosave (strokes, redo stack, reference, guides, timer elapsed). Reference undo history is intentionally NOT persisted to keep IndexedDB usage bounded.
- **`urlHistory`** — URL-input dropdown history. Entries: `{url, type, title?, lastUsedAt, fileName?, imageBlob?, thumbnailUrl?, pexelsSearchContext?, sketchfabSearchContext?}` keyed by `url`. Types: `youtube | pexels | url | image | sketchfab`.
- **`pexelsSearchHistory` / `sketchfabSearchHistory`** — per-source search-history dropdown. Pexels deduped by `query.toLowerCase()`. Sketchfab deduped by `query|category` (so a category-only browse with empty query gets its own row). Each capped at 50 via `historyEviction.selectKeysToEvict` (FIFO).

## urlHistory key + cap design (non-obvious)

- **Non-image entries cap = 50; image entries cap = 10 (separate)** — so a burst of image opens cannot evict other history.
- **Image key = `local:<sha256>`** — synthetic key so byte-identical files dedupe across paths/renames; repeat opens skip the resize. Blob is resized to max 2048px JPEG q=0.85 before storage.
- **Sketchfab key = `https://sketchfab.com/models/<uid>`** (canonical via `canonicalSketchfabUrl`). Stores Fix-Angle screenshot as 1024x1024 JPEG Blob (~200KB) in `imageBlob` so URL-history reopen can restore directly into fixed mode (gallery "Use this reference" UX).
- **Dropdown thumbnail resolution**: `image`/`sketchfab` use the stored Blob (ObjectURL via `blobThumbUrls` Map); `youtube` derives `https://i.ytimg.com/vi/<id>/default.jpg`; `url` uses the entry url; `pexels` uses `photo.src.tiny` saved at add time; `sketchfab` falls back to `thumbnailUrl` (model CDN) only if the Blob is missing.

## addUrlHistory field-preservation semantics

`addUrlHistory(url, type, string | AddUrlHistoryOptions)` upserts. Omitted `title` / `fileName` / `imageBlob` / `thumbnailUrl` / `pexelsSearchContext` / `sketchfabSearchContext` fall back to the existing row.

- **`thumbnailUrl` fallback is scoped to `pexels` / `sketchfab` only** — to avoid an unnecessary DB read for `url` / `youtube` types that derive the thumbnail at render time. **Why:** opening a URL or YouTube reopen should not pay for a DB lookup it doesn't need.
- **Blob lookup applies to both `image` and `sketchfab`** — both store local Blobs.

## storageUsage

`computeStorageUsage(drawings)` returns per-category byte breakdown:
- drawings: strokes / thumbnails / sketchfabImages bytes + `drawingCount` / `strokeCount` / `pointCount`
- urlHistory image bytes
- session bytes
- `navigator.storage.estimate()`

Takes the drawings array as input so the gallery reuses already-loaded records (no duplicate DB walk). urlHistory/session/estimate reads run in parallel via `Promise.all`. `formatBytes` produces B/KB/MB/GB.

The gallery uses these counters to derive averages (points/stroke, bytes/stroke, strokes/drawing) so users can triage stroke bloat (many strokes vs many points per stroke).

## Pexels API key

Stored in `localStorage['pexelsApiKey']`, NOT in IndexedDB. Each user supplies their own free key from pexels.com/api. **Why:** no dev key bundled into the public build.
