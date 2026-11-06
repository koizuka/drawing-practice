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
interface Layer { id; name; visible; opacity /* 0.1–1 */; locked; color; shared?: boolean }
interface LayerState { layers: Layer[] /* bottom → top, never empty */; activeLayerId }
interface Stroke { points; timestamp; layerId?: string; frameId?: string }
// `shared` and `frameId` belong to the animation axis — see "Frames" below.
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

## UI (`LayerToolbarButton` + `LayerPanel`)

Toggle button on the drawing toolbar, next to pen/eraser (the active layer
decides where the pen draws). Badge = active layer number when >1 layer.
The panel is **non-modal and docked flush to the canvas area's top-left
edge** (an earlier modal `Popover` had to be closed before the canvas took
input again, and it floated inward over where you draw). It stays open while
drawing; close via the toggle or its ✕. The header's 2×2 corner picker
docks it to any of the four corners (no free dragging — the only goal is to
get it out of where you draw). Widgets pinned to the same corner step aside
by the panel's measured height (`onHeightChange`, ResizeObserver): the
navigator and trace-score badge at top-right, `PerspectiveController` at
bottom-left. Open state and corner are per-user prefs
(`localStorage['drawing.layerPanelOpen']` / `['drawing.layerPanelCorner']`). Contents: list top-first
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
  current frame's per-frame strokes) and `frame-delete` (ONE OR MORE frames
  — `frames: {frameId, frameIndex}[]` ascending — + their per-frame strokes
  with array indices; shared-layer strokes survive) are undo entries, same
  shape on both stacks. `deleteFrames(ids)` is the bulk path (one undo
  unit; refuses to delete every frame); `deleteFrame(id)` wraps it. Strokes
  are matched against the frame list BEFORE any id is dropped, and a
  deleted current frame falls back to the nearest surviving earlier one
  (none left before it ⇒ the first surviving later one). Tentative-clear commit and
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
- Thumbnail / export / overlay compare use the current frame (record:
  `currentFrameId`); `CanvasNavigator` uses the DISPLAYED frame (the playback
  position while playing). GIF / sheet export: see "Animation export".

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
- **Select mode** (`ListChecks` button) for bulk delete: thumbnails stop
  navigating; a tap toggles one, a drag across the strip paints a range
  (adds if it started on an unselected frame, removes otherwise; the strip
  gets `touch-action: none` and auto-scrolls every animation frame while
  the pointer rests near an edge — a held finger sends no pointermove),
  shift-click extends from the last anchor, keyboard activation
  toggles. Ops become "N selected / select all ↔ clear / delete (✓/✗) /
  done"; selecting every frame disables delete (one must remain). Deleting
  is one `frame-delete` undo entry and immediately exits select mode;
  starting playback exits it too (render-time state reset, not an effect).
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
- The layer panel shows the "全コマ共通" (shared) switch while the
  timeline is open or the drawing has >1 frame.

### Persistence

Session draft and gallery record carry optional `frames` / `currentFrameId` /
`fps` (written only when not the default single frame — `docStateForStorage`
in `src/drawing/docState.ts`, which also handles the layer fields). No Dexie
bump. All restore paths pass them through `pickStoredDocFields` →
`StrokeManager.loadState(…, doc)`.

## Animation export (phase 3)

`src/storage/exportAnimation.ts`, entry points: the timeline's download
button (`exportLiveAnimation` — the drawing as it is on screen, no gallery
save needed; named by "now") and the gallery export menu for records with
>1 frame (`exportDrawingAnimation`; still SVG/PNG/JPEG keep exporting the
saved current frame).

- Every frame goes through `renderItemsForStoredDrawing(…, {frames, frameId})`
  — same visible-layer / tint / opacity / shared-layer rules as the stills —
  over ONE padded world box covering all frames, so motion is preserved
  instead of each frame being re-centered.
- **GIF**: long edge ≤ 720px (≤ 2× upscale), line width kept ≥ 1.25px.
  Delays come from `frameDelaysCs` (rounding distributed so 8 fps =
  13,12,13,12 cs, total exact). Loops forever. Frames are rendered one at a
  time with a `setTimeout(0)` yield before / between them and compressed
  immediately by the streaming `GifWriter`, which keeps only the previous
  frame's indices (for the diff crop) — never all 120 full-size buffers
  (120 frames of a busy 1500×1000 drawing ≈ 1.4 s, ~1.3 MB in Chrome). The
  contact sheet yields between cells too, so the busy spinner paints and the
  UI never blocks for more than one frame's work.
- **Quantization** (`buildQuantizer`): every pixel is white, a stroke color,
  or a white→color blend (antialiasing / layer opacity), so the palette is a
  white→tint ramp per used color (≤ 64 levels each, index 0 = white) and a
  pixel is projected onto the nearest ramp — no median-cut, no dithering.
- **Encoder** (`src/utils/gifEncoder.ts`, in-house on purpose — no npm
  dependency for ~150 lines): GIF89a, one global table, LZW with 12-bit
  reset, disposal "keep" + per-frame crop to the rectangle that changed
  (identical frames become a 1×1 image so their delay survives). Gotcha:
  reading the LAST data code makes the decoder add the table entry the
  encoder never adds, and if that fills the width it reads EOI one bit wider
  — the encoder must widen before EOI too (only strict decoders notice;
  Chrome tolerates it). Tests
  round-trip it through an independent spec decoder; Chrome's
  `ImageDecoder` was used for browser verification.
- **Contact sheet (コマ割りシート)**: PNG, frames in reading order with
  1-based numbers above each cell, light gray cell borders; column count
  picked so the sheet is closest to √2 landscape; cells ≤ 480px long edge,
  whole sheet ≤ 8 Mpx (same ceiling as the still raster export).

## Rotoscope (phase 4)

Trace a YouTube reference frame by frame. YouTube's picture can't be read
(cross-origin iframe, see `reference-sources.md`), so instead of an underlay
the timeline DRIVES the video on the reference panel: selecting a frame parks
the video on that frame's moment, and the drawing panel's grid / overlay
compare stay aligned as usual.

- **Model** (`FrameState.videoSync`, `src/drawing/frames.ts`):
  `{ videoId, offset, step }` — frame at playback index `i` = video time
  `offset + i·step` (clamped ≥ 0). Index-based on purpose: "next frame = next
  step of the video" is what tracing wants and stays predictable when
  frames are appended (inserting / reordering re-times the later frames —
  inherent, accepted). `step` is frozen at anchor time (1/fps then) so a
  later fps change alters only playback speed, never which video moment a
  drawn frame was traced from. Saved with the frame fields
  (`docStateForStorage`; a single frame + sync is "non-default"),
  sanitized on load; a non-undoable setting that bumps gallery-dirty.
- **Active** only while `videoSync.videoId` equals the current YouTube
  reference — another reference just leaves the sync dormant.
- **UI**: a `Clapperboard` toggle in the timeline (shown only for YouTube
  references). Turning it on anchors the CURRENT frame to the video's current
  position (`anchorVideoSync`); while on, the readout shows the shown frame's
  video time (`m:ss.cc`). Re-anchoring = toggle off, move the video, on.
- **Bridge** (`src/utils/videoSyncBridge.ts`): SplitLayout owns one;
  `YouTubeViewer` attaches a `VideoPlayerControl` while mounted
  (`seekTo` / `play` / `pause` / `getCurrentTime` from `infoDelivery`),
  DrawingPanel drives it. Calls are no-ops while nothing is attached.
- **Driving** (DrawingPanel effect): not playing ⇒ park on the current
  frame (paused). Playing with `step·fps ≈ 1` ⇒ seek + play at start and on
  every loop wrap, the video runs in between (smooth, real speed);
  otherwise ⇒ a paused seek per tick. Stop commits the shown frame ⇒ parks
  there. The bridge's "ready" signal (iframe `load` or first `infoDelivery`,
  once per video) re-runs the park — commands sent while the iframe loads
  are dropped — and also re-aligns a playback that started before it. An
  unstarted embed reports no time until it plays, so `load` seeds the
  position as 0 (no start param is ever passed): the toggle can anchor
  before the first play, and stays disabled only until the iframe loads.
- Turning sync off pauses the video; so does detaching (SplitLayout passes
  no bridge while the reference panel is collapsed — an invisible video
  must not keep playing; re-attaching an already-ready player replays the
  ready signal so the video re-parks). A change into / out of realtime mid-playback
  (fps changed) re-seeks immediately.
- **Paused seek gotcha** (`YouTubeViewer`): `seekTo` keeps a PAUSED player
  paused but STARTS one that is unstarted / cued / ended. Pausing right away
  there leaves it black (no frame decoded yet), so the viewer tracks the
  player state: paused ⇒ seek only; playing ⇒ seek + pause; anything else ⇒
  seek, then pause on the first "playing" report and seek again
  on the now-paused player so it lands exactly (it ran a few ms past). The
  hold survives slow buffering; it is cleared by any explicit play / pause /
  seek or the player settling paused / ended, with a 15 s safety net. A
  programmatic start can still be refused by autoplay policy without a user
  gesture (e.g. the reload-time park) — the poster then just stays up until
  the first frame tap.

## Next

- Ideas: per-frame video times (survive inserts), drawing over the video
  itself (impossible with the iframe; would need a user-supplied video file).
