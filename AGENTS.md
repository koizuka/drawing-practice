# AGENTS.md

Guidance for Codex when working in this repository.

## Project

Drawing Practice is an iPad-focused line-drawing practice app. The screen is split between a reference viewer and a drawing canvas, with shared grid / guide alignment.

Live app: https://koizuka.github.io/drawing-practice/

## Commands

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test
npm run test:watch
```

## Stack

- Vite + React + TypeScript
- Material UI
- Vitest + React Testing Library
- Dexie / IndexedDB for persistence

## Code Map

- `src/components/SplitLayout.tsx`: top-level state owner for reference, timer, autosave, and undoable reference changes
- `src/components/ReferencePanel.tsx`: reference source selection and reference-side toolbar
- `src/components/DrawingPanel.tsx`: drawing-side toolbar, timer, undo/redo, save, gallery
- `src/components/DrawingCanvas.tsx`: drawing input, rendering, zoom/pan, grid/guide rendering
- `src/components/SketchfabViewer.tsx`: Sketchfab browsing, embed, fix-angle capture
- `src/components/ImageViewer.tsx`: image reference viewer with shared overlays
- `src/components/YouTubeViewer.tsx`: YouTube iframe viewer with overlay-based interaction model
- `src/components/PexelsSearcher.tsx`: Pexels search UI and selection flow
- `src/components/Gallery.tsx`: saved drawing gallery, export, reload reference, storage summary
- `src/drawing/StrokeManager.ts`: shared undo/redo history for strokes and reference changes
- `src/guides/`: grid / guide shared state and rendering
- `src/storage/`: IndexedDB schema, draft persistence, URL history, export, storage accounting
- `src/hooks/useTimer.ts`: drawing timer lifecycle
- `src/hooks/useAutosave.ts`: debounced session draft persistence
- `src/utils/youtube.ts`, `pexels.ts`, `sketchfab.ts`: source-specific parsing and API helpers

## Architectural Rules

- Keep the reference panel and drawing panel in the same logical coordinate space. Grid, guides, overlay strokes, and fit sizing must stay aligned across both panels.
- Reference mutations should flow through `SplitLayout` so they are captured in undo history. Avoid introducing direct local mutations that bypass `changeReference(...)`.
- Undo/redo history covers both strokes and reference changes. When changing reference behavior, verify undo/redo semantics.
- Autosave persists the current session state, but reference undo history is intentionally session-only and not restored after reload.
- Timer behavior is user-visible product logic. Reference changes, save, gallery open, backgrounding, and fully undoing strokes all affect timer state.
- IndexedDB usage matters. Prefer bounded history, quantized persisted stroke data, and reuse of existing storage helpers.

## Reference Source Notes

- URL input auto-detects YouTube, Pexels, and Sketchfab URLs and routes them into dedicated flows rather than treating everything as a plain image URL.
- Sketchfab "Fix This Angle" captures a screenshot that becomes the fixed reference and also the persisted thumbnail for gallery / history restore.
- YouTube supports playback interaction through an overlay mode switch; still-frame capture is intentionally unsupported.
- Local images and Sketchfab screenshots are stored in URL history so references can be restored later.

## Storage Notes

- Main persisted entities are `drawings`, `session`, `urlHistory`, `pexelsSearchHistory`, and `sketchfabSearchHistory`.
- `drawings` stores quantized strokes for size control. Do not accidentally apply that quantization to in-memory editing behavior.
- `session` is the autosave draft.
- `urlHistory` is split-capped so image-heavy usage does not evict all non-image history.
- Database name is scoped by `BASE_URL` so preview deployments do not share data with production.

## Working Style For Codex

- Prefer minimal, local changes that preserve current interaction patterns.
- For behavior changes, inspect the owning component and the relevant storage / hook / utility modules together before editing.
- When touching reference flows, check `SplitLayout`, `ReferencePanel`, `StrokeManager`, and the relevant source utility.
- When touching persistence, check both the Dexie schema and all read/write call sites.
- Run `npm run lint` after meaningful code changes. Run targeted tests when behavior is covered by tests; add tests when the changed logic is isolated enough to justify them.

## When In Doubt

- Read code over relying on this file. This document is only a map of stable constraints and entry points.
