# WEB RESEARCH PROMPT — state-of-the-art rendering techniques for PLUX (paste into web Claude)

*Companion to `ENGINE_STATE_2026-09-02.md`. Everything below the line is the prompt; it is
self-contained because the researcher has no access to the repository.*

---

You are a senior real-time rendering engineer doing an independent literature and ecosystem survey
for a specific shipped web application. Your job is to find which current techniques, engine
practices and three.js capabilities could improve this system, ranked by expected payoff against
its constraints, with primary sources. You are not designing the implementation; you are equipping
an audit team that knows the code. Today is 2026-09-02; prefer sources from 2023 onward and say when
something is older.

## 1. The system you are researching

**Product.** PLUX (`plux.today`): a browser app that projects a photographer's camera (position,
heading, pitch, focal length, time) as a frustum onto a stylized 3D globe with real terrain, real
OpenStreetMap buildings and an ephemeris-driven sky (sun, moon, planets, stars, eclipses), so people
can plan and re-live shots. Photographic and astronomical accuracy are product features: the sun and
moon are where the ephemeris puts them, terrain heights are real, buildings stand on the real ground.
The client does all rendering; the backend (Wix) only stores records.

**Stack (verified in the installed packages).** TypeScript, Astro 5, React 18 island, **three.js
0.185.0 on WebGL2 only** (no WebGPU path, no TSL/NodeMaterial), **`3d-tiles-renderer` 0.4.28**
(NASA-AMMOS) for streaming, zustand stores. Rendering is GLSL-string based: 22 raw `ShaderMaterial`s
across 14 modules plus 5 chained `onBeforeCompile` patches on `MeshStandardMaterial`. No compressed
textures, no `BatchedMesh`, no `three-mesh-bvh`, no `compileAsync`, no worker-side parsing of tiles
(workers are used only for RAW photo decode and one analysis feature).

**Scene.** World space is raw ECEF metres (magnitudes ~6.4e6). Three `TilesRenderer` instances
stream in parallel with independent LRU caches (400 MB each on the top tier) and download/parse
queues (25/5):
- **ground**: Cesium World Terrain quantized-mesh (L13 over Ukraine, i.e. ~2.4×1.6 km tiles with
  4 vertices) with our own Copernicus GLO-30 terrain patch swapped in per tile inside the same
  renderer, draped with Esri World Imagery composited per terrain tile onto a canvas texture (512²,
  4 hand-built mip levels and anisotropy 16 in the high-quality profile). This surface is the single
  vertical authority: every height in the app comes from a CPU raycast against it (`heightAt`,
  0.018–0.067 ms per sample, memoised on exact lat/lon under a "terrain epoch" that increments on
  every terrain tile arrival, which drops the whole memo).
- **buildings**: Cesium OSM Buildings (ion), restyled by swapping one shared `MeshStandardMaterial`
  per tile on load (flat shading, dark mass, emissive floor, screen-door reveal), plus a per-tile
  `EdgesGeometry` line child built synchronously on the main thread; masked out inside our baked
  regions.
- **enriched**: our own baked city tiles (Dnipro is the primary city: 133k features, 389 ~1 km cells,
  7.7 M vertices, 227 MB; plus St Albans and Everest terrain), 3D Tiles 1.1 with `refine ADD`, a root
  with no content over GE-0 leaf cells (so there is no coarse tier), per-cell GLB with contiguous
  per-feature vertex runs, ~60k trees per city as one `InstancedMesh` per cell. Buildings are baked at
  ellipsoid height 0 and lifted onto the rendered terrain at runtime by CPU vertex writes in four
  eased layers (group → cell → per-building → per-tree), first sample snaps, refinements ease at a
  fixed per-frame factor (no dt term). Seating budget: 6 cell + 64 building + 40 tree raycasts per
  frame, four "look-cone" cells prioritised; the rest round-robin (≈41 s to revisit all 39k loaded
  footprints at 60 Hz, estimated).
- User-uploaded GLB models (≤100k tris, ≤8 MiB, textures ≤2048²) placed in the world: ≤24 resident
  within 3 km under a 1.5 M-triangle budget, loaded by `GLTFLoader` on the main thread, no cache, no
  instancing, every mesh casts and receives shadows.

**Lighting and sky.** One `DirectionalLight` key driven by the ephemeris sun (colour and intensity
from authored curves over solar elevation), one `HemisphereLight`, a dedicated moon light; no
ambient light, no environment map, no IBL, no fog, no volumetrics. Only buildings, trees and user
models are lit materials; the earth, terrain drape, sky dome, stars and impostors are self-lit
custom shaders. The sky dome is analytic (exponential-density limb from orbit blending into a
low-altitude sky with a true-horizon haze band); an opt-in desktop **ULTRA** profile adds a
Rayleigh+Mie directional term, an afterglow band, aerial perspective (distance and view–sun angle
only, no surface normal), exposure, a dusk model (key extinction / sky level / afterglow curves),
terrain shadow casting and two shadow cascades. A solar/lunar eclipse model darkens the world
topocentrically. Tone mapping is three's `NeutralToneMapping`; post chain is
`RenderPass → UnrealBloom → OutputPass` into a HalfFloat MSAA×4 target; MSAA is the only
anti-aliasing. GTAO is wired but off.

**Shadows (the owner's top visible complaint).** One ortho `PCFShadowMap` (three 0.185: `PCFSoft`
is rewritten to PCF; softness = `shadow.radius` on a 5-tap Vogel disk rotated per pixel by
interleaved gradient noise). Map 4096² (high tier), 8192² ULTRA. The ortho box is re-fitted every
frame: half-extent `clamp(max(alt·K, viewDist/2 + 800 m), 1600 m, 5 km)` rounded up to 128 m, centred
on the viewer's ground point pushed along the horizontal look direction — **the centre is never
snapped to the texel grid**, only the extent is quantised. Base profile: no cascade, a hard cut to
lit at 5 km, bias as a raw fraction of a depth range that moves with altitude, shadows fade out over
the last 3° and stop at +0.46° sun elevation. ULTRA: bias in metres, cascades 4096² to 60 km and
2048² to 260 km centred on the eye, refreshed on discrete triggers, **composed by plain
multiplication with no cascade dispatch or blend band**; lit materials receive only the first
cascade. Terrain casts only in ULTRA (custom depth material, `shadowSide=FrontSide`). The owner's
words after the last round: shadows are "cropped, sliced, hollow and incomplete", must "become
darker and more global, not just disappear", and must not return to "super elongated naive shadows".
Measured costs: ULTRA adds +18 % frame time in the city (30.7 → 36.1 ms on an M3 Pro at DPR 2); the
cascade ladder +7–10 % and +168 MB.

**Quality tiers and mobile.** A device tier (high/mid/low) from the GPU renderer string,
`deviceMemory`, cores, `maxTextureSize` and `(pointer: coarse)`; a governor steps tiers on an EMA of
CPU-side frame time only (it cannot see GPU time, heat or memory). `high` is byte-identical to the
pre-tiering constants, locked by tests. The mobile shell (`/m`) is planning-only, a 2D chart by
default with first-person-view touch: DPR 1.25, bloom off, 1024² shadows still on to 30 km,
Esri z18, 2k textures, imagery composites 512², a cached PiP map. **No performance number has ever
been taken on a real phone**; the owner's iPhone 17 Pro shows tile storms and Safari page reloads
(memory). iPhone 17 is the priority mobile target.

**Precision.** ECEF float32 in shaders only for haze distance; everything else relies on three's
float64 CPU matrices with centre-relative tile geometry. Depth: 24-bit over 1 m–180 km in FPV, no
shimmer observed; reversed-Z/log depth was rejected on that evidence.

## 2. Binding constraints — an answer that violates one is useless

1. **No accuracy regression.** Cartographic and 3D accuracy, ephemeris, plans and predictions, sky
   features may not change. Terrain heights stay WGS84-ellipsoidal from the tile data; no runtime
   geoid; buildings stand on the rendered terrain.
2. **Byte-identical top tier and exact off-state.** The default desktop look must not change without
   an explicit owner decision; the ULTRA chip off must change zero pixels (tested by identity). New
   techniques therefore ship ULTRA-first or as a new opt-in profile, then get A/B'd into baseline.
3. **WebGL2 today.** three.js 0.185 WebGL renderer; the GLSL-string look would need a rewrite for
   WebGPU/TSL. You may report WebGPU-only techniques, but label them as such and estimate the
   migration cost separately.
4. **Streaming world.** Casters and receivers arrive and leave continuously; anything that needs a
   static scene (baked lightmaps, probe volumes, precomputed visibility) must be reconciled with
   tiles arriving mid-frame.
5. **Globe scale.** One frame can span 1 m to 180 km; the same rig serves orbit, a mountain and a
   street.
6. **Ephemeris-driven.** Sun and moon directions come from an astronomy library at a scene time the
   user scrubs; there is no "time of day" slider abstraction to fake.
7. **Chained shader patches.** three keys its program cache on `onBeforeCompile.toString()`; anything
   that *assigns* `onBeforeCompile` (three's `csm` add-on does) breaks the existing patches. Solutions
   must chain.
8. **Better graphics at the same desktop frame rate is acceptable**; mobile must get faster or lighter.

## 3. Already refuted or rejected here — do not re-propose without new evidence

| Candidate | Why it was rejected (measured unless marked argued) |
|---|---|
| three's `csm` add-on | assigns `onBeforeCompile`; no cascade dispatch in `ShadowMaterial`; three extra lights force a recompile; its "already done" claim measured false |
| PCSS | not in the three package; needs a raw depth read while three's PCF path uses hardware-compare samplers (argued) |
| VSM | every receiver becomes a caster → 768 MiB at 8192² (argued) |
| Real-time GI, ray tracing | owner-ruled out for cost; streaming tiles cannot hold probes |
| TAA | continuous camera drift, no motion vectors in 22 custom materials, smears the screen-door dithers (argued) |
| Reversed-Z / logarithmic depth | 24 bits over 1 m–180 km, no shimmer in 10 browser legs |
| `BatchedTilesPlugin` (3d-tiles-renderer) | forces one material; kills the per-tile restyle, reveal, tint and dissolve |
| More aggressive imagery refinement on desktop | error target forced to 0.05 produced zero extra tiles: imagery is availability-capped by the provider |
| Terrain LOD geomorphing | the height sampler is a CPU raycast; TIN levels have no vertex correspondence (argued) |
| Flattening terrain under footprints | 38×25 m posting has no tessellation; self-confirming height fixed point (argued) |
| Bake-time curvature fix for building float | 0.568 m residual against 14.2 m of within-cell relief (4 %) |
| Predicate-based on-demand rendering | 40+ per-frame animation sources; a false negative freezes the globe; a heartbeat gate ships off |
| Half-rate PiP rendering | the composer overwrites the PiP rect every frame → flicker |
| Full auto-generated mip chains on imagery composites | transparent-border bleed; a capped 4-level manual chain shipped |
| Procedural window emissive on buildings | owner rejected twice on look |
| Google Photorealistic 3D Tiles | no coverage over Ukraine and a ToS that forbids restyling |
| Raising parse concurrency / blanket LRU raise on phones | main-thread hitches / memory kills |

## 4. Research questions — answer each with sources

For every question: name the technique(s), the primary source (paper, engine documentation, three.js
source or docs for r185, browser/OS documentation, WebKit/Chromium bug or blog), whether it works on
**WebGL2** or needs WebGPU, its known cost from the literature or from benchmarks (numbers, with the
hardware they were measured on), the risk to accuracy or to the constraints above, and your
confidence. If a technique is common practice but you cannot find a citable source, say so.

**Shadows**
- **Rq-1.** Stable cascaded/ortho shadow maps in a huge world: texel-grid snapping of the light-space
  origin (and how to do it robustly when world coordinates are ~6.4e6 m and the light frame must be
  built in float64 on the CPU), extent hysteresis, cascade selection/dispatch and blend bands, per-
  cascade bias in metres, contact hardening alternatives to PCSS that fit hardware-compare PCF,
  temporal-stable soft-shadow noise (world-space vs screen-space rotation), shadow-map caching for
  static casters (terrain) with per-tile invalidation, and how engines (Unreal, Unity HDRP, Godot 4,
  CesiumJS, Google Earth web) size and fade shadows across altitude from orbit to street. Also: is
  there any current three.js (r170+) or community CSM implementation that chains rather than assigns
  `onBeforeCompile`, or exposes cascade selection to a custom `ShadowMaterial`?

**Lighting, atmosphere, weather**
- **Rq-2.** Physically based sky and aerial perspective at real-time cost: Bruneton/Hillaire-style
  precomputed LUTs (transmittance, multiple-scattering, sky-view, aerial-perspective volume), their
  WebGL2 feasibility (texture sizes, update cost when the sun moves per frame under a time scrub),
  existing three.js/WebGL implementations, and how to derive a coherent key-light chroma, sky
  radiance, hemisphere/ambient irradiance and distance haze from one model so that dusk, eclipses
  and the terminator agree by construction. Include how such a model treats an observer above the
  atmosphere (the app also renders from low orbit).
- **Rq-3.** Cheap-to-real clouds and weather in a globe renderer: 2D noise cloud layers, cloud
  shadows on terrain, volumetric ray-marched clouds at reduced resolution, fog/haze volumes,
  precipitation particles; their costs on WebGL2 and on mobile; any three.js-ready implementations.
  Note interactions with ephemeris-accurate sun/moon rendering (clouds must not move the sun).

**Terrain seating and precision**
- **Rq-4.** How engines seat objects on streamed terrain without per-object CPU raycasts: height
  fields sampled on the GPU (vertex-shader displacement from a heightmap texture per tile), bake-time
  per-feature or per-vertex heights against the shipped TIN, spatially-keyed invalidation when a
  terrain tile refines, frame-rate-independent easing (`1 − exp(−dt/τ)`), terrain-conformed building
  bases (plane fit vs skirts). Cite CesiumJS clamp-to-ground, Unreal Landscape/World Partition,
  Unity terrain, Google Earth or any published approach. Note the WGS84-ellipsoidal datum constraint.

**Geometry throughput, batching, LOD**
- **Rq-5.** Instancing and batching strategies in three.js r185 for many user-placed GLBs of mixed
  materials: `InstancedMesh` per asset URL, `BatchedMesh` (capabilities and limits in r185, including
  per-instance attributes, sorting, frustum culling, texture arrays), per-material geometry merges,
  and what breaks shadows or custom `onBeforeCompile` patches.
- **Rq-6.** Off-main-thread asset pipelines on the web: parsing GLB/glTF and MVT vector tiles in
  Workers, transferring geometry buffers, `ImageBitmap`/`createImageBitmap` texture decode, KTX2/Basis
  transcoding in workers, and how 3d-tiles-renderer 0.4.x can be driven with worker fetch/parse
  (document what the library supports natively and what has to be added).
- **Rq-7.** Batching stock building tiles while keeping a per-tile reveal/tint/dissolve: per-instance
  or per-vertex attributes carried through `BatchedMesh`, or alternatives (uniform buffer objects /
  `UniformsGroup` in three r185, texture-driven per-tile parameters).
- **Rq-12.** HLOD and impostors for city-scale building sets in WebGL2: coarse merged tiers per
  cell, region proxies at altitude, octahedral impostors/billboards for far buildings and for user
  models, the 3D Tiles 1.1 features that support this (implicit tiling, `refine REPLACE` mixed
  hierarchies), and how CesiumJS / Cesium OSM Buildings / Google 3D Tiles handle far-field density.
- **Rq-16.** What a "simplified Nanite" realistically means on the web today: meshlet/cluster
  rendering and GPU-driven culling in WebGPU (compute) and whether any part is achievable in WebGL2
  (multi-draw-indirect extensions, `WEBGL_multi_draw`, transform feedback tricks); three.js's WebGPU
  renderer status for GPU-driven pipelines as of 2026; honest verdict on whether it is worth
  anything for low-poly OSM prisms.

**Textures and memory**
- **Rq-13.** GPU-compressed texture pipelines for user-uploaded models on the web: KTX2 with
  Basis/UASTC → ASTC on iOS / BC7 on desktop, encoder options in the browser or at upload, three's
  `KTX2Loader` requirements, VRAM savings and decode-hitch elimination numbers; also texture memory
  accounting in WebGL2 (`renderer.info`, extensions, heuristics per renderer string) and texture
  streaming/residency budgets used by web globes.

**Culling and spatial structures**
- **Rq-14.** Occlusion culling options in WebGL2 (no compute): GPU occlusion queries
  (`EXT_disjoint_timer_query` aside, `ANY_SAMPLES_PASSED` availability and latency), software
  hierarchical-Z on a downsampled depth readback, conservative horizon/skyline occluders for
  terrain, and the known failure mode of culling feeding a streaming eviction loop. Cite CesiumJS,
  deck.gl, Google Earth, or papers.
- **Rq-17.** Spatial acceleration for picking and height queries in three.js: `three-mesh-bvh`
  (current version, worker build, `firstHitOnly`, memory cost on streamed tiles), grid/octree
  structures for 40k footprints, and their construction cost when tiles arrive and leave.

**Post-processing, AA, shaders**
- **Rq-15.** Post-process AA that suits a globe with dithered transparency and a constantly drifting
  camera (SMAA, FXAA, CMAA2; TAA caveats), MSAA vs post-AA cost on tile-based mobile GPUs; async
  shader compilation in three r185 (`renderer.compileAsync`, `KHR_parallel_shader_compile`) and how
  to avoid first-appearance compile hitches; `UniformsGroup`/UBO support in three r185; reducing
  `discard`-based transparency (alpha-to-coverage with MSAA, ordered dither) so early-Z works;
  render-target pooling and HDR bloom cost reductions (fewer mips, half-res) in `EffectComposer`.

**Photorealistic still**
- **Rq-8.** A "render this frame" offline-quality still from a real-time WebGL2 scene: progressive
  accumulation with sub-pixel jitter (SSAA), forcing finest LOD and maximum shadow resolution for a
  single capture, tile-based capture for resolutions above the canvas, and the feasibility of
  `three-gpu-pathtracer` (or similar) on scenes with custom `ShaderMaterial`s and chained patches:
  what it needs from materials, its memory footprint on 5–8 M-vertex city sets, and rendering time
  on an M-series Mac. Give a recommended ladder from cheapest to most photoreal.

**Mobile, iPhone 17, Safari**
- **Rq-9.** The current (2026) state of WebGL2 on iOS Safari / iPhone 17 (A19-class GPU): documented
  limits (max texture size, renderbuffer size, MSAA sample counts, `EXT_color_buffer_half_float` /
  RGBA16F render-target support, `EXT_disjoint_timer_query_webgl2` absence, `powerPreference`
  honouring, `WEBGL_debug_renderer_info` string "Apple GPU"), the WebGL memory ceiling before Safari
  kills the page (jetsam) and how developers detect memory pressure, and whether WebGPU on iOS Safari
  is shipping and usable for three.js by 2026. Cite WebKit release notes, bug trackers, or measured
  reports; label anything anecdotal.
- **Rq-10.** Dynamic resolution scaling and upscaling on mobile web: continuous render scale (not
  DPR steps), temporal or spatial upscalers feasible in WebGL2 (FSR 1.0-style EASU/RCAS, bilinear +
  sharpen), thermal-throttling proxies available in browsers (frame-time drift, `navigator`
  signals), and how mobile web maps (Google Maps web, Mapbox GL, CesiumJS, deck.gl) tier their
  rendering by device.
- **Rq-11.** Reduced shadow and lighting tiers that keep the look plausible on phones: shadow
  distance caps, lower-frequency shadow updates, baked/approximate ambient occlusion in tile data,
  and any evidence on tile-based-GPU (Apple) costs of shadow maps and HalfFloat MSAA targets.

## 5. Deliverable format

1. **Executive ranking** (one table, ≤25 rows): lever · which questions it answers · expected gain
   (visual and/or performance, quantified where the literature allows) · implementation cost
   (S/M/L with a sentence) · risk to accuracy/constraints (§2) · WebGL2 or WebGPU-only ·
   confidence · sources. Rank by gain ÷ risk for this system, not in general.
2. **Per-question sections** (Rq-1 … Rq-17) with the evidence, the numbers with their hardware, and
   a one-line "applies here / does not apply because …" verdict.
3. **iPhone 17 / iOS Safari section** consolidating every hard limit you found, with the source and
   its date.
4. **three.js 0.185 and 3d-tiles-renderer 0.4.x specifics**: exact API names that exist in those
   versions (verify against the release's docs or source, not from memory), and features that only
   exist in newer releases (say which release).
5. **A "do not do" list** where your research confirms one of our rejections or finds a new trap.
6. **Open questions** you could not settle, with the experiment that would settle each.

Rules: cite primary sources with URLs; when a number is from a vendor blog or an anecdotal
benchmark, say so; never invent an API name — if unsure whether three r185 has it, mark it "verify";
prefer measured costs to opinions; keep prose plain; tables over paragraphs where the parts are real.
