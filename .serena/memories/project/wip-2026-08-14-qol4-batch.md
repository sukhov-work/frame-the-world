# WIP 2026-08-14 night-3 — QoL-4 owner batch (moon dark-chunk ROUND 3 · reticle parallax · hover ring+names · QoL-3 shipped desktop · §3.5 spec)

Twin: DECISIONS 2026-08-14 night-3 line. Gates: **vitest 828/828 (+39) · astro 0 err/5 hints**;
desktop browser-VERIFIED (headed Chrome CDP :9222 + wix dev; shots `verify-shots/qol4-01..04`).
Owner-device taste tier OPEN. Tree UNCOMMITTED (auto-ship).

## Moon dark chunk — ROUND 3, the REAL enabler (supersedes qol3's "impossible by construction")
The night-2 additive day arm was right but insufficient: the disc still WROTE DEPTH, and under
FPV look-drags the additive sky dome intermittently LOST the depth test against the disc's wall →
no sky behind the disc → dayRgb over the near-black scene.background = warm dark-textured chunk
([19,19,14] RGB — albedo over black, NOT ghost blue). Bad renders persist several presented
frames (render loop skips under drag) — hence owner screenshots.
**Empirical chain (the method matters — reuse it):** in-page rAF `gl.readPixels` patch around
the projected moon + scripted pointerdown/move/up drag oscillations → dark-frame detector
(min disc luminance / sky ring); banked state per bad frame. Results: 20/485 dark frames at
0.11–0.13× sky, `uDaySky ≡ 1`, same-frame far/dome/moon geometry consistent, draw order STABLE
(onBeforeRender capture: moon→dome→sun→ghosts good AND bad), ghosts exonerated by setGhosts(false)
A/B. **`moonMat.depthWrite=false` live-toggle → 0/469.** Fix: `scene/sky.ts` moon material
`depthWrite: false`. Depth served nothing: terrain occlusion = depthTest (kept ON); star
occlusion = night arm alpha≈1 REPLACES stars drawn before the disc. Known cosmetic edge: total
solar eclipse would wash the additive sun through the disc. DO NOT re-enable depthWrite.
(The exact GL micro-mechanism of the intermittent rejection was NOT pinned — the depth-wall
removal kills the whole class; if it ever resurfaces look at multi-frame presentation of skipped
renders, not uniforms.)

## Reticle off-target = LUNAR DIURNAL PARALLAX (0.878° measured → 0.000°)
`targetDirW` was geocentric `TargetState.dir`; the moon became trackable in qol2 → topocentric
offset up to ~0.95° (reticle ABOVE the disc = parallax altitude depression — matches owner shots).
Fix (StylizedTiles): sampleEphemeris banks `targetPosW = dir·distanceAu·KM_PER_AU·1000` when
distanceAu != null; stepSkyTarget re-derives `targetDirW = normalize(targetPosW − camera.position)`
PER FRAME (the sky.ts moon-disc move). Covers marker, trySkyMarkerClick, pickSkyBody, hover,
edge chip. `targetAzAlt` was ALREADY topocentric (topoAzAlt subtracts the observer) — ghosts/
trail/panel were never wrong. Stars/DSOs (distanceAu null) stay geocentric.

## Ghost now-exclusion
1-min default step → k=±1 moon ghosts sat ON the disc (alpha .62 NormalBlending bite).
skyGhosts.resample skips ghosts within `GHOSTS.nowGapDiscs 1.2` disc-DIAMETERS of the now
direction (targetAzAlt at sceneMs). Verified nearest ghost 0.654° ≥ 0.636° floor.

## Hover: ring + gain + NAMES
- `ORCH.skyHoverGain 0.25→0.32`; NEW hoverRing billboard in scene/sky.ts (reticle quad-gap
  grammar, r=0.8 plane, knobs `SKY.hoverRing{RadFrac 1.45, WidthN .016, GapFrac .22, Gain 2.2}`),
  positioned by `setHoverGlow` (banks camera in update(); keep the call right after sky.update).
- NAMES (owner "reveal very gently"): pure `lib/sky/hoverNames.ts` (raDecUnit, arcDistRad
  great-circle SEGMENT distance with within-arc test, buildHoverIndex, hitTestNames — priority
  star → asterism → constellation figure → constellation anchor 8°; star pads by vmag 1.1°→0.5°,
  gate `SKYNAMES.maxVmag 3.6` — MW-band ask covered by the star tier, Deneb/Altair/Antares etc).
  Scene `scene/skyNames.ts`: geoLabels-discipline DOM layer (fixed, pointer-events none,
  z-index 2, name+sub divs); HEAVY catalogs dynamic-imported + asterisms/constellation-lines
  JSONs fetched ON FIRST ELIGIBLE HOVER (lazyContract green). Orchestrator: stepSkyHover
  extension — same cadence/ease, night gate = STARS nightVis ramp (no names by day), bodies win,
  asterisms only when `fpvActive && skyGuides`, ECEF ray → J2000 = rotate by **+gastRad** about Z
  (stars mesh applies −gast), label follows live cursor, `skyNameLast` melts outgoing text.
  Verified: VEGA·Lyra, SUMMER TRIANGLE mid-edge, absent by day. Hit-test reuses the _pickRay
  seated by pickSkyBody in the SAME cadence tick — keep that coupling.

## QoL-3 shipped desktop (P4/P5/P6/R9)
- **P4 FindCard** (panels/FindCard.tsx): az±3/el±0.5 (R8), presets 1W/1M/6M/1Y, ☀/☾/target chips,
  skyline rows (bins mirror), DATE↔LIGHT sort, ⌖ seeds from fpvHud. Engine NEW
  `frameFinder.azElHits[InDay]`: hourly Δaz sign flips (|Δ|<90 guards the wrap seam) → bisect ≤1s
  → el-tol check → joint-box edge bisection. ~1 ms/day → 1Y in ONE memo pass (no chunking).
  END-TO-END: row tap landed sun az 249.99/el 15.08 for az 250/el 15. NOTE: "known standings"
  computed from geocentric moonDir will look ~1° off — the engine is topocentric (horizontal()).
- **P6 MoonCalCard** + NEW `lib/ephemeris/moonCalendar.ts`: SearchMoonQuarter/NextMoonQuarter +
  SearchLunarApsis/NextLunarApsis walks; `SUPERMOON_MAX_KM 360_000`; disc-arcmin/distance/illum
  per event via bodyStatesAt (ONE ephemeris); ★ SUPER rows + NEXT SUPERMOON chip; TodayCard grammar.
- **P5 SpotStarsCard** + NEW `lib/photo/npf.ts`: npfFullSec (k1–3, cosδ floor .05) · npfSimpleSec
  (D850 4.35µm/14mm/f2.8 → 16.3 s pinned) · rule500Sec · decAtAzAlt · maxCosDecInFrame (9-point
  frustum sample; cosδ=1 exactly when sampled declinations straddle the equator). FPV-only card;
  aperture + pixel-pitch inputs; focal from focalFromVerticalFov(fovDeg).
- **R9** NEW `lib/geo/sizeDistance.ts` + TargetPanel SIZE→DIST row (discs >300″ only): verified
  "1.8 M PERSON @ 209 M · 30 M TOWER @ 3.48 KM".
- PLAN order: FRAME · TODAY · FIND · MOON · SPOT STARS · MW. CSS `.pp-in/.pp-chip--on/.pp-find*/
  .pp-npf*` in plan-panel.css (spinners stripped; 12.5rem width kept).

## §3.5 spec (PLANNING_QOL_PLAN) — sunsets/sunrises IN FRAME (QoL-4 build next)
Event-time-anchored day loop (SearchRiseSet/SearchAltitude, ~4 finds/day) + airless
azAltFrameMarker geometry with solar-disc extent folded in; refraction convention: refracted
LABEL times, airless GEOMETRY (never mix). SUNSETS card (FPV pose-seeded, 1M/3M/1Y) + sunset-
corridor v2 (dayArcs arc pair). Mobile M3c.

## Owner taste knobs (new)
`SKY.hoverRing{RadFrac,WidthN,GapFrac,Gain}` · `ORCH.skyHoverGain .32` · `GHOSTS.nowGapDiscs 1.2` ·
`SKYNAMES.{maxVmag,starHitBrightDeg,starHitFaintDeg,figureHitDeg,anchorHitDeg,alpha,offsetPx}`.

## Follow-up (night-3b, same session): moon blow-out + scrubber
- **"Moon too bright" = a night-3 interaction:** the tracked-body marker's POINT GLOW (pointAmp
  clamps at 1.5 for mag −12.7) used to be 0.88° off-disc AND depth-rejected on the disc; the
  round-3 fixes centred + un-rejected it → blown core+halo stacked on the night disc. Fix
  (skyTarget.ts): body treatment NEVER draws for kind sun/moon (`uBodyFade = 0`; mesh visible
  only for the reticle) — the real disc IS the body. Plus gentle trim `SKY.moonBrightness
  3.2 → 2.9` (SHARED by both arms — day dim? raise moonDayAddGain 0.55 → ~0.61). Measured:
  halo@2R 8.8/255 (was blown), disc avg 167/max 251, texture back. ANY new treatment for a
  trackable body must check `kind === "sun" || "moon"` — the disc renders itself.
- **Scrubber:** `.ts-rail 40→48px`, curve strip 24→32px (`.ts-curves` height + `.ts-tick--midnight`
  in lockstep — three values, keep synced). Trace = wide translucent ribbon vs thin solid
  hairlines: clear 2.4px@52% · frame 3.6px@65% (shadow 45%) · blocked 1.6px@42%.

## Verify traps touched
- In-page `gl.readPixels` in a rAF registered AFTER boot reads the just-rendered default buffer
  (same-task guarantee) — the dark-frame detector recipe.
- React controlled inputs from probes: use the native value setter + `input` event.
- Geocentric ENU math in probes reads ~1° off the topocentric engine for the MOON — always
  compare against `horizontal()`.

Related: [[project/wip-2026-08-14-qol3-batch]] [[project/wip-2026-08-14-qol2-batch]]
