---
paths:
  - "src/components/Gallery.tsx"
  - "src/storage/exportDrawing.ts"
  - "src/storage/storageUsage.ts"
---

# Gallery rules

Modal showing saved drawings with thumbnails, reference title/author, timestamps, delete, per-card export menu, and "Use this reference".

## Grouping modes

`ToggleButtonGroup` in the header switches between three modes (selection persisted in `localStorage['gallery.groupMode']`):

- **`date`** (default) — year-month buckets ordered newest-first via `Intl.DateTimeFormat`.
- **`ref-first`** — one section per reference via `referenceKey()`, ordered by oldest first-use.
- **`ref-recent`** — one section per reference, ordered by most-recent use.

Groups render as labeled sections with a divider above each non-first group. **Not collapsible.**

Drawings without a structured `reference` field fall into a single legacy `その他 / Other` bucket in ref modes.

## "Use this reference" placement

- **Date mode**: button on each card (next to a small reference thumbnail).
- **Ref modes**: button only on the group label. **Why:** the per-card label/button are redundant when every card in the group shares the same reference.

## Reference thumbnail resolution

- **Sync**: `sketchfab` (uses saved `imageUrl` screenshot from Fix Angle), `url` (uses entry url), `youtube` (gallery uses `mqdefault.jpg` 320x180 via `buildYouTubeGalleryThumbnailUrl`; URL-history dropdown still uses smaller `default.jpg` 120x90), `pexels` (uses `pexelsImageUrl`).
- **Async**: `image` references read the Blob from `urlHistory` via `getUrlHistoryEntry(url)` (the `local:<sha256>` key). ObjectURLs cached per `referenceKey` and revoked on unmount.

## "Use this reference" restoration paths

- `'image'` source — resolves Blob from `urlHistory` via `ReferenceInfo.url`. If the entry has been evicted, `SplitLayout` surfaces a Snackbar warning instead.
- `'sketchfab'` with `imageUrl` set — saved screenshot restored directly into `fixed` mode. Iframe stays mounted in fixed mode so "Change angle" can still switch back into browse with the model already loaded.
- Legacy Sketchfab drawings without `imageUrl` — fall back to original browse-only restore.
- `'trace-template'` — `canLoadReference` returns true unconditionally (the bundle is always available; nothing to evict). `handleLoadReference` restores `source='trace-template'` + `referenceMode='fixed'` + the original `referenceInfo` (carrying `templateId`); `ReferencePanel` looks up the template via `getBundledTemplate(id)`. Trace scoring state is NOT restored — see `trace-template.md`'s "Out of scope".

## Enlarged preview + "Continue this drawing"

Tapping a card's thumbnail opens `DrawingPreviewDialog` (overlay above the gallery modal). The stored thumbnail is only 200px, so the preview re-renders the vector strokes via `renderDrawingToCanvas` (shared with export; up to 2048px / 8Mpx) — never scale up the stored thumbnail. Footer has the export menu and a "Continue this drawing" button (shown only when `onLoadDrawing` is wired and the record has strokes).

Load flow: `Gallery.onLoadDrawing` → `DrawingPanel.handleGalleryLoadDrawing` (confirmation gate) → `SplitLayout.handleLoadDrawing`.

- **Confirmation only when the canvas holds unsaved strokes** (`strokeCount > 0 && isDirtySinceGallerySave()`). A clean or empty canvas loads immediately. The confirm is a small modal above the gallery (deliberate deviation from the toolbar-in-place rule — there's no toolbar context inside the modal stack; Cancel keeps the gallery open).
- `SplitLayout.handleLoadDrawing` restores the reference via `handleLoadReference(ref, onApplied)` — `onApplied(applied)` fires synchronously after `changeReference` (or once eviction is known) so stroke loading can run AFTER `changeReference` resets `pendingMigrationRef`. Records without a structured reference leave the current reference untouched.
- Strokes go through `loadState(strokes, [])` + `markSavedToGallery()` (record is bit-identical to the gallery entry — Save must stay disabled), then `timer.restore(elapsedMs)` continues the recorded drawing time. Undo history / guides are NOT in the record; guides are left as-is, undo restarts from the loaded strokes.
- **Camera centers on the loaded strokes' bounding box** (zoom 1), NOT on home. Home (= world origin = reference center) is not enough: off-center drawings, and legacy strokes loaded unshifted (evicted reference), can sit entirely outside the home viewport — the load would look like a silent no-op. Reset-zoom still offers the reference-centered home. Three delivery routes, chosen by whether a viewer reload will fire `loadContent(0,0,1)` afterwards (which would stomp a camera set eagerly): (1) no reload coming (same content / evicted / no reference) → `restoreCamera` directly in `applyLoadedDrawingStrokes`; (2) fresh reference + current coords → bbox stashed in `pendingGalleryCameraRef`, promoted to `pendingCameraRef` in `handleReferenceImageSize` (with a `restoreVersion` bump so the apply-effect re-runs even on same-dimension content); (3) fresh reference + legacy coords → `centerCameraOnStrokes` flag on `pendingMigrationRef`, bbox computed from the migrated strokes. Both pending refs are cleared on `changeReference` / `resetReferenceOnError`.
- **Legacy coords** (`coordVersion < 2`) with a sizing reference defer through `pendingMigrationRef` with `skipUserStartGuard: true` (the `canUndo()` guard would otherwise always trip — `changeReference` just pushed entries) and `guides` omitted (current guide setup untouched).
- **Same-content trap**: viewers fire `onReferenceImageSize` only on an actual content (re)load. If the record's reference is the content ALREADY displayed (same src / videoId / templateId), React sees unchanged props, nothing reloads, and a deferred legacy migration would hang forever — strokes never appear while reference/timer do. `handleLoadDrawing` snapshots the pre-load reference state and, when `isSameReferenceContent(prev, ref)` (pure helper in `splitLayoutHelpers.ts`), passes the current `referenceSize` as `knownSize` so `applyLoadedDrawingStrokes` shifts and loads immediately instead of deferring.

## Export

Per-card menu via `exportDrawing` — supports SVG / PNG / JPEG with auto-generated filename. The renderer is exported as `renderDrawingToCanvas` and reused by the preview dialog.

## Selection / bulk delete

Cards are deleted via a select-then-delete flow rather than a per-card trash icon. **Why:** removing a card immediately on tap caused the grid to reflow under the user's finger, so a mistap deleted the next card. Deferring deletion until an explicit button press eliminates that class of mistake.

- Each card has a checkbox overlay at the top-right of the thumbnail. Tapping toggles selection (no immediate effect).
- When `selectedIds.size > 0`, a `Delete (N)` Button (`variant="contained" color="error"`) appears in the header next to the grouping toggle. Pressing it `deleteDrawing`s the selected ids in parallel, removes them from local state, recomputes storage usage, and clears the selection.
- Closing the dialog without pressing the button discards the selection — nothing is deleted. There is no separate confirmation dialog; the two-step selection itself is the friction.

## Storage usage row

Header shows a collapsible storage usage breakdown (default collapsed; expanded state in `localStorage['gallery.storageUsageExpanded']`). When expanded, derives averages (points/stroke, bytes/stroke, strokes/drawing) from `computeStorageUsage` counters so users can triage stroke bloat. See `storage.md` for the underlying computation.
