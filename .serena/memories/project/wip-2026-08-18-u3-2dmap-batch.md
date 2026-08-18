# wip 2026-08-18b — UPLIFT U3 SHIPPED + the owner's 5-issue 2D-map batch

## What shipped (DECISIONS 2026-08-18b-u3-2dmap-batch; investigate-design-v3 implement mode, 4 evidence-cited scouts)
1. **3D→2D multi-rotation FIXED** — reproduced live (170→9.7→308.6→207→359.7° at tilt 0.2°,
   sweep 323°, 3 reversals): `stepHeadingGlide` steered the FORWARD bearing (degenerate at
   nadir) while the 2D lock used `mapUpHeadingDeg`. Fix: below `CONTROLS.headingUpRefMaxTiltDeg`
   (60°) the glide measures SCREEN-UP too — one definition through the handoff. Post-fix sweep
   166.9° (ideal 170), zero reversals. + temp-pin focus lock skipped in mobile-2D (pin-orbit
   whirl) + 2D `requestFly` arrivals use `mapArrivalPose` (was the oblique 52° search pose).
2. **Street names v4 + flat-map ink** (`streetNames.ts` rewrite + `vectorTiles.ts`): v3
   selection was world-space over the whole cache, no camera test → the 40-label budget sat
   off-screen at street zoom (why names "never appeared"). v4: viewport-filtered selection
   (NDC ≤ 1.15) · repeat anchors along long streets (`sampleLineAnchors` every 450 m, ≤6/feat,
   half-step end margins) · same-name sep 650 m×scale · refcounted per-name texture cache ·
   band 2500/2100 → **5000/4000 m** · legibility scale (`labelScaleFor`: ≥13 px smallest tier,
   floor 1 at street level, cap ×9, per-frame eased). Roads clipping: `mapFlat` latch (mobile
   mapMode 2d / desktop tilt<10°+5 hysteresis) → depthTest OFF on ribbons/fills/labels + night
   dim down + near-ground ink fade (`flatNearFade` 900→300 m → ×0.35 — imagery is the map at
   street zoom).
3. **Imagery sharpness**: `GROUND.overlayResolution` 256→512 · ground-only DEVICE-px SSE
   (`ground.refreshResolution()`, wired into resize + applyQualityTier) · XYZ `levels` is a
   COUNT off-by-one fixed (Esri z19/CARTO z20 real) · `GROUND.errorTargetNear2d` 2 in /m 2D ·
   **2D map day-graded around the clock** (eased `uFtwFlat2d` forces dayK) · NavChip: micro
   compass (needle = heading mirror, tap = face north in 3D) + `formatAltM` altitude, in
   `.m-actrow` right of the 2D/3D chip.
4. **2D speed**: CARTO overlay attaches ONLY in dark mode (was fetching a full second tile
   chain at opacity 0; delete→add = the plugin's own idiom) · shadow twins off in 2D (flat2d
   param) · bloom off while /m shows the map · `MOBILE2D.zoomSlowFrac` 0.85 (chart pinch fast).
5. **MY LOCATION lands the MAP** (supersedes 2026-08-14 straight-into-FPV): setMapMode(2d) +
   setTempPin + requestFly @ `MOBILE2D.locateAltAboveGroundM` 600 → nadir north-up over the fix
   (verified 718 m over ~117 m terrain), ◎ LOOK FROM HERE armed. Desktop island unchanged.
6. **U3**: minimap pose gains `coneDeg` (`horizontalFovDeg(fovDeg, aspect)` — verified 26.9°
   phone / 83.1° desktop, tracks pinch-FOV) → MiniMap draws a translucent sector; the patch is
   a tap target (`.mm-open`) opening NEW top-level `panels/MapWindow.tsx` island (desktop
   centred window z 42 / /m fullscreen z 20): raw Esri/CARTO XYZ canvas (NEW pure
   `lib/geo/slippy.ts`; retina = one level deeper drawn half-size), drag/wheel/pinch/± zoom,
   dblclick/long-press(500 ms) = VIEW FROM HERE via requestFpvJump (relocates live FPV, closes),
   Esc/✕, attribution line. Esri ToS decision rides U7.

## Verification
Gates vitest **947/947** (+21) · astro 0 err/5 hints. Browser (wix dev + Playwright CDP,
402×874 + 1440×900): rotation repro before/after · 2D map 1500 m/500 m shots (names along
streets, day grade at 02:00, no clip gaps, ink fade) · MY LOCATION store-flow (geolocation
itself can't be granted over CDP — the success-callback writes were driven verbatim) · U1/U2
contracts intact (FPV exit → 2D nadir 679–714 m · bank {0,0} · LRU pairs) · U3 full loop both
shells. Shots `verify-shots/u3-01..07`, before `u3-repro-01..02`.
**UNVERIFIED:** real-device (T1) · natural governor deferral (unchanged) · real geolocation
permission flow on device · Esri z19 coverage varies across Dnipro (some blocks source-soft).

## Traps for the record
- **XYZTilesOverlay `levels` is a COUNT** (generateLevels: maxLevel = levels−1) — passing a max
  level caps the source one below reality.
- **setResolutionFromRenderer feeds CSS px** — retina refines no deeper than 1×; per-renderer
  `setResolution(camera, w·dpr, h·dpr)` is the device-px seam (ground only here; buildings
  stay CSS-px deliberately).
- **An overlay registered at opacity 0 still fetches + composites per tile** — attach/detach
  overlays dynamically (`addOverlay`/`deleteOverlay`; delete→add is the plugin's re-order idiom).
- **Two heading definitions across one ease handoff = visible spin** — any writer easing
  heading near nadir must measure `mapUpHeadingDeg`, not the forward bearing.

## Follow-up round 2026-08-18c (owner, same session)
- **The real blur root** (live-probed): CWT leaves over Dnipro carry GE ≈ 1.1 m on ~800 m
  tiles → at errorTarget 2 the geometry "converges" after ONE virtual split and the imagery
  composite freezes at z16 ≈ 1.6 m/px regardless of composite resolution. SSE measures mesh
  error, not texel density. Fix: `GROUND.errorTarget2dDeep` 0.35 below `error2dDeepAltM`
  1.2 km, blended to the tier near-target by `error2dBlendAltM` 6 km (flat2d only). Measured:
  600 m → z17–18 imagery, 16 virtual splits, ~+5 visible tiles; 1.8 km → 0.55/z16 = screen
  density. Probe recipe: plugin = ground.plugins IMAGE_OVERLAY_PLUGIN →
  overlay.calculateLevel(tileInfo.get(tile).range) histogram over visibleTiles.
- Flat-map vectors: fills ×`VECTOR.flatFillK` 0.15, ribbons ×`flatLineK` 0.55 (the park fill
  blanketed a district; imagery is the map).
- Chips: `▲ 3D` / `▼ 2D` / `🧭 MY LOC` (guide prose updated).

## Follow-up round 2026-08-18d (owner round 3)
- Street-name scale v4.1: per-tier screen px targets `STREETS.textPxTarget` [15,13,11]
  (replaces minTextPx; `labelScaleFor(hWorld, pxTarget, wpp)` per entry in applyMatrix) applied
  DIRECTLY per frame — the eased global scale lagged pinch ~270 ms and majors rode 2× world
  size × scale (the owner's "huge text out of its lane" shot). Floor 1 = the v3 road-paint
  reading at street level. Same-name spacing rides the major tier's scale.
- `VECTOR.flatFillK` 0.15 → 0.08 (owner). Gates 950/950.

## Follow-up round 2026-08-18e (owner round 4 — desktop flat map)
- Unified `flatGroundNow()` in StylizedTiles = ink latch AND (mobile mapMode-2d OR desktop
  alt < `CONTROLS.mapFlatMaxAltM` 120 km): deep imagery error + `uFtwFlat2d` day grade +
  WHOLE shadow rig off (was receiver-twins only) + zoom-brake relax + bloom off (new
  `tilesHandle.mapFlat()` seam consumed by GlobeCanvas). Verified: desktop 1.5 km nadir fully
  flat (errorTarget 0.45, grade 1.0) · tilt 55° reverts · **LEO 1.09 Mm nadir stays OFF (the
  altitude bound protects the flagship terminator/bloom — load-bearing)**. Deliberate shell
  difference: desktop keeps buildings attached at nadir (BLD chip hides manually).

## Open tails
- U4 next (direction lines + visibility cones — UPLIFT_PLAN §2/U4; the U3 MapWindow is its
  twin canvas surface).
- Taste: ribbon widths/opacity at street zoom · MapWindow could draw the minimap vector web
  when zoomed under ~500 m span · desktop 2D chip keeps the cinematic night ground (/m-only
  day grade — deliberate).
- Real-device pass (T1): + MY LOCATION real geolocation + MapWindow touch feel.

Related: [[project/wip-2026-08-17-u2-fpv-stability]] · [[project/wip-2026-08-17-u1-2d-mobile]] ·
UPLIFT_PLAN §2/U3 + §5 log · DECISIONS 2026-08-18b.
