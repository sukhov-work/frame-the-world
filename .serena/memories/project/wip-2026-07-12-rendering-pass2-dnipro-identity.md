# wip 2026-07-12 — Rendering Pass 2 (Dnipro identity): R2+R3 SHIPPED, R4 design-and-defer

Mode: implement (investigate-design-v3) · Tier: Deep. Follows Pass 1 (code-complete). Owner: proceed
with Pass 2. Gates GREEN (LOCAL): astro check 0/0 · vitest 416 (+8 buildingNight) · wix build.
DECISIONS "2026-07-12 (Pass 2 R2+R3)" + "2026-07-13 (R3 wall-gate fix)".

## 2026-07-13 — OWNER FEEDBACK (browser, live): R3 "looks broken" → wall-gated + toned down
The owner ran it in the browser and screenshotted night Dnipro: **the building shader COMPILES + LINKS
(R3 emissive + R2 tone visibly rendering — the #1 correctness risk is now browser-VERIFIED PASS).** But
R3 looked broken: whole building ROOFS flooded solid saturated yellow, ~45% of buildings, at full
intensity — read as "buildings painted yellow", not lit windows. THREE causes → fix:
1. **Roofs glowed** (the main tell). FIX: gate the emissive to VERTICAL walls only. New world face normal
   `vFtwWNormal = mat3(modelMatrix) * objectNormal` (direction-only → float32-safe at ECEF scale, UNLIKE
   world position — a `dFdx(worldPos)` face normal would cancellation-explode at 6.4e6; the buildings
   tileset is NOT re-centered). `wallness = 1 − |normalize(vFtwWNormal) · uFtwUp|`, length-guarded
   (tile with no `normal` attr → objectNormal 0 → fall back to wallness 1, never NaN). `uFtwUp` = the
   view-focus geodetic up (`_focusUp`), now passed as `setNight(sunElevSin, up)`.
2. **Too intense**: `nightWindowGain 0.6 → 0.4` (0.6 also pushed lit R over BLOOM.threshold → bloom smear).
3. **Too many lit**: `nightWindowLitLo 0.55 → 0.7` (~45% → ~25% of buildings carry facade light).
Verified objectNormal is defined by `<beginnormal_vertex>` (meshphysical vert :33) before `<begin_vertex>`
(:40); modelMatrix is a built-in uniform. astro check 0/0 · vitest 416 green.

### 2026-07-13 (2) — wall-gate ALSO rejected → R3 turned OFF (nightWindowGain 0)
Owner re-checked: "sides of random buildings become constant yellow color" — the wall-gate just moved
the flat fill from roofs to walls. **ROOT LESSON: a FLAT per-building emissive fills whole surfaces with
a CONSTANT colour — it reads as "painted", never as lit windows, regardless of gate (roof→wall) or
intensity (0.6→0.4→…). There is no flat-emissive tuning that looks like windows.** → `nightWindowGain: 0`
(R3 OFF by default; the wall-gate/hash plumbing stays wired so a real pattern can drop in). **R2 (tone
variation) STAYS — not flagged, it's the genuine daytime massing win.** The proper R3 = a procedural
WINDOW PATTERN (a lit-window grid up the facades) — its own slice, and the CORRECT approach:
- Precision-safe local coords: the b3dm object-space `position` attribute is RTC-relative → SMALL →
  float32-safe. Height along world-up = `dot(position, objectUp)` where `objectUp = normalize(transpose(
  mat3(modelMatrix)) * uFtwUp)`; `fract(height / floorH)` → floor bands. A horizontal axis (e.g. another
  position component) → window columns → a grid. Combine with wallness + per-window random + night gate.
- This is iterative shader ART that NEEDS eyes-on tuning; I can't see it here → only attempt it in a live
  browser loop with the owner, or defer. Do NOT ship blind again (two misses: roof flood, wall flood).

## The crux (R2 metadata readability) — SELF-VERIFIED against node_modules, and REFRAMED
The doc flagged R2 as "PROBE readability FIRST — UNVERIFIED". Verdict: the b3dm batch id survives GLTF
load as `geometry.attributes._batchid` (legacy) or `_feature_id_0` (3D Tiles 1.1). Proven:
`three` GLTFLoader lowercases any non-standard attribute (`GLTFLoader.js:4806`; Draco `:1941/:1949`),
`_BATCHID`/`_FEATURE_ID_0` are NOT in its `ATTRIBUTES` map, `3d-tiles-renderer@0.4.28` never strips
attributes (zero `deleteAttribute`). three 0.185.0.
**Reframe (load-bearing): readability does NOT gate the code.** The vertex shader sums
`_batchid + _feature_id_0 + uFtwTileSeed` → correct for BOTH encodings AND degrades to per-TILE tone
when neither is present (three reads an unbound attribute as 0 — never errors). Browser only grades
granularity (per-building vs per-tile), never correctness. This is why R2 ships safely with no browser.

## SHIPPED — both ride the ONE shared fill material's existing chained onBeforeCompile (invariant intact)
### R2 per-building tonal variation (scene/buildings.ts)
- Vertex `<common>`: `attribute float _batchid; attribute float _feature_id_0; uniform float uFtwTileSeed;
  varying float vFtwBId;`; `<begin_vertex>`: `vFtwBId = _batchid + _feature_id_0 + uFtwTileSeed;`
  (plain varying, no `flat` — value is piecewise-constant per building triangle, GLSL1/3-safe).
- Fragment `<color_fragment>`: `diffuseColor.rgb *= mix(1-toneVariation, 1+toneVariation, ftwHash11(vFtwBId+11.0));`
  `BUILDINGS.toneVariation 0.12` (0 = byte-identical no-op comparator). Hash = `fract(sin(n*12.9898)*43758.5453)`.
- Per-tile seed: `let tileSeedSeq=0` → `const tileSeed=(tileSeedSeq++*0.6180339887498949)%1.0` (golden-ratio,
  no Math.random), written per-tile by the mesh's existing `onBeforeRender` next to the F1 birth stamp.
  Decorrelates tiles so b3dm batch ids that restart at 0 per tile don't repeat.
### R3 night facade/window emissive
- NEW pure `lib/globe/buildingNight.ts`: `smoothstep01` + `buildingNightFactor(sunElevSin, band)` =
  `1 - smoothstep01(band0, band1, sunElevSin)` over EARTH.lightsBand — the CPU twin of the earth/ground
  terminator (unit-testable unlike the shader). 8 tests (`test/lib/globe/buildingNight.test.ts`).
- `BuildingsHandle.setNight(sunElevSin)` → `uFtwNight.value = buildingNightFactor(...)`. Called from
  StylizedTiles `stepKeyLightAndShadow` (step 26): `buildings.setNight(sunDirW.dot(_focusUp))`.
- Fragment injects AFTER `<emissivemap_fragment>` (verified present in three 0.185 meshphysical;
  `totalEmissiveRadiance` declared :168, consumed :198): `totalEmissiveRadiance += uFtwWindow *
  (nightWindowGain * uFtwNight * lit)`. `uFtwWindow = new THREE.Color(tokens.cityLights)` (warm sodium,
  LINEAR uniform — same as earth's uCityLights). `lit = smoothstep(nightWindowLitLo 0.55, Hi 0.95,
  ftwHash11(vFtwBId+71.0))` gates WHICH buildings glow (decorrelated hash) — "city alive at night",
  not a light box. `nightWindowGain 0.6` (0 = off).
### Tiering / invariant
- Both are FREE fragment math (no pass, no texture) → NO new QUALITY field. They degrade with the
  EXISTING bloom tiering: bloom-off `low` tier → windows read as flat warm colour, no glow. quality.test.ts
  still locks the perf invariant (416 green). Edges (edgeMat) stay the uniform lit stroke (fill only).
- Shader-anchor safety (silent-no-op risk): all 6 injection points source-verified present in three 0.185
  (`<common>`/`<color_fragment>`/`<emissivemap_fragment>`/`<dithering_fragment>` frag; `<common>`/`<begin_vertex>` vert).

## R4 DECISION = DESIGN-AND-DEFER (its own slice, evidence-backed; matches the doc sequencing)
Bespoke L-effort S3DB geometry (NO drop-in three.js roof lib — OSM Buildings/Streets.GL are whole
engines; `straight-skeleton` = single-maintainer WASM CGAL hobby wrapper) + net-new Overpass->public/data
bake (85,802 bldgs / 2,568 roof:shape / 1,766 building:part; ~sub-MB packed; precedent build-ne-labels.mjs)
+ the CRUX BLOCKER: reconstructed roofs z-fight the streamed Cesium LOD1 prism; culling the prism
per-footprint needs a batch-id->OSM-id map + per-building sub-mesh culling the one-material swap can't do
(deeper than R2, browser-gated). CARVE-OFF available on request: ONE hero glb (DRACO decoder wired
buildings.ts:86 but NO standalone GLTFLoader; needs one + a licensed Dnipro model — none in-repo).

## Files
lib/globe/buildingNight.ts (new) · test/lib/globe/buildingNight.test.ts (new, 8) · components/globe/tuning.ts
(BUILDINGS +toneVariation/nightWindowGain/nightWindowLitLo/Hi) · scene/buildings.ts (R2 vertex+frag, R3
emissive, setNight, per-tile seed) · StylizedTiles.ts (setNight step 26).

## DO NEXT (browser, wix dev — this is the whole rendering pass's deferred verify loop)
1. **Confirm the building shader COMPILES** — the #1 correctness risk local gates can't catch. Fly to
   Dnipro, watch the console for a GLSL link error. If it fails, the injection is the suspect.
2. A/B the look: toneVariation / nightWindowGain / lit thresholds are glf-baked (retune + RELOAD);
   window colour = tokens.cityLights. Night: scrub to local night to see R3.
3. Confirm live tiles carry `_batchid` (per-building) vs only per-tile:
   `console.log(Object.keys(mesh.geometry.attributes))` at load-model.
THEN Pass 3 (moat) / decide R4 build. Phase 6 marketplace still deferred.

## Carried taste follow-ups
- R3 window emissive still adds while buildings are FPV-ghosted (transparent) — cosmetic; gate by uGhostK
  if the owner dislikes glowing ghosts.
- toneVariation/gains are glf-baked (reload to retune). If the owner wants live A/B, promote to a
  `window.__globe.buildingUniforms` DEV seam (buildings expose no uniforms today, unlike earth/ground).

Related: mem:core · mem:project/wip-2026-07-12-rendering-quality-pass (keystone + design) ·
wip-2026-07-12-rendering-pass1-tiling-fluidity · mem:patterns/globe-rendering · RENDERING_QUALITY_PASS.md WS3.
