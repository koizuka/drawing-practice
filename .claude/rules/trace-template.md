---
paths:
  - "src/trace/**"
  - "src/templates/**"
  - "src/components/TraceTemplateViewer.tsx"
  - "src/components/BundledTemplatePicker.tsx"
---

# Trace template scoring rules

Curve-tracing practice: the user picks a bundled `TraceTemplate`, the template's stroke targets are rendered as semi-transparent gray guide lines on both panels, and each user stroke is auto-scored against the closest target. Visual feedback is a red deviation band (`TraceFeedback`); summary is an overlay pill `なぞり済 N/M · 最良 X%` pinned to the top-right of the drawing canvas.

## Template definition (`src/templates/`)

Each template is a TypeScript module exporting a `TraceTemplate`:

```ts
{ id: 'bundle:<slug>', titleKey: MessageKey, viewBox: {w, h}, strokes: TraceStroke[] }
```

- `viewBox` is centered on world origin (template strokes are pre-shifted by `(-w/2, -h/2)` during construction via the builder helpers). Matches the world-origin-≡-grid-center invariant from `CLAUDE.md`.
- `titleKey` is typed against `MessageKey` (exported from `src/i18n.ts`) so a missing translation fails at compile time. **Don't** revert this to `string`; the previous version needed `as any` casts.
- `TraceStroke.closed` controls scoring branch: open templates anchor on endpoints; closed templates allow any starting position and direction (see `scoring.ts`).
- New templates are added to `BUNDLED_TEMPLATES` in `bundled.ts` (ordering controls picker order). `getBundledTemplate(id)` is the resolver used by `SplitLayout` when restoring from autosave.

Builders (`builders.ts`): `circle`, `ellipse`, `cubicBezier`, `polyline(points, closed?)`, `smoothCurve(controlGroups)`. They populate `points`/`length`/`closed` consistently — don't construct `TraceStroke` literals by hand.

## Scoring pipeline (`src/trace/scoring.ts`)

`scoreAttempt(user, templates)` returns the best `TraceMatch` across all candidates or `null`.

Per-template-stroke matching:
- **`matchOpen`**: user start/end must each be within `endpointTolerance(template.length)` of the template's start/end (tried in both forward and reverse directions). Best of forward/reverse wins.
- **`matchClosed`**: user must be approximately closed (`dist(start, end) <= closureTolerance`), and the user's start must project onto the template ring with `perpDist <= endpointTolerance`. The template ring is rotated to start at the projected arc length, tried in both directions; best wins. This is what makes "start at 12 o'clock CCW" and "start at 3 o'clock CW" score identically on a circle.
- **Length-ratio guard**: `lengthRatioOk(userLength, templateLength)` requires `0.5 ≤ ratio ≤ 3`. Protects against spirals/scribbles whose endpoints happen to fall within tolerance — without it, a 1000px doodle on a 100px template could "score" with a hundreds-of-percent error and would *replace* a previous good attempt.

`SCORING_N = 64` is the per-stroke arc-length sample count. `resampleByArcLength(points, N)` returns `N+1` points (both endpoints included). `buildFeedback(match)` emits one deviation segment per sample — bumping `SCORING_N` raises both per-attempt CPU and the number of red bands drawn.

## TraceScoringContext: replace-vs-undo semantics

The non-obvious bit. `TraceScoringContext` keeps three pieces of state:
- **`attemptHistoryRef: Map<strokeTimestamp, {templateStrokeIdx, errorPct}>`** — append-only per-stroke ledger of every scored attempt.
- **`allTimeStatsRef: Map<templateStrokeIdx, {attempts, bestErrorPct}>`** — monotonic per-template aggregate. **Preserves `best` across re-trace replacements** (the great attempt actually happened, even if the stroke was replaced by a worse one). Cleared on `setTemplate` / `resetScores`.
- **`attemptMapRef: Map<templateStrokeIdx, strokeTimestamp>`** — most-recent live attempt per target. Used by `handleStrokeFinalized` to find the prior stroke to delete on a re-trace.

Derived (`scores`, the visible per-template `TemplateScore[]`) is rebuilt from `allTimeStats` ∩ live strokes by `computeScores`. A template idx only surfaces as a score when at least one of its attempt strokes is currently in `StrokeManager`. So:
- Re-trace replacement: prior stroke deleted, new stroke added; `allTimeStats.attempts++`, `bestErrorPct = min(prev, new)`. Visible: 1 live stroke, attempts=N, best=lifetime min. ✓
- Undo of a traced stroke: stroke pops; `syncAttempts` rebuilds derived state from live strokes; if no live attempt remains for that idx, the score row disappears. `allTimeStats` is preserved internally so Redo restores the displayed score with the same lifetime numbers. ✓

`handleStrokeFinalized` flow (success):
1. Score, record in `attemptHistory`.
2. Update `allTimeStats` (attempts++, best = min).
3. Replace prior live attempt for this idx if any (`strokeManager.deleteStroke(prevIdx)` — this DOES push an undo entry, intentional: Undo restores the prior stroke and `syncAttempts` brings its attempt back).
4. `setLatestFeedback(buildFeedback(match))`.
5. `syncAttempts(strokeManager)` — re-derives `scores` and `attemptMap`.

`handleStrokeFinalized` flow (rejection):
1. `strokeManager.discardLastStroke()` — non-undoable. **Why not `deleteStroke`**: a delete entry pushed here would let Undo resurrect the rejected stroke as an untracked ghost. See `drawing-undo.md` for the broader rationale.
2. `setLatestFeedback(null)` to clear any prior feedback.

`syncAttempts` does NOT clear `latestFeedback` — that's set by the calling code path. The clear-on-redraw semantics live in `setTemplate`, `resetScores`, and `DrawingPanel.handleClear` (the explicit user-driven clear paths).

## Calling convention from DrawingPanel

DrawingPanel forwards these callbacks to scoring (wired in SplitLayout):
- **`onStrokeFinalized`** → fires from `DrawingCanvas` after `endStroke` in pen mode, BEFORE `notifyStrokeCount` / `redrawAll`. Synchronous stroke mutations inside the callback (`discardLastStroke` on rejection, `deleteStroke` on replacement) settle before timer/autosave/UI observe the new stroke set.
- **`onTraceSyncAttempts`** → fired from `handleUndo`, `handleRedo`, `handleDeleteHighlighted`, `handleStrokeCountChange` (covers lasso erase). Rebuilds derived scoring state from the live `StrokeManager`. Without this, `attemptMap` and `attemptedStrokeTimestamps` stay stale after Undo and the next re-trace fails to replace.
- **`onTraceResetScores`** → fired from `handleClear` (and the score-overlay reset button). Removes traced strokes via `discardStrokes` (non-undoable) and wipes `allTimeStats`/`attemptHistory`/`attemptMap`/`attemptedStrokeTimestamps`/`latestFeedback`. Wrapped in SplitLayout so it also fires `handleStrokesChanged` (otherwise the canvas would not redraw after the strokes vanished).
- **`onTraceStrokeStart`** → fired from `DrawingCanvas` pen-mode pointer-down, BEFORE `strokeManager.startStroke`. Calls `clearLatestFeedback` so the red deviation bands disappear the instant the user touches down for a re-trace — they're noise while drawing the new attempt.

## Re-trace visibility: dimmed scored strokes

Scored attempts (i.e. user strokes tracked in `attemptedStrokeTimestamps`) render on the drawing canvas at `DIMMED_STROKE_OPACITY = 0.2` instead of full black — visibly below the template guide's `~0.45` alpha so the visual hierarchy reads template > past attempts > current draw.

In-progress strokes (`strokeManager.getCurrentStroke()`) and highlighted (lasso-preselected / eraser-hover) strokes ignore the dim — the active focus or stronger UI signal wins. Strokes the user drew while NOT in a trace template (free drawing alongside a trace, mid-mode-switching) are not in `attemptedStrokeTimestamps` so they keep full opacity.

The reference panel's `overlayStrokes` rendering (only active when overlay-compare is toggled on) intentionally stays at the existing blue glow — visually distinct from the template gray already, so re-trace occlusion is less of an issue there. Match it to the drawing-canvas dimming only if user feedback complains.

## TraceTemplateViewer

`TraceTemplateViewer.tsx` is structurally similar to `ImageViewer` (same zoom/pan/grid/guide/flip machinery) but renders `template.strokes` directly via canvas paths instead of `drawImage`. It calls `viewTransform.loadContent(0, 0, 1)` on mount/template-change when `isFitLeader === true` — same convention as the image-bearing viewers, so the camera-restore-on-reload flow in `SplitLayout` works uniformly.

`onTemplateLoaded(w, h)` is wired to `SplitLayout.handleReferenceImageSize` (same callback name reuse as other viewers).

## BundledTemplatePicker

Renders the 5 bundled templates as 140px thumbnail cards on a `repeat(auto-fill, minmax(160px, 1fr))` grid. Each thumbnail draws the template strokes into a small canvas (no React state for animation; one-shot effect on mount). Selecting a card calls `onSelect(template)` which routes through `SplitLayout.handleSelectTraceTemplate` → `changeReference` (so it's undoable via the standard reference-undo path).

In portrait, the picker occupies the full viewport and hides the still-mounted drawing panel, matching Pexels search and pose browse. Selecting a template enters fixed mode and restores the normal split layout.

## Gallery / autosave wiring

- `SplitLayout.loadDraft` has a `'trace-template'` else-if branch that sets `referenceMode='fixed'` (no fixedImageUrl to restore — `templateId` on `referenceInfo` is enough).
- `referenceWillSize` includes `'trace-template'` so `pendingCameraRef` defers the camera restore until after the viewer's `loadContent(0,0,1)`.
- `galleryGrouping.canLoadReference` and `SplitLayout.handleLoadReference` both have trace-template branches so "Use this reference" in the gallery restores the active template into fixed mode.
- `urlHistory` is NOT touched for trace templates — the bundle is enough and the dropdown stays free of trace entries.

## Out of scope (future work)

- SVG file import / external user-supplied templates
- Persisting `attemptHistory` / `allTimeStats` across reload (currently session-only — strokes persist via autosave but their scoring history does not, so a reloaded traced stroke becomes an "untracked free stroke")
- Trace-template-aware gallery view ("past best %" displayed on saved drawings)
- Ghost mode (briefly flash the template then hide for memorization practice)
