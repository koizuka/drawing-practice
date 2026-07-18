# AGENTS.md

Guidance for Codex when working in this repository.

## Project

Drawing Practice is an iPad + Apple Pencil focused line-drawing practice app. The screen is split between a reference viewer and a drawing canvas, with shared grid / guide alignment. References include Sketchfab models, images, YouTube videos, Pexels photos, bundled trace templates, and an AI-posed 3D mannequin; trace templates score strokes against target shapes and show red deviation feedback.

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

Prefer `npm run test` over watch mode in agent / CI-style runs.

## Stack

- Vite + React + TypeScript strict mode
- Material UI
- Vitest + React Testing Library
- Dexie / IndexedDB schema v16 for persistence
- GitHub Pages via GitHub Actions

## Code Map

- `src/components/SplitLayout.tsx`: top-level state owner for reference, timer, autosave, undoable reference changes, panel collapse, shared `StrokeManager`, and restore gating
- `src/components/ReferencePanel.tsx`: reference source selection and reference-side toolbar
- `src/components/DrawingPanel.tsx`: drawing-side toolbar, timer, undo/redo, save, gallery
- `src/components/DrawingCanvas.tsx`: drawing input, rendering, zoom/pan, grid/guide rendering
- `src/components/SketchfabViewer.tsx`: Sketchfab browsing, embed, fix-angle capture
- `src/components/ImageViewer.tsx`: image reference viewer with shared overlays
- `src/components/YouTubeViewer.tsx`: YouTube iframe viewer with overlay-based interaction model
- `src/components/PexelsSearcher.tsx`: Pexels search UI and selection flow
- `src/components/TraceTemplateViewer.tsx`, `src/components/BundledTemplatePicker.tsx`: trace template viewing, browsing, and scoring flows
- `src/components/PoseSourcePanel.tsx`: sketch / text-to-pose flow, VRM mannequin viewer, generated-pose history, and fix-angle capture
- `src/components/Gallery.tsx`: saved drawing gallery, export, reload reference, storage summary
- `src/drawing/StrokeManager.ts`: shared undo/redo history for strokes and reference changes
- `src/guides/`: grid / guide shared state and rendering
- `src/trace/TraceScoringContext.tsx`: shared trace-template scoring state
- `src/trace/`, `src/templates/`: trace template definitions, scoring, and bundled assets
- `src/pose/`: pose prompts and JSON sanitizing, joint mapping / IK, geometric validation, and bounded refinement loop
- `src/storage/`: IndexedDB schema, draft persistence, URL history, export, storage accounting
- `src/hooks/useTimer.ts`: drawing timer lifecycle
- `src/hooks/useAutosave.ts`: debounced session draft persistence
- `src/utils/youtube.ts`, `pexels.ts`, `sketchfab.ts`: source-specific parsing and API helpers

## Architectural Rules

- Keep the reference panel and drawing panel in the same logical coordinate space. Grid, guides, overlay strokes, and fit sizing must stay aligned across both panels.
- Shared camera state is a `ViewTransform` model: `viewCenter` in world coordinates plus `zoom`, projected into each panel with its own `baseScale`. Pan / zoom should survive UI navigation and reset only on actual content load via the fitting viewer.
- Split layout switches between side-by-side and stacked panels by orientation. The reference panel can be collapsed for free drawing from the drawing toolbar, and that collapsed state is autosaved.
- `drawingFitSize` must be derived from `fitLeader`, not raw `referenceSize`; source pickers and search screens may still have stale reference dimensions.
- World origin is the grid center. References are rendered centered at `(0, 0)`, and stored strokes / guides use `coordVersion` migration for legacy data.
- Reference mutations should flow through `SplitLayout.changeReference(mutate, opts?)` so they are captured in undo history, pause the timer, and bump history sync state. Use `{ recordUndo: false }` only for intentionally non-undoable flows such as rapid gesture-driven photo advancement. Image-load errors use the separate non-undoable reset path.
- Undo/redo history covers both strokes and reference changes. When changing reference behavior, verify undo/redo semantics.
- Autosave persists the current session state, but reference undo history is intentionally session-only and not restored after reload.
- `SplitLayout` intentionally gates panel rendering until draft restore is complete or no session lock exists. Do not replace this with hidden-but-mounted panels; first-paint toolbar transitions are user-visible.
- Autosave uses a 2s debounce for freehand stroke commits, immediate flush for reference changes and discrete UI actions, and a short camera tail-debounce. Camera home / unfit adjustment paths intentionally suppress autosave.
- Timer behavior is user-visible product logic. Reference changes, save, gallery open, backgrounding, and fully undoing strokes all affect timer state.
- IndexedDB usage matters. Prefer bounded history, quantized persisted stroke data, and reuse of existing storage helpers.
- Canvas work must account for `window.devicePixelRatio`, and viewport sizing should use `100dvh` rather than `100vh` for iPad Safari.
- The Apple Pencil input-freeze investigation is resolved: WebKit / iPadOS can suspend page-wide input delivery while rAF and the main thread remain alive; see `docs/apple-pencil-input-freeze.md` and `DrawingFreezeHint`. The `?diag=touch` diagnostics harness used for that investigation has been removed (recoverable from git history).

## Detailed Rule Documents

For path-specific behavior and product rules, also check `.claude/rules/`:

- `drawing-undo.md`: `src/drawing/**`, `SplitLayout.tsx`, `DrawingPanel.tsx`
- `timer-autosave.md`: `useTimer.ts`, `useAutosave.ts`, `SplitLayout.tsx`
- `reference-sources.md`: reference viewers, searchers, and source utilities
- `storage.md`: `src/storage/**` and storage accounting / history behavior
- `gallery.md`: `Gallery.tsx`, export, and restored-reference flows
- `ui-design-principles.md`: component-level UI structure and interaction patterns
- `trace-template.md`: `src/trace/**`, `src/templates/**`, `TraceTemplateViewer.tsx`, `BundledTemplatePicker.tsx`

Read the relevant rule document before changing those areas. Keep `AGENTS.md` as the stable high-level map, and treat the rule documents as the detailed source of truth for scoped behavior.

## Reference Source Notes

- URL input auto-detects YouTube, Pexels, and Sketchfab URLs and routes them into dedicated flows rather than treating everything as a plain image URL.
- Sketchfab "Fix This Angle" captures a screenshot that becomes the fixed reference and also the persisted thumbnail for gallery / history restore.
- YouTube supports playback interaction through an overlay mode switch; still-frame capture is intentionally unsupported.
- Pexels API keys are user-supplied and stored in `localStorage['pexelsApiKey']`; never bundle a key.
- Local images and Sketchfab screenshots are stored in URL history so references can be restored later.
- Trace template replacement / undo semantics are path-specific; read `trace-template.md` before changing template state, scoring, or bundled template behavior.
- The `pose` source accepts a rough figure sketch and/or a text hint, calls the Anthropic Claude API directly from the browser using the user's `localStorage.getItem('anthropicApiKey')` value, and applies semantic pose JSON to a three.js / three-vrm mannequin. Never bundle an API key.
- Pose limbs may use angles or placement targets (`handAt`, `footAt`, `kneeAt`, `elbowAt`, and `body.hipsHeight`) solved by analytic two-bone IK. Generated poses are geometrically validated and may be refined in the same model conversation for at most two rounds.
- Pose "Fix This Angle" uses the standard fixed-image path. User-loaded VRMs are stored in `poseAssets`; successful generations are stored in the capped, LRU-managed `poseHistory` and can be reapplied. Inverted-pose hair behavior is a VRM spring-bone model trait; see `docs/vrm-springbone-gravity.md`.

## Storage Notes

- Main persisted entities are `drawings`, `session`, `urlHistory`, `pexelsSearchHistory`, `sketchfabSearchHistory`, `poseAssets`, and `poseHistory`.
- `drawings` stores quantized strokes for size control. Do not accidentally apply that quantization to in-memory editing behavior.
- `session` is the autosave draft.
- `urlHistory` is split-capped so image-heavy usage does not evict all non-image history.
- `poseHistory` stores pose JSON, hint, and thumbnail, and is capped at 50 entries using LRU eviction.
- Database name is scoped by `BASE_URL` so preview deployments do not share data with production. Main uses `DrawingPracticeDB`; previews use `DrawingPracticeDB_{basePath}` and have cleanup behavior for stale preview DBs.

## Working Style For Codex

- Prefer minimal, local changes that preserve current interaction patterns.
- For behavior changes, inspect the owning component and the relevant storage / hook / utility modules together before editing.
- When touching reference flows, check `SplitLayout`, `ReferencePanel`, `StrokeManager`, and the relevant source utility.
- When touching persistence, check both the Dexie schema and all read/write call sites.
- When working in an area covered by `.claude/rules/`, read the matching rule document alongside the code before editing.
- Run `npm run lint` after meaningful code changes. Run targeted tests when behavior is covered by tests; add tests when the changed logic is isolated enough to justify them.

## Project Codex Skills

- `.agents/skills/create-pr`: check, branch, commit, push, and open a PR for the current changes.
- `.agents/skills/merged`: switch back to `main`, pull, delete the merged local branch, and prune stale remote refs.
- Invoke skills explicitly with `$create-pr` or `$merged`. In the Codex app, enabled skills may also appear in the slash command list after Codex reloads skill discovery.

## When In Doubt

- Read code over relying on this file. This document is only a map of stable constraints and entry points.
