# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Overview

Drawing Practice is a line-drawing practice tool for **iPad + Apple Pencil**. Users view a reference (Sketchfab 3D model, image file/URL, YouTube video, or Pexels photo) on one side and draw on the other, with synchronized grid and guide lines for alignment.

**Live deployment**: https://koizuka.github.io/drawing-practice/

## Common Commands

```bash
npm run dev        # Development server
npm run build      # Build for production
npm run preview    # Preview production build
npm run lint       # Lint
npm run test       # Run tests once
npm run test:watch # Run tests in watch mode (prefer `npm run test` in CI/agent runs)
```

## Tech Stack

Vite + React + TypeScript (strict mode), Material-UI, Vitest + React Testing Library, Dexie.js (IndexedDB schema v13), GitHub Pages via GitHub Actions.

## High-level Architecture

- **Split layout** (`SplitLayout`): two equal panels, landscape (left/right) or portrait (top/bottom), auto-switching on orientation. Reference panel can be collapsed for free-drawing layout (drawing panel takes the full screen); the toggle lives on the drawing toolbar and the collapsed state is autosaved.
  - **Reference Panel** (left/top) — `ReferencePanel` hosts one of: `SketchfabViewer`, `ImageViewer`, `YouTubeViewer`, `PexelsSearcher`.
  - **Drawing Panel** (right/bottom) — `DrawingPanel` + `DrawingCanvas`.
- **Shared state** lifted to `SplitLayout`: reference (source/mode/images), timer, autosave, undo, panel-collapse. Guide state shared via `GuideContext`.
- **Single undo stack** in `StrokeManager` covers both strokes AND reference changes — see `.claude/rules/drawing-undo.md`.
- **Autosave** (`useAutosave`) persists session draft to IndexedDB `session` table; restored on reload. 2s debounce for strokes; immediate flush on reference change and discrete UI button operations (collapse / flip / grid / line edits); 250ms tail-debounce for camera (pan/zoom) with bypass when the camera lands at home — see `.claude/rules/timer-autosave.md`.

## Cross-cutting invariants

These apply codebase-wide. Violating them breaks alignment, persistence, or undo correctness.

- **Shared canvas coordinate space**: grid, guide lines, strokes, and overlay-compare strokes all live in the same coordinate space. `ViewTransform` is a **camera model** (`viewCenter` in world coords + `zoom`); each panel projects the shared camera into its own container size with its own `baseScale` (= fit-to-container ratio for the reference content, or 1 for free drawing). Layout changes (collapse, rotation, window resize) preserve the visual center automatically — no orientation-reset hack needed.
- **Camera (pan/zoom) survives UI navigation, resets only on content load**. The active fitting viewer (`ImageViewer` on image onload — also covers the post-Fix-Angle screenshot, since Sketchfab Fix-Angle confirm switches the source to a fixed image which then mounts `ImageViewer`; `YouTubeViewer` on mount) calls `viewTransform.setHome(0, 0, 1)` to snap the camera to home — the user expects new content to land centered. UI-only transitions (returning to the source picker, entering Sketchfab/Pexels search, closing a reference) must NOT touch the camera. Two pieces of machinery enforce this: (1) `DrawingCanvas` does not register `setHome` on `fitSize` changes — home defaults to `(0, 0, 1)`, and the active viewer re-registers it on actual content load. (2) `DrawingCanvas`'s fitSize-change effect compensates `camera.zoom` (so `visualScale = baseScale × zoom` stays continuous) **only on size→null transitions** (closing reference). null→size and size→size transitions are content loads — the viewer's `setHome` reset is intended and must not be undone.
- **`drawingFitSize` is derived from `fitLeader`, not raw `referenceSize`**. When no viewer is fitting (source picker, Sketchfab/Pexels search screens), `referenceSize` may still hold the previous content's dimensions. Passing it as `DrawingCanvas.fitSize` makes `baseScale` alternate between fit-to-stale and 1 as the user navigates, shifting strokes visibly. Use `computeFitLeader` / `resolveDrawingFitSize` in `src/components/splitLayoutHelpers.ts` — `fitSize` is set only when a viewer is actively the fit leader (`'reference'`).
- **World origin ≡ grid center** (`GRID_CENTER = { x: 0, y: 0 }` in `canvasUtils.ts`). Every reference is rendered with its center at world origin (`drawImage(img, -W/2, -H/2)`; YouTube iframe wrapper offset by `(-LOGICAL_HALF_W, -LOGICAL_HALF_H)` × `scale`). `setHome` always registers `(0, 0)` so reference loads don't translate existing strokes off the grid center — only `baseScale` changes. The center grid line is drawn thicker as a visual anchor. Stored strokes / guides carry a `coordVersion` field; legacy records (missing or `< COORD_VERSION_CURRENT`) are lazy-shifted by `(-W/2, -H/2)` in `SplitLayout.handleReferenceImageSize` once the reference reports its size — see `src/storage/coordMigration.ts`.
- **Overlay comparison passes stroke DATA, not screenshots** — strokes are re-rendered in the reference panel's coordinate space so grid positions align.
- **DPR**: every canvas operation must multiply by `window.devicePixelRatio`.
- **Viewport sizing uses `100dvh`, not `100vh`** — required for iPad Safari's dynamic toolbar.
- **All reference mutations go through `changeReference(mutate)`** in `SplitLayout`. This records an undo entry, applies the mutation, pauses the timer, and bumps `historySyncVersion`. Image-load errors take a separate non-undoable `onReferenceResetOnError` path.
- **Pexels API key lives in `localStorage['pexelsApiKey']`** — each user supplies their own. Never bundle a key into the build.
- **PR preview DBs are isolated by `BASE_URL`**: main = `DrawingPracticeDB`, previews = `DrawingPracticeDB_{basePath}`. Don't change `db.ts` naming without considering the cleanup path in `indexedDB.databases()` for stale previews.

## Detailed area rules

Path-scoped rules in `.claude/rules/` load automatically when you read matching files:

- `storage.md` — `src/storage/**` (Dexie tables, urlHistory key/cap design, addUrlHistory semantics, storageUsage)
- `drawing-undo.md` — `src/drawing/**`, `SplitLayout.tsx`, `DrawingPanel.tsx` (StrokeManager, reference-snapshot wiring, MAX_REFERENCE_HISTORY)
- `reference-sources.md` — reference panel + viewers + utils (URL auto-routing, Sketchfab Fix-Angle triple persistence, YouTube overlay modes, Pexels attribution)
- `timer-autosave.md` — `useTimer.ts`, `useAutosave.ts`, `SplitLayout.tsx` (start/pause/reset triggers, autosave debounce/suppression)
- `gallery.md` — `Gallery.tsx`, `exportDrawing.ts`, `storageUsage.ts` (3 grouping modes, thumbnail resolution, "Use this reference" paths, export)
- `ui-design-principles.md` — `src/components/**` (layout skeleton, three-tier button model, stateful vs stateless choice, error/loading treatment, access symmetry)
