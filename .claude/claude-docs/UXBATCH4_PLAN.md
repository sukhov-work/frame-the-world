# UX BATCH #4 — owner's post-real-device list (2026-08-21) — 15 items, mobile-heavy

Owner order: ALL 15 items required, no priority given, "don't break what's built", multi-session
expected. Organized here into 6 tracks / 3 sessions. Evidence: 4 parallel scouts 2026-08-21
(radar/aim · map/windows · mobile shell · tile network), all claims file:line-cited in the
session log + `mem:project/wip-2026-08-21-owner-uxbatch4`.

## Ground truth that reshaped the plan (scout findings)

- The mobile "2D map" IS the GL globe top-down (`MOBILE2D` lock, StylizedTiles.ts:2680-2723).
  Two-finger rotation is currently *suppressed* by the per-frame north re-lock; tilt >15°
  (`MOBILE2D.enter3dTiltDeg`) is the 2D→3D door. Library two-finger "rotate" = parallel drag,
  NOT twist — a true twist is custom two-pointer math (precedent: FPV pinch-FOV,
  StylizedTiles.ts:1166-1410).
- The "minimap zoom in crude steps" is actually the **MapWindow** (fullscreen on /m): pinch
  snaps to integer slippy z (`Math.round(log2)`, MapWindow.tsx:502-505). The FPV mini-patch has
  NO zoom at all (fixed 200 m patch).
- "Expanded minimap" on /m = MapWindow fullscreen; its `✕ MINI-MAP` close button
  (MapWindow.tsx:622-624) is what item 1 replaces with a live-3D PiP. The GL canvas keeps
  rendering *underneath* the fullscreen MapWindow → PiP = a punched hole (CSS/canvas clear)
  over the live canvas, NOT a second GL view. Cheap, zero extra GPU.
- The "tracking ray" is the aimCones target dial (unit quad, tip at sector rim ×`lineLenK`
  1.18; aimCones.ts:164-177,376 + MapWindow.tsx:308-319). Sun/moon dials also reach their full
  sector rims today. `azSector.ts` needs NOTHING for the radar rework — annular bands are a
  consumer-side geometry change (fan centre → inner-radius vertices; canvas centre-moveTo →
  outer-arc + reversed inner-arc).
- The GL globe has NO FOV cone today (only MapWindow :360-381 hardcoded 0.22 and MiniMap
  :102-115); both render only while `fpvHud` exists → "cone everywhere" needs a planned-view
  (heading+focal) state that lives OUTSIDE FPV (also what the #11 joystick drives and what #10
  long-press jump uses).
- Item 15 falsified hypothesis: ALL tile hosts already serve cacheable headers (probed live —
  ion/Esri/CARTO/workers.dev/openfreemap all `public, max-age`, mostly immutable). The storm is
  LRU-eviction re-`fetch()` (library relies on the browser disk cache, TilesRendererBase.js:1786-1794)
  meeting iOS Safari's small, pressure-pruned HTTP cache. Esri is HTTP/1.1-only (6-conn limit).
  Item 5 (Safari reloads) is the same memory pressure: jetsam kill, zero contextlost/pagehide
  handling in the app, mid-tier phones run bloom + 2048 shadows + DPR 1.5 + up to 3×256 MB LRU.
- Item 14 half-done already: guide search SHIPPED 2026-08-19d both shells (Guide.tsx:177-191) —
  owner tested a pre-ship build. Remaining: resize (drag exists; `usePanelResize`/ResizeGrip
  from DragGrip.tsx:134-219 not yet wired) .

## Tracks

| Track | Items | Session |
|---|---|---|
| A Touch & input correctness | 2 (selection tint) · 3 (2D gestures) · 4 (MapWindow zoom feel) · 10 (long-press 3D) | **S1 ✓ SHIPPED 2026-08-21** |
| B Overlay & chrome quick wins | 6 (ray far) · 7 (vector transparency+toggle) · 8 (find-in-frame toggle) · 12 (time dock) | **S1 ✓ SHIPPED 2026-08-21** |
| C Desktop windows | 13 (MapWindow drag/−10%) · 14 (guide resize) | **S1 ✓ SHIPPED 2026-08-21** |
| D Radar unify (design) | 9 (zones/bands/dials/focal cone everywhere) · 11 (focal joystick) · 4-rotation (MapWindow twist — same draw() rewrite) | S2 |
| E FPV⇄map continuity | 1 (PiP hole in MapWindow) | S3 (after D reshapes MapWindow) |
| F Network & iOS stability | 15 (SW tile cache + demand shrink + force-cache care) · 5 (iOS resilience: contextlost/pagehide/lean profile/heat) | S3 |

S1 verification: gates 1,074/1,074 · astro 0 err/5 hints · `scripts/verify-uxbatch4.mjs`
23/23 both shells (re-runnable regression suite; shots `verify-shots/uxb4-01..11`). Gesture
FEEL on a real device = UNVERIFIED, rides T1. DECISIONS 2026-08-21 ·
`mem:project/wip-2026-08-21-owner-uxbatch4`.

## S1 spec (this session)

1. **#2 selection tint** — `global.css` (both layouts import it): `-webkit-tap-highlight-color:
   transparent` global; `user-select/-webkit-user-select: none` + `-webkit-touch-callout: none`
   on body; re-enable `user-select: text` for `input, textarea, select, [contenteditable]`.
   Existing explicit `user-select: text` pockets (fpv-hud.css:77) keep winning.
2. **#7 vector layer** — new pref `vectorsVisible` (default true; prefs.ts + sanitize + test) +
   camera-store flag; AND into `enabled` at StylizedTiles.ts:3895 (vectorFeatures; streetNames
   stays on — labels are content, ribbons are the wash). LayersChip row (/m) + desktop `.ct-row`
   chip. Transparency: VECTOR fillOpacity 0.5→0.25 · lineOpacity 0.85→0.55 · flatLineK
   0.55→0.32 (flat 2D map is the screenshot case).
3. **#8 find-in-frame toggle** — TargetPanel.tsx before :610 + TargetSheet.tsx before :230, same
   body mapping + toggle semantics as SkyContextMenu.tsx:279-299.
4. **#12 mobile time dock** — remove TimeChip from top strip (MobileShell.tsx:81); in
   MobileTimeDock replace `.md-play`+`.md-rate` (:378-399) with a time-only readout (no date).
5. **#6 ray far** — new `AIMCONES.rayLenK` (target dial only, ~4× rim) GL + MapWindow twin +
   tap-promote reach update (MapWindow.tsx:556-557). Sun/moon dials untouched (S2 reshapes them).
6. **#13 MapWindow desktop** — `usePanelDrag("map-window")` + DragGrip in `.mw-top`; CSS −10%:
   `min(57.6rem,84.6vw) × min(72vh,43.2rem)` (desktop block only, /m stays fullscreen).
7. **#14 guide resize** — wire `usePanelResize("guide")` + ResizeGrip; guide.css reads
   `--win-w/--win-h`. (Search: already shipped — tell owner.)
8. **#4-zoom MapWindow pinch** — continuous fractional zoom (tiles at ⌊z⌋, canvas scaled
   2^frac), damped sensitivity, wheel stays ±1; FPV open default z 17→18. Rotation gesture
   moves to S2 (same draw() rewrite as the radar twin — avoid rewriting it twice).
9. **#10 long-press 3D chip** — 500 ms/6 px pattern (ORCH.longPressMs) on MapModeChip →
   FPV jump at current map centre, current focal preserved.
10. **#3 2D map gestures** — in 2D: `controls.maxAltitude≈0` (restore CONTROLS.maxAltitudeRad
    on 3D) kills pitch at the source (EnvironmentControls.js:1649-1661 clamp, azimuth term
    untouched); remove the tilt-through-15° 3D flip (3D via button only, owner order); custom
    two-finger TWIST → heading (pinch-FOV precedent); heading re-lock stands down while a twist
    gesture lives.

## Owner addendum (2026-08-21, after S1 — three additions, all accepted)

- **#15 scope widened**: the missing-physical-cache / excessive tile loading is NOT
  Safari/iPhone-exclusive — the owner observes the same in **desktop Chrome mobile view**
  (and possibly desktop view — needs additional checks). S3 must FIRST measure re-fetch
  behaviour in desktop Chrome with the network panel (cache ENABLED — rule out the
  disable-cache checkbox) on both views: if Chrome's disk cache also misses, the cause ranking
  shifts from "iOS cache too small" toward request-level cache-busting or eviction churn
  outrunning ANY browser cache — re-verify before building the SW (the SW mitigation stays
  valid either way; the demand-shrink lever gains weight).
- **#9 radar gains a north bearing**: a small `N` marker on the radar rim (all surfaces — GL,
  MapWindow twin, minimap) — now that the 2D map rotates everywhere, the radar needs its own
  north indication. Fold into the S2 unify geometry.
- **NEW (item 16): street-name labels ×0.5 font** — `STREETS.textPxTarget [15, 13, 11]` →
  halve (≈ [8, 7, 6]), and CHECK the world-size floor path too (tuning.ts ~1449 "world-sized
  text reads like road paint" — the giant riverfront label in the owner's screenshot is likely
  the world-size branch, not the px target). Quick win — do at S2 open.

## S2 spec (radar unify — design-first, `investigate-design-v3` design mode)

- **#9**: target visibility zone = annular band clipped at the outer radar circle; sun/moon
  zones = THIN non-overlapping concentric bands at own radii (sun inner, moon outer — per
  sketch moon band sits above sun band), sun tint sunGlow/past-grey, moon brighter moonDial;
  dials capped at their own band outer radius; target ray stays long (S1 #6). One geometry
  model shared GL fan + canvas twin; minimap gains the same radar (it has none today).
- **Focal cone everywhere**: GL scene module + MapWindow (replace hardcoded) + minimap,
  reach = tracking ray, distinct colour (NOT accent — candidate `timeFuture` blue or a new
  token), near-zero fill, highlighted boundary. Needs **planned-view state** (heading+focal
  outside FPV) — new store seam; FPV mirrors `fpvHud`, non-FPV uses planned view (seeded by
  #10 jump + #11 joystick + photo placement heading).
- **#11 focal joystick**: parameterized `Joystick` (`onVector` prop; FpvControls.tsx:65-129);
  left-right → heading rate (`setHeadingRate`, max 45°/s), up-down → focal rate (`setFovRate`,
  log-space, max 0.9/s; expo γ 2.2 like desktop encoder); placement: minimap bottom-right,
  2D/3D map bottom-left. Drives planned view outside FPV, real camera in FPV.
- **#4-rotation**: MapWindow two-finger twist → map bearing (canvas rotation around centre);
  all overlays + hit-tests + pan axes rotate. Done together with the radar-twin draw() rewrite.

## S3 spec (network & stability + PiP)

- **#15**: (a) same-origin service worker, Cache Storage LRU ~300 MB for Esri/ion/workers.dev/
  openfreemap GETs (all CORS-clean; verify Esri ToS note tuning.ts:699-700 before persistent
  caching); (b) mobile demand shrink: GROUND.overlayResolution 512→256 on mid/low, consider
  Esri depth cap z17 on coarse-pointer, modest ground-LRU raise ONLY (blanket raise worsens
  jetsam); (c) `fetchOptions.cache='force-cache'` ONLY per-URL-filtered (immutable binaries —
  tileset.json/layer.json must keep revalidating, max-age 300 must-revalidate).
- **#5**: `webglcontextlost` preventDefault + restore path; pause rAF + tile updates on
  `visibilitychange`/`pagehide`; iOS lean profile on coarse-pointer (bloom off / shadow 1024 /
  DPR cap 1.25?) — kills jetsam reloads AND heat. On-device verify rides T1.
- **#1 PiP**: /m MapWindow close button → live-3D PiP (GL canvas punched through: clearRect
  hole + no background in that rect; tap → close window = back to FPV). Same size as the FPV
  mini-patch (200 px). After S2's draw() rewrite.

## Verification contract (every session)

vitest + `npx astro check` green (baseline 2026-08-21: 1073/1073 · 0 err/5 hints) · browser
CDP verify both shells via `node scripts/verify-chrome.mjs`, shots `verify-shots/uxb4-*` ·
touch-gesture FEEL + iOS Safari behaviour = UNVERIFIED locally, rides the owner's next device
pass (T1). Don't break: aimCones GL/canvas parity · U5 loading invariants (at-rest scene
tile-identical) · desktop MapWindow behaviour outside the −10%/drag delta.
