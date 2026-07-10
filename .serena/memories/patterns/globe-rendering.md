# mem:patterns/globe-rendering — the organic LEO instrument (2026-07-10 overhaul + refactor)

How the globe is built. Browser-VERIFIED at LEO / orbit / night / mid-fade / city (Playwright).
All colour flows through `lib/theme/tokens.ts` (D14).

## Layout (2026-07-10 refactor — convention: `.claude/conventions/globe-tuning.md`)
- **`tuning.ts`** — EVERY tunable number, grouped + documented (SUN/RENDERER/POSE/GATES/DRIFT/
  CONTROLS/TERRAIN/TILESETS/EARTH/GRATICULE/ATMOSPHERE/STARS/BUILDINGS/GROUND/FRUSTUM/FLIGHT).
  Pure TS, no three, NO colours; re-exports WGS84_A/B from `lib/geo/projection` (the drifted
  duplicate is gone). `SUN.direction` is the ONE sun constant — earth shader + ground grade +
  GlobeCanvas's DirectionalLight all read it (the "must match" trap is dead).
- **`scene/{baseEarth,graticule,atmosphere,stars,buildings,imageryGround}.ts`** — one concern per
  module, idiom `attachX(scene, opts) → { objects/uniforms, update?(plainValues), dispose() }`.
  Modules own their full lifecycle; the orchestrator computes alt/dist ONCE per frame.
- **`scene/glsl.ts`** — `glf()` (JS number → GLSL float literal; GLSL ES rejects `float x = 2`)
  for baking tuning constants into shader templates, + the shared dither snippet. Runtime-animated
  values stay uniforms (defaults seeded from tuning; live-tweakable via `__globe.*Uniforms`).
- **`StylizedTiles.ts`** (~230 lines) — orchestrator only: camera pose, GlobeControls, idle drift,
  per-frame gates, flight + click-to-place wiring, `__globe` DEV introspection, try/catch frame.
- **`PhotoFrustum.ts` + `flight.ts`** — Phase 3 (see `mem:patterns/photo-frustum`).
Seed authority: PROJECT_SEED §2 — "cinematic low-earth-orbit angle… NOT messy half-baked semi-realistic
textures… stylized and adaptive with zoom". Design-canvas concepts that bind: halo ≈5% alpha (restraint),
oblique framing, idle drift pause-on-interaction resume-8s, "terrain resolves" on descent.

## Three altitude bands, no hard switches
1. **ORBIT** — base ellipsoid ShaderMaterial: NASA **Blue Marble JULY topo+bathy 5400²**
   (`/textures/earth-color.jpg`, eoimages record 73751 — December=73909 has a snow blanket, don't)
   mixed `uOrganic=0.58` over the sage duotone ramp (water/land/landHi/peak from mask+elevation);
   `uSat 0.5`, `uGain 0.55` keep it stylized-dark. + **VIIRS night lights** (`/textures/earth-night.jpg`,
   3600², record 79765) → `uCityLights #FFC36E` emissive: `li*li*2.1 * night * land`, night =
   `1-smoothstep(0.30,0.52,wrap)`. + normal-map relief (tangent frame from ECEF normal, pole-guarded)
   + in-shader day-side limb scattering (`uAtmTint` rim ×0.12×wrap) + hash dither (banding killer).
   **Colour maps = SRGBColorSpace** (real imagery); **mask/elevation/normal = NoColorSpace** (data).
2. **MID (3000→1400 km)** — imagery ground screen-door-dissolves in: `uFtwFade` 0 at 2600 km → 1 at
   1400 km (bayer discard, offset +2.0 vs TilesFadePlugin's grid). Same geography → reads as "detail
   growing out of the earth".
3. **CITY** — Esri imagery keeps refining to z19 under Cesium OSM Buildings (ion 96188).

## Imagery ground (2nd TilesRenderer) — SUPERSEDED 2026-07-10 (pre-Phase-4)
**The GeneratedSurfacePlugin ellipsoid drape below was REPLACED by real Cesium World Terrain
(quantized-mesh, ion asset 1) + ImageOverlayPlugin — see `mem:patterns/sky-bodies-terrain` for the
current pipeline (plugin order, unlit swap, grade re-anchor, shadow twins, 90 m sink removal).
Ephemeris now drives SUN.direction (static constant = first-frame fallback only). Historical notes:**

## Imagery ground (2nd TilesRenderer) [historical]
- `XYZTilesOverlay({ url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", levels: 19 })`
  + `GeneratedSurfacePlugin({shape:'ellipsoid', applyOverlayTexture:true})` + TilesFadePlugin +
  UpdateOnChangePlugin. Esri ToS for production = UNVERIFIED (hackathon-standard; revisit pre-release).
- Each generated tile = MeshBasicMaterial with overlay texture as `map` (GeneratedSurfacePlugin.js:138,400).
  On `load-model`: polygonOffset (buildings win ties), map.anisotropy = max, map sRGB, and **CHAIN
  onBeforeCompile — NEVER assign** (TilesFadePlugin's FadeMaterialManager already wrapped it; wrapFadeMaterial
  chains any previous, and my handler chains `prev(shader); mine(shader)`).
- Injected grade (shared `groundUniforms` object across all tile materials — one value drives the layer):
  desat 0.52 → gain 0.56 → cool cast (0.92,0.99,1.06) → **water darkening**: `smoothstep(0,.12, b-max(r,g))`
  → ×0.35 (Esri's bright seas → near-black palette water) → **same half-lambert sun shading as the base**
  (`uFtwNightFloor 0.5`) so the terminator is continuous across LODs. World pos via injected `vFtwW` varying.

## Atmosphere — ray-based, NOT fresnel (the "crude halo" fix)
- A fresnel rim peaks at the SHELL's silhouette; from LEO that detaches from the limb (floating band + gap).
  Instead: per-fragment `h` = view ray's closest-approach altitude (`tc = max(-dot(O,D),0); h =
  |O+D·tc| - Re`), glow = `uColor·exp(-h/60km)·0.8 + uColorDeep·exp(-h/240km)·0.3`, sun-modulated,
  dithered. Rays that HIT the planet (dmin < Re) get a faint blue air-wash (×0.045) instead — atmosphere
  between craft and ground.
- **CRITICAL: render the NEAR hemisphere.** GlobeControls fits camera.far to visible terrain (~3.9e6 m
  at LEO); the shell's far hemisphere sits at ~6.8e6 → frustum-clipped (glow invisible even at intensity 3 —
  same trap that once hid the starfield). `side: DoubleSide` + `if (uInside<0.5 ? !gl_FrontFacing :
  gl_FrontFacing) discard;` with `uInside = dist < atmosphere.scale.y` per frame. Shell at 1.1R.
- Tokens: `atmosphere #38E1D0` (tight line) + `atmosphereDeep #4A93D4` (broad haze + day-side scattering).

## Default POV + idle drift (the "spacecraft in LEO" feel)
- Cam geodetic (46.0N, 31.3E, 1100 km) → lookAt (53.2N, 41.3E, 0) via `WGS84_ELLIPSOID.
  getCartographicToPosition`; `camera.up = position.normalize()` (radial, no roll). Horizon dip at h:
  `acos(R/(R+h))` ≈ 31.5° at 1100 km; aim ~46° below horizontal → limb in top quarter of a 38° FOV.
- Drift: rotate position+up+quaternion about ECEF +Z by 0.0011°/frame (≈ISS angular pace); pause on
  pointerdown/wheel/touchstart, resume after 8 s (design spec); off when reduceMotion; only >400 km.
- NEVER test poses with spherical lat→ECEF math — geodetic vs geocentric lat differs ~21 km at 48°N
  (missed Dnipro entirely). In-page JS: N = a/√(1−e²sin²φ) form, or use the ellipsoid API.

## Stars
- Camera-centred unit sphere, scaled to `min(1.05·limbDist, 0.9·camera.far)` where `limbDist =
  sqrt(alt·(2R+alt))` — **NOT 1.05·alt**: from an oblique LEO POV the slant range to far terrain ≫ alt,
  and an alt-scaled sphere puts star specks IN FRONT of the ground (depth-tested additive points).
  Fade 250→700 km so they show at LEO and leave before street level.

## Gates + altitude
- `alt = WGS84_ELLIPSOID.getPositionElevation(camera.position)` — `position.length()-WGS84_A` is up to
  ~21 km off at mid-latitudes. Gates: ground <3000 km · fade band 2600→1400 km · decor (grid+atmosphere)
  >150 km · stars >250 km · drift >400 km.
- Base at WGS84×0.9997 (~1.9 km under) + polygonOffset(1/1); imagery at exact WGS84 in front.
- **Buildings (2026-07-10 design idiom — dark mass, lit edges):** styleMat = `tokens.surface` dark slate +
  flatShading + roughness 0.85 + emissive land×0.10 + DoubleSide + **polygonOffset 0.5/0.5** (own edge
  lines win the tie; bases still beat the ground's 1/1). Per-tile `EdgesGeometry(geom, 30°)` LineSegments
  added as mesh children on `load-model` (shared `edgeMat` = landHi @ 0.4, raycast noop); `dispose-model`
  disposes ONLY per-tile edge geometry — edgeMat/styleMat are shared, disposed once. Edge perf on dense
  metros UNVERIFIED.
- **Terrain float:** Cesium OSM Buildings are clamped to Cesium World Terrain → bases sit ~60–150 m above
  the ellipsoid-draped imagery. Interim fix: `tiles.group.position.addScaledVector(dniproUp, -90)`
  (`TERRAIN_SINK_M`, city-specific to the Phase-1 test city) until real terrain (QuantizedMeshPlugin) lands.
- **Adaptive halo:** `uOrbit = clamp((alt - 2.5e6)/6.5e6, 0, 1)` scales BOTH scale heights ×`mix(1, .1,
  uOrbit)` and blue-shifts the line `mix(atmosphere, atmosphereDeep, .2 + .5·uOrbit)` — outer orbit gets a
  thin elegant blue rim, LEO keeps the thick horizon haze. Night floors: base uNightFloor 0.32, ground 0.45.

## Renderer (GlobeCanvas)
`outputColorSpace = SRGBColorSpace`, `NeutralToneMapping` (ACES/AgX desaturate the accent). Scene lights
(key 1.5 at SUN_DIR + hemisphere fill) light ONLY the OSM tiles; earth+atmosphere are self-lit shaders.
SUN_DIR (5,2,4) must match GlobeCanvas's DirectionalLight; ephemeris takes over in a later phase.

## Verifying with Playwright
`wix dev` → localhost:4321. `window.__globe` (DEV only): camera/controls/tiles/ground/groundUniforms/
earthUniforms/alt(). Confirm buildings via resource entries `/b3dm/`, imagery via `/arcgisonline/`.
Night side: put camera over the Americas (sun (5,2,4) → day centered ~22E/37N). Attribution line lives
in `index.astro` (`© Esri · Maxar · Earthstar Geographics · © OpenStreetMap contributors`).
UNVERIFIED: drift pause via real pointer events; live-dive crossfade feel; mobile memory (2 renderers +
5400² textures); CORS/ToS under `wix release`.
## Camera feel (2026-07-10 owner pass — gradual verticality, eased zoom, inertia, tilt slider)
Root causes from GlobeControls 0.4.28 SOURCE (node_modules/3d-tiles-renderer/src/three/renderer/controls):
- "Snaps vertical on zoom-in" = `EnvironmentControls._setFrame` rotates the camera around the zoom
  point at FULL strength as the local up changes (GlobeControls forces `scaleZoomOrientationAtEdges`
  OFF while zooming in), and the whole wheel delta is consumed in ONE frame (`zoomDelta` reset each
  update — the class has NO zoom inertia; drag inertia exists via enableDamping/dampingFactor).
- All fixes live in the ORCHESTRATOR (StylizedTiles), no fork: (1) bank `controls.zoomDelta`, hand
  back `pending·(1-exp(-dt/CONTROLS.zoomSmoothTauMs))` per frame before `controls.update()`;
  (2) after update, if zoomStep>0, counter-rotate camera around `getPivotPoint()` by
  `slerp(identity, qUpSwing⁻¹, 1-CONTROLS.zoomTiltKeep)` (0.35 — keeps the approach oblique;
  zoom-out untouched, it runs `_tiltTowardsCenter`); (3) `controls.zoomSpeed` is re-read every
  update → altitude-brake it per frame (×zoomSlowFrac below zoomSlowAltM); (4) dampingFactor 0.28.
- POSE.target (57.3,46.9) ≈ 38° depression (was 47°) — more horizon/limb in the default frame.
- **Declination slider seam**: `store/camera.ts` (tiltDeg live mirror ≤5 Hz; targetTiltDeg request)
  + `panels/CameraTiltPanel.tsx` (board-04 Slider, docked above TimeReadout). Orchestrator glides
  with `controls._applyRotation(0, (pitch−target)·(1-exp(-dt/tiltEaseTauMs)), pivot)`.
  **Source-verified conventions:** pitch angle 0 = nadir, π/2 = horizon; `_applyRotation`'s +y
  pitches TOWARD nadir (newPitch = pitch − y); min/maxAltitude clamps applied inside; pitch =
  angle(localUp, camera +Z world) — camera +Z is BACKWARD. Glide cleared on arrival or canvas
  pointerdown (direct manipulation wins). DEV: `window.__cameraStore`.
- Verified (scripted Chrome): zoom 1100 km→1.7 km pitch 51→60° no snap, eased tail; slider
  20°→19.9°/70°→69.8°; fling coast 10.6°/6.2°/2.1° per 0.3/0.5/0.8 s.

## Manual heading/zoom sliders (2026-07-10 pre-Phase-5 batch)
- `store/camera.ts` now carries THREE live-mirror/target pairs (tilt / heading / zoom) + pure
  helpers `wrapHeadingDeg`, `headingDeltaDeg` (shortest arc), `sliderToAltM`/`altMToSlider`
  (log-mapped, CONTROLS.zoomMinAltM 120 → zoomMaxAltM 12e6); `clearAllTargets()` is what
  noteInteract calls (direct manipulation wins). Panel = CameraTiltPanel.tsx (3 board-04 sliders;
  ZOOM inverted: right = zoom IN).
- **Heading glide** = rigid rotation about the view-focus local up through the focus point —
  preserves tilt EXACTLY (verified 47°→119.4°, tilt frozen 51.21°). Sign: rotating the camera +θ
  about local up DECREASES compass heading → negate. **Zoom glide** = log-space exp approach,
  dolly along camera→focus (radial past the limb).
- **TRAP — one frame for glide + mirror**: heading measured at the controls pivot's up vs the
  camera-position up disagreed by 25° at LEO tilt (knob landed ≠ readout). Orchestrator now
  computes the view focus (forward ray → ellipsoid, fallback sub-camera point) ONCE per frame
  early; heading glide, its mirror, zoom dolly, shadow rig and golden key all share it.
- **TRAP — `controls.getPivotPoint()` returns NULL** when the centre-screen ray misses the planet
  (horizon views) and LEAVES THE OUT-ARG STALE — the tilt glide orbited a garbage pivot and flew
  the camera 8 km → 128 km. Always check the return value; fall back to the shared focus.

Related: [[architecture/system-overview]] [[decisions/adr-000-locked-stack]] [[patterns/design-system]]
