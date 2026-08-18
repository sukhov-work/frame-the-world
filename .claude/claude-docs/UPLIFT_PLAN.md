# UPLIFT_PLAN — mobile UX/perf + desktop uplift (owner 10-point order, 2026-08-17)

**Status: U1 SHIPPED 2026-08-17b · U2 SHIPPED 2026-08-18 · U3 SHIPPED 2026-08-18b (+ the
owner's 5-issue 2D-map batch, same session — all browser-verified; the shared real-device pass
rides T1 and stays each slice's exit gate). U4 next.** Originally AUTHORED 2026-08-17 (design session; P7 meteors
shipped the same session under IMPLEMENTATION_PLAN Phase 8c). Owner ask (2026-08-17, verbatim priority order):
current mobile experience is "barely acceptable" on iPhone 17 Pro + Pixel 6 Pro — both
performance and stability; 10 points below, "in order of urgency and criticality", to be churned
over the following sessions. This doc is the canonical schedule + design sketches; each slice is
independently shippable and lands desktop-safe (frozen chrome untouched unless the point is
desktop-facing). Research provenance: three parallel evidence-cited scouts (minimap/2D/gesture
audit · FPV-stability/tiles/terrain audit · P7 seams), 2026-08-17; every load-bearing claim below
carries file:line evidence from them. Memory twin: `mem:project/wip-2026-08-17-uplift-plan`.

**Authority interplay:** M4 (MOBILE_PLAN — P7–P9 mobile twins, AR, PWA) stays queued; this plan
takes the next sessions per the owner order. Desktop freeze stays additive-only. C-constraints
(C4 client:only, C6 privacy) bind throughout.

---

## 0. The owner's 10 points → slice map

| # | Owner point (condensed) | Slice | Sessions (est) |
|---|---|---|---|
| 1 | Mobile starts in **2D map** (photo tiles + vectors, NO 3D buildings); two-finger tilt → 3D (Google-Maps-style); button back to 2D; buildings only exist in 3D mode; FPV exit lands in 2D | **U1** | 1–2 |
| 2 | Minimap tap → **fullscreen map** (desktop: bigger modal) with photo layer + long-tap view-from-here; button back to mini; north-up fixed | **U3** | 1 |
| 3 | **Direction lines + visibility cones** on the 2D map for tracked target / sun / moon — PhotoPills-style, past amber / future blue, cone width = above-horizon span, fully dynamic (scrubber/pin/zoom) | **U4** | 1–2 |
| 4 | Minimap **view cone** (semi-transparent, width = current FPV focal, dynamic) | **U3** | (rides U3) |
| 5 | **Pinch gesture must never zoom the browser page** (minimap, panels…) | **U1** | (rides U1, ~small) |
| 6 | **FPV random full re-render / violent camera jerk to orbit / buildings re-seat at new altitude — must never happen** | **U2** | 1–2 |
| 7 | **Closest-to-viewer-first progressive rendering** (FPV: nearest area first), async, painless, no quality loss | **U5** | 1 |
| 8 | **Foveated rendering** + other tricks — mobile high prio, desktop low | **U5/U6** | 1–2 |
| 9 | **Terrain height source precision** — audit; better data for Dnipro (buy?) | **U7** | 1 (+bake) |
| 10 | **Per-building height override** — double-tap in FPV → extrude, saved to localStorage, highlighted; collaborative flow later | **U8** | 1–2 |

Recommended execution order: **U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8** — matches the owner
order except U2 (point 6) runs second because every later mobile slice is verified *through* FPV
sessions the bug corrupts. U5/U6 gate on U2's fixes landing first (a governor that mass-evicts
mid-FPV would poison any foveation measurement).

---

## 1. Evidence base (the load-bearing findings)

### 1.1 What exists for "2D mode" (U1)
- A tilt-only 2D chip already exists on DESKTOP: `setTargetTilt(0)` glide, `is2D = shownTilt <
  CONTROLS.twoDMaxTiltDeg (10°)`, `toggle3dTiltDeg: 55` [CODE CameraTiltPanel.tsx:137-146,51;
  tuning.ts CONTROLS 568-571]. Programmatic nadir pitch is proven; **heading is NOT locked**
  (north-up needs `setTargetHeading(0)` — the compass click [CODE CameraTiltPanel.tsx:120]).
  The chip does not exist on /m (grep-verified).
- Photo imagery already streams: Cesium World Terrain + Esri World Imagery + CARTO dark
  crossfade, gated below 3,000 km [CODE imageryGround.ts:127-143,374]; SAT mode = `groundMode`
  pref [CODE prefs.ts:18-19]. Vector roads/water/green + street names are terrain-seated GL
  ribbons with altitude presence bands [CODE vectorFeatures.ts:41-43; streetNames.ts:43-46].
- Buildings: OSM base + enriched Dnipro bake; the enriched↔classic swap needs a RELOAD
  (pose-hash lossless) [CODE CameraTiltPanel.tsx:205-210; enrichedVariant.ts:61-66], but plain
  runtime hide/show is a different, feasible seam — the stop-traversal
  `calculateTileViewError → inView:false` plugin already fully suppresses OSM tiles under the
  enriched bbox [CODE buildings.ts:100-119] and is the precedent for "buildings OFF in 2D".
- /m boot: no boot script — initial view is the shared orchestrator default (LEO orbit) or the
  URL hash [CODE m.astro:14-26; StylizedTiles.ts:427-451].

### 1.2 Pinch-zoom leak audit (U1, point 5) — structural, runtime-UNVERIFIED
- BOTH viewport metas permit browser pinch-zoom (no `maximum-scale`/`user-scalable`)
  [CODE Layout.astro:31; MobileLayout.astro:25; guide.astro:48].
- Only 9 `touch-action` declarations exist repo-wide; the DESKTOP canvas has none (mobile.css
  covers /m only) [CODE global.css:21-28; mobile/mobile.css:11-14]. Bare /m surfaces over the
  canvas: the minimap (`.mm`), `.m-bottom` tab bar (only `.md-rail` is protected), `.m-actions`
  chips, `.m-status` live children, `.m-sheet__body`, `.m-scrim`, SkyContextMenu [CODE
  mini-map.css:5-21; mobile/chrome.css:7-19,103-124; dock.css:19; sky-menu.css].
- Engine never `preventDefault`s touch (`touchstart` passive [CODE StylizedTiles.ts:634]) — CSS
  `touch-action` is the only line of defence.

### 1.3 FPV instability mechanisms (U2, point 6) — source-cited, browser-UNVERIFIED
- **A9 (the "full re-render"):** a quality-governor tier step-down (likely in FPV — the
  heaviest frames) calls `setQualityTier` → `lruCache.maxBytesSize` 256/160 MB, but the library
  `LRUCache.minBytesSize` stays at its 0.3 GB default → `isFull()` permanently true → hard
  eviction loop → buildings + terrain unload and re-stream (fade plugin + birth dissolve
  replay), the enriched module loses its cellList and re-runs the whole seating sequence —
  **exactly "full re-render + buildings at a different altitude"** [CODE GlobeCanvas.tsx:316-334;
  StylizedTiles.ts:284-293; node_modules/3d-tiles-renderer LRUCache.js:81-130;
  enrichedBuildings.ts:356-365]. `composer.setSize` also reallocates every render target
  mid-frame [CODE GlobeCanvas.tsx:319-322].
- **A2 (the "jerk to orbit and back"):** wheel/pinch zoom banked just before FPV entry survives
  in `zoomDelta` (controls.update early-returns while disabled; `resetState()` never clears
  zoomDelta) and DISCHARGES as a real zoom the instant FPV exits [CODE
  StylizedTiles.ts:1418-1442; EnvironmentControls.js:79-96,866-880,921-925].
- **A4/A5 (altitude jumps):** `tempPinPoint()` re-samples `heightAt` EVERY FRAME with no
  easing/stickiness — a terrain-LOD refine teleports the FPV eye by the LOD delta; the same
  sampler translates the whole enriched city group unsmoothed [CODE StylizedTiles.ts:606-617,
  1748-1750; enrichedBuildings.ts:541-547]. Photo-FPV: frustum resnap on a 0.5 m threshold,
  snap not ease [CODE PhotoFrustum.ts:201-206].
- **A1/A8/A7 (frame-boundary writes):** controls enable/disable flips are one frame late around
  step 3; `noteInteract` cancels flights + clears targets with no fpvActive guard; sticky
  `lastGroundM` can clamp the camera upward right after FPV exit [CODE
  StylizedTiles.ts:1444-1447,1592,1642,623-634,1281,2177-2193].
- **A11 (resize):** `setResolutionFromRenderer` is a one-shot per module — after any resize /
  orientation change the SSE denominator is stale → load/unload burst [CODE
  GlobeCanvas.tsx:381-388; buildings.ts:122; imageryGround.ts:145; enrichedBuildings.ts:141].

### 1.4 Tile-priority + foveation hooks (U5/U6) — real library APIs, cited
- Today the app sets ONLY `errorTarget` + `lruCache.maxBytesSize`; no priorityCallback, no
  queue tuning [scout B]. Every renderer runs the **error-first** policy because `loadAncestors`
  defaults true — **`tiles.loadAncestors = false` is the one-line switch to the closest-first
  `distancePriorityCallback` path** (cost: no coarse ancestor stand-in → brief holes)
  [CODE 3d-tiles-renderer TilesRendererBase.js:41-185,622].
- Sanctioned foveation primitives exist: `LoadRegionPlugin` with `RayRegion` (a camera-forward
  ray region — literally foveation along the FPV look vector), `SphereRegion` around the eye,
  per-region errorTarget, merge rule max(error) [CODE LoadRegionPlugin.js:161-251;
  TilesRendererBase.js:1044-1054]. `downloadQueue.maxJobs`/`priorityCallback` are public
  [CODE TilesRendererBase.js:444-510]. Do NOT touch deprecated `optimizedLoadStrategy`.
- Perf machinery to extend, not reinvent: device tiers + frame governor + per-tier levers
  [CODE quality.ts:65-182; tuning.ts:418-460; GlobeCanvas.tsx:316-334]; known defects to fold
  in: the A9 LRU floor, stars pixel-ratio captured once [CODE StylizedTiles.ts:206], whole-scene
  GlobeControls raycast with no BVH [CODE StylizedTiles.ts:454].

### 1.5 Terrain + buildings ground truth (U7/U8)
- Terrain = Cesium World Terrain (ion asset "1", quantized-mesh) [CODE tuning.ts:601-603;
  imageryGround.ts:77-88]. Actual max level over Dnipro: **UNVERIFIED** (needs a layer.json
  check); the enrichment plan already recorded "R6 — 30 m terrain ceiling limits
  riverbank/ravine fidelity" [DOCS dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md:220].
- The Dnipro bake carries NO terrain: buildings baked at ellipsoid h=0, runtime-clamped to
  rendered CWT in three stacked layers (group lift → per-cell → per-building vertex rewrite,
  budgeted + eased) [CODE bake.mjs:186; enrichedBuildings.ts:471-567].
- Per-building identity EXISTS in the enriched bake: `_FEATURE_ID_0` contiguous vertex runs,
  centroids, edge CSR — exercised every frame by the re-seat pass; raycast hit → run index is a
  ~10-line addition [CODE enrichedMask.ts:143-209; enrichedBuildings.ts:322-351,471-534]. BUT
  `featureId` is bake-sequential (OSM element id is DROPPED by the extractor) — **any re-bake
  reshuffles ids** [CODE bake.mjs:68,88; overpass.mjs:66-72]. Cesium OSM buildings: batch table
  reachable, property keys UNVERIFIED, runs not contiguous → v1 scope = enriched Dnipro only.

### 1.6 Direction-line ingredients (U4)
- No azimuth ground-line exists today (grep-verified) — the nearest precedents: dayArcs' sky
  polylines with per-vertex past/future alpha split + analytic horizon fade [CODE
  dayArcs.ts:74,83-90; tuning.ts DAYARC 1766-1775], findGhosts' per-hit identity system.
- All the math is shipped: `dayEvents` rise/set instants each ANNOTATED with azimuth,
  `horizontal`/`targetAzAlt` az-at-time, `sampleDayArc`/`targetElevationSeries`,
  `traceStates` skyline classification [CODE planner.ts:54-61,86-138; dayArc.ts:109-232].
- Colour convention shipped: past = `--color-warn` amber, future = `--color-time-future` blue
  (chrome-only tokens) [CODE tokens.css:26-27]; body identity = sunGlow/moonlight/accent
  (GL bridge) [CODE dayArcs.ts:114; skyTrail.ts:51-52].
- MiniMap: pure-canvas vector consumer, north-up, heading wedge with NO FOV information, no
  pointer handlers at all; collapse is /m-only local state [CODE MiniMap.tsx:21-146;
  minimapFeed.ts:8-19; mini-map.css:56-96].

---

## 2. The slices

### U1 — 2D-first mobile navigation (+ pinch hardening) · points 1 + 5
**SHIPPED 2026-08-17b** (DECISIONS 2026-08-17b-u1-2d-mobile · `mem:project/wip-2026-08-17-u1-2d-mobile`).
As sketched, with three implementation rulings: the two-finger tilt is the LIBRARY's own
touch-ROTATE state (no custom gesture layer — the pinch/parallel classifier already exists,
EnvironmentControls.js:562-585); detach = scene-graph removal + frozen update (three's Raycaster
does not skip invisible objects — `visible=false` would have left hidden mass under GlobeControls'
pivot raycast); the idle LEO drift is OFF in 2D (it slid the chart ~3° lon — a map holds still).
Real-device exit gate OPEN (iPhone 17 Pro / Pixel 6 Pro): pinch suppression + gesture feel
(MOBILE2D.enter3dTiltDeg / lockEaseTauMs) are tunable on glass.
**Scope.** /m boots into a top-down, north-up "2D map" over photo tiles + vectors with ALL
building tilesets detached; a two-finger vertical drag tilts into 3D (buildings attach); a
`2D` button glides back (buildings detach); FPV exit lands in 2D. Desktop untouched (its 2D
chip stays tilt-only).
**Sketch.**
- `store/camera` gains `mapMode: "2d" | "3d"` (mobile-written; desktop never writes it). 2D =
  `targetTilt 0` + heading glide to 0 + rotation suppressed; 3D = `toggle3dTiltDeg`. Reuse the
  existing tilt glide seam [1.1]; suppression of twist/tilt in 2D via the controls' enable flags
  (verify which EnvironmentControls axes can be frozen — fallback: per-frame heading re-lock,
  the `zoomTiltKeep` counter-rotation precedent [CODE tuning.ts:530-534]).
- Two-finger tilt: a /m-only gesture layer (pointer bookkeeping beside the long-press timer
  [CODE StylizedTiles.ts:1204-1241]) — two pointers moving vertically in the same direction →
  tilt delta; pinch stays zoom (library); guard against the FPV pinch-FOV path (FPV owns its
  pointers).
- Building detach: an orchestrator `buildingsActive` flag feeding BOTH building modules — group
  `.visible = false` AND a stop-traversal plugin (the OSM-mask precedent [1.1]) so hidden
  buildings stop downloading/parsing (the perf point). The "▦ 3D DETAIL" chip semantics on /m:
  in 2D it is inert (buildings absent); in 3D it keeps today's enriched↔classic reload.
- Pinch hardening (point 5): `maximum-scale=1, user-scalable=no` on MobileLayout (keep
  desktop/guide zoomable — accessibility); `touch-action: none` (or `manipulation` where taps
  must stay) on the audited leak list [1.2]; `overscroll-behavior: contain` on sheet bodies.
  Desktop canvas gets `touch-action: none` too (touch-laptop pinch reaches the browser today).
**Risks.** Gesture conflict with the library's two-finger pinch (needs on-device tuning);
buildings re-attach hitch on 2D→3D (mitigate: keep LRU-cached tiles, attach before the tilt
glide ends). Real-device pass is the exit gate (the M0 lesson).
**DoD.** Phone-viewport + real-device: boot lands 2D/north-up/no-buildings; tilt gesture in/out;
zero page-zoom on every audited surface; desktop byte-identical chrome; gates green.

### U2 — FPV stability: the re-render/jerk bug · point 6
**SHIPPED 2026-08-18** (DECISIONS 2026-08-18-u2-fpv-stability · `mem:project/wip-2026-08-17-u2-fpv-stability`).
All 8 mechanisms fixed as sketched + three verification upgrades: A9's discard-loop confirmed at
TilesRendererBase.js:1789 (parsed tile DISCARDED when isFull() — worse than the plan text); A2's
bank proven CONSERVED across FPV (stepZoomBrakeAndEase sloshes it between pendingZoom and the
unconsumed zc.zoomDelta); A8's wheel-during-entry-flight cancel was a browser-real teleport.
Soak: zero non-walk eye jumps (>0.5 m/frame, walk-attributed probe) through walk + look-drag +
±6 h scrub + high→mid→low→high flap on both shells; LRU pairs mid 192/256 · low 120/160 MB;
exit-alt drift 0.00 m. OPEN: natural-governor deferral (this machine never governs down; DEV
force() bypasses the gate) + real-device feel ride T1.
**Scope.** Kill every mechanism in [1.3]. Instrument first, fix second, prove third.
**Sketch (in fix order).**
1. Reproduce + instrument: log tier changes, `zoomDelta` at FPV boundaries, `tempPinGroundM`
   steps, enriched `seatM` epochs against a jump (the scout's discriminator probes
   [CODE StylizedTiles.ts:1374-1387; enrichedBuildings.ts:642-680]).
2. **A9:** set `lruCache.minBytesSize` alongside maxBytesSize (floor ≤ cap, e.g. cap−1); gate
   governor tier steps while `fpvActive` (defer to exit — FPV pose is the worst moment to
   reallocate composer targets); on tier change, skip `composer.setSize` when DPR unchanged.
3. **A2:** zero `zoomDelta`/`pendingZoom` at FPV entry AND exit [CODE StylizedTiles.ts:1418-1442].
4. **A4/A5:** sticky-eased ground for the temp-pin eye (accept-only-plausible + `seatStep` ease —
   the enriched module's own `acceptSample`/ease discipline [CODE enrichedBuildings.ts:422-426])
   and an eased group seat; frustum resnap eased rather than snapped where `framingActive`.
5. **A1/A8/A7:** same-frame controls flip (set enabled before step 3 runs — reorder or gate);
   `noteInteract` respects FPV transitions; invalidate `lastGroundM` on FPV exit.
6. **A11:** re-call `setResolutionFromRenderer` on resize/orientation for all three renderers;
   refresh the stars' captured pixel ratio on tier change.
**DoD.** A scripted FPV soak (walk + look + scrub + governor-forced tier flap) shows zero
camera teleports > 0.5 m and zero full-city re-streams; desktop + phone viewport; real device
rides T1. Each fix gets a regression probe where unit-testable (LRU floor arithmetic, zoom-bank
clearing are pure).

### U3 — Fullscreen map + minimap view cone · points 2 + 4
**SHIPPED 2026-08-18b** (DECISIONS 2026-08-18b-u3-2dmap-batch ·
`mem:project/wip-2026-08-18-u3-2dmap-batch`) — as sketched: minimap pose mirror gains `coneDeg`
(horizontalFovDeg off fpvHud, tracks pinch-FOV; wedge replaced by a translucent sector), the
patch is a tap target opening the NEW `MapWindow` island (desktop centred window / /m true
fullscreen; raw Esri/CARTO XYZ canvas via the new pure `lib/geo/slippy.ts`, drag/wheel/pinch/±,
double-click / long-press = VIEW FROM HERE through `requestFpvJump`, Esc/✕ back, attribution).
Shipped alongside the owner's 5-issue 2D-map batch (3D→2D spin fix · street-names v4 +
flat-map depth · imagery sharpness chain · 2D speed levers · MY LOCATION lands the map) — see
the DECISIONS entry. Esri ToS decision still rides U7.
**Scope (as planned).** Tap the minimap → fullscreen north-up map (desktop: large centered modal — the GUIDE
window precedent) with the photo-tile layer, long-tap = view-from-here, a button where the map
was returns to mini; minimap (both sizes) gains a semi-transparent FOV cone driven by the live
FPV focal.
**Sketch.**
- The minimap canvas is a pure `store/minimap` consumer with no handlers [1.6] — fullscreen =
  the SAME renderer at viewport size (patchM scaled), mounted as a top-level island layer
  (S2 containing-block rule). Photo layer: the minimap is vector-only today; fullscreen adds an
  imagery underlay — v1: raster XYZ fetch of the SAME Esri/CARTO sources the ground uses
  [CODE tuning.ts:606-617] into the 2D canvas (tile math is trivial at fixed north-up zoom);
  respect the Esri ToS caveat [CODE tuning.ts:596-597] — resolve in U7's provider decision if
  needed.
- Long-tap view-from-here: canvas point → lat/lon (the feed's inverse is linear around the
  centre) → `setTempPin` + `setTempFpv` (the SceneActions path [CODE SceneActions.tsx:93-95]).
- View cone: a filled sector at the wedge, half-angle = `fovDeg/2` from the FPV HUD mirror
  (already in `store/camera.fpvHud`), length ~fixed fraction of the map, alpha ~0.2 accent —
  replaces the fixed-width wedge's ambiguity [1.6]. Desktop + /m automatically (same island).
**DoD.** Browser-verified both shells (tap → fullscreen → long-tap → FPV at the point → back);
cone width visibly tracks pinch-FOV; north-up invariant; collapse behavior preserved.

### U4 — Direction lines + visibility cones on the 2D map · point 3
**Scope.** From the current pin/eye on the 2D map: three color-coded azimuth systems — tracked
target (accent) / sun (sunGlow) / moon (moonlight) — each a direct line at the CURRENT azimuth
plus a ground sector ("visibility cone") sweeping rise-azimuth → set-azimuth for the scene day,
split at the current azimuth: swept-already = amber, still-to-come = blue (the scrubber's
past/future convention [1.6]). Below horizon → the line pales (disabled treatment). Everything
re-derives on scrubber change, pin move, target change, map zoom.
**Sketch.**
- New scene module `scene/aimCones.ts` (orbit-mode overlay, dayArcs' material/fade grammar):
  ground-plane geometry seated flat at the pin (terrain-seated like vectorFeatures ribbons),
  camera-independent scale in METRES with a zoom-adaptive radius clamp (reads the same altitude
  bands the vector layers use [CODE vectorFeatures.ts:41-43]) so cones neither vanish at city
  zoom nor swallow the map at street zoom.
- Data per body: `dayEvents` rise/set azimuths + `elevationSeries`/`targetElevationSeries`
  sampled across the day → the azimuth sweep polyline (azimuth is NOT linear in time — build
  the sector from time-ordered az samples, not a naive arc between rise/set az); current az/alt
  from `horizontal`/`targetAzAlt` [1.6]. Skyline: v2 folds `traceStates` blocking into the
  sector (dimmed sub-bands) — v1 ships horizon-only (honest, labeled).
- The "don't overload" challenge (owner): one body EMPHASIZED at a time — the tracked target
  full treatment (line + cone + labels), sun/moon compact by default (line + hairline cone),
  a tap on a line promotes it; cones render at low alpha with additive-free blending (the S6
  bright-sky lesson [DECISIONS Traps]); all three toggleable from the sky quick-menu.
- Twin surface: the U3 fullscreen map draws the same three systems in its 2D canvas (shared
  pure helper producing az-sector geometry consumed by both the GL module and the canvas map).
**Risks.** Visual clutter (mitigated above + owner taste pass); azimuth wrap and circumpolar
targets (no rise/set — sector = full ring, label it); performance trivial (few hundred verts,
rebuild ≤ 1/s on scrub, memo on day/eye keys like the scrubber).
**DoD.** Browser-verified: cones re-shape on scrub (amber grows through the day), track-switch
recolors, pin move re-seats, zoom keeps legibility; screenshots at 3 zooms; unit tests for the
sector-geometry helper (wrap, circumpolar, below-horizon paling).

### U5 — Closest-first progressive loading · point 7
**Scope.** Make streaming visibly near-to-far in FPV and steadier everywhere; no quality loss at
rest (same errorTargets — only ORDER and concurrency change).
**Sketch.** Per-renderer experiments behind tunables: `loadAncestors=false` +
`distancePriorityCallback` on buildings + enriched (ground keeps ancestors — coarse terrain
stand-in prevents holes under the camera); custom `downloadQueue.priorityCallback` biasing
look-direction dot-product in FPV; `maxJobs` per tier (mobile: fewer, larger batches);
`parseQueue` cap on mid/low to stop main-thread hitches [1.4]. Measure with the frame governor's
own EMA + a tile-latency probe before/after.
**DoD.** A/B numbers recorded (time-to-first-building at the eye, hitch count during a scripted
FPV walk, phone viewport); no visual regression at rest; tunables documented in tuning.ts.

### U6 — Foveated rendering + perf tricks · point 8 (mobile-first)
**Scope.** Spend detail where the user looks: FPV gets a `RayRegion` along the look vector with
a tight errorTarget + a `SphereRegion` around the eye; periphery rides a relaxed base
errorTarget. Stretch (desktop-low-prio): DPR/resolution foveation via the composer.
**Sketch.** `LoadRegionPlugin` per building/ground renderer, regions updated in the FPV pose
step (cheap vector math); tier-dependent region radii/error in `QUALITY.tiers`; fold in the U2
resize fix so SSE stays honest. Gate everything on `fpvActive` — orbit/2D keep uniform error.
Note: this changes tile SELECTION, not shading — C2's "no quality loss" holds at the fovea by
construction; periphery honesty = the owner's explicit trade to test on device.
**DoD.** Mobile FPV time-to-sharp-centre measurably down (numbers in DECISIONS); no popping
regressions at the fovea; desktop unchanged unless enabled per tier.

### U7 — Terrain precision audit (Dnipro) · point 9
**Scope.** Establish what CWT actually delivers over Dnipro, whether better data exists, and
whether we self-host a Dnipro terrain patch (the R2 bake precedent).
**Sketch.** (a) Measure: read layer.json max level + sample a tile over the city; cross-check
`heightAt` at surveyed points (bridges, the embankment) [1.5]. (b) Source scan: SRTM 30 m
(current ceiling), ALOS AW3D30, Copernicus GLO-30, **UA-specific**: SSC/UkrGeo LiDAR
availability given wartime data restrictions (C6 sensitivity — an owner decision on any
purchase; commercial: Maxar/Vricon-class, Airbus WorldDEM Neo 5 m). (c) If a better source
lands: bake a quantized-mesh (or raster-height) patch for the 20×20 km enriched bbox onto R2,
served through the SAME QuantizedMeshPlugin path or a pre-seat table folded into the bake
(buildings then stop chasing runtime CWT — also shrinks the U2/A5 surface). Buildings' vertical
truth depends on this — it feeds U8's "ground zero" reference.
**DoD.** A decision memo in this doc's appendix (measured level, candidate table with
cost/licence, recommendation); owner call on purchase; bake slice scheduled if approved.

### U8 — Per-building height override (localStorage) · point 10
**Scope.** In FPV (both shells): double-tap/double-click an ENRICHED building → it arms for
extrude (highlight); drag up/down scales its height relative to its own ground zero; release
persists to this browser's localStorage; overridden buildings render in a distinct tint and
reload with the device. v1 = enriched Dnipro set only [1.5]; the collaborative/shared flow is a
later owner-designed phase (this slice is its local substrate).
**Sketch.**
- Pick: raycast → `hit.face.a` → binary-search the cached feature-run table → run index
  [1.5]. Extrude: scale the run's local +Y spans above the building's base (reuse the exact
  per-building vertex write path + edge CSR co-mutation + boundingSphere pad); the override
  MUST be folded into `applyFeatureSeats`' target (both write the same array every frame —
  they fight otherwise [scout B]).
- Identity: bake-sequential featureId is NOT re-bake-stable — key overrides on
  `(variantName, cellUri, featureId)` + a rounded-centroid checksum that invalidates rows on
  mismatch; AND add the OSM element id to the baker (one line in overpass.mjs + an accessor)
  so the NEXT re-bake upgrades keys to stable OSM ids [1.5].
- Storage: own key `ftw:bldg-overrides:v1` (NOT the prefs blob — it is uncapped [CODE
  prefs.ts:87]); capped map with insertion-order trim (the ttlCache discipline), value =
  {heightScale | absDeltaM, centroidCheck, ts}.
- Highlight: the tone pipeline already varies per `_feature_id_0` [CODE
  buildingMaterial.ts:137-155] — an override mask attribute/uniform tints the run (accent-mix).
- Gesture: double-tap arms; drag maps screen-Y → metres (scaled by distance); Esc/tap-away
  disarms; a small HUD chip shows Δm + RESET. Desktop: double-click + drag, same store.
**Risks.** Fighting the re-seat writer (folded by design); mis-picks on dense blocks (highlight
the armed run before any drag applies); localStorage quota (capped map).
**DoD.** Browser-verified both shells: pick → extrude → release → reload → override re-applied
+ tinted; unit tests for the override store (keying, checksum invalidation, cap) and the
run-index binary search; C6 note: overrides are local-only, never uploaded.

---

## 3. Cross-cutting rules
- Every slice: lib/math first with vitest twins where pure; browser claims UNVERIFIED until run;
  real-device pass (iPhone 17 Pro + Pixel 6 Pro) is the exit gate for U1/U2/U6 (the M0 lesson).
- Desktop frozen-additive: U1 is /m-only; U2/U5/U6 are engine-internal (desktop benefits
  silently); U3/U4/U8 add surfaces on both shells without touching shipped chrome behavior.
- Tunables land in tuning.ts blocks with doc comments (globe-tuning.md contract); new scene
  modules follow the attach-module pattern.
- Record per session: DECISIONS line + wip memory + this doc's slice status flipped.

## 4. Open questions for the owner (defaults attached, none blocking)
1. U1: should DESKTOP also gain the north-up-locked 2D mode (beyond the tilt-only chip)?
   Default: not yet — desktop nav is fine; revisit after U3/U4 land.
2. U3 fullscreen imagery: Esri World Imagery is ToS-flagged for production [CODE
   tuning.ts:596-597]. Default: reuse it in dev, fold the licensed-source decision into U7.
3. U6 periphery quality on mobile: how much softness is acceptable? Default: tier-gated
   conservative radii; judged on device with you.
4. U7: budget ceiling for commercial Dnipro terrain, and whether wartime sensitivity (C6)
   restricts sourcing. Default: audit + free sources first; purchase is an explicit owner call.
5. U8: confirm enriched-Dnipro-only for v1 (Cesium OSM global set needs its own identity
   research). Default: yes, enriched-only.

## 5. Decision log (append-only)
- 2026-08-17 · Plan authored from 3 parallel evidence-cited scouts; slice order U1→U8 ratified
  against the owner's 10-point urgency list (U2 promoted to second — verification of every
  later mobile slice runs through FPV). P7 meteors shipped the same session (Phase 8c line in
  DECISIONS).
- 2026-08-17b · U1 shipped (see the slice header). Rulings: library touch-ROTATE reused as the
  tilt gesture · detach = scene-graph removal (Raycaster ignores `visible`) · drift off in 2D ·
  nadir `#p=` hashes re-land 2D on /m (the mirror writes them) · heading mirrored off SCREEN-UP
  in 2D (forward-heading degenerate at nadir) · ▦ 3D DETAIL hidden in 2D · exit alt 600 m.
  Gates 922/922 · astro 0 err. Real-device pass = the open exit gate.
- 2026-08-18e · Owner round 4: desktop nadir = the same flat map (unified `flatGroundNow()`:
  deep error target + day grade + shadow rig off + bloom off + fast zoom, bounded by
  `CONTROLS.mapFlatMaxAltM` 120 km so the LEO flagship stays byte-identical; any inclination →
  normal 3D). Buildings stay attached on desktop (BLD chip hides them) — the one deliberate
  shell difference.
- 2026-08-18d · Owner round 3: street-name scale v4.1 — per-tier screen px targets [15,13,11]
  applied DIRECTLY per frame (the eased global scale lagged pinch ~270 ms and majors rode 2×
  world size × scale = the "huge text" shot); flat-map fills 0.15 → 0.08.
- 2026-08-18c · Owner follow-up: the LIVE-map blur root was CWT's tiny leaf GE (≈1.1 m on
  ~800 m tiles) freezing the overlay's virtual splits at z16 — `errorTarget2dDeep` 0.35 below
  1.2 km (blended out by 6 km) reaches z17–18 for ~+5 tiles at street nadir; flat-map fills
  ×0.15 / ribbons ×0.55 (imagery is the map); chips → `▲ 3D`/`▼ 2D`/`🧭 MY LOC`.
- 2026-08-18b · U3 shipped + the owner's 5-issue 2D-map batch (see the U3 slice header +
  DECISIONS 2026-08-18b). Rulings: the heading glide measures SCREEN-UP below 60° tilt (one
  heading definition through the glide→lock handoff — the 3D→2D spin) · nadir vector web +
  names = MAP INK (depthTest off, night dim down, near-ground ink fade) · street names v4
  (viewport selection + along-street repeats + legibility scale, band → 5 km) · imagery chain
  (512 composite · device-px SSE for the ground alone · levels off-by-one · 2D day grade ·
  2D near-error 2) · CARTO overlay attach-on-dark-only · MY LOCATION lands the 2D map with the
  pin armed (supersedes 2026-08-14) · MapWindow = raw-tile canvas island, NOT a second GL view.
- 2026-08-18 · U2 shipped (see the slice header). Rulings: LRU floor = cap×0.75 (the library's
  own min/max ratio; pure fn, both defaults captured + restored on high) · governor steps PARK
  during FPV (pendingTier; force() immediate) · DPR-unchanged tier flips skip the composer
  realloc · zoom bank zeroed at BOTH FPV boundaries · entry-frame controls.update gated by
  fpvEntryPending() · temp-pin ground eased at TEMPPIN.groundEaseK (first sample snaps) ·
  enriched GROUP seat eased, per-cell targets reference the APPLIED seat (sum invariant holds
  mid-slide) · photo-FPV skips the cadence resnap · noteInteract keeps only the drift guard in
  FPV · lastGroundM invalidated at exit · resize refreshes setResolutionFromRenderer ×3 + stars
  uDpr on tier change. Soak trap for the record: an OCCLUDED headful CDP Chrome stops rAF
  entirely (visibilityState hidden) — assert rAF ticks in every probe or "zero jumps" passes
  vacuously; launch with --disable-backgrounding-occluded-windows.
