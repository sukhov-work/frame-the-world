# wip 2026-10-13 — the sticky collision box · the lighting pass (soft shadows, brighter scene) · building colour triage — IN PROGRESS

Mode: implement, Deep (`/frame` under investigate-design-v3; four parallel research agents at boot). Owner order 2026-10-13 (three asks):
1. FPV collision: no bounce. Descending onto a mesh snaps the eye metres back up (speed-dependent); ascending from below likewise.
   Want: a human-sized box (~0.5 × 0.3 × 2 m, eye at 1.7) that STICKS to surfaces; a box already intersecting geometry, or hitting a
   side, keeps moving UP (scale buildings gracefully). Never clip.
2. Lighting: shadows too deep/contrasty even at noon (ULTRA + regular, desktop + mobile); the whole scene too dark and dull — ground tiles,
   buildings, user meshes (custom textures dim). Want realistic, soft, pleasant light + colour; cheapest nicer option; no GTAO; NO regression
   of the shadow / progressive / mobile optimisation work. Screenshots: Dnipro 48.470991, 35.053172 (~/Desktop/Screenshot 2026-10-13 at 22.29.*.png).
3. Building colour (triage, new experimental): colour non-user meshes from the map tiles below or another mechanism so buildings are
   distinguishable in close city views; colours not textures; pre-bake only if beneficial (Dnipro bake exports are the priority);
   advanced story = street photo projected onto the geometry. Deliver (a) a generic quick way, (b) a design for the photo flow.
Verification owed: Chrome harnesses AND the farm (the farm tests the LIVE site → after a release).

Records (to fill at exit): DECISIONS 2026-10-13 · NSP · backlog rows · this leaf.

## Status
- Boot: SHIP_ATTENTION absent, tree clean on master at 234b749 (v1.36.26 live).
- Research agents done (collision mechanics · lighting ledger · building colour · three.js r185 facts).

## Ask 1 — THE STICKY BOX (built; `lib/globe/fpvClearance.ts` v2 + `StylizedTiles.stepFpvMeshFloor`)
MEASURED before the fix (probe `scripts/probe-fpv-bounce.mjs` + scratch variants, house Chrome :9333): a SLOW encoder descent onto a 20 m
test box threw the eye **+19.9 m in one frame** the moment the feet came within `meshStepM` (0.35) of the roof — the 2026-09-22 "standing"
acquisition re-based `fpvEyeM` from terrain- to roof-relative without preserving the eye; a FAST descent skipped the band → the `inside`
snap (eyeM reset to 1.7) masked it = the owner's "depends on speed". Also found: the ELEVATOR (hovering over a roof and walking over a
taller one lifted the eye by the difference), the DIP (rising past the column's 400 m reach eased the eye 20 m down), the slab SAWTOOTH
(rising into an underside snapped onto the deck / oscillated), walls undetected (the eye crossed the wall plane and climbed from inside).
THE MODEL: a box (feet = eye − 1.7, head = eye + 0.3, footprint ±0.25 × ±0.15 in the walk frame). `boxClearance(columns, {eyeM, bodyM,
headM, preStepHits})` → {inside, climbToM, wallTopM, floorM, ceilingM}; `stepStickyEye(state, in)` is the per-frame vertical authority:
eye = (refAbsM ?? baseAbsM) + eyeM; a reference change while HOVERING is eye-preserving, while STANDING the feet follow (fall eased τ 200,
step/climb glided τ 160 + min 4 m/s); landing = a clamp; a head-only overlap = a ceiling clamp (never a climb); the SWEEP while walking
(the centre column at the pre-step position + the two leading corners post-step): a solid entered by the step is a WALL → the step is
reverted (no clip) and the box climbs the wall; a CLIMB LATCH finishes the climb if the input stops and holds at the top edge until a step.
Tunables: `FPV.meshBoxHalfWidthM 0.25 / meshBoxHalfDepthM 0.15 / meshHeadM 0.3 / meshClimbTauMs 160 / meshClimbMinRateMps 4` (+ the old
column reach / stepM / fall τ). The column skips hidden objects and the OSM twins inside the enriched mask. DEV: `__globe.fpvTestSolid(lat,
lon, hM, sizeM, baseOffsetM, name)`, `__globe.fpvClearance()` adds refAbsM/climbing/blocked/blockedFrames/cols.
Gates: `test/lib/globe/fpvClearance.test.ts` 35 · harness `verify-fpv-collision-2026-10-13` (legs A–H + D2) · the 2026-09-22 carry
harness adapted (`blockedFrames`), 29/29. Cost: 4 columns while walking ≈ 6.5 ms/frame on the throttled headless twin (1 column ≈ 1.3 ms there).
Traps met on the way: (1) a 0.15 m box depth cannot catch a 0.4 m step — the SWEEP (pre-step centre) is what detects walls at any speed;
(2) "inside" must need the pre AND post columns to overlap, or walking off an edge re-climbs the roof as the feet drop (the pre column is
still over it); (3) the encoder writes next frame's eye before the ceiling clamp can answer — a head-only overlap is a ceiling, else a
3 m sawtooth under a slab; (4) a reached wall target must HOLD (returning into the floor logic fell and re-climbed, a 2 m sawtooth);
(5) the climb latch must be evaluated BEFORE the authority step.

## Ask 2 — THE LIGHTING LEDGER (research done; implementation next)
Baseline probe `scripts/probe-lighting-2026-10-13.mjs --label before` (verify-shots/lighting/before-*.png + before-ledger.json; owner pose
48.470991,35.053172 at 12 Oct 15:03 local): the ground-and-buildings band p50 = 65 (dark) / 28 (SAT) at pose 1, **36 % of pixels < 12/255
and 79 % < 30** at the owner's second pose, base and ULTRA identical at noon. The three crushers (lighting agent, three.js agent, all cited):
(1) the ground shadow twin (`DRAPE.shadowOpacity` 0.8 / `SHADOWS.groundOpacity` 0.75) removes 75–80 % of a composite whose direct share is
~23 % at a 34° sun (lit:shadow ≈ 7× after the tone map; real ≈ 4–6×, pleasant ≈ 3×); (2) the hemisphere fill (`SUN.hemiIntensity` 0.32,
sky = `tokens.landHi` sage) is 4–5× too weak vs the key and sage-coloured — a shadowed textured user model = 0.005 linear → black;
(3) `NeutralToneMapping`'s black offset (−0.02…−0.04 linear) is regressive on exactly these darks (−67 % on the shadowed drape).
Buildings: `tokens.surface` albedo lum 0.0078 → the sun is ~20 % of a lit face, the emissive 75 % → no shading possible at any light
level; only a brighter fill (day) can show shading / colour. three facts: received shadows scale the DIRECT term only (raising the hemi
= lighter, bluer shadows, free); PCFSoft is coerced to PCF in r185 (radius honoured, per light, live); `ShadowMaterial.color` can be a sky
tint; `scene.environment` from a 64 px 2-colour PMREM ≈ 1.4 MB, ~3 fetches/fragment, mobile-safe — the cheapest "PBR looks alive" for
user models; a shadow-only sky fill injection at `aomap_fragment` is 1 MAD. Rulings to respect: no flat direction-blind night fills
("milky", 2026-09-10b), no emissive brightening ("painted", 2026-07-13), ACES/AgX rejected (cyan). `lookOn()` is TRUE on every rig
(`ULTRA.baseTakesLook`) so noon base = ULTRA; `hemiTrackUp` is live on the base (AB2 de facto settled).
PLAN: keep Neutral; lower the sun ground-shadow opacity to ~0.5 (moon stays 0.75 — no sky fill at night; re-pin `moonlightTerrain.test`
:108); sky-tint the shadow twin; hemi 0.32 → ~0.75 with a sky-coloured top (`tokens.skyHorizon` × k) + a warm-dark ground half; a DAY
building fill (a new token, light warm grey, lerped to `tokens.surface` by `uFtwNight` so the owner-verified night look is kept) with
the emissive dropped by day; PCF radius 2 → 3; `scene.environment` 2-colour PMREM (flagged); `DRAPE.gain` 1.6 → ~1.9, `ambientDayK`
0.1 → ~0.14. Verify: the probe's after-ledger + the pose-catalogue sweep + the pinned harnesses (`verify-ultra`, `verify-ultra-dusk`,
`verify-rendering-charter`, `verify-s5-night`:166 pins `keyIntensity` 1.5 — unchanged).

## Ask 2 — BUILT (2026-10-13): the values + the after-ledger
`SUN.hemiIntensity` 0.32 → 1.2 (+ `hemiSkyK` 0.8 × skyHorizon, `hemiGroundK` 0.6 × land) · `SHADOWS.groundOpacity` 0.75 → 0.6 +
`groundTintSkyK` 0.04 · `radius` 2 → 3 · `DRAPE.shadowOpacity` 0.8 → 0.65 · `DRAPE.gain` 1.6 → 1.9 · `GROUND.ambientDayK` 0.1 → 0.14 ·
`tokens.buildingDay` #B8B4AC (+ `--color-building-day` in tokens.css — the parity test) lerped to `surface` by `uFtwNight` in
`buildingMaterial.ts` + `BUILDINGS.dayEmissiveK` 0.2 · `GOLDEN.keyStrength` 1.0 → 0.6, `keyBrighten` 0.35 → 0.25 (full strength painted
the light fill pumpkin-orange at 16:47) · `MODELS.envIntensity` 0.3 = a uniform 16 px PMREM (`GlobeCanvas.makeUniformEnvMap`) on the
user models' own MeshStandardMaterials (`attachUserModels({envMap})`) · `RENDERER.toneMapBlackOffsetK` 1 (wired: a Custom tone map =
Neutral with the offset × k; UNUSED — the inputs fixed it; T162). After-ledger (`after-k1b`): owner2 black<12 36 % → 0 %, dark<30
79 % → 4 %, p50 17 → 87; owner1 dark p50 65 → 91, SAT 28 → 49; ULTRA identical at noon. Screens: `verify-shots/lighting/after-k1b-*.png`.
Re-pinned: `duskShadeRatio` (0.263/0.219 → 0.323/0.229; the cliff > 6 → > 5; lo/hi 1.1–1.2 → 0.85–0.95), `moonlightTerrain:108`
(moon ≥ sun now), `heatPalette` parity (the css token). The FPV "olive walls" at street level are the FPV ghost dither mixing the grey
facade with the green ground behind — existing behaviour. Harness chain (s5-night PASS; ultra / ultra-dusk / charter / the sweep —
see DECISIONS for the results).

## Ask 3 — BUILDING COLOUR (triage done; rung 1 SHIPPED: `BUILDINGS.hueVariation` 0.22, a warm↔cool per-building wobble on the day fill;
the design `rendering/BUILDING_COLOUR_TRIAGE_2026-10-13.md`; backlog T157 photo spike · T158 rung-2 bake · T159 rung-3 licence)
Data: OSM `building:colour` 0.74 % / `roof:colour` 1.1 % / `building:levels` 13 % of Dnipro's 128,649 footprints; `building=*` is 50 % `yes`.
Esri World Imagery terms (E204 §3.2.c/§3.3.b, E300 fn 10) forbid a bake-time bulk sample; a transient client-side read of the composite
the browser already shows is defensible but must never persist. OSM2World honours colour tags but the bake sets `useBuildingColors=false`
and drops COLOR_0. Carrier ranking: a per-cell palette `DataTexture` indexed by `_feature_id_0` (zero wire bytes, one material) > a
`_ftw_palette` float attribute > `vertexColors` (a missing `color` attribute renders BLACK on MeshStandardMaterial — three only loads
`defaultAttributeValues` for ShaderMaterial). Photos (b): prototype with `SpotLight.map` + its shadow map (projective + occlusion, zero
material surgery); the real path is a ≤4-projector uniform block with an RTC-safe matrix; risks: registration vs LOD1 boxes (77 % default
heights), ECEF float32. Rung 1 = a hash-keyed hue jitter in a restrained palette (needs the day fill from ask 2 to be visible at all).
