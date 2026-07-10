# mem:patterns/sky-bodies-terrain — ephemeris sun/moon + real terrain + bloom + shadows (pre-Phase-4, 2026-07-10)

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

## UNVERIFIED / carried
- Moonlight visual on night buildings (code-wired; not isolated in a shot — moon was 22%).
- Terrain memory/perf at street level (CWT errorTarget 2 + z19 overlay splitting) — profile later.
- Esri imagery via ImageOverlayPlugin looks slightly softer at grazing angles than the old direct
  `map` path (256² per-tile composites; knob = GROUND.overlayResolution).
- `wix build`/release with astronomy-engine bundle (~47-49 KB gz worst case) — build was green.
- Screenshots rule: ALL browser-verification screenshots → `verify-shots/` (git-ignored, rule in
  .claude/CLAUDE.md); this session's pile lives there (prephase4-01..18).
Related: [[patterns/globe-rendering]] [[patterns/photo-frustum]] [[decisions/adr-000-locked-stack]]
