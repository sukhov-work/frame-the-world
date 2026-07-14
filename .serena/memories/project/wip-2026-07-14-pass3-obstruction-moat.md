# WIP 2026-07-14 — Pass 3 astro/obstruction moat + Slice 5 enrichment feed — SHIPPED (browser-VERIFIED)

**Mode:** implement/Deep (investigate-design-v3 via /frame). **Gates: 506 vitest (+33) · astro
check 0/0 · wix build Complete · browser-VERIFIED in wix dev via Playwright MCP.** Shots:
`verify-shots/pass3-01-planpanel-sunset-fpv.jpeg` (city-center FPV sunset, verdict rows + chips)
· `pass3-02-park-fpv-golden-morning.jpeg` (Monastyrsky island canopy anchor, CLEAR verdicts).

## What shipped (WS4 quick-win + structural, Slice 5 feed, in one pass)
- **`lib/ephemeris/planner.ts`** (pure): `dayEvents(sceneMs, obs, goldenCurve)` — sun/moon
  rise/set (`SearchRiseSet`, eye-height dip via metersAboveGround), civil dawn/dusk
  (`SearchAltitude` ±6° geometric), **golden windows DERIVED from tuning.GOLDEN** (bell=0.5 at
  smoothstep band midpoints → `goldenElevationsDeg` = asin(mid sines) — chips match the rendered
  grade exactly: −6.53°/+15.37° at current tuning), culminations (`SearchHourAngle` 0),
  `moonPhaseEvents` (next full/new, `SearchMoonPhase` 180/0, 40 d); **`skylineState(body, ms,
  obs, profileFn)`** = the moat: blockedNow + next clear/block crossings of
  `altDeg(t) − profile(azDeg(t))` via coarse scan (12 min) + bisection (±0.5 s) — own root-find,
  NOT astronomy `Search` (profile is piecewise-bin, no smoothness for its quadratic interp).
- **`lib/geo/horizonProfile.ts`** (pure): azimuth-bin max-elevation container (`createProfile`/
  `raiseBin`/`sampleProfile` lerp between bin CENTRES/`profileCoverage`/`isBlocked`), eye-height
  dip `horizonDipDeg` = √(2h(1−k)/R), terrain march `marchTerrainBin` (geometric steps, apparent
  elevation = atan((h−eye−d²(1−k)/2R)/d), k=0.13), `azAltOfEcef` ENU frame (ECEF geometry is
  curvature-EXACT; only +k·d²/2R refraction lift added).
- **`lib/geo/occlusion.ts`** (pure, **NO Raycaster — the load-bearing design choice**):
  `sweepMeshEdges` walks every triangle edge with **azimuth-adaptive subdivision sized by the
  segment's CLOSEST APPROACH** (endpoint-distance sizing skips bins on long near walls — caught
  by the street-canyon test) + rejects vertices inside the OSM-mask prism (reuses
  `bboxClipPrismEcef`/`planeDistance`; either-endpoint-inside drops the edge — enriched owns the
  interior); `sweepTreeInstances` reads the slice-3 `EXT_mesh_gpu_instancing` TRS directly
  (canopy sphere at base+up·0.61h, r=max(sx·0.5, 0.39h)) — sidesteps the tree `raycast=()=>{}`
  noop AND the fragment-level-clipping CPU/GPU mismatch entirely.
- **`scene/planFeed.ts`** (attach-module) + orchestrator **step 40 `stepPlanFeed`** (LAST —
  needs post-`stepEnrichedUpdate` matrices; enriched cells re-seat every frame): anchor = photo
  apex (`frustum.current().apex`) > FPV eye > view focus (chips only, no skyline); TIME-SLICED
  build (3 terrain bins + 2 meshes per frame, `PLAN.terrainBinsPerFrame/meshesPerFrame`);
  bounding-sphere prefilter computed lazily in the slice; mirrors → **`store/plan.ts`** at
  `PLAN.mirrorEveryFrames` cadence with a change-signature gate; scan throttle
  (`scanStaleMs` 5 min scene-drift / `scanThrottleMs` 900 ms real). Focus anchor quantized 0.05°
  + skipped entirely while panel closed (LEO drift would churn finder calls).
- **`panels/PlanPanel.tsx` + `styles/plan-panel.css`** (+index.astro island): PLAN pill at
  left 18rem bottom (the free strip between FpvHud and TimeScrubber), upward card — sun/moon
  BEHIND SKYLINE/CLEAR verdict rows with jump chips (CLEARS/HIDES hh:mm), "SKYLINE N% MAPPED ·
  3 KM TRUST" honesty line, almanac chips → `timeStore.setTime`. New tuning group **`PLAN`**;
  DEV seams `window.__planStore` + `__globe.plan()` (anchorKind/building/coverage/binAltDeg).

## Browser-verified numbers (wix dev, Dnipro, enriched tileset on)
- City-centre temp-pin FPV (48.4647,35.0462, eye 1.7 m): profile coverage **1.0**, bins
  0.39–13.27° (mean 5.9°) — real street skyline. **Sun clears the REAL skyline 02:29:14Z vs
  astronomical sunrise 01:52:36Z (+37 min); drops behind west skyline 16:43Z vs sunset 17:38Z
  (−55 min).** Jumped to clear+90 s: alt−skyline margin **0.42°**, blockedNow flipped ✓.
- Chips self-consistent with JPL-anchored `horizontal()`: sunrise alt −0.87° az 54.9 NE, noon
  az 180.0 alt 63.19, golden edges exactly at derived thresholds; **new moon 2026-07-14
  cross-check: moon culminates 3 min from the sun**. Chip click → timeMs jumps (3.5 s delta vs
  focus-anchor chip = the eye-dip recompute, correct).
- Park anchor (Monastyrsky island): canopy-driven skyline (max 5.43°, 22 bins >2°) with 4.9k
  tree instances streamed — **trees ARE the occluders there** (Slice 5 DoD).
- Two independent surfaces agree: FpvHud sun 305° NW −0.9° vs planner skyline 1.3° → BEHIND
  SKYLINE; moon +2.7° → CLEAR (pass3-01 shot).
- Console: only the 2 known benign errors.

## BUG found live + fixed + regression-tested
**Zenith overflow:** a canopy sphere grazing the eye → asin(r/d)→90° → altTop 92°+ AND
azHalfDeg → 450° (the 1/cos spread) → ONE tree painted ALL 120 bins at >90° (first park run:
every bin >2°, max 92.1). FIX: clamp altTop ≤ 89.9 + azHalf ≤ 180 (occlusion.ts); test "canopy
grazing the eye clamps at the zenith". NOTE: f32 bin storage rounds 89.9 → 89.90000153 — assert
`< 90`, not `≤ 89.9`. Re-verified live: max 5.43°.

## TRAPS (this session)
- **`Bash cmd | head -N` KILLS a background dev server** (SIGPIPE when head exits) — the 87
  console errors mid-verify were the page losing its server. Run `wix dev > log 2>&1` instead.
- The `#p=` pose-restore at low altitude can keep gliding (tilt creep) for minutes — the glide
  steering EXITS temp-FPV instantly. Verify recipe: real-ish grab (pointerdown/move/up on
  canvas, clears targets) → THEN `setTempPin`+`setTempFpv(true)` → FPV sticks.
- `sampleProfile` interpolates between bin CENTRES — march/tests must use centre azimuths
  ((i+0.5)·binWidth) or the sample blends with an untouched neighbour.
- OSM b3dm may carry interleaved/normalized/non-f32 positions — `positionsOf` falls back to
  getX/getY/getZ (applies normalization) before handing arrays to the pure sweep.
- Stale-value leak: `ctx.fpvEyeAboveGroundM` holds the LAST FPV value while orbiting a placed
  photo — photo anchors pass 0 and derive eye height from apex-alt − terrain.

## UNVERIFIED tails (carried)
- **Photo-apex anchor path in-browser** (needs a real placement flow; same construction as the
  verified FPV path — startBuild is shared, only the anchor source differs).
- Landmark-height validation (Slice 5 DoD tail): skyline validated self-consistently vs live
  geometry, NOT yet against a surveyed landmark height.
- Build-slice frame cost not instrumented (no jank observed on M3 during ~1–2 s builds).
- dayArcs skyline fold (dim the arc below profile(az)) — designed seam exists
  (`planFeed.profileSample()`), NOT built. Post-build streamed-in cells don't retro-raise the
  profile (rebuild only on anchor move >25 m).
- Narrow-viewport PlanPanel placement is a one-media-query guess (mobile pass carried anyway).

## Files
NEW: `src/lib/ephemeris/planner.ts` · `src/lib/geo/horizonProfile.ts` · `src/lib/geo/occlusion.ts`
· `src/components/globe/scene/planFeed.ts` · `src/store/plan.ts` ·
`src/components/panels/PlanPanel.tsx` · `src/styles/plan-panel.css` ·
`test/lib/ephemeris/planner.test.ts` · `test/lib/geo/horizonProfile.test.ts` ·
`test/lib/geo/occlusion.test.ts`.
EDITED: `tuning.ts` (PLAN group + sections) · `StylizedTiles.ts` (attach + step 40 + dispose +
`__globe.plan`) · `global.d.ts` (`__planStore`) · `pages/index.astro` (island).

NEXT: owner R2 hosting · optional HLOD coarse tier · dayArcs skyline fold · WS4-D subject
shadow timeline · Phase 6 marketplace (still deferred).

Related: [[project/wip-2026-07-13-dnipro-slice3-trees]] [[project/wip-2026-07-13-dnipro-slice2]]
[[patterns/sky-bodies-terrain]] [[patterns/photo-frustum]]
