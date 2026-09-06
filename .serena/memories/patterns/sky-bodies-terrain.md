# mem:patterns/sky-bodies-terrain — ephemeris sun/moon + real terrain + bloom + shadows (2026-07-10; compacted 2026-09-06 from 19,337 B)

> **PARTIALLY SUPERSEDED (2026-08-18, audit-2 D9; extended 2026-09-06):** the GROUND/TILES pipeline
> was rebuilt by U3 (2026-08-18b/c) and U5 (closest-first loading), then the RENDERING CHARTER
> (2026-08-25 → 08-26d, RC0–RC30) rebuilt the light model, the shadow rig and the quality tiers on
> top. **Current truth for lights, shadows, tiers or tile streaming:
> `.claude/claude-docs/rendering/RENDERING_ARCHITECTURE.md`** + ARCHITECTURE §7 +
> `conventions/globe-tuning.md`. Era digests: `mem:project/wip-2026-08-18-u3-2dmap-batch` ·
> `-u5-loading` · `mem:project/wip-2026-08-25-rendering-charter` ·
> `mem:project/wip-2026-08-26-group-d-rc13-rc17` · `mem:project/wip-2026-08-22-ultra-track`.
> The EPHEMERIS/sky mechanics (terminator, moon phase, impostors, bloom) remain accurate.

> **NUMBERS THAT DRIFTED (checked against `src/components/globe/tuning.ts` on 2026-09-06)** —
> the mechanisms below are right, these values are not:
> - `SKY.moonSceneGlow` 0.35 → **0.5**; `SKY.moonBrightness` 1.8 → **2.9**; `SKY.moonEarthshine`
>   0.1 → **0.12**. The moon's phase scaling is now the K&S-1991 curve
>   (`lib/ephemeris/moonlight.ts`), not the linear illuminated fraction, so both moon constants are
>   FULL-MOON anchors.
> - `SHADOWS`: `mapSize` **4096**, `normalBias` 1.0 → **0.75**, `radius` 3 → **2**, and the ortho box
>   is no longer a fixed ±2.5 km — it is `boundsM 1_600` grown by `boundsAltK 0.6` and `viewFitK 1`
>   to `maxBoundsM 5_000`, quantised by `boundsQuantM 128`, and re-centred on a rig-only
>   `_shadowFocus` so the viewer sits at the box edge (RC4; RENDERING_ARCHITECTURE §1.4). Sunset no
>   longer snaps: `shadow.intensity` fades over `fadeBandSin 0.0523` before `castShadow` flips.
>   Moonlight shadows exist (`moonMinIllum 0.6`, `moonGroundOpacity 0.62`).
> - `SKY.horizonFadeBandM` (40 km metric band) is GONE — horizon occlusion is now ANGULAR against
>   the true ellipsoid horizon: `horizonFadeStreetDeg 0.08` / `horizonFadeOrbitDeg 0.6`, blended over
>   `horizonFadeAltLoM 50_000` → `horizonFadeAltHiM 600_000`. The moon's discard threshold is
>   `moonAlphaDiscard 0.03` (was 0.004) and gates premultiplied rgb AND alpha.
> - `GROUND.overlayResolution` 256 → **512**, and the EFFECTIVE composite px is now per tier
>   (`overlayResolutionPx` 512 high / 256 mid+low; `overlayResolution2dPx` 512 for the flat chart),
>   RATCHETING UP only — one writer, `stepGroundUpdate`, which never lowers it on a mode flip or a
>   governor demote. `GROUND.gain` 0.56 → **0.6**; `GROUND.nightFloor` **0.4**; `EARTH.nightFloor`
>   **0.23**. `GOLDEN` is a 4-point band (`fadeInLo -0.21` → `fadeOutHi 0.36`, `castGain 1.3`) with
>   per-consumer strengths, not one bell.

Browser-VERIFIED 2026-07-10: the terminator matched real time (subsolar 22.2 N/43.1 E @ 09:12Z) and
Dnipro buildings seated on terrain without the 90 m sink.

## Ephemeris (ADR D6 — astronomy-engine 2.1.19 EXACT-pinned)
- `lib/ephemeris/bodies.ts` (pure, three-free): `bodyStatesAt(utcMs)` → sun/moon ECEF unit dirs +
  distances + `moonPhaseDeg` (0 new/180 full) + `moonIllumination` (0..1) + `gastRad`. Recipe:
  `GeoVector`/`GeoMoon` (EQJ, AU) → `Rotation_EQJ_EQD` → rotate about +Z by −GAST
  (`SiderealTime(t)·15°`). Sign convention verified 3 ways vs the library's own terra()/Horizon()
  and JPL Horizons (≤0.0007°).
- **TRAP:** `MakeTime(number)` = J2000 DAYS, not epoch ms — always `MakeTime(new Date(ms))`.
- `horizontal(body, utcMs, lat, lon)` = topocentric az/alt (of-date + parallax, airless) — the
  almanac-checkable face; tests assert JPL Horizons rows (Dnipro solstice noon 179.13°/64.97°) to
  0.05°. Moon geocentric-vs-topocentric parallax ≤ ~1°, fine for the scene.
- `test/lib/ephemeris/bodies.test.ts` — 9 tests incl. subsolar-lat-at-solstice = tropic check.

## Scene time
- `store/time.ts`: `{ timeMs, live, setTime(pin), goLive }` + `sceneTimeMs()`. LIVE reads
  `Date.now()` — the store is NOT written at 60 fps.
- The orchestrator re-samples ephemeris when |sceneTime − lastSample| > `SKY.sampleIntervalMs`
  (1 s; the sun drifts 0.004°/s). ONE sample pushes the earth, ground, atmosphere and sky uniforms
  plus the key light — `uSunDir`/`uMoonDir`/`uMoonGlow` and their `uFtw*` ground twins.
- `panels/TimeReadout.tsx` + `styles/time-readout.css` = the bottom-right mono HUD. DEV: `window.__timeStore`.

## Sky bodies (`scene/sky.ts`)
- Both bodies are camera-anchored impostors at `clamp(far·0.5, near·1.2, far·0.95)` — **the CLAMP IS
  LOAD-BEARING**: looking AWAY from earth the controls fit `near` to ~13,000 km and an unclamped
  0.5·far impostor near-plane-clips. Apparent size = `d·tan(angularRadius)`; sun ≈ 0.263°.
- Sun: billboarded plane ShaderMaterial, additive — limb-darkened HDR core (× `SKY.sunIntensity 5`,
  above `BLOOM.threshold` so bloom carries the wide glow) + a tight exp halo. tokens.sunCore/sunGlow.
- Moon: SphereGeometry + custom shader `albedo·(earthshine + pow(N·sunDir, 0.8)·brightness)` — phase
  comes from the REAL sun direction for free and scene lights cannot wash the dark limb, which is why
  it is NOT Lambert. Texture `public/textures/moon-color.jpg` (NASA CGI Moon Kit LROC 1k, sRGB); near
  side (+X of sphere UV) aimed at Earth, pole ≈ ECEF +Z.
- `moonLight` DirectionalLight = tokens.moonlight × `SKY.moonKeyIntensity` × phase curve; the earth
  and ground shaders get the matching `uMoonGlow = SKY.moonSceneGlow × phase curve` night term.
- **Impostor occlusion is ANALYTIC, not depth.** The impostors sit at a FAKE distance (0.5·far) and
  the earth's limb is usually farther, so the depth buffer drew the moon THROUGH the planet. Both
  shaders fade against the horizon instead (angular band — see the numbers block). The moon material
  is transparent with a `discard` below `moonAlphaDiscard`: a hidden disc must write NO depth or it
  punches a hole in the starfield and depth-rejects the sky dome drawn after it. `depthWrite` stays
  on otherwise, because the moon BODY does occlude stars.

## Bloom (GlobeCanvas)
EffectComposer with a **custom RT: HalfFloatType + samples 4** (the default 0 aliases building edge
lines) → RenderPass → UnrealBloomPass (`BLOOM` 0.4 / 0.5 / 0.9) → OutputPass. Materials are
auto-untonemapped inside RTs (r185), so `toneMapped: false` on the photo frustum is a NO-OP under the
composer. Resize with `composer.setSize(logical px)`.

## Real terrain (`scene/imageryGround.ts`)
- Cesium World Terrain (ion asset **1**) quantized-mesh + an Esri imagery overlay. **Plugin order is
  priority-sensitive:** `CesiumIonAuthPlugin({assetId:"1", autoRefreshToken, assetTypeHandler})` —
  QuantizedMeshPlugin is registered INSIDE `assetTypeHandler` on `'TERRAIN'` (**NEVER up-front**: its
  priority −1000 would fetch layer.json before the ion endpoint resolves) → our unlit-swap plugin
  (−100: Standard → per-tile Basic material, disposed on `dispose-model`) → TilesFadePlugin →
  UpdateOnChangePlugin → ImageOverlayPlugin (−15, composites after `color_fragment`).
- The grade is injected at **`alphamap_fragment`** (AFTER the overlay composite), never
  `map_fragment`, and **CHAINS `onBeforeCompile` — never assigns** (TilesFadePlugin already wrapped
  it; `scene/imageryGround.ts:917`). Half-lambert uses the REAL surface normal
  (`vFtwN = mat3(modelMatrix)·normal`), so slopes shade and the terminator stays continuous.
- Buildings: the 90 m sink is REMOVED (OSM Buildings are clamped to CWT = the terrain now rendered).
  `terrainHeightAt(lat,lon)` = a down-raycast from +12 km (QueryManager pattern); Dnipro fine-LOD
  reads 93.8 m (≈ the old hand-tuned sink) but **coarse LOD returns garbage (−453 m at LEO)** —
  every consumer must clamp (`lib/geo/terrain.ts clampGroundM`) and tolerate refinement.
- The "tiles versions at 1.1+ limited support" console warning is benign.
- **Soft loading — the five 0.4.28 defaults that made the first load patchy:** `fadeRootTiles=false`
  (coarse tiles POP); `maximumFadeOutTiles=50` plus a camera moving >0.1 u/frame → `completeAllFades()`
  SNAP (idle drift moves ~140 m/frame, so it always counted as moving); QuantizedMeshPlugin pinning
  `errorTarget=2` at init; failed Esri overlay fetches never retried; `uFtwFade` snapping to 1 on
  frame 1 over ZERO loaded tiles. As built: `TilesFadePlugin{fadeRootTiles:true, fadeDuration 700,
  max 300}`; reveal = altFade × readiness low-passed (`revealTauMs 600`), readiness =
  `loadProgress × revealProgressCap 0.85` until the first `tiles-load-end` then 1 (**`loadProgress`
  reads 1 BEFORE any request**); adaptive `errorTarget` 2 ↔ 12 across `errorNearAlt 60_000` ↔
  `errorFarAlt 750_000`, set per frame AFTER QuantizedMeshPlugin's init; `uocPlugin.needsUpdate =
  true` until the initial load ends; `resetFailedOverlays()` debounced `overlayRetryMs 8_000`.
- Buildings still hard-pop: ONE shared `styleMat` cannot ride TilesFadePlugin (fades are per-tile
  material) — it would need per-tile material clones.

## Shadows (sun-driven, city scale) — see the numbers block; RC-era truth is RENDERING_ARCHITECTURE §1.4
- GlobeCanvas: `shadowMap.enabled`, **default PCFShadowMap** (PCFSoft deprecated in r185; VSM would
  drag huge receivers into the depth pass). Rig on the ONE sun light: near/far = `lightDistM 8_000` ±
  `depthMarginM 3_500`, `bias -2e-4`, **`normalBias` in world metres — the float32-at-6.4e6 acne
  killer**. `scene.add(sun.target)` is REQUIRED (matrixWorld). Buildings cast + receive (flags set
  per mesh on `load-model`; tiles arrive false).
- Per frame: gate = `alt < SHADOWS.maxAltM` (30 km) AND `sunDir·focusUp > minSunElevSin` (a
  below-horizon sun projects garbage). **RC3 (2026-08-25) removed `!!focusHit` from `shadowEligible`**
  — a look at or above level no longer kills `castShadow` and detaches every terrain caster.
- Ground receives via a **ShadowMaterial twin per terrain tile** (same geometry, child of the tile
  mesh, `polygonOffset -1`, raycast noop, altitude-gated), tinted toward `tokens.water` — pure black
  melts into the dark grade. `groundOpacity 0.75`.
- **KEY DEBUG LESSON, learned twice:** the shadow mask is essentially always correct — **debug
  CONTRAST first** (an opaque `getShadowMask()` visualisation, or the ShadowMaterial set red at
  opacity 1). Hard ceiling: shadow contrast can never exceed the graded ground's own luminance, so a
  further "crisper" ask needs a brighter day grade, not shadow-rig work.

## Photo-frustum altitude semantics (D4, changed with terrain)
`PhotoFrustum` takes `terrainHeightAt` + `resnap()` (called as tiles refine, keyed by placement so a
re-place never inherits a stale height). **EXIF-provenance altitude is an ABSOLUTE ellipsoidal
height**, clamped to ≥ terrain + eyeHeight (geoid/GPS noise buries it otherwise); MANUAL/MISSING =
metres above the RENDERED ground. Fixture: apex 96 m ellipsoidal ≈ 2.2 m above the 93.8 m terrain.
Follow-on: `mem:bugs/pin-arrival-reframe`.

## Later 2026-07-10 batches — invariants + traps only (verbatim: DECISIONS_ARCHIVE.md §Moved 2026-08-15)
- **TimeScrubber**: a ±12 h rail whose window math (`timeToFraction`/`fractionToTime`,
  `localDateStr`/`withLocalDate`) lives in `store/time.ts`. **TRAPS:** the drag flag MUST be a
  `useRef` (React state does not flip between same-tick pointer events, so fast or synthetic drags
  scrub nothing); wrap `set/releasePointerCapture` in try/catch (synthetic pointerIds throw); round
  the offset label's minutes FIRST then carry (per-unit rounding printed "+3936 h 60 m").
- **capturedAt seeding**: `captureTime.ts capturedAtToUtcMs(stamp, lonDeg)` reads TZ-naive EXIF as
  SOLAR time at the placement longitude (offset = `round(lon/15)` h; ≤1 h vs civil DST).
- **Golden hour has FOUR twins that must stay in sync**: GLSL in baseEarth, in the ground grade, on
  the atmosphere line (`2·sun−1` IS the same sine at the ray's closest approach), and the JS
  `lib/ephemeris/golden.ts goldenFactor` driving the key light. The focus ray is computed every
  frame, falling back to the sub-camera up on a miss.
- **Narrow terminator**: `dayK = smoothstep(EARTH.termBand[0], [1], sunDot)` over sin(sun elevation)
  ≈ the real ~9° twilight zone, as GLSL twins in baseEarth AND the ground grade; city lights and the
  moon night term use `EARTH.lightsBand` over the same sine. **Still true with ULTRA OFF only**: S9
  (2026-08-22j) drives the day factor from a twilight-band curve on `lib/ephemeris/twilight.ts`
  spanning 36° of solar elevation, and the 2026-08-27 dusk rebuild replaced `EARTH.dayGradMin` with a
  direct/ambient split whose ambient half has a level and an azimuth.
- **BSC5 stars (D6)**: `scripts/build-star-catalog.mjs` (run once, needs network) bakes
  YaleBrightStarCatalog bsc5.json (MIT) → `public/data/bsc5.bin` — LE float32 [x,y,z,vmag,bv] ×
  9,096 (177.7 KB). `scene/stars.ts` fetches it async (the procedural field is the offline fallback)
  and sets `points.rotation.z = −gastRad` (a star at RA=GAST lands on lon 0 — round-trip unit test).
  The Milky Way is a CHILD Points of the star sphere, so it inherits that rotation, the camera-follow
  and the scale.
- **TRAP, hit twice (see `STARS.brightMin`)**: sub-pixel points (0.6–1.7 px at DPR 1) often cover NO
  pixel centre and render literally nothing. `uFade` is overwritten every frame — live-tune via
  `uColor`/`uDpr`.
- **Esri patchwork ROOT CAUSE** (persistent, so never a loading state): the blobs are regional mosaic
  seams and haze baked into Esri World Imagery's own low/mid zoom levels, and no retry fixes that.
  The kill was `GATES.groundFadeTop 750_000` / `groundFadeBottom 380_000` + `GROUND.errorFarAlt
  750_000` — Blue Marble owns everything above ~750 km, so the default LEO view carries zero Esri.
- **TRAP — dome re-anchor**: below `ATMOSPHERE.domeMaxAlt` (350 km) the earth-centred shell's visible
  hemisphere sits PAST the controls' tight far plane (street-level far ≈ 300 km, shell overhead ≈
  630 km). The shader shades by ray DIRECTION only, so `update()` re-anchors the SAME mesh to
  `camera.position` at scale `0.45·camera.far` with `uInside` forced to 1 — pixel-identical. The
  atmosphere is no longer gated by `GATES.decorMinAlt`; the graticule still is.
- **Stars at night at any altitude**: `stars.update(sunDir)` fades on `max(altFade, nightFade)` over
  `STARS.nightVisStartSin -0.02` → `nightVisFullSin -0.14`.
- **Photo plane preview**: opacity = `store/upload.planeOpacity ?? FRUSTUM.planeOpacity` (0.7),
  driven by PhotoDetailPanel's PLANE ALPHA slider (`setPlaneOpacity(undefined)` = default).

## UNVERIFIED / carried (as of 2026-09-06)
- Moonlight on night buildings: code-wired, never isolated in a shot.
- Terrain memory/perf at street level — the T77 rendering-performance track owns this now
  (`mem:project/wip-2026-09-05-t77-measure`).
- Esri via ImageOverlayPlugin looks slightly softer at grazing angles than the old direct `map` path.

Related: `mem:patterns/globe-rendering` · `mem:patterns/photo-frustum` ·
`mem:decisions/adr-000-locked-stack` · `mem:bugs/ground-checkerboard-flicker` (OPEN).
