# WIP 2026-07-14 — Owner batch: PER-BUILDING seating + coords/drag/altitude-invert/mini-map — SHIPPED (browser-VERIFIED)

**Mode:** implement/Deep (/frame + investigate-design-v3). **Gates: 513 vitest (+7) · astro check 0/0 ·
wix build Complete · browser-VERIFIED in wix dev via Playwright MCP.** Shots:
`verify-shots/owner0714-01-orbit-coords-card.jpeg` (orbit, POSITION card) · `-02-fpv-minimap-hud.jpeg`
(FPV night: mini-map + HUD + ALTITUDE 7.5 m post-ascend) · `-03-fpv-day-seating.jpeg` (daylight solid).
R2 hosting DEFERRED again (owner: fix these first).

## 1 · PER-BUILDING / PER-TREE terrain re-seat (the critical fix — buildings sunk/levitating)
The per-cell plane left ±10–20 m within-cell relief error. Now each building (one contiguous
`_feature_id_0` vertex run — baker emits footprints in one pass, non-indexed, **glb local +Y IS up**:
ENU (e,n,u)→glTF (e,u,−n)) and each tree instance lifts by (terrain@its-own-footprint − cell seat),
**written into the position attribute / instanceMatrix[13] on the CPU** — deliberately, so the
occlusion sweeps (planFeed reads the same arrays), shadow maps and GlobeControls picks stay consistent
(shader displacement would desync the skyline planner — rejected).
- **Edges co-mutate:** EdgesGeometry copies floats verbatim → exact-position key map (pristine buffer,
  built BEFORE any delta) buckets edge verts per feature (CSR). Pure helpers + tests in
  `lib/globe/enrichedMask.ts`: `featureRunsOf/runCentroid/vertexKeyToRun/mapVertsToRuns/csrFromRunIds`.
- **Sampling:** budgeted heightAt raycasts (`ENRICHED.reseatFeatureSamplesPerFrame` 16 bldg +
  `reseatTreeSamplesPerFrame` 10 tree /frame); HALF always on the cell NEAREST the camera (re-found
  every `reseatPriorityEveryFrames` 30), half global round-robin (one cell per frame takes the rest).
  Footprint lat/lon located lazily ONE-SHOT per cell (gated `cell.appliedM != null` — matrixWorld is
  forced current only after the first cell write; TilesGroup skips child updates otherwise).
- **Apply pass every frame** (cheap compares over all loaded, ~0.2 ms): target = f.seatM − cell.seatM
  (cell TARGET, not eased — the two lifts sum to the footprint terrain once both settle); snap-first
  (`seatStep` null→snap), ease refinements (reseatEaseK 0.12), 1 cm deadband; needsUpdate per touched
  attr; bounding spheres padded once (`reseatBoundsPadM` 40).
- **GARBAGE-SAMPLE GUARDS (browser-caught live):** a streaming-time heightAt raycast returns
  coarse-LOD garbage → clampGroundM(negative)=0 → a first-sample SNAP put a building **−134 m**
  underground. TWO guards: (a) sample-accept only within `reseatFeatureMaxDeltaM` (45 m) of the cell
  seat; (b) **the pair can be poisoned the OTHER way** — the CELL seat itself can be garbage-0 when the
  feature samples (|0−0| passes), then the cell corrects and the stale feature seat drags −134 →
  APPLY-time check: implausible delta ⇒ `f.seatM = null` (tree: NaN) + ease back to the cell plane +
  round-robin re-samples. Verified: transients now capped ≤ bound and converge.
- **planFeed consistency:** handle gains `seatState() {epoch, quietFrames}` (epoch++ per write-frame)
  + `debugSeats()` (DEV, exposed as `__globe.enrichedSeats()`); planFeed gains `invalidate()` (clears
  anchorKind → next update() re-anchors + rebuilds); orchestrator step 41 invalidates ONCE per settled
  epoch (`PLAN.reseatQuietFrames` 90, only when profileSample() ready) — no rebuild thrash while easing.

**Measured (browser, Dnipro city view):** applied deltas settle to **−17.0 … +18.7 m** (real relief);
14-cell view = 4,163 features + 2,912 trees ALL sampled; 48-cell session peak = 12,113 features +
7,433 trees all sampled; epoch freezes + quietFrames grows (settles); PLAN profile ready, coverage 1.0
over the seated geometry.

## 2 · Always-on precise viewer coords (left card, both modes)
New `camera.camGeo` mirror `{latDeg, lonDeg, groundAltM|null}` = **camera-nadir geodetic** +
`ground.heightAt` there (null-honest; deadband ~0.1 m). Written in `stepPoseMirrorAndViewport`
(12-frame) in orbit and in the FPV HUD block (3-frame) while FPV walks (`mirrorCamGeo()` closure in
StylizedTiles). FpvHud card now renders whenever `camGeo` exists: POSITION row (new
`formatLatLonPaste` — signed decimal 6 dp `"48.464712, 35.046199"`, ASCII minus, the exact Google
Earth paste shape, unit-tested) + COPY button (navigator.clipboard.writeText → "COPIED ✓" flash;
`user-select:text` fallback) + GROUND row; instrument rows stay FPV-only. `.fh` is pointer-events:none
— the copy row + grip re-enable themselves. TRAP: clipboard **readText()** hangs headless Playwright
on a permission prompt (evaluate timed out) — verify via the UI state, never read back.

## 3 · Draggable panels — `ui/DragGrip.tsx` (usePanelDrag + DragGrip) + `styles/drag-grip.css`
One ⠿ grip per floating panel (dedicated handle — NEVER whole-surface: sliders/encoders own their
pointerdowns). Hook exposes `style` carrying `--drag-x/--drag-y`; **each panel's CSS composes them
into its own transform** (`.ts`/`.lf` keep `translateX(-50%) translate(var(--drag-x)…)`) — inline
transforms would clobber centering. Offsets clamped (≥48 px sliver on-screen), remembered per panel
key in a module Map (session-scoped; FPV/photo panels remount), double-click grip = reset (slider
idiom). Wired: `.ct-stack` (safe ONLY because .ct-pinpop is a SIBLING — comment updated), `.ts`,
`.tr` (pointer-events:none root — grip re-enables), `.lf`, `.pp-root`, `.fh`, `.pd` (INSET grip —
overflow:auto clips the overhang tab; pd-enter keyframes now compose the drag vars so a remembered
offset doesn't snap), `.mp-panel` (inset + corner="left" — × lives top-right), `.mm`. UploadFlow is a
full-screen page, not a window — skipped. Verified: drag −180/−120 moves the deck; dblclick resets.

## 4 · FPV ALTITUDE invert
`StylizedTiles.ts` FPV zoom-rate application: the two `fpvEyeM/fpvLiftM` clamps flipped `−`→`+` —
**+rate (drag right) = ASCEND** in both temp and photo FPV; orbit ZOOM branch untouched (+ = zoom in).
Encoder keyboard (ArrowRight=+) now also means up. Tip copy updated. Verified: +0.6 rate ×1.2 s took
eye 1.7 → 7.4 m.

## 5 · FPV mini-map (`MINIMAP` tuning group — patchM 200 IS the owner tunable)
- `vectorTiles.ts` parses the OpenMapTiles **`building` layer** (probe-verified over Dnipro: 80 merged
  multipolygon features / 1,539 rings / 10.4k verts in the central z14 tile) → `VecPolyFeat.kind`
  gains "building"; `vectorFeatures.ts` skips that kind (the 3D web has real buildings).
- NEW `scene/minimapFeed.ts` (step 40, before planFeed-last): reuses the SHARED vtiles handle
  (usually zero new network — street web already fetched the ring); on `version()` change or a
  >`rebuildDistM` (60 m) walk, clips features to `clipK`(1.6)×patchM around the eye and projects
  lon/lat→local metres (equirectangular at origin; sub-cm at this scale) → `_syncScene`; pose channel
  `{dxM, dyM, headingDeg}` at `poseEveryFrames` 3 (~20 Hz) → `_syncPose`; nulls once outside FPV.
- NEW `store/minimap.ts` (+ `window.__minimapStore`) · NEW `panels/MiniMap.tsx` + `styles/mini-map.css`:
  176 px canvas, north-up, viewer wedge+dot at centre (rotated by heading), token colours resolved via
  getComputedStyle (canvas can't var()— streetNames idiom), green/water/building fills + class-tiered
  road strokes (widthM × pxPerM, 1.4 px floor; bridges brightest; tunnels skipped), N + "200 M" DOM
  labels, welcome-hidden, drag grip. Island in index.astro (top-level, containing-block rule).
  Verified: 32 lines + 20 fills incl. buildings; pose tracked a 33.4 m arrow-key walk; unmounts on Esc.

## Files
NEW: `src/components/ui/DragGrip.tsx` · `src/styles/drag-grip.css` · `src/components/globe/scene/minimapFeed.ts`
· `src/store/minimap.ts` · `src/components/panels/MiniMap.tsx` · `src/styles/mini-map.css`.
EDITED: `scene/enrichedBuildings.ts` (feature/tree registries + sampling + apply + guards + debugSeats)
· `lib/globe/enrichedMask.ts` (+5 pure helpers) · `scene/planFeed.ts` (invalidate) · `scene/vectorTiles.ts`
(building layer) · `scene/vectorFeatures.ts` (kind skip) · `StylizedTiles.ts` (FPV zoom sign ·
mirrorCamGeo · step 40 minimapFeed + step-41 seat-epoch invalidate · __globe.enrichedSeats) ·
`tuning.ts` (ENRICHED reseatPerFeature/budgets/bound/pad · MINIMAP group · PLAN.reseatQuietFrames) ·
`store/camera.ts` (camGeo) · `lib/format/readout.ts` (formatLatLonPaste) · panels
CameraTilt/TimeScrubber/TimeReadout/LocationFinder/PlanPanel/PhotoDetail/MyPins/FpvHud (grips; FpvHud
also the POSITION card) · 8 panel CSS files (transform compose) · `global.d.ts` · `index.astro` ·
tests: `enrichedMask.test.ts` (+5) · `readout.test.ts` (+2).

## UNVERIFIED tails
- Sub-M3/phone cost of the apply-pass compares (~19k/frame at 48 cells) + minimap 20 Hz canvas redraw.
- Mini-map look at other patchM values; heading-up mode (owner may prefer) — north-up shipped.
- Drag persistence across reloads (session-only by design; no localStorage idiom in repo).
- Photo-FPV minimap/coords (verified in temp FPV only — same mirrors feed both).

Related: [[project/wip-2026-07-14-pass3-obstruction-moat]] [[project/wip-2026-07-13-terrain-reseat]]
[[project/wip-2026-07-13-dnipro-slice3-trees]] [[patterns/globe-rendering]]
