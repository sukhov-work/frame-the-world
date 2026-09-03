# ENGINE STATE — PLUX rendering, scene management and pipelines, as of 2026-09-02

**Purpose.** The owner ordered this report (2026-09-02n) as the lead-in to T77, the architecture and
performance audit: everything built and optimized in the engine so far, its limits and caveats across
desktop / mobile × regular / ULTRA, and which techniques a modern engine has that we do not. Its
companion, `WEB_RESEARCH_PROMPT_2026-09-02.md`, is the self-contained prompt for the independent web
research pass the owner will run before the audit.

**Method.** Read-only. Six parallel research tracks over the code (`three` 0.185.0,
`3d-tiles-renderer` 0.4.28, verified in `node_modules`), the rendering docs, DECISIONS and the Serena
memories; cross-track seams checked; the claims the verdict rests on spot-verified by grep against `src/`. Every
claim cites `file:line` or a doc section, or is marked ESTIMATED / UNVERIFIED. Track outputs
(~15k words, all citations) are kept verbatim in `engine-state-tracks-2026-09-02/` and summarised here; where this report and
an older doc disagree, this report is current and the disagreement is listed in §10.

**Owner's binding rule for everything downstream (2026-09-02n):** no optimization may degrade app
behaviour, cartographic or 3D accuracy, calculations, plans, predictions or sky features. Better
graphics at today's desktop frame rate is acceptable, provided mobile gets faster.

---

## 0. Verdict

The engine is a mature, heavily instrumented three.js + 3D-Tiles system whose three visible defects
(unstable shadows, slow off-screen re-seating, unmeasured mobile) are architectural rather than
tuning problems, and whose per-frame cost has never been profiled on real hardware. The audit should
measure first, then attack four structural levers.

Five findings that change what the audit does:

1. **No draw-call, triangle or GPU-time reading exists for any pose on any hardware.** The DBG HUD can
   read them since 2026-09-01 (`frame.calls`, `frame.tris`, `frame.gpu`), but nothing in DECISIONS,
   the rendering docs or the memories records a value (grep, 2026-09-02). Whether desktop is CPU- or
   GPU-bound at street level is unknown. The quality governor sees only CPU-side rAF time
   (`quality.ts:446`), so it cannot tell a fill-rate stall from a parse hitch.
2. **Shadows swim, pop and cut because the rig is built that way, not because a knob is wrong.** The
   ortho shadow box is re-centred every frame on a continuous point and three never snaps it to the
   texel grid (`shadowFit.ts:60-79`, `LightShadow.js` has no quantisation); the extent steps in 128 m
   rungs; the base profile has no cascade and cuts to fully lit at 5 km; the two ULTRA cascades are
   multiplied together with no dispatch or blend band; the base bias is a fraction of a moving depth
   range, not metres. The owner's 2026-08-27 words ("cropped, sliced, hollow") describe exactly these
   mechanisms, and the 2026-09-01 ruling says that round did not close the issue.
3. **Re-seating is slow off-screen and frame-rate-dependent by construction.** Every building is
   lifted onto terrain by a CPU raycast per footprint; the height memo is invalidated city-wide on
   every terrain tile arrival (`imageryGround.ts:907-911`, 406 invalidations in one leg); features
   outside the four look-cone cells are refreshed at 16 per frame over ~39,000 footprints (≈41 s at
   60 Hz, ESTIMATED); every ease is per-frame with no dt term, so a 30 fps device settles twice as
   slowly. The RC7 convergence bar (>0.9 within 5 s) is unmet at 50.3 % (measured 2026-08-25).
4. **Mobile is unmeasured and its profile hangs on one media query.** `(pointer: coarse)` is the
   only phone signal (`GlobeCanvas.tsx:52`); every "mobile" number on record came from desktop Chrome
   at 402×874 or a headless tier-low harness; the owner's iPhone 17 Pro and Pixel 6 Pro have produced
   only qualitative reports (tile storm, Safari reloads). The governor is blind to heat and memory;
   512² imagery composites are latched at boot on `/m`; the shadow pass runs on phones from 30 km down.
5. **Ten structural absences, all verified by grep:** no worker-side parsing in the tile path (only
   RAW decode and BEST SPOT use workers), no HLOD or impostors, no occlusion culling, no spatial index
   (`three-mesh-bvh` not installed), no instancing or GLB cache for user models, no compressed
   textures, no post-process AA (MSAA×4 on the composer target only), no async shader compilation,
   no VRAM accounting, no WebGPU path.

What is solid and must not regress: the byte-identical `high` tier, the ULTRA off-state law (exact
zero, proven by identity), the single vertical authority (`heightAt`), the ellipsoidal datum rule,
the availability-capped imagery finding, the Esri placeholder detector, the LRU floor/cap discipline,
the RC18 lever split, the eclipse and dusk models, and 2,428 unit tests plus fourteen browser
harnesses (§9).

Recommended audit order (§11): measure → shadows → seats → streaming/workers → mobile.

---

## 1. System map — how a frame is made

**Island and renderer.** One `client:only` React island (`GlobeCanvas.tsx`) owns a `WebGLRenderer`
(`antialias:false`, `powerPreference:"high-performance"`, default `highp`, no logarithmic depth),
a `PerspectiveCamera` whose near/far `GlobeControls.adjustCamera` re-fits every frame (1.0 m /
180,375 m in FPV, 24 depth bits, measured RC28), an `EffectComposer` and the lights. Everything else
lives behind `attachStylizedTiles` in `StylizedTiles.ts` (7,419 lines), which owns every store read
and runs ~56 named step functions per frame in a fixed order (`StylizedTiles.ts:7261-7316`; full
roster in `engine-state-tracks-2026-09-02/track1-frame.md`). `GlobeCanvas` never reads a store.

**Three tile renderers stream in parallel, with no shared cache or queues** (`TilesRendererBase.js:445-525`):

| Renderer | Source | errorTarget | LRU cap (high / mid / low / ULTRA) | Queues dl/parse (high / mid / low) | Plugins in order | Module |
|---|---|---|---|---|---|---|
| ground | Cesium World Terrain ion `1` + our GLO-30 patch on R2 (L13, dnipro / everest) | altitude ramp 2 → 12 device px (60 km → 750 km); flat chart 0.35 below 1.2 km | 400 / 320 / 192 / 600 MB, floor 0.75·cap | 25/5 · 12/3 · 8/2 (+ overlay queue 10) | ion (QuantizedMesh −1000) · patch fetch −500 · unlit swap −100 · Fade −2 · UpdateOnChange · LoadRegion · ImageOverlay −15 | `scene/imageryGround.ts` |
| buildings | Cesium OSM Buildings ion `96188`, masked inside baked regions | 16 / 24 / 40 CSS px; ULTRA 12 | 400 / 256 / 160 / 600 MB | same | ion · GLTFExtensions (draco + meshopt) · LoadRegion · region mask | `scene/buildings.ts` |
| enriched | our baked city cells on R2 (`tileset.json`, two-level ADD, GE-0 leaves) | 16 (sets stream radius only) | 400 / 256 / 160 / 600 MB | same | GLTFExtensions · force-cache fetch −500 · LoadRegion | `scene/enrichedBuildings.ts` |

The ground renderer is special twice: it is the only surface `heightAt` raycasts against (the single
vertical authority), and it alone carries `UpdateOnChangePlugin`, so its traversal and LRU trim run
only when the camera moved (`imageryGround.ts:318`).

**Per-frame order that matters** (`StylizedTiles.ts:7261-7316`): frame timing → controls → buildings
and enriched `update()` + seat sweep → flight / FPV / focus → camera glides → ULTRA gate (sole writer
of `ultraOn`) → ground update (error-target ramp, eases, LRU bank, `update()`) → ephemeris resample
(1 Hz scene time) → eclipse → ULTRA look eases → key light + shadow rig → sky bodies, pins, labels,
feeds (throttled by frame modulo) → back in `GlobeCanvas`: `composer.render()` (never skipped; the
RC21 on-demand gate ships OFF) → optional `/m` PiP blit. Whole chain in one try/catch.

**Post chain.** `RenderPass → [GTAO, never constructed: AO.enabled=false] → UnrealBloom(0.4/0.5/0.9)
→ OutputPass` into a HalfFloat MSAA×4 target; `EffectComposer` clones it, bloom allocates 11 more
HalfFloat targets (~12 fullscreen draws). Tone mapping is `NeutralToneMapping` (ACES/AgX desaturated
the accent). Bloom is off on `low`, on lean mobile and on the flat chart. MSAA on that target is the
only anti-aliasing in the product (`GlobeCanvas.tsx:361-380`).

**Adaptive quality** (`lib/globe/quality.ts`). Device tier from the GPU renderer string,
`deviceMemory`, `hardwareConcurrency`, `maxTextureSize` and `(pointer: coarse)`; a governor steps the
tier on an EMA of rAF dt (budget 35 ms, restore 13 ms, 100 down / 240 up frames, 2.5 s cooldown).
`high` reproduces the pre-quality-pass constants exactly (tests `quality.test.ts:207-290`). RC18
splits a tier change: a promote's tile levers land immediately even inside FPV, renderer levers wait
for FPV to end; a demote never splits. Shadows follow the device tier, never the governor
(`GlobeCanvas.tsx:587-593`).

**ULTRA** is an override profile on the running tier, desktop fine-pointer only. Law: with the chip
off no ULTRA value may change a pixel, proven by `=== 0` and object identity (`ultraTileLevers`
returns `base` by identity). Three shadow levers are boot-latched (`mapSize`, `shadowMap.enabled`,
cascades); `ultraBootSnapshot()` freezes the boot answer and the chip warns on disagreement.

**Mobile (`/m`)** is planning-only: 2D chart boot at 1.1 Mm over Dnipro, FPV touch, no upload. A
lean override on any coarse pointer: DPR 1.25 (1.5 on the chart), bloom off, shadow map 1024², Esri
z18, 8k textures skipped, 2k Milky Way. Buildings are detached in 2D. The PiP map is a cached render
target blitted every frame (RC19).

---

## 2. Subsystem state cards

Each card: what is built · the numbers · the limits. Tunables named here live in
`src/components/globe/tuning.ts` (4,028 lines; the two-file rule in `conventions/globe-tuning.md`).

### 2.1 Tile streaming, LOD, caching, culling

**Built.** Screen-space-error refinement from the library (`error = GE / (distance · sseDenominator)`);
the ground alone feeds device pixels, buildings and enriched feed CSS pixels (a ~2× coarser
refinement on retina, T43 gap #15, owner A/B AB6). U5 closest-first: `loadAncestors=false` plus a
download comparator biased toward the FPV look direction (`fpvBiasK` 1.5, `lib/globe/loadPriority.ts`);
ground excluded by design. U6 foveation: a bounded ray region plus an eye sphere per renderer that can
only add detail, on mid/low only (`foveation: null` on high). LRU floor paired at 0.75·cap because the
library evicts as soon as one unvisited tile exists and the cache is above the **floor**
(`LRUCache.js:342-348`); RC20 raises the ground floor to 0.92·cap for 45 s after each FPV boundary on
mid/low. Queues freeze on page hide. Altitude gates: ground hidden above 3,000 km, decor fades
250→150 km, stars gone below 250 km, streets < 5 km, vector web < 15 km, shadow twins off above 30 km.

**Numbers.** Ground cache rests at 109.8 MB against a 322 MB floor on `high` (trim never arises,
measured 2026-08-26); ~600 Esri GETs per 2D↔FPV leg on the headless `low` tier (2026-08-21); forcing
the ground error target to 0.05 produced **zero** extra tiles (desktop imagery is availability-capped,
2026-08-22); 452 imagery composites live at Dnipro; 101 enriched cells hold 39,302 buildings and
60,527 trees; U5/U6 warm-cache FPV: 0 hitches, EMA 16.7–21 ms (M3 Pro, weak evidence).

**Limits.** Culling is tileset frustum + horizon far plane only; three's per-object culling is
disabled on tile meshes; building shaders `discard`, which defeats early-Z. No occlusion culling, no
HLOD (the enriched far field is a cutoff, T7), no impostors, no prefetch beyond the look bias. Every
parse (GLB, MVT, `EdgesGeometry`, canvas composite, mip halving) runs on the main thread. Creation-time
imagery levers (anisotropy, mip chain, composite resolution) reach nothing mid-session on desktop
because the ground cache never turns over — they are delivered by reload. Per-tile composites are C0
discontinuous at tile borders (bounded by the 4-level mip cap). T5 (checkerboard + flicker
1500→200 km, reported 2026-07-17) is still unreproduced under instrumentation.

### 2.2 Imagery and vector layers

**Built.** Esri World Imagery composited per terrain tile onto a canvas (`ImageOverlayPlugin`,
512² on high / 256² mid-low, sticky-up because a resolution change rebuilds every composite);
optional CARTO dark drape; ULTRA stamps anisotropy 16 and a hand-built 4-level mip chain at creation
(`drawImage` halving, 0.06 ms per composite after the 5.36 ms readback path was refuted). Esri's
HTTP-200 "no data" placeholder (2,521 bytes, FNV-1a-32 `0x92d9118f`) is detected by bytes and replaced
by a cropped parent, up to 3 levels (RC5). HTTP `force-cache` on all tile hosts; an iOS-only service
worker (6,000 entries, 7 days). Vector: OpenFreeMap MVT z14 parsed on the main thread, 56-tile cache,
ribbons/fills as one mesh per tile per kind seated on a 6×6 `heightAt` lattice (8 raycasts per
frame); street names as canvas textures on terrain-lying quads (40 max); geo labels as a DOM div pool
(28 max).

**Limits.** Imagery sharpness on desktop is bounded by provider coverage, not by our refinement
(refuted twice: S10, T44). Street labels have no depth occlusion against buildings (T19, accepted v1).
The mini-map draws culverted drains (T48).

### 2.3 Lighting, sky, atmosphere, ULTRA look, dusk, eclipse

**Built.** Exactly two lights reach lit materials: one `DirectionalLight` key driven by the
ephemeris sun (colour from a golden bell over solar elevation, intensity `1.5 × golden × eclipseK ×
handoff × ultraDirectK`), one `HemisphereLight` fill. A dedicated moonlight exists in `sky.ts`;
under ULTRA-at-boot two zero-intensity cascade lights own depth maps only. No ambient light, no
environment map / IBL, no fog, no volumetrics. Only `MeshStandardMaterial` surfaces (buildings,
enriched, trees, user models) read the lights; the earth, terrain drape, sky dome, stars and
impostors are self-lit `ShaderMaterial`s (22 raw ShaderMaterials across 14 modules, 5 chained
`onBeforeCompile` patches). Sun→moon handoff: at +0.46° the same key light impersonates the moon
(K&S-1991 illuminance). Eclipse: topocentric coverage per frame → `eclipseK` to a 0.04 daylight
floor across key, ground, dome and stars (T46: the base earth is deliberately unwired — no LEO umbral
spot). Sky dome (`atmosphere.ts`): analytic — an exponential-density limb with two scale heights from
orbit, blended below 120 km into a low-altitude sky with a true-horizon haze band (dip included) and
the golden bell; ULTRA adds a Rayleigh + Mie directional arm and an afterglow band. Aerial
perspective `ftwAerial` (distance and view-sun angle only) compiled into ground, buildings and
models. Stars: BSC5 9,096 points with softened Pogson sizing, B-V tint, twinkle; Milky Way 8k JPEG
(~134 MB VRAM, T16) or 2k on mobile. ULTRA dusk model: key extinction, sky-level, afterglow and
Rayleigh curves, a direct/ambient ground split, all functions of solar elevation.

**Numbers.** ULTRA on: city 30.7 → 36.1 ms (+18 %), Everest 29.3 ms (owner's M3 Pro, dev build,
1600×950 @ DPR 2, 2026-08-22). Hemisphere light contributes 0.18 % of a facade pixel while the
building emissive floor is 3.6× the sun at 3° elevation (2026-08-27). Aerial perspective erases wall
front/back contrast to 1.043 at 10 km (T69). ULTRA off-state proven exact by `verify-ultra` 28/28.

**Limits.** The baseline key never dies below the horizon without a qualifying moon (AB1). The
baseline hemisphere "sky" points along ECEF +Y, correct on one meridian (AB2); ULTRA re-seats it.
Every ULTRA look term is a function of solar elevation, so coherence between sky, ground, haze and
key is kept by hand-shared uniforms, and the eclipse and dome seams were fixed by fading toward
baseline rather than by one model. `ftwAerial` has no surface-normal term (T69). Afterglow is
evaluated at geometric elevation, so a sun behind a ridge produces none (T68). The dome's Mie lobe
mixes an ellipsoid-scaled direction with raw ECEF (≤0.19°, T70). Tone/exposure is an authored ramp,
not luminance-driven. GTAO is wired but off (T10) and would silently become an ULTRA lever because
the chip pins the tier to `high`. No clouds, weather or fog volumes exist anywhere.

### 2.4 Shadows

**Built.** One `PCFShadowMap` (three rewrites `PCFSoft` to PCF; the soft lever is `shadow.radius` on
a 5-tap Vogel disk rotated per pixel). Map size boot-latched by tier (4096 / 2048 / 1024; lean 1024;
ULTRA 8192). One ortho box, refit every frame: half-extent `clamp(max(alt·K, d/2 + 800), 1600, cap)`
rounded up to 128 m, centred on the eye's ground point pushed along the horizontal look
(`shadowFit.ts:60-79`); cap 5 km base / 18 km ULTRA. `shadow.intensity` fades over the last 3°
(0.6° ULTRA) before `castShadow` flips at +0.46°. Bias: raw −2e-4 base (a fraction of a depth range
that moves with altitude: −1.4 m at construction, −2…−3.3 m when casting), ULTRA authors it in metres
and re-derives it per resize. Casters: OSM buildings, enriched, trees, user models; terrain
ULTRA-only via a shared custom depth material with `shadowSide=FrontSide` (silent failure otherwise)
and a skirt clip. Receivers: building fills, per-tile `ShadowMaterial` twins on the ground. ULTRA
cascades: 4096² to 60 km (29 m/texel) and 2048² to 260 km (254 m/texel), eye-centred, refreshed on
extent step / terrain epoch / 12 % drift / 0.25° swing / 1.5 s.

**Numbers.** Coverage before the cascade ladder 24 % / 8 % / 35 % of the view at three mountain
poses, 100 % after; ladder costs +3.0/+3.3 ms and +168 MB (arithmetic) on top of 536 MB for cascade 0
(2026-08-27). Base texel 0.78 m at 1.6 km → 2.44 m at the 5 km cap (RC4's stated cost). Fade loss
52 % at +2°.

**Why shadows are still unpredictable — mechanisms, in order of visibility** (track 3; items marked
"argued" are read from three's shader source and not yet observed in a browser):
1. No texel snapping: the box centre moves continuously with every translation and yaw; edges crawl
   on every drag. Only the extent is quantised.
2. Extent steps of 128 m re-rasterise every edge at a new texel size; at the cap the far edge is a
   straight cut to lit. The base profile has no cascade, so "cropped, sliced" is the shipped default
   for every non-ULTRA user (AB7).
3. Cascade composition is a raw product (`shadow *= getShadow(...)`) with no dispatch or blend band:
   at the cascade-0 edge the penumbra jumps from ~4 m to ~90 m and coarse-cascade acne multiplies into
   the near field (argued).
4. Lit materials receive cascade 0 only (cascade lights are black), so beyond 18 km walls are
   unshadowed while the ground under them is shadowed (argued).
5. Cascades are stale between discrete triggers; a terrain epoch re-renders both.
6. Casters pop while receivers crossfade: the depth material ignores per-tile fade (argued).
7. Vogel + gradient noise is screen-space with no temporal filter: grain crawls with the camera;
   penumbra width is constant in texels (no contact hardening).
8. Base bias is not metric, so contact varies with altitude.
9. Base shadows die from +3.5°: the raking hour is shadowless outside ULTRA.
10. Boot-latched levers: a mid-session ULT flip leaves the rig on the boot profile.
11. 1 Hz ephemeris sampling steps the sun ~0.004° in live mode (~1 texel/s at 0.39 m, ESTIMATED).

No harness asserts temporal stability; every shadow harness is a pose ladder.

### 2.5 Terrain, the vertical authority, seats and the FPV eye

**Built.** Cesium World Terrain is L13 over Ukraine (4-vertex quads per ~2.4×1.6 km, measured U7);
our GLO-30 patch (mago 3DTiler, EGM2008 → ellipsoidal at bake) is swapped per tile inside the same
renderer by rewriting `tile.content.uri` (dnipro, everest; St Albans has none). Heights are
WGS84-ellipsoidal at runtime; a runtime geoid is a binding rejection; EXIF altitudes stay orthometric
and are floored to terrain + 1.7 m. `heightAt` (`imageryGround.ts:1111-1140`): a down-ray from 12 km
along the geodetic normal through the library's bounding-volume walk, geometry tested only for
active tiles (why a fading parent never wins: 1.00 hits per sample over 47,616 samples), deepest
stamped tile chosen, memoised on the exact `(terrainEpoch, lat, lon)` key, `null` never cached, whole
memo dropped on overflow (cap 100,000). Enriched buildings sit at h = 0 in the bake and are lifted at
runtime by four eased layers that sum to each footprint's own terrain (group → cell → per-building
vertex write into the non-indexed soup plus the edge CSR → per-tree instance matrix); first sample
snaps, refinements ease at 0.12 per frame; per-feature sampling gated by
`max(45 m, 1.5 × observed relief)`; seats survive LRU eviction through a per-cell cache (RC9). The
FPV eye re-samples the ground every 4 m of walk and eases at 0.08 per frame; the orbit street-floor
guard clamps to last ground + 2 m below 50 km.

**Numbers.** `heightAt` 0.018–0.067 ms per sample; memo hit rate 84 % over 18,457 entries (42 % on
another leg); 406 terrain epochs in one leg; look-cone convergence 50.3 % vs 33.9 % city-wide (bar
0.9 unmet, RC7); 302 m walk: 0.50 m total correction, 0.23 m worst step, zero non-walk jumps > 0.5 m
(RC10); curvature residual 0.568 m against 14.20 m rms within-cell relief (RC12 refuted).

**Reseat mechanics when a terrain tile refines under a building** (track 4, ESTIMATED timings from
measured counts): the tile crossfades over 700 ms, so the ground moves at once; the epoch bump dumps
the memo city-wide; the cell centre re-samples within ≤17 frames and settles in ~0.9 s; but the
building's own seat is sticky — the four layers sum to it, so the cell shift is cancelled until the
footprint itself is re-sampled: ≤0.55 s inside a look-cone cell, ≈41 s for the 16-per-frame
round-robin over 39,302 footprints, ≈100 s for trees, at 60 Hz. A cold memo costs 2–7 ms in the frame
(111 raycasts). Every ease is per-frame, so a 30 fps device doubles all of this.

**Limits.** Memo invalidation is global, not spatial. Eases have no dt term. The plausibility gate is
structural: a footprint further than the gate from its cell centre never seats, and a gizmo move
beyond it slams onto the cell plane. Buildings are rigid boxes translated by one scalar at one
centroid (±slope × half-diagonal residual; the 4 m rim skirt from RC13 hides the downhill side — the
RENDERING_ARCHITECTURE §2.6 sentence saying the skirt is not built is stale). Stock OSM buildings are
never seated and ride ion's terrain clamp, which the patch moved under the extent annulus (gap #7,
RC14 unbuilt). Trees stand on a DSM that already contains the canopy (T58). User models take a 120 m
fallback seat immediately when no tile answers. `verify-pin-reframe` is red on a cold profile
because a coarse ancestor answers −2,047 m (T76).

### 2.6 Geometric precision

World space is raw ECEF (magnitudes ~6.4e6 m). There is no floating origin, no relative-to-eye
rendering and no `matrixWorldAutoUpdate` toggling (grep). Precision rides three's float64 CPU
`modelViewMatrix`: tile geometry is centre-relative (`CESIUM_RTC`), enriched cells and models are
local-metre geometry, and pins/markers/frustum carry explicit camera-anchored RTC. The only float32
ECEF values in shaders are the world-position varyings feeding aerial-perspective distance (~0.5 m
ulp on both operands; invisible at the 55 km haze scale, ESTIMATED). Depth: 24 bits over 1 m to
180,375 m, no shimmer observed in ten legs; reversed-Z / logarithmic depth rejected on that evidence
(RC28). This is adequate today and a latent hazard only if a float32 world position is ever used for
something sharper than haze.

### 2.7 Buildings (stock and enriched), trees, user models, bake

**Built.** Stock OSM tiles: a shared material swap on `load-model` (`BatchedTilesPlugin` rejected —
it forces one material and kills the reveal, tint and dissolve that ride the shared material's
uniforms), a synchronous per-mesh `EdgesGeometry(30°)` line child with no cap or deferral, a
polygon-offset ladder, a Bayer screen-door reveal, haze chained on. Enriched: gridded 3D-Tiles 1.1
(ADD, root GE 512 with no content, GE-0 ~1 km cells, ±80 m pad), per-cell GLB with contiguous
per-feature runs plus a `meta.json` sidecar, **no draco/meshopt on the output** (raw float32),
one `InstancedMesh` of trees per cell (no LOD, no per-instance culling), residency by byte LRU only.
Sizes: dnipro-o2w 133,437 features / 389 cells / 7.74 M vertices / 227 MB; classic 127,890 / 386 /
5.05 M / 155 MB + 161,823 trees; st-albans-o2w 50 MB; terrain dnipro 11.5 MB, everest 210 MB.
User models (MESH SUITE MS4–MS6): upload-time audit, meshopt decimation to 100k tris, GLB export on a
2048→512 texture ladder; runtime ENU rig, residency 24 models / 1.5 M tris / 3 km in, 4 km out,
`GLTFLoader` on the main thread, no cache, no instancing, cast + receive on every mesh, a chained
shader for haze and dissolve.

**Limits.** Draw structure (ESTIMATED, nothing measured): 1 draw per terrain tile + 1 shadow twin
below 30 km; 2 per stock building tile (fill + edges) × (1 + shadow maps); 3 per enriched cell (fill,
edges, trees) × (1 + shadow maps); 1–25 per user model; ~12 for bloom. `EdgesGeometry` cost on a
dense metro is unverified. The enriched far field is a stream-radius cutoff, not a coarse tier (T7).
User-model cliffs (MESH_SUITE_PLAN §12, all ESTIMATED): texture VRAM first (24 × 4 × 2048² ≈ 2 GB),
then draw calls × shadow passes, then 20–200 ms arrival hitches, then the 200-row world page.

### 2.8 Mobile profile

**Built.** See §1. The tier is `mid` at most on any coarse pointer; the lean override applies on top.
Wake lock during FPV, tile queues frozen on hide, context-loss recovery, an iOS service worker.

**Numbers.** None from a real device. Desktop-Chrome emulation: FPV walk 66 m/s with 0 drift,
pinch 55→27.7°; U5 `/m` EMA 8.3 ms on the M3 Pro. Real iPhone 17 Pro: qualitative only — tile storm
on the chart, Safari page reloads (memory), a fixed gesture list (2026-08-17, 2026-08-21).

**Limits.** One media query decides the phone; a tablet is "coarse", a privacy-hardened renderer
string reads as `mid`, `softwareGL` is declared but never probed. The governor is blind to heat and
memory; there is no memory-pressure listener and jetsam fires no event. The 256² composite lever is
dead on `/m` because the chart is the boot state and the sticky ratchet reaches 512² on frame 1. The
shadow pass runs on phones from 30 km down at 1024² (RC22 proposes 8 km, unapplied). The HalfFloat
MSAA×4 composer target and the `high-performance` hint are unverified on iOS. The GPU timer is absent
on Safari. Parse concurrency is the only hitch lever, and RC18's live promote raises it mid-viewfinder.

---

## 3. Mode matrix — what runs where

| Lever | Desktop `high` | Desktop `mid` / `low` | Desktop ULTRA (on high) | `/m` chart (2D) | `/m` FPV / 3D |
|---|---|---|---|---|---|
| DPR cap | 2 | 1.5 / 1.25 | 2 (raise is inert) | 1.5 | 1.25 |
| Shadow map | 4096² | 2048² / off | 8192² + cascades 4096² @ 60 km, 2048² @ 260 km | rig off | 1024², to 30 km |
| Terrain casts | no | no | yes (< 30 km) | no | no |
| Bloom / GTAO | on / off | on·off / off | on / off (would couple) | off | off |
| Composer target | HalfFloat MSAA×4 | same | same | same | same |
| Imagery composite | 512² | 256² | 512² + aniso 16 + 4 mips | 512² (sticky from boot) | 512² inherited |
| Esri max zoom | z19 | z19 | z19 | z18 | z18 |
| Buildings | on (BLD chip) | on | SSE 12 | detached | on, SSE 24 |
| Foveation / closest-first | none / FPV bias | on / on | none | — | on / on |
| LRU ground / bldg / enr | 400 / 400 / 400 MB | 320·192 / 256·160 | 600 all | 320 (+bank) | 320 (+bank) |
| Parse jobs | 5 | 3 / 2 | 5 | 3 | 3 |
| 8k earth / Milky Way | 8k / 8k | 8k / 8k | 8k / 8k | 2k / 2k | 2k / 2k |
| Frame gate (RC21) | off | off | off | off | off |
| Aerial haze / dusk model / exposure | off | off | on | off | off |

---

## 4. Measured-number ledger (what we actually know)

Hardware key: **OM** owner's M3 Pro Mac (dev build 1600×950 @ DPR 2) · **HL** headless tier-low
Chrome on :9333 · **WC** warm cache. No real phone number exists.

| Metric | Value | Where | HW / date |
|---|---|---|---|
| Frame time, city, ULTRA off → on | 30.7 → 36.1 ms | ULTRA_ARCHITECTURE §1 | OM 2026-08-22 |
| Frame time, Everest, ULTRA on | 29.3 ms | same | OM |
| Cascade ladder | mountain 31.2 → 34.2 ms; city 47.0 → 50.3 ms; +168 MB | ULTRA_ARCH §13.1 | OM 2026-08-27 |
| Shadow coverage before / after ladder | 24 / 8 / 35 % → 100 % | same | OM |
| Depth | 24 bits, near 1.0 m, far 180,375 m | RC0/RC28 | OM 2026-08-25 |
| `heightAt` | 0.018–0.067 ms/sample | RC0 M6 | OM |
| Memo hit rate | 84 % / 18,457 entries; 42 % other leg | RC11 | OM |
| Fading-parent wins raycast | 0 of 47,616 samples | RC6/M7 | OM |
| RC7 convergence | 50.3 % cone vs 33.9 % city (bar 0.9) | RC7 | OM |
| RC10 walk | 0.50 m over 302 m, 0.23 m max step | RC10 | OM |
| Curvature residual | 0.568 m vs 14.20 m rms (4 %) | RC12 | bake |
| Working set | 39,302 buildings + 60,527 trees / 101 cells | tuning.ts:2487 | OM |
| Ground LRU at rest | 109.8 MB vs 322 MB floor | T34/M13 | OM 2026-08-26 |
| Esri GETs per 2D↔FPV leg | ~600 | T34 | HL low 2026-08-21 |
| Ground errorTarget 0.05 | 0 extra tiles | T44 | OM 2026-08-22 |
| Mip chain | ×1.328 VRAM; 5.36 → 0.06 ms/composite; 452/452 chained at boot, 2/321 mid-session | RC25 | OM |
| Hemisphere on a facade | 0.18 % of pixel; emissive 3.6× sun at 3° | ULTRA_ARCH §14.2 | OM |
| Aerial contrast erasure | 1.13 @ 2 km, 1.043 @ 10 km, 1.0025 @ 30 km | T69 | OM |
| Dusk sweep | skyLevel 1 → 0.282; keyLevel peak 1.294 @ 9.5° | ULTRA_ARCH §13.2 | OM |
| U5 stream | buildings mean 376 / max 540 ms; 0 hitches / 4 s; EMA ~21 ms | U5 memory | WC (weak) |
| U6 first tile after FPV entry | enriched 185–221 ms, ground 528–624, buildings 1.1–1.3 s | U6 memory | WC |
| CWT over Dnipro | L13, 4-vertex quads; landmark errors +33…58 m; GLO-30 fixed city 120.4 → 85.9 m | UPLIFT App. A | bake |
| Tile cache | ~95 % fromDiskCache on reload; 0 in-session refetch | measure-tile-cache | OM |
| DBG HUD | GPU 7.3 ms; rAF median 33.4 ms with HUD open | DEBUG_HUD_PLAN | HL 2026-09-01 |
| Bakes | dnipro-o2w 227 MB / 7.74 M verts; everest terrain 210 MB | manifests | bake |

**Never measured (explicit):** any real-device number (T1); draw calls, triangles, texture bytes or
total VRAM for any pose; `frame.cpu` vs `frame.gpu` split on the owner's machine; the shadow pass in
isolation; baseline stage breakdown (fill vs raycast vs parse, asked for 2026-07-12, never taken);
GTAO cost; `mid`/`low` on real weak hardware; RC19 PiP saving; RC21 skip ratio; a dense-metro pose
(NYC/Tokyo-class OSM density); T34 GET count on device; prod (Wix cloud) render performance;
`EdgesGeometry` cost per stock tile; the RC22 knobs.

---

## 5. Refuted and rejected candidates — do not re-propose without new evidence

Merged from FPV_FIDELITY_AUDIT §4, ULTRA_ARCHITECTURE §10, RENDERING_ARCHITECTURE §2.1, the charter
and the tracks. **M** = measured, **A** = argued from source or reasoning, **O** = owner ruling.

| Candidate | Why | Kind |
|---|---|---|
| `BatchedTilesPlugin` for buildings | one material; kills reveal / tint / dissolve on the shared material | A |
| `TilesFadePlugin` for buildings | per-material map fights the one-material invariant | A |
| three `csm` library | assigns `onBeforeCompile` (clobbers chained patches); +3 lights recompile; no cascade dispatch in `ShadowMaterial`; its "free" claim measured false (8–35 % coverage) | A→M |
| PCSS | not in the npm package; needs a raw depth read while three's PCF uses hardware-compare samplers | A |
| VSM | every receiver becomes a caster → 768 MiB at 8192² | A |
| Real-time GI | owner-accepted; streaming tiles cannot hold probes | O |
| `PCFSoftShadowMap` | dead code in 0.185 (rewritten to PCF) | source |
| Tilting the hemisphere toward the sun | 0.18 % of a facade pixel | M |
| Dimming the additive sun disc | dim = dissolve under additive blending | M |
| TAA | continuous drift/walk, no motion vectors, smears the dithers | A |
| Reversed-Z / logarithmic depth (RC28) | 24 bits, no shimmer in 10 legs; 22 ShaderMaterials to touch | M |
| Tangent-plane curvature dominates building float (RC12) | 0.568 m vs 14.20 m relief | M |
| Fading parent wins the seat raycast (M7) | 1.00 hits/sample | M |
| Desktop far-field refinement (S10) and the HQ 3D MAP region (T44) | errorTarget 0.05 → 0 extra tiles; built in full, measured inert, removed | M |
| Foveation on `high` | region error = GE; arithmetic no-op | A |
| DPR foveation | mobile ceiling is heat/jetsam, not fill | A |
| Terrain LOD geomorphing | `heightAt` is a CPU raycast; TIN has no vertex correspondence | A |
| `TileFlatteningPlugin` under footprints | no tessellation at 38×25 m; self-confirming height fixed point | A |
| DSM → DTM punch for buildings (RC15) | footprint signature +0.34 m median, control-dominated | M |
| Extruded base skirt | +59 % vertices; RC13's rim lowering does it for +0 | M |
| Straddler margin bake (RC16) | 96–99.9 % of "dropped" was disjoint geometry; only 123/61/1 real | M |
| Runtime geoid | D4 binding; EXIF datum unknowable; smaller than GPS noise | O |
| Occlusion culling now | horizon profile not conservative; cull↔evict loop; C2 | A |
| KTX2 / texture budget for imagery composites | bakes carry no textures; composites are canvases | A |
| Full auto mip chain on drapes | transparent-border bleed → seam grid | A |
| `getImageData` mip filter | 5.36 ms/composite stalled the page | M |
| Half-rate PiP | composer overwrites the PiP rect → 30 Hz flicker | A |
| Blit `toneMapped:false` | three forces no tone mapping into render targets | source |
| Predicate-based on-demand render (RC21 as designed) | 40+ per-frame change sources; false negative = frozen globe; heartbeat shape shipped OFF | A |
| ULTRA as a 4th quality tier; ULTRA `dprCap` raise | type error on `caps[tier]`; inert behind `min(devicePixelRatio, …)` | A |
| Governor disabling shadows/bloom | over-degraded the M3 Pro (2026-07-13) | M |
| Ground rest-trim churn on desktop | cache rests below the floor on `high` | M |
| Google Photorealistic 3D Tiles for Dnipro | no coverage over Ukraine; C5 | M |
| WebGPU near-term (D12) | the look is GLSL-string / `onBeforeCompile`; TSL rewrite | A |
| Flat / procedural window emissive | owner rejected twice ("painted", "junky") | O |
| Raising parse queue caps; blanket LRU raise on mid/low | main-thread hitches; worsens jetsam | A |
| Two-finger tilt door, MY LOCATION → FPV, auto re-arm map follow | reversed after owner device tests | O |

---

## 6. Gap analysis by the owner's topics (ASSESSMENT)

"Exists" and "constraint" are cited facts; "candidate levers" are this report's assessment for the
audit and the web research to test, ranked within each row. **Rq-n** are the research questions the
prompt asks.

| Topic | What exists | What is missing | Constraints that shape any answer | Candidate levers (ASSESSMENT) |
|---|---|---|---|---|
| **Predictable shadows in every mode** | one ortho PCF map, view-fitted, 3° fade, ULTRA cascades, terrain casting (ULTRA) | texel-snapped centre; extent hysteresis; cascade dispatch + blend band; metric bias on base; any cascade on base; temporal-stable filtering; a shimmer metric | ECEF magnitudes → snap in the light's frame in float64; chained `onBeforeCompile` must stay named + uniform-declared; boot-latched map size; off-state law → ULTRA-first then A/B | snap centre to texel grid along light right/up (pure orchestrator, Rq-1); quantise extent with hysteresis; base-profile far cascade or a wide fade band instead of a cut (AB7); bias in metres on base; world-space (not `gl_FragCoord`) rotation noise; a per-cascade mask with a blend band injected once into the two chained patches; a browser shimmer metric (per-pixel shadow-mask delta on a static pose) |
| **Realistic lighting, atmosphere, future weather** | one key + hemisphere, analytic dome, authored elevation curves, aerial perspective by distance only, dusk model (ULTRA), eclipse | physically-based sky (precomputed transmittance / sky-view / aerial LUTs), sky irradiance → ambient/IBL, normal-aware aerial perspective, clouds, fog, precipitation, exposure adaptation | ephemeris-driven sun/moon in ECEF; globe scale from orbit to street; self-lit ShaderMaterials for earth/drape/dome; off-state law | Hillaire-2020-style LUT atmosphere driving key chroma, dome, aerial and ambient from one model (Rq-2); hemisphere/irradiance from the same LUT (fixes AB1/AB2 and the "backs of buildings" tint); `ftwAerial` with an N·L term (T69); cloud layer as a screen-space or dome-projected 2D noise first, volumetrics later (Rq-3) |
| **Faster and more precise reseat in 3D and FPV** | CPU raycast `heightAt` with memo, four eased seat layers, look-cone priority, RC9 cache, walk re-sample | spatial memo invalidation; dt-based eases; bake-time seats; GPU height lookup; plane-fit bases | ellipsoidal datum at bake (patch regions only); CWT mutable elsewhere; occlusion sweeps and picks read the CPU arrays | per-tile / per-cell epoch instead of global (Rq-4); `1 − exp(−dt/τ)` eases; bake per-feature seats against the shipped L13 TIN inside patched regions (runtime raycast stays the target-of-ease); per-feature `dy` attribute + GPU offset to end whole-cell re-uploads; a height raster or heightmap texture per cell for O(1) lookup |
| **More meshes, faster** | enriched soup + instanced trees; user models 24 / 1.5 M; MS4 decimation | GLB cache + instancing per URL; per-material merge; LOD rungs; impostors; worker parse; shadow leash; VRAM-aware residency | shared-material invariant on stock tiles; three's program-cache key = `onBeforeCompile.toString()` | `InstancedMesh` per GLB URL (Rq-5); meshopt LOD rungs emitted at upload; thumbnail billboard beyond ~1 km; `GLTFLoader` + texture upload in a worker with `ImageBitmap` (Rq-6); cast shadows within ~300 m only; residency by projected size and VRAM bytes; `BatchedMesh` with per-instance attributes for stock tiles (reconciles batching with the shared-material invariant, Rq-7) |
| **Photorealistic "render this frame"** | nothing (no offline/still path) | a high-quality still: supersampled or path-traced, higher shadow res, full LOD forced, no time budget | must not touch the live loop; C5 forbids Google tiles derivation; the look is GLSL-string | progressive accumulation on a static pose (jittered MSAA/SSAA into a float RT, N frames); force finest LOD + 8192² shadows for the still; evaluate `three-gpu-pathtracer` feasibility on our materials (Rq-8) |
| **iPhone 17 / mobile** | lean override, tier `mid`, PiP cache, foveation, LRU bank, SW cache | any real-device number; tier from the renderer string + screen; VRAM budget; thermal proxy; memory pressure; dynamic resolution; ASTC textures; shadow/light tiers; worker parse | Safari has no GPU timer; jetsam is silent; `deviceMemory` absent; HalfFloat MSAA unverified on iOS | run the DBG twin on the device via remote inspector and record the baseline (Rq-9); renderer-string + screen-size tier table with a VRAM budget; RC22 knobs (384² composite, 8 km shadow cap, 6/2 queues); continuous render scale with a temporal-stable upscale (Rq-10); KTX2/ASTC for user-model textures; memory-pressure heuristics (Rq-11) |
| **LOD and distance-conditional rendering** | tileset SSE; altitude gates for decor/stars/labels; foveation regions | HLOD for enriched (T7); LOD rungs for models; screen-size culling of small features; distance-tiered shading | enriched is a 2-level ADD tileset; 39k buildings per city | bake a coarse tier per cell (merged blocks, no edges, no trees) and a region proxy above ~20 km (Rq-12); drop edges/trees by projected size; shading tiers by distance in the chained patch |
| **Texture management** | byte LRU (library estimate); sticky composite resolution; manual 4-level mips; 2k/8k sets | VRAM accounting; compressed formats; texture streaming by residency; atlas/array for street labels | composites are canvases (KTX2 moot for them); user-model textures are the real VRAM load | GPU-compressed user-model textures (KTX2 → ASTC/BC7, Rq-13); count `renderer.info.memory.textures` against a per-tier VRAM budget; label atlas; earth 8k in KTX2 |
| **Culling** | tileset frustum + horizon far plane; altitude gates | occlusion (HZB or conservative horizon), small-feature culling, per-instance tree culling, cluster culling | `discard` in building shaders defeats early-Z; cull↔evict loop risk | conservative horizon-profile occluder for cells (`lib/geo/occlusion.ts` exists but never reaches the renderer, Rq-14); GPU occlusion queries per cell; projected-size culling of edges/trees/labels |
| **Shader optimizations** | 22 raw ShaderMaterials + 5 chained patches; Bayer dithers; per-pixel noise | async compile; uniform buffers; variant reduction; early-Z-friendly transparency | program cache key rules; TDZ trap; must keep the look byte-identical on `high` | `KHR_parallel_shader_compile` via `renderer.compileAsync` at attach (Rq-15); `UniformsGroup` for the shared `uFtw*` block; alpha-to-coverage or ordered dither instead of `discard` where possible; profile with the GPU timer per pass |
| **Nanite-like (simplified)** | none | meshlet/cluster LOD, GPU-driven culling, virtualized geometry | WebGL2 has no compute; our meshes are low-poly prisms | not applicable as such in WebGL2; the practical equivalent is HLOD + `BatchedMesh` + projected-size culling (Rq-16 asks what is realistic in three.js today, including the WebGPU branch) |
| **Octrees / spatial partitioning** | tileset bounding-volume hierarchy; per-cell grid; geohash covers | a runtime BVH for picks and seats; spatial memo keys; spatial epoch | `three-mesh-bvh` absent; picks are brute-force `Mesh.raycast` | `three-mesh-bvh` on terrain tiles and enriched cells (Rq-17); a cell-keyed height memo; a uniform grid over footprints for the sweep |

---

## 7. Cross-cutting caveats and traps the audit will hit

- **Construction-time levers**: shadow map size, `shadowMap.enabled`, cascades, composite resolution,
  anisotropy and mip chain are stamped at creation; on desktop the ground cache never turns over, so
  they reach nothing mid-session. A/Bs of these need a reload per arm.
- **The off-state law and byte-identical `high`** are machine-checked (`quality.test.ts`,
  `verify-ultra`); an optimization that changes a `high` pixel needs an owner ruling first.
- **Chained shader patches** must be one named function with no captured state and every bound
  uniform declared in `<common>`; three keys the program cache on `onBeforeCompile.toString()`.
  Anything that assigns `onBeforeCompile` (three's CSM, GTAO source patches) clobbers the chain.
- **Directional shadow order**: the casting sun must stay first among directional lights.
- **`shadow.bias` is a fraction of a moving depth range**; `shadowSide=FrontSide` or terrain casts
  nothing, silently; `mapSize` set at runtime is a no-op.
- **LRU floor/cap**: a cap below the library's 0.3 GiB default floor inverts the band and every
  parse is discarded; eviction starts above the floor, not the cap.
- **`UpdateOnChangePlugin`**: any error-target or region change with a parked camera needs an
  explicit `needsUpdate`.
- **Orchestrator state must be declared above the ephemeris seam** (TDZ → silent placeholder globe).
- **Harnesses**: the verify Chrome has no occlusion flags (frozen rAF reads as a perfect pass);
  probes on non-existent fields fail open; eased uniforms must be asserted after ≥6.2τ; cumulative
  counters must be differenced.
- **Wix Data reads lag writes ~1 s; `BuildingOverrides` and `UserModels` are the production world
  even from `wix dev`.**

---

## 8. What the audit must not break — the non-regression contract

Owner's rule restated: behaviour, cartographic and 3D accuracy, calculations, plans, predictions and
sky features may not regress. The machine-checked floor today:

| Guard | What it pins | Status 2026-09-02 |
|---|---|---|
| vitest | 2,428 tests / 162 files (FOV, geohash, projection, ephemeris, seats, quality tiers, fences) | green |
| `npx astro check` | types | 0 errors |
| `npm run proofs` (Lean) | BEST SPOT slope facts, bounded scores | 25/25 (2026-08-25) |
| `test/lib/globe/quality.test.ts` | `high` byte-identical; ULTRA off returns `base` by identity | green |
| `fences.test.ts` | scene modules never value-import stores; ULTRA gate file list | green |
| `brandFence.test.ts` | product name vs persisted `ftw:*` keys | green |
| `verify-rendering-charter.mjs` | RC0–RC11 + Groups E/F | 85/85 |
| `verify-ultra.mjs` / `verify-ultra-dusk.mjs` | off-state exactness, live flip, timelapse; cascade coverage, monotone dusk | 28/28 · 21/21 |
| `verify-eclipse.mjs` | topocentric geometry + pixels | pass |
| `verify-bldg-override` / `meshedit` / `usermodels` / `modelupload` | MESH SUITE MS1–MS6 | pass |
| `verify-qaslice-cab.mjs` | `/m` 2D↔FPV ≈0 GETs | 64/64 (2026-08-22) |
| `verify-bestspot.mjs` | BEST SPOT | 96/101 (T61, stale fixture) |
| `verify-pin-reframe.mjs` | pin arrival | RED (T76, environment) |

Not machine-checked today and needed before shadow or seat work: a **temporal-stability metric**
(shadow-mask and seat-height deltas across frames on a static pose and on a scripted drag), a
**draw-call / triangle / GPU-ms baseline** per pose, and a **real-device baseline**.

---

## 9. Verification ladder and DBG readings available

The DBG HUD (`lib/globe/debugFeed.ts`, 151 metrics + 3 actions) can read today: `frame.dt / cpu /
draw / gpu / calls / tris`, `mem.jsHeapMB`, `canvas.hitches`, tier and DPR state, `ultra.shadow.*`
(casting, map px, m/texel, cover, viewFit), cascade ages, per-renderer `dlLen / parseLen / visible /
inCache / lruMB`, composite counts and z range, Esri sentinels, `terrain.epoch / memo hits·misses /
pick.parentWinRate / patchRewrites`, `buildings.deferred / rejected / seatEpoch / seats`, `models.*`,
vector and label censuses. It cannot read total VRAM, per-pass ms (shadow vs composer), or a
per-level imagery histogram (T73).

---

## 10. Seams and contradictions found across sources

- `RENDERING_ARCHITECTURE.md` §2.6 says the base skirt "is not built"; RC13 shipped it (rim lowered
  4 m, +0 vertices) on 2026-08-26c. Stale sentence.
- T54 says no RC row is open; RC14 (per-tile seat for stock OSM buildings over the patch) was never
  built and never closed. Registry gap.
- "Cascade 0's 536 MB" (ULTRA_ARCHITECTURE §13.1) vs 512 MiB from the RGBA8 + D24 arithmetic: the same
  number in decimal vs binary units.
- Milky Way 2k VRAM is "~8 MB" in DECISIONS and "~2 MB" in `tuning.ts:2064`; neither measured.
- T45 is closed (ULTRA light half) but the owner reopened shadows on 2026-09-01 with no backlog row.
- `MESH_SUITE_PLAN.md` §6 `TRANSLATE_MAX_M` 60 vs the shipped sanity rail 5 km (MS5b); doc drift.
- ARCHITECTURE.md's "1 concurrent decode on mobile" is not found in code (`halfSize: true` is universal).

---

## 11. Recommended audit order (for the owner to confirm)

1. **Measure before touching anything.** With the DBG window open at the Dnipro FPV pose, the
   ULTRA city and Everest poses, and the `/m` chart: record `frame.calls / tris / cpu / draw / gpu`,
   `mem.jsHeapMB`, per-renderer `lruMB`, composites, with 0 / 6 / 24 resident models (seed through
   `/api/dev-seed kind:"model"`, remove in `finally`), ULTRA on/off, shadows on/off (device tier
   force), tiers `high/mid/low` via `__quality.force`. Then the same on the iPhone 17 Pro through
   Safari's remote inspector. This replaces every ESTIMATED figure above.
2. **Shadow stability slice** (pure orchestrator + tuning; ULTRA-first, then baseline A/B): texel
   snap of the box centre in the light frame; extent hysteresis; metric bias on base; a far cascade
   or wide fade band on base instead of the 5 km cut; world-space rotation noise; a shimmer metric in
   `verify-ultra-dusk`.
3. **Seat pipeline slice**: spatial (per-tile) memo invalidation; dt-based eases; bake-time seats
   against the patched L13 TIN with the runtime raycast as the target-of-ease; per-feature `dy`
   attribute on the GPU.
4. **Streaming and workers slice**: worker-side GLB and MVT parse; bake-time edges (or a worker);
   GLB cache + instancing per URL; KTX2 for user-model textures; residency by projected size and
   VRAM bytes.
5. **Mobile slice**, gated by the step-1 device baseline: tier table from renderer string + screen;
   RC22 knobs; a VRAM budget; continuous render scale.

Each slice is a separate session under the §4a-style no-regression contract with the harness list in
§8 re-run.

---

## 12. Falsification record (gate verdicts on the headline claims)

| Claim | Check | Verdict |
|---|---|---|
| No draw-call / triangle / GPU reading is on record | grep `N draw calls`, `frame.calls` with a value across DECISIONS, rendering docs, memories → 0 hits | PASS |
| No BVH, log depth, async compile, WebGPU, `BatchedMesh`, worker tile parse in `src/` | grep `src/` for each; workers only in `lib/decode` and `lib/geo/bestSpot*`; `three-mesh-bvh` not in `node_modules` | PASS |
| Shadow box centre is never snapped to the texel grid | `shadowFit.ts:60-79` quantises extent only; `LightShadow.js`/`DirectionalLightShadow.js` contain no quantisation (track 3 source read) | PASS (source); browser effect UNVERIFIED |
| Height memo invalidation is global | `imageryGround.ts:907-911` bumps `terrainEpoch` on every ground `load-model`; `heightMemo.ts:63-72` drops on epoch change | PASS |
| Reseat off-cone takes tens of seconds | derived from measured counts (39,302 footprints, 16/frame) — not observed | CONTESTED until measured (step 1) |
| Defects are architectural, not tuning | strongest counter: the 2026-08-27 taste passes moved every shadow knob and the owner ruled the issue open on 2026-09-01; no knob addresses centre snapping, cascade dispatch or memo scope | PASS with the reservation that no shimmer metric exists yet |

Confidence: **84 %** overall (tracks 78–87 %). What would move it: the step-1 measurements, a browser
observation of the cascade-edge and caster-pop mechanisms, and one real-device run.

**Sources.** Tracks: `engine-state-tracks-2026-09-02/track{1..6}-*.md`. Docs: `rendering/RENDERING_ARCHITECTURE.md`,
`rendering/ULTRA_ARCHITECTURE.md`, `rendering/RENDERING_CHARTER_2026-08-25.md`,
`rendering/FPV_FIDELITY_AUDIT_2026-08-22.md`, `rendering/RENDERING_QUALITY_PASS.md`, `MOBILE_PLAN.md`,
`UPLIFT_PLAN.md`, `ULTRA_PLAN.md`, `MESH_SUITE_PLAN.md` §12, `DEBUG_HUD_PLAN.md`, `BAKED_ASSETS.md`,
`conventions/globe-tuning.md`, `skills/frame/references/tracked-backlog.md`, DECISIONS 2026-07-12 →
2026-09-02m. Code: `src/components/globe/{GlobeCanvas.tsx, StylizedTiles.ts, tuning.ts, scene/*}`,
`src/lib/globe/*`, `scripts/bake/**`, `node_modules/three/src`, `node_modules/3d-tiles-renderer/src`.
