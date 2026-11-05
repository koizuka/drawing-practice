# Drawing layers — design

## Motivation

Two workflows want strokes grouped and shown independently:

1. **Draft → ink (phase 1, PR #408)**: rough lines on a faint blue layer,
   clean lines on top, then hide the draft and save — the thumbnail / export
   show only the ink, while the record keeps the draft so it stays
   re-editable.
2. **Line animation (phase 2)**: frames × layers. A second, orthogonal
   per-stroke attribute (`frameId`) plus onion skin / filmstrip / playback —
   see "Frames" below.

## Data model (`src/drawing/layers.ts`)

```ts
type LayerColor = 'ink' | 'blue' | 'red';
interface Layer { id; name; visible; opacity /* 0.1–1 */; locked; color }
interface LayerState { layers: Layer[] /* bottom → top, never empty */; activeLayerId }
interface Stroke { points; timestamp; layerId?: string }
```

- **One chronological stroke array** stays in `StrokeManager`. A stroke only
  carries an optional `layerId`; layer order is applied at render time by
  `orderStrokesForRender` (bucket by layer, chronological within a layer,
  hidden layers skipped). **Why:** every existing index-based undo entry
  (`add` pops the last stroke, `delete` / `lasso-delete` splice at stored
  indices) keeps working unchanged — splitting strokes into per-layer arrays
  would have meant rewriting the whole undo machinery.
- `layerId` absent ≡ `DEFAULT_LAYER_ID` (`'base'`). Strokes on the default
  layer are stored without the field, and a single untouched default layer is
  not persisted at all (`isDefaultLayerState`) — plain drawings serialize
  byte-identically to pre-layer data.
- Copy helpers must spread the stroke (`quantizeStroke`, `shiftStroke`) so
  `layerId` (and phase 2's `frame`) survive.
- `MAX_LAYERS = 8`.
- New ids are `layer-N` from a **monotonic** counter in `StrokeManager`
  (`layerSeq`, raised past every loaded id). A deleted layer can come back
  via undo, so reusing its id for a new layer would create two layers with
  the same id (mixed settings; a redo of the old delete would take the new
  layer's strokes too).

## StrokeManager

Layer list + active id live in `StrokeManager` (it is the drawing document).

- `startStroke` tags the new stroke with the active layer.
- **Editable = on the active layer AND the active layer is visible and
  unlocked** (`isStrokeEditable`). `findNearestStroke` (erase tap), the
  lasso candidate scan in `DrawingCanvas`, and `clearLayer` all honor it, so
  you can fix the ink without touching the draft and a lock really protects.
- A press (pen OR erase) on a hidden/locked active layer is refused in
  `DrawingCanvas` (`canDrawOnActiveLayer`) before `onStrokeStart` — no stroke,
  no timer start — and `onStrokeBlocked` shows a short hint. The toolbar
  layer button turns warning-colored in that state.
- The in-progress stroke is painted at its layer's z-position (after that
  layer's committed strokes), not on top of everything.
- **Undo policy**: only stroke-removing layer ops are undoable. `deleteLayer`
  pushes a `layer-delete` entry
  (layer, its index, its strokes with their array indices, previous active
  id), same shape on both stacks. Undo re-inserts the layer and splices the
  strokes back ascending (indices clamped, since a committed tentative clear
  may have shrunk the array). `commitTentativeClear` / `discardStrokes` filter
  its items like `lasso-delete` but keep the entry (the layer itself is still
  restorable). `clearLayer` reuses `lassoDelete` (one undo unit).
  Settings edits (add / rename / visibility / opacity / lock / color / reorder
  / active) are NOT on the stack — like `masksHidden` they are view-ish, and
  keeping them off means stroke undo never has to reason about a moved layer.
- Gallery-dirty: every layer edit except `setActiveLayer` bumps the mutation
  counter (it changes what a save would write — layers and thumbnail).
- `loadState(strokes, redo, layerState?)`: absent ⇒ default single layer;
  sanitized via `sanitizeLayerState`; strokes on unknown layers are reassigned
  to the bottom layer. Every restore path passes the layer state: draft
  restore, deferred legacy migration (`pendingMigrationRef.layerState`),
  gallery load (`drawing.layers`).
- The trash button (`tentativeClear`) still clears all layers; layers stay.

## Persistence

- Session draft: optional `layers` / `activeLayerId` (written only when
  non-default). A layer-only setup (no strokes, no reference) still keeps the
  draft alive.
- Gallery record: optional `layers` (non-default only). All strokes are saved —
  hidden layers included — so the drawing stays re-editable.
- No Dexie version bump: all fields are additive and unindexed (comment next
  to v17 in `db.ts`).

## Rendering consumers

| Consumer | Behavior |
|---|---|
| `DrawingCanvas` | layer order, tint, opacity (× trace dim); in-progress stroke in the active layer's style |
| Thumbnail / export (SVG, PNG, JPEG, gallery preview) | `renderItemsForStoredDrawing`: visible layers with tint/opacity; only if EVERY layer is hidden, render all (never export a blank) — a visible-but-empty layer does not trigger the fallback |
| Overlay compare, `CanvasNavigator` | visible strokes only, untinted |
| Trace scoring | unchanged — it scores the just-committed stroke, which is on the active layer |

Opacity is applied per stroke (overlaps darken slightly) rather than via an
offscreen layer composite — cheaper, and indistinguishable for line art.

## UI (`LayerPopoverButton`)

Drawing toolbar, next to pen/eraser (the active layer decides where the pen
draws). Badge = active layer number when >1 layer. Popover: list top-first
(row = select; eye; lock; tint dot; name; stroke count), "Add layer",
"Draft + Ink" preset (single-layer only: base → blue 50% "Draft", new "Ink"
on top; the ink layer becomes active only if something was already drawn),
then active-layer settings (name, color, opacity slider, up/down, clear-layer
and delete-layer with in-place ✓/✗ confirm; deleting an empty layer skips the
confirm). Slider drag / typing use the debounced autosave; discrete edits
flush.

## Frames (phase 2 — line animation)

### Model (`src/drawing/frames.ts`)

```ts
interface FrameState { frames: string[] /* playback order, never empty */; currentFrameId; fps }
interface Stroke { …; frameId?: string }   // absent ≡ DEFAULT_FRAME_ID ('frame-0')
interface Layer  { …; shared?: boolean }   // true ⇒ ignores frames (background)
```

- Frames are **stable ids**, not indices. The plan originally said
  `frame: number`, but insert / reorder / delete would then have to renumber
  strokes, and undo entries hold references to stroke objects — mutating or
  replacing them would desync history. With ids, frame edits only touch the
  `frames` list (plus the strokes being added / removed).
- Ids come from a monotonic `frameSeq` (same reason as `layerSeq`).
- `resolveFrameId(stroke, frames)`: a stroke whose frame no longer exists
  resolves to the first frame (only reachable via a shared→per-frame toggle
  after a frame delete), so nothing becomes unreachable.
- **Visible on frame F** = layer visible ∧ (layer.shared ∨ resolveFrameId = F)
  — `isStrokeInFrame`, applied by `orderStrokesForRender(…, frameView)`.
- **Editable** (erase tap, lasso, `clearLayer`) = the stroke is on the
  active layer ∧ that layer is visible and unlocked ∧ the stroke is visible
  on the current frame (shared layers: any frame).
- `startStroke` records the current frame, or the `SHARED_FRAME_ID` marker
  when the active layer is shared. Turning sharing OFF moves exactly the
  marker-tagged strokes onto the current frame (mutated in place so undo
  entries holding the same objects stay consistent); without the marker they
  would be indistinguishable from frame-0 strokes and would vanish from the
  frame being viewed.
- Selecting a frame bumps gallery-dirty (not undoable): the thumbnail /
  export of a save show the current frame, so a different frame is a
  different save.
- `MAX_FRAMES = 120`, fps ∈ {4, 6, 8, 12, 24} (default 8).

### Undo

- `frame-add` (empty, or duplicate carrying fresh-timestamp copies of the
  current frame's per-frame strokes) and `frame-delete` (frame + its
  per-frame strokes with array indices; shared-layer strokes survive) are
  undo entries, same shape on both stacks. Tentative-clear commit and
  `discardStrokes` filter their stroke lists like `layer-delete`.
- Selecting a frame is not undoable but bumps gallery-dirty (see above);
  reorder and fps are non-undoable settings that bump gallery-dirty too.

### Rendering

- `DrawingCanvas` renders `strokeManager.getFrameView(playbackFrameId ?? current)`.
- Onion skin (`onionSkinItems`): per-frame, visible layers' strokes on ±N
  neighbor frames — earlier warm red, later green, nearest ~35% alpha fading
  out, multiplied by the layer's opacity; ordered farther frames first, then
  layer z-order, then chronological — drawn under the current frame. Shared layers are never onioned
  (they're already on screen). Off during playback.
- Thumbnail / export / overlay compare / navigator use the current frame
  (record: `currentFrameId`). GIF / sheet export is phase 3.

### Playback & UI (`AnimationTimeline`)

- Toggle = `Film` button on the drawing toolbar (badge = frame count while
  closed). Timeline open / onion range are per-user prefs in localStorage
  (`drawing.timelineOpen`, `drawing.onionRange`), not drawing data.
- Row 1: prev / play-stop / next, scrub `Slider` (mid-drag = debounced
  autosave, commit = flush), `n / N`, fps select, onion `なし/±1/±2`.
- Row 2: thumbnail filmstrip (shared world bbox across frames so motion
  reads) ending in a dashed "+" cell that appends a frame at the END (placed
  where the new frame appears, not with the far-right ops); then duplicate
  (inserted right after the current frame) / move earlier / later / delete
  (in-place ✓/✗ for non-empty frames; a pending confirm is dropped when the
  current frame changes and is disabled during playback).
- Playback is a DrawingPanel interval over `frames[playIndex]`, passed to the
  canvas as `playbackFrameId` — it does NOT change the manager's current frame
  (no autosave per tick). Stopping commits the shown frame as current. A
  canvas `onPointerDownCapture` stops playback synchronously before the
  canvas handlers run, so a pen-down during playback draws on the frame that
  was showing. Undo / redo / trash / save also stop it (save commits the
  shown frame first so the record's `currentFrameId` matches the screen); a
  gallery load drops it without committing. `CanvasNavigator` gets the
  displayed frame id so its overview follows playback.
- Keyboard: `,` / `.` = previous / next frame.
- The layer popover shows the "全コマ共通" (shared) switch while the
  timeline is open or the drawing has >1 frame.

### Persistence

Session draft and gallery record carry optional `frames` / `currentFrameId` /
`fps` (written only when not the default single frame — `docStateForStorage`
in `src/drawing/docState.ts`, which also handles the layer fields). No Dexie
bump. All restore paths pass them through `pickStoredDocFields` →
`StrokeManager.loadState(…, doc)`.

## Next

- Phase 3: GIF / contact-sheet export.
- Phase 4: rotoscope — step a YouTube reference in sync with frames.
