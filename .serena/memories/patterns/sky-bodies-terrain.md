# mem:patterns/sky-bodies-terrain — ephemeris sun/moon + real terrain + bloom + shadows (pre-Phase-4, 2026-07-10)

> **PARTIALLY SUPERSEDED (2026-08-18, audit-2 D9):** the GROUND/TILES pipeline described below was
> rebuilt by U3 (2026-08-18b/c — errorTarget2dDeep, unified flatGround gate, labels v4.1) and U5
> (closest-first loading). Current truth: ARCHITECTURE §7 + `conventions/globe-tuning.md` +
> `mem:project/wip-2026-08-18-u3-2dmap-batch` / `-u5-loading`. The EPHEMERIS/sky mechanics
> (terminator, moon phase, bloom, shadows) remain accurate.

Browser-VERIFIED (Playwright on wix dev): terminator matches real time (subsolar 22.2N/43.1E @ 09:12Z
Jul 10 ✓), night Americas + blooming VIIRS lights, sun disc + halo, moon with correct 22% waning
crescent + LROC maria + earthshine, Matterhorn/Alps real 3D relief, Dnipro buildings seat on terrain
WITHOUT the 90 m sink, time pin (07:30 PINNED) relights scene + long-shadow geometry proven via
red-mask debug. 113 vitest · astro check 0.

## Ephemeris (ADR D6 — astronomy-engine 2.1.19 EXACT-pinned)
- `lib/ephemeris/bodies.ts` (pure, three-free): `bodyStatesAt(utcMs)` → sun/moon ECEF unit dirs +
  distances + `moonPhaseDeg` (0 new/180 full) + `moonIllumination` (0..1). Recipe: `GeoVector`/
  `GeoMoon` (EQJ, AU) → `Rotation_EQJ_EQD` → rotate about +Z by −GAST (`SiderealTime(t)·15°`).
  Sign convention verified 3 ways vs library's own terra()/Horizon() + JPL Horizons (≤0.0007°).
- **TRAP:** `MakeTime(number)` = J2000 DAYS, not epoch ms — always `MakeTime(new Date(ms))`.
- `horizontal(body, utcMs, lat, lon)` = topocentric az/alt (of-date + parallax, airless) — the
  almanac-checkable face; tests assert JPL Horizons rows (Dnipro solstice noon 179.13°/64.97°) at
  0.05°. Moon geocentric-vs-topocentric parallax ≤ ~1° (fine for scene: moon impostor direction is
  computed camera-relative from the true position anyway).
- `test/lib/ephemeris/bodies.test.ts` — 9 tests incl. subsolar-lat-at-solstice = tropic check.

## Scene time
- `store/time.ts`: `{ timeMs, live, setTime(pin), goLive }` + `sceneTimeMs()` helper. LIVE mode
  reads Date.now() — the store is NOT written at 60 fps; Phase-4 scrubber just calls setTime.
- Orchestrator re-samples ephemeris when |sceneTime − lastSample| > SKY.sampleIntervalMs (1 s;
  sun drifts 0.004°/s). ONE sample pushes: earth uSunDir/uMoonDir/uMoonGlow, ground uFtwSun/
  uFtwMoonDir/uFtwMoonGlow, atmosphere uSunDir, GlobeCanvas DirectionalLight, sky module.
- `panels/TimeReadout.tsx` + `styles/time-readout.css`: bottom-right mono HUD — local clock,
  LIVE/PINNED pill (accent/warn dot), date · UTC · moon glyph+%. DEV: `window.__timeStore`.

## Sky bodies (`scene/sky.ts`)
- Both bodies are camera-anchored impostors at `clamp(far·0.5, near·1.2, far·0.95)` — **CLAMP IS
  LOAD-BEARING**: looking AWAY from earth, GlobeControls fits near to ~13,000 km and an
  unclamped 0.5·far impostor near-plane-clips (bug found live). True apparent size:
  scale = d·tan(angularRadius); sun ≈0.263°, moon from real camera→moon distance.
- Sun: billboarded plane ShaderMaterial, additive — limb-darkened HDR core (×SKY.sunIntensity 5,
  > BLOOM.threshold → bloom carries the wide glow) + tight exp halo. tokens.sunCore/sunGlow.
- Moon: SphereGeometry + custom shader `albedo·(earthshine + pow(N·sunDir,0.8)·brightness)` —
  phase from the REAL sun direction for free; scene lights can't wash the dark limb (that's why
  NOT Lambert). Texture `public/textures/moon-color.jpg` (NASA CGI Moon Kit LROC 1k, sRGB);
  near side (+X of sphere UV) aimed at Earth, pole ≈ ECEF +Z (roll unrefined — invisible at 0.5°).
- moonLight DirectionalLight = tokens.moonlight × SKY.moonKeyIntensity(0.3) × illumination;
  earth/ground shaders get matching `uMoonGlow = SKY.moonSceneGlow(0.35) × illumination` night term.

## Bloom (GlobeCanvas)
- EffectComposer with **custom RT: HalfFloatType + samples:4** (default samples 0 would alias the
  building edge lines) → RenderPass → UnrealBloomPass (BLOOM 0.4/0.5/0.9) → OutputPass. Renderer
  keeps SRGBColorSpace + NeutralToneMapping — OutputPass reads them; materials are auto-untonemapped
  inside RTs (r185). Resize: `composer.setSize(logical px)`. Night floors dropped: EARTH 0.32→0.22,
  GROUND 0.45→0.38 ("night more pronounced"); SUN.hemiIntensity 0.4→0.25 (moonlight carries fill).
- CAVEAT: photo-frustum `toneMapped:false` is a no-op under the composer (whole buffer tonemapped
  by OutputPass). Neutral ≈ identity below ~0.8 — mild; revisit if photo fidelity complaints.

## Real terrain (`scene/imageryGround.ts` REWRITTEN)
- Cesium World Terrain (ion asset **1**) quantized-mesh + Esri imagery overlay, replacing the
  smooth-ellipsoid GeneratedSurfacePlugin drape. Plugin order (priority matters):
  `CesiumIonAuthPlugin({assetId:"1", autoRefreshToken, assetTypeHandler})` — QuantizedMeshPlugin is
  registered INSIDE assetTypeHandler on 'TERRAIN' (**NEVER up-front**: its priority −1000 would
  fetch layer.json before the ion endpoint resolves) → own unlit-swap plugin (priority −100:
  MeshStandardMaterial → per-tile MeshBasicMaterial, disposed on dispose-model) → TilesFadePlugin →
  UpdateOnChangePlugin → ImageOverlayPlugin({renderer, resolution 256, overlays:[XYZTilesOverlay
  Esri z19]}) (wraps at −15, composites into diffuseColor after color_fragment).
- Grade re-anchored `map_fragment` → **`alphamap_fragment`** (after the overlay composite) and
  half-lambert now uses the REAL surface normal (`vFtwN = mat3(modelMatrix)·normal`) — slopes
  shade, mountains read; terminator still continuous with the base. + moonlight night term.
- Buildings: 90 m sink REMOVED (OSM Buildings are clamped to CWT = the same terrain now rendered);
  verified seated at Dnipro. `terrainHeightAt(lat,lon)` = down-raycast from +12 km (QueryManager
  pattern); Dnipro fine-LOD = 93.8 m (≈ the old hand-tuned sink!) but **coarse-LOD reads garbage
  (−453 m at LEO)** — consumers must tolerate refinement.
- ES tile version warning in console ("tiles versions at 1.1+ limited support") is benign.

## Shadows (sun-driven, city scale)
- GlobeCanvas: shadowMap.enabled, **default PCFShadowMap** (PCFSoft deprecated r185; VSM would drag
  huge receivers into the depth pass). Rig on the ONE sun light: mapSize 2048², ortho ±2.5 km,
  near/far = lightDist(8 km)±3.5 km, bias −2e-4, **normalBias 1.0 (world-m — the float32@6.4e6
  acne killer)**, radius 3. `scene.add(sun.target)` REQUIRED (matrixWorld).
- Orchestrator per frame: focus = camera-forward ray→ellipsoid; gate = alt < SHADOWS.maxAltM(30 km)
  AND sunDir·focusUp > 0.03 (sun up at focus — below-horizon sun projects garbage). Ungated mode
  keeps direction-only (position = sunDir·1e7, target origin).
- Buildings cast+receive (flags set per-mesh on load-model — tiles arrive false).
- Ground receive: **ShadowMaterial twin per terrain tile** (same geometry, child of tile mesh,
  polygonOffset −1, raycast noop, visible-gated by altitude, geometry owned by tile). **KEY
  DEBUG LESSON:** the twins worked from the start — black @0.35 over the near-black graded ground
  is imperceptible; proven by an opaque `getShadowMask()` visualization (crisp bands) and a
  mask-driven red overlay. groundOpacity now 0.55; shadows read best at low sun. Don't re-debug
  the pipeline — debug CONTRAST first.

## Photo-frustum altitude semantics (D4, changed with terrain)
- `PhotoFrustum` gets `terrainHeightAt` + `resnap()` (orchestrator calls every 120 frames; re-seats
  as tiles refine, keyed by placement so re-place never inherits stale height).
- **EXIF-provenance altitude = ABSOLUTE ellipsoidal height**, clamped ≥ terrain + eyeHeight
  (geoid/GPS noise buries otherwise). MANUAL/MISSING = metres above the RENDERED ground.
  Fixture verified: apex 96 m ell ≈ 2.2 m above the 93.8 m terrain (was floating 96 m before fix).

## Tunables added (tuning.ts)
SKY (moonTexture/sampleIntervalMs/impostorFarFrac/sunGlowExtent/sunIntensity/sunGlowGain/
moonBrightness/moonEarthshine/moonKeyIntensity/moonSceneGlow) · BLOOM (strength/radius/threshold/
msaaSamples) · SHADOWS (maxAltM/mapSize/boundsM/lightDistM/depthMarginM/bias/normalBias/radius/
minSunElevSin/groundOpacity) · TILESETS.terrainAssetId "1" · GROUND.overlayResolution 256.
Tokens added: sunCore #FFF3D9 · sunGlow #FFD9A0 · moonlight #BFD0E8 (tokens.css + bridge).

## Moon/sun horizon occlusion + soft adaptive loading (2026-07-10 owner pass)
- **Impostor occlusion is ANALYTIC, not depth.** The camera-anchored impostors sit at a FAKE
  distance (0.5·far) — the earth's limb is usually FARTHER, so the depth buffer drew the moon
  THROUGH the planet. Both impostor shaders (scene/sky.ts) now compute per-fragment the view ray's
  closest-approach altitude vs the earth (atmosphere math; `tc<=0 → visible` guards zenith-at-street
  -level) and fade across SKY.horizonFadeBandM (40 km) — bodies melt into the horizon haze. Moon
  material transparent (alpha=fade) with `discard` at fade<0.004 (a hidden disc must write NO depth
  or it punches a hole in the starfield — depthWrite stays on otherwise: the moon BODY occludes
  stars). moonBrightness 1.8, earthshine 0.1. Verified at scrubbed pinned times: h=+614 km disc,
  +18 km ghost in haze, −1469 km gone (verify-shots/uifix-07..09).
- **Soft loading (imageryGround)** — the 0.4.28 defaults that caused the patchy first load:
  fadeRootTiles=false (coarse tiles POP), maximumFadeOutTiles=50 + camera moving >0.1 u/frame →
  `completeAllFades()` SNAP (idle drift moves ~140 m/frame → always "moving"), QuantizedMeshPlugin
  pins errorTarget=2 at init (deep refinement = long patchy window at LEO), failed Esri overlay
  fetches never retried, and uFtwFade snapped to 1 on frame 1 (page open alt 1100 km < fadeBottom)
  over ZERO loaded tiles. Now: TilesFadePlugin{fadeRootTiles:true, 700 ms, max 300}; reveal =
  altFade × readiness low-passed (τ 600 ms), readiness = loadProgress×0.85 until first
  `tiles-load-end` then 1, gated on `tiles-load-start` (**loadProgress reads 1 BEFORE any
  request**); adaptive `tiles.errorTarget` 2↔12 across 60 km↔1200 km alt (set per-frame in
  ground.update, AFTER QuantizedMeshPlugin's init); `uocPlugin.needsUpdate=true` until initial
  load ends (reduced-motion would stall refinement — UpdateOnChangePlugin short-circuits static
  cameras); `resetFailedOverlays()` debounced 8 s on `load-error`. All knobs in GROUND.
  Page open verified: 1 s clean base → 3 s one soft dissolve → settled ~6 s (uifix-01..04).
- Buildings still hard-pop: ONE shared styleMat can't ride TilesFadePlugin (fades are per-tile
  material) — needs per-tile material clones if ever faded. Playwright MCP wedged this session →
  scripted verification via scratchpad `playwright-core` + system Chrome (channel:"chrome").

## Phase-4 remainder: scrubber + golden hour + BSC5 stars (2026-07-10, browser-VERIFIED)
- **TimeScrubber** (`panels/TimeScrubber.tsx` + `styles/time-scrubber.css`): ±12 h rail around an
  anchor; drag → `setTime`; NOW/dblclick/Backspace → `goLive`; release at a rail end recentres
  (multi-day walks). Pure window math (`timeToFraction`/`fractionToTime`) exported from
  `store/time.ts`. Layout: fluid middle band (`left:32rem; right:16rem; margin-inline:auto`) —
  never overlaps hero/readout. TRAPS: the drag flag MUST be a useRef (React state doesn't flip
  between same-tick pointer events — synthetic/fast drags scrub nothing) and wrap
  set/releasePointerCapture in try/catch (synthetic pointerIds throw).
- **capturedAt seeding**: on upload phase → "placed", pin scene time via
  `lib/ephemeris/captureTime.ts capturedAtToUtcMs(stamp, lonDeg)` — TZ-naive EXIF read as SOLAR
  time at placement longitude (offset = round(lon/15) h; v1 choice, ≤1 h vs civil DST). Verified
  exact in-browser: 18:42:17 @ 35.05°E → 16:42:17Z.
- **Golden hour (D6/D14)**: ONE bell over sin(sun elevation), knobs in `tuning.GOLDEN`
  (−8°→−1° in, hold →+7°, out by +16°; castGain 1.15). Per-fragment GLSL twins in
  baseEarth (dot(N,sunDir)) + ground grade (dot(nS,uFtwSun)) + atmosphere line (2·sun−1 IS the
  same sine at the ray's closest approach); JS twin `lib/ephemeris/golden.ts goldenFactor` drives
  the building key light: `sunLight.color.lerpColors(white, tokens.goldenHour, bell(sunDir·focusUp)
  × keyStrength)`. Focus ray HOISTED out of the shadow gate in StylizedTiles — computed every
  frame, falls back to sub-camera up when the forward ray misses the planet. Verified: warm band
  hugs the dusk terminator at LEO; key light #ffc790 at 18:42 solar city view; cold at noon/night.
- **BSC5 stars (D6)**: `scripts/build-star-catalog.mjs` (run once, needs network) bakes
  brettonw/YaleBrightStarCatalog bsc5.json (MIT, SIMBAD-checked) → `public/data/bsc5.bin` —
  LE float32 [x,y,z,vmag,bv]×9,096 (177.7 KB; BV_SENTINEL 9.99 × 310). `lib/ephemeris/stars.ts` =
  parse/raDecToUnit/magToSize/magToBright (Pogson softened: sizeGamma 0.35, brightGamma 0.6,
  brightMin 0.55 — below ~0.5 a 1.5 px point is INVISIBLE at DPR 1, tuned across 3 shots).
  `scene/stars.ts` fetches async (procedural field stays as pre-load/offline fallback), swaps
  geometry, sets `points.rotation.z = −gastRad` (equatorial → ECEF; star at RA=GAST lands on lon 0
  — round-trip unit test). `bodyStatesAt` now returns `gastRad` (almanac test: 280.46° @ J2000).
  B-V colour tint NOT used yet (baked for later).

## Pre-Phase-5 fix batch (2026-07-10, browser-VERIFIED — shots prephase5-01..11)
- **Narrow terminator**: half-lambert `wrap²` shading REPLACED in baseEarth + ground grade (GLSL
  twins — keep in sync): `dayK = smoothstep(EARTH.termBand[0], [1], sunDot)` over sin(sun elev)
  [−6°, +3.2°] ≈ the real ~9° twilight zone; day side keeps `mix(EARTH.dayGradMin 0.78, 1,
  sqrt(sunDot))` so the sphere stays dimensional; city lights + moon night term use
  `EARTH.lightsBand` over the SAME sine (nightBand deleted). Earth rim scattering now × mix(0.25,1,dayK).
- **High-alt patchwork (owner screenshot)**: mixed Esri source zooms (washed low-zoom mosaic vs
  crisp z-detail) read as patches once imagery fully owned the frame. GATES fade band 2.6e6/1.4e6 →
  1.6e6/650e3 (Blue Marble owns high orbit; LEO 1100 km = ~0.53 dither mix) + `uFtwHiAlt = 1−altFade`
  lerps desat → GROUND.hiAltDesat 0.88 (tone convergence). Residual contrast settles as tiles refine.
- **Low-altitude sky regime** (tokens skyDay/skyHorizon; ATMOSPHERE.sky*): in the SAME atmosphere
  shader, `skyK = 1−smoothstep(skyFullAlt 12 km, skyGoneAlt 120 km, uCamAlt)` blends the limb model
  into: zenith mix(skyHorizon→skyDay, pow(sinEl, 0.55))·0.85·dayK + horizon haze `exp(−sinEl/0.1)`
  (+ `exp(sinEl/0.08)` below horizon = aerial perspective over DISTANT terrain — near geometry
  depth-occludes the dome) golden-warmed by the GOLDEN bell over sun elev; black at night. dayK =
  smoothstep(−0.12, 0.12, sinSunElev).
- **TRAP — dome re-anchor**: below ATMOSPHERE.domeMaxAlt (350 km) the earth-centred shell's visible
  hemisphere is PAST GlobeControls' tight far plane (street level far ≈ 300 km, shell overhead ≈
  630 km). The shader shades by ray DIRECTION only ⇒ update() re-anchors the SAME mesh to
  camera.position at scale 0.45·camera.far, uInside forced 1 — swap is pixel-identical. Atmosphere
  is no longer gated by GATES.decorMinAlt (graticule still is); update signature is (camera, alt).
- **Stars at night at any altitude**: stars.update takes `sunDir`; fade = max(altFade,
  nightFade) where nightFade ramps over sin(sun elev) STARS.nightVisStartSin −0.02 → nightVisFullSin
  −0.14. Verified at 5.7 km w/ sun −10°: stars + city lights.
- **Milky Way (real coords)**: `lib/ephemeris/stars.ts galacticToEquatorial(l, b)` — IAU J2000 NGP
  (RA 192.85948°, Dec 27.12825°) + GC (266.405°, −28.93617°), Gram-Schmidt basis, unit-tested vs
  both anchors; `milkyWayField(MILKYWAY)` = 14k points, gaussian σb 8.5° + 20%×2.5σ halo, Sagittarius
  bulge via rejection sampling. Rendered as a CHILD Points of the star sphere (inherits −GAST
  rotation + camera-follow + scale); star shader extracted to `makeStarMaterial` factory.
  **TRAP (2nd time — see STARS.brightMin)**: sub-pixel points (0.6–1.7 px @ DPR 1) often cover NO
  pixel centre → rendered literally nothing; MILKYWAY sizeBase/spread 2.2 + alpha 0.25 = subtle veil.
  Live-tune trick: uFade is overwritten per frame — tune via uColor/uDpr uniforms instead.
- **Photo plane preview transparency**: planeMat transparent, opacity = store/upload.planeOpacity ??
  FRUSTUM.planeOpacity (0.7); PLANE ALPHA slider in PhotoDetailPanel (setPlaneOpacity(undefined) =
  back to default; cleared on `clear()`). FLIGHT arrival retuned backFactor 4.2 / liftFactor 0.45
  (~5° depression — near-horizontal, landscape behind the photo reads).

## Owner batch #2 (2026-07-10, browser-VERIFIED — shots prephase5b-01..10)
- **Multiday scrubber**: `store/time.ts` `localDateStr(ms)` + `withLocalDate(ms, "YYYY-MM-DD")`
  (LOCAL time-of-day preserved; null on malformed input) + `<input type="date">` in the
  TimeScrubber header (`.ts-date`, `color-scheme: dark` for the native popover). Picking a date
  pins + recentres the ±12 h rail. Ephemeris exact at any epoch — verified subsolar lat −23.44°
  on a 2026-12-21 jump, moon phase 21%→91%. offsetLabel: round minutes FIRST then carry (old
  per-unit rounding printed "+3936 h 60 m"); ≥1 day shows "±N d H h".
- **Shadows "crisper"**: mapSize 4096 · boundsM 1600 (0.78 m/texel) · radius 2 · groundOpacity
  0.75 · ShadowMaterial tinted tokens.water (cool shadow reads on the dark grade; pure black
  melts). LESSON (2nd time): the mask is always correct — debug CONTRAST first (red-mask trick:
  set ShadowMaterial color red / opacity 1 via scene.traverse). Hard ceiling: shadow contrast ≤
  the graded ground's own luminance (dark palette) — further "crisper" asks need a brighter
  day-ground grade, not shadow-rig work.
- **Esri patchwork ROOT CAUSE (owner screenshot #2 — persistent ⇒ not loading)**: the blobs are
  regional mosaic seams + atmospheric haze baked into Esri World Imagery's low/mid-zoom levels.
  No retry/harmonizer fixes that. Kill: fade band 750e3/380e3 + errorFarAlt 750e3 — Blue Marble
  owns >750 km (default LEO = zero Esri, spotless), Esri only below where source zooms are
  detailed. 517 km mid-band verified coherent.

## UNVERIFIED / carried
- Moonlight visual on night buildings (code-wired; not isolated in a shot — moon was 22%).
- Terrain memory/perf at street level (CWT errorTarget 2 + z19 overlay splitting) — profile later.
- Esri imagery via ImageOverlayPlugin looks slightly softer at grazing angles than the old direct
  `map` path (256² per-tile composites; knob = GROUND.overlayResolution).
- `wix build`/release with astronomy-engine bundle (~47-49 KB gz worst case) — build was green.
- Screenshots rule: ALL browser-verification screenshots → `verify-shots/` (git-ignored, rule in
  .claude/CLAUDE.md); this session's pile lives there (prephase4-01..18).
Related: [[patterns/globe-rendering]] [[patterns/photo-frustum]] [[decisions/adr-000-locked-stack]]
