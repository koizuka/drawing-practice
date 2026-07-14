---
paths:
  - "src/components/ReferencePanel.tsx"
  - "src/components/SketchfabViewer.tsx"
  - "src/components/ImageViewer.tsx"
  - "src/components/YouTubeViewer.tsx"
  - "src/components/PexelsSearcher.tsx"
  - "src/components/TraceTemplateViewer.tsx"
  - "src/components/BundledTemplatePicker.tsx"
  - "src/utils/sketchfab.ts"
  - "src/utils/pexels.ts"
  - "src/utils/youtube.ts"
  - "src/utils/anthropic.ts"
  - "src/components/PoseSourcePanel.tsx"
  - "src/components/PoseViewer.tsx"
  - "src/components/PoseSketchPad.tsx"
  - "src/pose/**"
---

# Reference source rules

Reference sources: Sketchfab 3D model, local image file, URL (auto-routed), YouTube video, Pexels photo, bundled trace template (curve-tracing practice with scoring — see also `trace-template.md`), pose mannequin (stick-figure → Claude → posed VRM).

## ReferencePanel

- Reference state is **read-only from props**. All mutations route through `onReferenceChange(setters => ...)` so each change is recorded as an undo entry. (See `drawing-undo.md`.)
- URL input auto-detects: YouTube (`parseYouTubeVideoId`), Pexels photo (`parsePexelsPhotoUrl`), Sketchfab model (`parseSketchfabModelUrl` — supports `/3d-models/<slug>-<uid>` and `/models/<uid>`). Each routes to its dedicated source path instead of plain image preload.
- **Sketchfab URL paste**: resolves the URL-history entry once and reuses it for both `sketchfabSearchContext` (search restoration) and `title` (passed to `loadModelByUid` to skip the redundant Data API fetch).
- **URL-history dropdown sketchfab entry with `imageBlob`**: jumps straight to fixed mode with the saved screenshot Blob (FileReader → data URL), restores the search context, and loads the iframe in the background. Mirrors gallery "Use this reference" UX.
- `handleOpenSketchfab` clears `sketchfabRestore`. **Why:** prevents leftover state from a prior URL-history reopen leaking into a fresh top-screen entry.

## SketchfabViewer

- Search via Data API. Keyword input is MUI `Autocomplete` populated from `getSketchfabSearchHistory()` — past keyword + category-only searches with per-row delete.
- **Unified search/UID input**: the same Autocomplete classifies its value via `classifySketchfabQuery()` — a 32-char UID (`isValidUid`) or a Sketchfab model URL (`parseSketchfabModelUrl`) routes Enter/submit to `loadModel(uid)` and flips the button label to `Load`; anything else stays a keyword search. **Why:** keeps the surface to one box without losing direct UID/URL paste, and avoids polluting search history with UID/URL entries (the UID branch never calls `recordSearch`).
- Category-only browses dedupe under `|<slug>` keys. Dropdown labels them with the translated category name (italic) so the empty-query case is distinguishable. `getOptionLabel` returns the translated category name for category-only entries — **why:** an empty-string match against an empty input would otherwise suppress the dropdown.
- Categories: static `[All, Animals, Vehicles, ...]` button row. **"All" (`handleClearCategory`) is the escape hatch** from a sticky category — clears `activeCategory` and re-fetches `/v3/models` without a category filter. Specific categories re-roll a random subset (`handleRandomFromCategory`).
- `initialQuery` / `initialTimeFilter` / `initialCategory` props auto-restore a saved search context on mount. Parent bumps `sketchfabRestore.token` to remount the viewer. `applySketchfabRestore` skips the bump when the new context equals the current one — **why:** avoids a wasteful iframe + state remount.
- `loadModelByUid(uid, meta?: SketchfabModelMeta)`: when `meta` is omitted (URL paste, gallery legacy records), the viewer fetches `/v3/models/<uid>` so Fix Angle has a non-empty title/author. Search-grid clicks pass `meta` directly to skip the fetch.
- `onFixAngle(screenshot, info, extras)`: `extras` carries `searchContext` + model CDN `thumbnailUrl` so `ReferencePanel` attaches them to the URL-history entry without round-tripping through the localStorage `lastSearch` snapshot.

## Sketchfab Fix Angle: triple persistence (non-obvious)

A single screenshot is captured at Fix Angle time and stored in **three** places:
1. `fixedImageUrl` (in-memory) — used for drawing.
2. `ReferenceInfo.imageUrl` — saved to IndexedDB so the gallery shows a per-drawing thumbnail and "Use this reference" can restore the exact angle directly into `fixed` mode.
3. URL-history entry's `imageBlob` (1024x1024 JPEG via `dataUrlToJpegBlob`, ~200KB) — so URL-history dropdown reopen can also restore directly into fixed mode.

**Thumbnail timing:** capture happens at Fix Angle time, NOT save time. Retake overwrites all three. Save just writes the existing `imageUrl` to IndexedDB — no resize/re-encode at save. **Why:** gallery thumbnail must reflect the exact angle the user drew on, not some later-loaded angle. Drawings without `imageUrl` are legacy records from before this change.

## ImageViewer

Canvas-based image viewer with zoom/pan, grid/guide overlay, stroke overlay for comparison, and guide line interaction (drag to add, tap to select for deletion). Loads images with non-CORS fallback for cross-origin URLs.

## YouTubeViewer

iframe embed with a transparent canvas overlay spanning the full container (incl. 16:9 letterbox). Fixed 16:9 logical coordinate space (1920x1080) reported via `onFitSize` so drawing-panel grid aligns.

Two overlay modes:
- **Zoom mode (default)**: `pointer-events: auto`, captures wheel/trackpad/2-finger pinch and drives shared `ViewTransform`. **Why:** prevents browser page-zoom default on `ctrlKey` wheel or iframe pinch. Single tap auto-promotes to video mode.
- **Video interact mode**: `pointer-events: none` so iframe handles clicks (seek bar, subtitles, settings). Exited via toolbar button in `ReferencePanel`.

Play/pause via YouTube IFrame Player API (`enablejsapi=1` + postMessage; see `YT_EVENT_*` / `YT_CMD_*`). `YouTubeViewer` accepts a `ref` prop (React 19+ ref-as-prop pattern) exposing `YouTubePlayerHandle` (`{ play(), pause() }`). Emits `onPlayerStateChange(isPlaying)` with per-transition de-dup (`lastPlayingRef`) so the toolbar icon flips without thrash.

**No video-frame capture** — YouTube iframe content is CORS-protected. Fix/still-frame is intentionally unsupported. **Why:** cross-origin iframe isolation makes wheel/touch events inside the iframe unreachable from the parent; the overlay-and-tap model is the deliberate workaround.

## PexelsSearcher

Search input, orientation filter, preset query chips, result grid, pagination. On photo selection, image loads in `fixed` mode via ImageViewer using Pexels CDN `src.large2x`. Also used indirectly when `https://www.pexels.com/photo/...-12345/` is pasted (`parsePexelsPhotoUrl` + `getPhoto(id)`).

API: `api.pexels.com/v1` with `Authorization` header; key in `localStorage['pexelsApiKey']` (set via `PexelsApiKeyDialog`). `buildPexelsReferenceInfo` preserves photographer name + pexelsPageUrl for the "Photo by ... · via Pexels" attribution overlay (Pexels TOS requirement).

**Missing/invalid key is handled modally by the parent, not in-screen.** When `needsKey` flips true (mount with empty key, post-Clear `apiKeyVersion` bump, or 401 from `searchPhotos`), `PexelsSearcher` fires `onApiKeyMissing`; `ReferencePanel` opens `PexelsApiKeyDialog` and, on Cancel/Clear, calls `handleClose` to exit the Pexels source. **Why:** every searcher control is `disabled={needsKey}` — without the modal recovery the user would be stranded on a fully-disabled screen with no way off. Do not re-introduce a modeless in-screen Alert for this path.

The notification is gated on the `active` prop (parent passes `referenceMode === 'browse'`). The searcher stays mounted in fixed mode (preserves search state across browse↔fixed transitions), but in fixed mode the user is viewing/drawing on a CDN-loaded photo that doesn't need the API key — firing `onApiKeyMissing` there would yank them out of their work.

## Trace template (`source: 'trace-template'`)

Bundled curve practice. `browse` mode shows `BundledTemplatePicker` (5 templates in `src/templates/`); `fixed` mode mounts `TraceTemplateViewer` which renders the chosen `TraceTemplate.strokes` in semi-transparent gray on both panels and overlays the user's strokes (via the existing overlay-compare path). `ReferenceInfo.templateId` is `'bundle:<slug>'` — resolved via `getBundledTemplate(id)`. There is no fixed/local URL — `displayImageUrl` stays null; `isFixed` is expanded to `(referenceMode === 'fixed' && !!displayImageUrl) || isTraceFixed`.

**No URL-history entry.** Template selection records nothing in `urlHistory`; the dropdown doesn't surface trace templates. The bundle is enough.

**Autosave restore takes a trace branch.** `loadDraft`'s else-if chain has a `info?.source === 'trace-template'` arm that just calls `setReferenceMode('fixed')` (no `setFixedImageUrl` — there's no image). `referenceWillSize` includes `'trace-template'` so the camera restore path defers behind `TraceTemplateViewer.onTemplateLoaded` → `pendingCameraRef` → `restoreCamera` lands after the viewer's `loadContent(0,0,1)`. Without these two pieces, reload either reverts to the picker or stomps the saved pan/zoom.

**Gallery integration.** `canLoadReference` returns true for trace-template (bundled IDs never get evicted), and `handleLoadReference` has a trace-template branch mirroring `handleSelectTraceTemplate`. So "Use this reference" on a gallery record drawn with a trace template restores the active template + fixed mode.

**Scoring + replace-vs-undo semantics** live in `trace-template.md` — read that for the attempt-map design, the live-vs-lifetime stats split, and why rejected attempts must use `StrokeManager.discardLastStroke()` instead of `deleteStroke()`.

## Pose mannequin (`source: 'pose'`)

Browse mode = `PoseSourcePanel` (lazy chunk carrying three.js + @pixiv/three-vrm — keep it lazy): stick-figure `PoseSketchPad` (private StrokeManager, fixed 512² logical space, no ViewTransform) + hint field + Generate + bundled/user VRM toggle + free-orbit `PoseViewer`. Generation calls `generatePose` in `src/utils/anthropic.ts` (BYOK raw-fetch funnel, `localStorage['anthropicApiKey']`, `anthropic-dangerous-direct-browser-access` header — same pattern as pexels.ts) and writes the sanitized `PoseJson` into `referenceInfo` via `onReferenceChange` (= one undo entry). Errors stay inline (`Alert`); key-missing opens `AnthropicApiKeyDialog` with a pending-generate resume keyed off `apiKeyVersion`.

**Validation-correction loop** (between generate and commit): `refinePoseUntilValid` (`src/pose/poseRefineLoop.ts`) applies the candidate to the on-screen VRM via `PoseViewer.measurePose`, runs the generic plausibility checks in `src/pose/poseValidation.ts` (floor penetration, nothing-grounded floating, center of mass vs. support area, limb capsule crossing — pure math over sampled landmarks, no per-pose knowledge), and sends failures as an English feedback turn in the SAME conversation (`refinePose`; `generatePose` returns `{ pose, messages }` for this). Bounded and best-effort: max 2 rounds; early exit when the model returns the JSON unchanged (its signal for "intentional", e.g. an airborne jump — the feedback text explicitly permits keeping values); a failed refine request keeps the last good pose, only aborts propagate. Invariants: `measurePose` leaves the candidate applied, so every exit path must end in a commit (the `pose` prop re-applies) or `restorePose` — the generate `.finally` calls `restorePose` only when the run still owns `abortRef` AND did not commit (an unconditional restore would flash the stale pre-effect pose after a commit, and a superseded run would stomp the newer run's display), and `fixAngle` calls it before capturing so the screenshot always shows the committed pose, never a mid-loop candidate. Thresholds in poseValidation.ts are deliberately lenient (e.g. hips radius 0.12 absorbs the fixed `CROUCH_HIP_DROP` gap) so floor-sitting poses don't diagnose as floating — that would be uncorrectable and would burn refine rounds on every sit.

**Browse never touches the shared ViewTransform** (Sketchfab-browse style — the drawing panel is fit leader; no grid over the 3D view). "Fix This Angle" captures a PNG from the WebGL canvas (render right before `toDataURL`; no preserveDrawingBuffer) and rides the standard fixed path: `fixedImageUrl` + `referenceInfo.imageUrl` + mode 'fixed' → ImageViewer (grid-synced). Autosave stores the screenshot in `referenceImageData` (same branch as sketchfab); browse restore re-applies `referenceInfo.pose` through PoseViewer's `pose` prop. Sketch strokes and the 3D orbit camera are deliberately NOT persisted — the pose JSON and the fixed screenshot are the artifacts. No urlHistory entry (like trace-template); gallery "Use this reference" restores fixed mode from `imageUrl`.

**Pose domain invariant**: `src/pose/posePrompt.ts` (schema + viewer-relative turn convention + natural-pose bias), `poseTypes.ts` (`parsePoseJson` sanitizer), `poseMapping.ts` (joint application), and `poseIk.ts` (placement-target solver) must stay in sync.

**Placement targets (IK)**: a limb with `handAt`/`footAt` (optionally `elbowAt`/`kneeAt`) ignores its angle fields; `applyPose` solves the joint rotations with an analytic two-bone solver. Targets are FIGURE-frame — origin on the floor below the hips, +y up, +x figure-left, +z figure-front, yawed by `body.turn` but NOT by `bend`/leans — in meters for a nominal 1.6m figure, rescaled by `targetScale` (standing height = rest head y + 0.12, same allowance as poseValidation). The path needs a `PoseRig` (rest joint positions incl. `spine`, sampled once per VRM in `PoseViewer.rigOf` via a WeakMap cache); without it targets are silently ignored — angle fields remain the fallback, so poses stay renderable. `y = 0` targets are "planted": the wrist/ankle snaps to its floor offset and the palm/sole is laid flat automatically (world rest orientation + yaw; palm fingers splayed 75° toward figure-front) unless explicit `wrist`/`forearmTwist`/`ankle` override, and only when the fore-limb is upright enough to make that physical. `body.hipsHeight` (absolute hip-joint height, meters) overrides crouch's fixed 0.35 drop and is what lets floor sits / all-fours / handstands actually reach the floor — it also only works with a rig. Out-of-reach targets clamp to the reachable annulus (0.999 of full extension, so the fold direction stays defined); `kneeDirection` = which way the knee APEX points, while `elbowDirection` keeps its "forearm folds toward" meaning (the elbow pole is its negation). `poseMapping` pins the upper-arm twist with a full-basis rotation so the elbow fold plane faces the anatomically natural direction, and `elbowDirection` is interpreted as a WORLD direction projected onto the elbow hinge — don't revert to shortest-arc `setFromUnitVectors`, it leaves the twist arbitrary and sends forearms in unrelated directions. `elbowDirection: 'back'` is rendered as the front fold: its projection is (near-)pure hyperextension for every arm orientation (the reversed-elbow artifact on running poses), so the enum value survives only for stored-pose compat and the prompt no longer offers it — a hand behind the body = negative arm "forward", never a backward elbow. `TOUCH_PRESETS` values were tuned visually against this basis. User VRM = single `poseAssets` record ('userVrm', 50MB cap); load failure falls back to the bundled model with a notice, never `onReferenceResetOnError` (sketch/hint must survive a retry).

**Pose history**: every successful generation is appended to the `poseHistory` Dexie table (pose JSON + hint + small JPEG thumbnail Blob, cap 50, LRU by `lastUsedAt` — selecting an entry bumps it via `touchPoseHistory`). The thumbnail is captured synchronously in the commit `.then` — at that moment the refine loop's last `measurePose` has left the final (= committed) candidate applied to the viewer, so the shot matches the recorded JSON; a not-yet-ready viewer just yields a thumbnail-less entry. The 履歴 button opens a Popover grid; selecting an entry commits a fresh `referenceInfo` (one undo entry) onto the CURRENT vrmId and deliberately does NOT mark it `selfCommitted`, so the hint-field re-seed and the in-flight-generation abort both fire — both are wanted when restoring a past pose.
