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

Vite + React + TypeScript (strict mode), Material-UI, Vitest + React Testing Library, Dexie.js (IndexedDB schema v9), GitHub Pages via GitHub Actions.

## High-level Architecture

- **Split layout** (`SplitLayout`): two equal panels, landscape (left/right) or portrait (top/bottom), auto-switching on orientation.
  - **Reference Panel** (left/top) — `ReferencePanel` hosts one of: `SketchfabViewer`, `ImageViewer`, `YouTubeViewer`, `PexelsSearcher`.
  - **Drawing Panel** (right/bottom) — `DrawingPanel` + `DrawingCanvas`.
- **Shared state** lifted to `SplitLayout`: reference (source/mode/images), timer, autosave, undo. Guide state shared via `GuideContext`.
- **Single undo stack** in `StrokeManager` covers both strokes AND reference changes — see `.claude/rules/drawing-undo.md`.
- **Autosave** (`useAutosave`, 2s debounce) persists session draft to IndexedDB `session` table; restored on reload — see `.claude/rules/timer-autosave.md`.

## Cross-cutting invariants

These apply codebase-wide. Violating them breaks alignment, persistence, or undo correctness.

- **Shared canvas coordinate space**: grid, guide lines, strokes, and overlay-compare strokes all live in the same coordinate space. Each panel applies its own `ViewTransform` independently. When loading a reference image, its dimensions go to `DrawingCanvas` via `fitSize` so both panels start at the same scale.
- **Grid is anchored to the center point** (image center, or viewport center when no reference). The center grid line is drawn thicker as a visual anchor.
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
