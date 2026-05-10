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

## Export

Per-card menu via `exportDrawing` — supports SVG / PNG / JPEG with auto-generated filename.

## Selection / bulk delete

Cards are deleted via a select-then-delete flow rather than a per-card trash icon. **Why:** removing a card immediately on tap caused the grid to reflow under the user's finger, so a mistap deleted the next card. Deferring deletion until an explicit button press eliminates that class of mistake.

- Each card has a checkbox overlay at the top-right of the thumbnail. Tapping toggles selection (no immediate effect).
- When `selectedIds.size > 0`, a `Delete (N)` Button (`variant="contained" color="error"`) appears in the header next to the grouping toggle. Pressing it `deleteDrawing`s the selected ids in parallel, removes them from local state, recomputes storage usage, and clears the selection.
- Closing the dialog without pressing the button discards the selection — nothing is deleted. There is no separate confirmation dialog; the two-step selection itself is the friction.

## Storage usage row

Header shows a collapsible storage usage breakdown (default collapsed; expanded state in `localStorage['gallery.storageUsageExpanded']`). When expanded, derives averages (points/stroke, bytes/stroke, strokes/drawing) from `computeStorageUsage` counters so users can triage stroke bloat. See `storage.md` for the underlying computation.
