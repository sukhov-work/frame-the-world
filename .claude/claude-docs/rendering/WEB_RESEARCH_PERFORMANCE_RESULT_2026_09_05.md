# State-of-the-Art Rendering Techniques for PLUX: An Independent Survey

Confidence tags: [VERIFIED] confirmed by a primary source or two independent sources; [INFERRED] reasoned from evidence; [UNVERIFIED] plausible but unconfirmed; [ASSUMPTION] operator-supplied or a stated default. Numbers carry the hardware where the source gives it; where a source omits the hardware, the figure is flagged.

## 1. Executive ranking

Ranked by gain ÷ risk for PLUX specifically, not in general. Gain is visual and/or performance; risk is to the §2 constraints (no accuracy regression, byte-identical top tier and exact off-state, WebGL2-only, streaming world, globe scale 1 m–180 km, ephemeris-driven, chained shader patches).

| # | Lever | Rq | Expected gain | Cost | Risk to §2 | WebGL2? | Conf | Primary source |
|---|---|---|---|---|---|---|---|---|
| 1 | Texel-grid snap the ULTRA cascade centre in float64 (not just extent) | Rq-1 | Kills the crawl the owner calls "sliced"; ~one matrix op/cascade | S | Very low; ULTRA-only | Yes | [VERIFIED] Valient ShaderX6; TheRealMJP Shadows |
| 2 | Cascade dispatch + blend band + per-cascade metre bias | Rq-1 | Removes the seam and the "hollow" transition | S | Low, ULTRA-only | Yes | [VERIFIED] MS "Common Techniques to Improve Shadow Depth Maps" |
| 3 | `compileAsync` prewarm of the 22 materials | Rq-15 | Removes first-appearance compile stalls (74.6 ms M1 case) | S | None | Yes | [VERIFIED] three docs; r3f #3073 |
| 4 | KTX2/UASTC for user-GLB textures via `KTX2Loader` | Rq-13 | 4–8× texture VRAM cut; kills decode hitch; direct iPhone memory relief | M | Low; user assets only | Yes | [VERIFIED] Khronos KTX guide; Basis Universal |
| 5 | Continuous render-scale + FSR1 EASU/RCAS upscale on mobile | Rq-10 | Sustains 60 Hz under thermal load; 17 taps total | M | Low; mobile-only | Yes | [VERIFIED] AMD GPUOpen FSR1; Shadertoy stXSWB |
| 6 | Terrain shadow-map caching keyed to terrain epoch | Rq-1 | Cuts ULTRA terrain caster cost; terrain is static between loads | M | Medium; reconcile with streaming | Yes | [VERIFIED concept] Cesium ShadowMap; MS doc |
| 7 | `three-mesh-bvh` for `heightAt` + picking, worker-built per tile | Rq-17, Rq-4 | log-depth raycast vs 0.018–0.067 ms linear; 40k-footprint picking | M | Low; additive | Yes | [VERIFIED] gkjohnson three-mesh-bvh 0.9.x |
| 8 | Hillaire sky-view + aerial-perspective LUTs; one model drives key/ambient/haze | Rq-2 | Dusk, terminator, eclipse agree by construction; ~590 KiB LUTs | L | Medium; match ephemeris curves | Yes | [VERIFIED] Hillaire 2020 CGF 14050 |
| 9 | `1−exp(−dt/τ)` frame-rate-independent seating ease | Rq-4 | Fixes latent frame-rate-dependent ease bug | S | Very low | Yes | [VERIFIED technique] |
| 10 | GPU heightfield seating (vertex displacement from per-tile height texture) | Rq-4 | Removes per-frame CPU raycast seating budget | L | Medium; datum + fixed-point care | Yes | [INFERRED] Cesium clamp-to-ground; cesium-martini |
| 11 | SMAA as a desktop opt-in over MSAA | Rq-15 | Cleaner edges on dithered transparency | S | Low | Yes | [VERIFIED] SMAA/CMAA survey |
| 12 | UBO (`UniformsGroup`) or data-texture for per-tile building params | Rq-7 | Fewer uploads; keeps per-tile restyle while batching | M | Medium; chained-patch interaction | Yes | [VERIFIED] three `UniformsGroup` |
| 13 | Worker KTX2/Draco tile decode via `GLTFExtensionsPlugin` | Rq-6 | Heaviest decode off main thread | M | Low | Yes | [VERIFIED] 3DTilesRenderer CHANGELOG |
| 14 | Octahedral impostors / coarse REPLACE tier for far buildings | Rq-12 | Large draw-call + vertex cut at altitude | L | Medium; swap popping | Yes | [VERIFIED mechanism] 3D Tiles 1.1 HLOD |
| 15 | Alpha-to-coverage to replace `discard` screen-door under MSAA | Rq-15 | Restores early-Z; less overdraw | M | Medium; A/B vs baseline | Yes | [VERIFIED] three `alphaToCoverage` |
| 16 | Half-res, fewer-mip bloom in `EffectComposer` | Rq-15 | Bloom cost down; TBDR bandwidth relief | S | Low | Yes | [INFERRED] pmndrs postprocessing |
| 17 | Progressive SSAA "render this frame" still (sub-pixel jitter) | Rq-8 | Offline-quality capture, no new renderer, all 22 materials | M | Low; capture path only | Yes | [VERIFIED] three jitter accumulation |
| 18 | 2D cloud layer + terrain cloud-shadow (ULTRA + mobile) | Rq-3 | Weather without moving the ephemeris sun | M | Medium; must not tint sun | Yes | [VERIFIED] Heckel/Front Dev cloudscapes |
| 19 | Software horizon/skyline occluder for terrain | Rq-14 | Cheap off-horizon cull | M | Medium; can feed eviction loop | Yes | [VERIFIED concept] Cesium horizon culling |
| 20 | Reduced mobile shadow tier (distance cap, low-rate update, MSAA×2) | Rq-11 | Frame-time headroom on A19 TBDR | S | Low; mobile-only | Yes | [VERIFIED] Apple TBDR WWDC20 |
| 21 | Volumetric raymarched clouds at 1/4 res (desktop ULTRA only) | Rq-3 | Hero realism; 128→8 steps + jitter | L | High; TAA conflicts with dither | Yes | [VERIFIED cost] Toft/Bowles arXiv 1609.05344 |
| 22 | GPU occlusion queries (`ANY_SAMPLES_PASSED`) | Rq-14 | Possible draw cull | M | High; iOS false positives, ≥1-frame latency | Yes | [VERIFIED] MDN; webgl-dev-list |
| 23 | `three-gpu-pathtracer` for the still | Rq-8 | True-GI still, but standard materials only | L | High; custom shaders unsupported | Yes | [VERIFIED] gkjohnson three-gpu-pathtracer |
| 24 | "Simplified Nanite" meshlet/GPU-driven cull | Rq-16 | Near zero for low-poly OSM prisms | L | Very high; WebGPU-only | No | [INFERRED] three WebGPU status |

## 2. Per-question sections

### Rq-1 — Stable cascaded/ortho shadows in a huge world

**Texel snapping is the missing piece.** The canonical fix for the crawling edges the owner calls "sliced" is Valient's stable-CSM method: wrap each cascade's frustum slice in a bounding sphere (rotationally invariant, so extent does not change as the camera turns), then snap the light-space projection origin to shadow-map texel increments every frame. The rounding is a translation applied to the projection matrix: project the world origin into shadow texture space, round to the nearest texel, translate back, with `dx /= shadowMapSize * 0.5`. [VERIFIED] (Valient, "Stable Rendering of Cascaded Shadow Maps," ShaderX6, 2008; TheRealMJP `Shadows/MeshRenderer.cpp` StabilizeCascades; alextardif.com "Cascaded Shadow Maps with Soft Shadows"). PLUX quantises the extent to 128 m but never snaps the centre. That single omission produces sub-texel swimming. The robust method at ECEF magnitude: build the light view in float64 on the CPU (three already keeps float64 matrices), compute the origin's projected texel fraction, and fold `(round − actual)` back as a light-space translation before the float32 matrix upload. Because the snap is a translation, the ~6.4e6 m magnitude never enters the rounding term, only the centre-relative offset does, so the float32 upload stays precise. [INFERRED]. Verdict: **applies here** for the ULTRA cascades and the base ortho box; it is the single highest gain-÷-risk change in this report.

**Extent hysteresis.** Round the sphere radius up to a fixed increment (`ceil(radius*16)/16` in published impls) so extent changes in discrete steps. PLUX already does this via 128 m rounding. [VERIFIED] (gamedev.net stable-CSM threads). Verdict: **already partially done**.

**Cascade dispatch, blend bands, per-cascade metre bias.** Microsoft's "Common Techniques to Improve Shadow Depth Maps" documents cascade selection by view-depth interval, a blend band across the cascade boundary to hide the seam, and bias in world units per cascade. PLUX composes ULTRA cascades "by plain multiplication with no cascade dispatch or blend band," which is exactly what yields the seam and the "hollow" transition. The fix is a real dispatch (sample the tightest cascade containing the fragment) plus an overlap band that lerps the two cascade factors over a small depth window. [VERIFIED for the technique] (MS Learn shadow doc). Verdict: **applies here**.

**Contact hardening without PCSS.** PLUX's PCSS rejection is sound: the three PCF path uses hardware-compare samplers, and PCSS needs a non-compare depth read for the blocker search. A compare-friendly substitute is a small-kernel PCF whose world-space radius scales with cascade index, approximating contact hardening at no extra sampler cost. [INFERRED]. Verdict: **applies as a cheaper substitute**.

**Temporal-stable soft-shadow noise.** PLUX rotates a 5-tap Vogel disk by interleaved gradient noise in screen space; screen-space rotation crawls under camera drift. Rotating in world space (hash the receiver's world position) makes the penumbra dither stable frame-to-frame. This is common practice; I could not find a single citable primary source stating it for Vogel-disk PCF specifically. [INFERRED, common practice, no citable source found]. Verdict: **applies here**.

**Static-caster shadow caching.** Terrain is static between tile arrivals, so its shadow depth can be rendered once per cascade and reused, re-rendering only cascades whose tiles changed under the terrain-epoch signal PLUX already maintains. Cesium re-renders every frame; the caching concept is documented in the MS shadow doc and game engines. [VERIFIED concept]. Verdict: **applies here**, keyed to the existing terrain epoch, and it directly attacks the +18 % ULTRA city cost (30.7 → 36.1 ms on an M3 Pro at DPR 2 [ASSUMPTION, operator-measured]).

**How engines size and fade across altitude.** CesiumJS `ShadowMap` uses 4 cascades by default ("numberOfCascades Number 4 ... Supported values are one and four"), `maximumDistance` default 5000.0 ("Lower values improve shadow quality"), `size` default 2048, and `fadingEnabled` default true ("shadows start to fade out once the light gets closer to the horizon"). [VERIFIED] (cesium.com ShadowMap ref-doc). PLUX's fade over the last 3° and cut at +0.46° sun elevation is the same family. Verdict: adopt Cesium's 4-cascade `maximumDistance`-driven sizing over PLUX's two-cascade 60 km/260 km ladder for the street-to-mountain range; keep the orbit fade for the +0.46° cut.

**CSM that chains, not assigns.** The three.js `examples/jsm/csm/CSM.js` addon exists at r185, and `CSM.setupMaterial(material)` **assigns** `material.onBeforeCompile`, overwriting any existing patch. This is a documented defect (StrandedKitty/three-csm #26: "setupMaterial() overrides a material's onBeforeCompile function if it already exists ... The solution would be to compose it"). [VERIFIED]. No upstream or community CSM at r185 chains `onBeforeCompile` or exposes cascade selection to a custom `ShadowMaterial`. Verdict: PLUX's `csm` rejection **stands confirmed**; a bespoke chained patch is required.

### Rq-2 — Physically based sky and aerial perspective

Hillaire 2020 ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique," Computer Graphics Forum 39(4):13–22, DOI 10.1111/cgf.14050, Epic Games) replaces high-dimensional LUTs with four small RGBA16F tables. Sizes and per-frame costs from Table 1 and the paper's timings: Transmittance 256×64 (128 KiB), Multiscattering 32×32 (8 KiB, 0.12 ms), Sky-View 192×128 (~198 KiB), Aerial-Perspective 32×32×32 froxel volume (256 KiB, 0.11 ms), total ~590 KiB. [VERIFIED] (Hillaire 2020; readkong and CESCG Vulkan-paper reproductions of the table). The GPU behind the millisecond figures is not named in the reproductions. [UNVERIFIED hardware]. If a hardware-anchored volumetric figure is later needed, a 2025 UE study (arXiv:2502.08107) benchmarks named GPUs at 1080p.

The froxel aerial-perspective volume gives distance-and-view-angle inscatter that PLUX's ULTRA aerial term (distance and view–sun angle only, no surface normal) already approximates; the LUT version adds altitude parameterisation and handles the low-orbit view the paper explicitly targets ("render the atmosphere of a planet from ground to space views"). [VERIFIED]. WebGL2 feasibility is strong: the LUTs are tiny and the sun moves only on a time-scrub, so a full recompute is needed on scrub, not per frame. Reference implementations: the Shadertoy "Production Sky Rendering" (slSXRW, WebGL) and `webgpu-sky-atmosphere` (JolifantoBambla, WebGPU-only). VIRUP (arXiv 2110.04308) ports the model for a planetarium and notes the multiple-scattering and aerial LUTs can be dropped when terrain height is not accounted for, which does not apply to PLUX since PLUX has real terrain. [VERIFIED]. Driving key-light chroma, sky radiance, hemisphere irradiance and haze from the single transmittance/sky-view pair is how the model stays coherent so dusk, eclipse and terminator agree by construction. [INFERRED]. Verdict: **applies here, ULTRA-first**; the accuracy risk is matching PLUX's authored solar-elevation curves to the LUT output, which is testable (see §6).

### Rq-3 — Cheap-to-real clouds and weather

Three cost tiers. (1) 2D animated noise cloud layer on the sky dome with a projected cloud-shadow term on terrain: cheap, WebGL2, mobile-safe. (2) Volumetric raymarched clouds. The reference cost is Toft, Bowles and Zimmermann, "Optimisations for Real-Time Volumetric Cloudscapes" (arXiv:1609.05344, Studio Gobo/Cambridge): the naive reference "requires ≈128 raymarch steps with ≈6 lighting steps each, per pixel," and the teaser reports "128 raymarch steps (draw time 297.7 ms) ... 8 steps ... (draw time 2.3 ms) ... 8 steps with a random offset ... (draw time 7.5 ms) ... with TAA applied to reduce noise (draw time 7.5 ms)," achieving "visually similar results with 1/16 the number of steps." [VERIFIED]. The paper names no GPU. [UNVERIFIED hardware]. Guerrilla/Horizon-style Worley volumes cost 144 MiB for the noise LUTs alone (128 MiB base + 16 MiB detail, CESCG Vulkan paper). [VERIFIED]. (3) Half/quarter-res offscreen buffer with depth-aware upsample (ChaliceUnity documents half and quarter res; quarter is visibly worse). [VERIFIED].

Ephemeris interaction: clouds must sample the sun direction and never move it. The 2D layer is the only tier safe on the iPhone 17. Volumetric clouds depend on TAA to denoise the 8-step march, and PLUX rejected TAA (no motion vectors in 22 custom materials, smears the screen-door dithers). [INFERRED]. Verdict: 2D layer + terrain cloud-shadow **applies** (ULTRA and mobile); volumetric clouds are **desktop-ULTRA only** and only with a cloud-isolated reprojection buffer that does not touch the dithered materials.

### Rq-4 — Seating objects on streamed terrain without per-object CPU raycasts

Engines seat objects three ways. (1) GPU heightfield displacement: sample a per-tile height texture in the vertex shader and lift base vertices there, removing the CPU raycast; standard terrain-conform practice, no single citable primary. [INFERRED, common practice]. (2) Bake-time per-vertex heights against the shipped TIN. (3) CesiumJS clamp-to-ground: `HeightReference.CLAMP_TO_GROUND` clamps entity/vector geometry to terrain, and Cesium issue #9533 documents the exact failure PLUX already avoids: per-frame reclamping is a penalty, and the proposed fix is PLUX's model, "clamping results could be cached ... recompute heights only when the containing terrain tile's height data is updated." [VERIFIED].

Frame-rate-independent easing must use `1 − exp(−dt/τ)`, not a fixed per-frame factor. PLUX's "fixed per-frame factor (no dt term)" makes the ease speed frame-rate dependent, a latent bug that changes seating behaviour between 30 and 60 Hz. [VERIFIED technique, standard]. Verdict: the `1−exp(−dt/τ)` fix **applies immediately, S-cost, very low risk**. GPU heightfield seating **applies** but must be reconciled with the WGS84-ellipsoidal datum authority and the self-confirming height fixed point PLUX depends on; keep `heightAt` as the single vertical authority and treat GPU seating as an L-cost visual smoothing layer, not a datum change.

### Rq-5 — Instancing and batching for mixed-material user GLBs

`THREE.BatchedMesh` exists at r185 with per-instance color (`setColorAt`, Color or Vector4 for alpha), per-instance visibility (`setVisibleAt`), per-object frustum culling (`perObjectFrustumCulled`, default true), sorting (`sortObjects` + `customSort`), and multi-draw via the `WEBGL_multi_draw` extension. [VERIFIED] (three BatchedMesh docs; r184 getColorAt fix #33079). It has **no** first-class arbitrary per-instance custom-attribute API; per-instance data beyond matrix/color/visibility/geometryId must be packed into a texture (community extensions do this). [VERIFIED]. A BatchedMesh needs one shared material, which is why the operator's `BatchedTilesPlugin` rejection holds for restyle-per-tile buildings. For ≤24 resident user GLBs of mixed materials under a 1.5 M-triangle budget, the payoff of batching is small; use one `InstancedMesh` per asset URL where the same model repeats. Shadows and chained `onBeforeCompile` patches survive both because both use the standard material program. [INFERRED]. Verdict: `InstancedMesh` per URL **applies** for repeated user models; BatchedMesh **applies only** to material-compatible groups and is **low priority** at 24 models.

### Rq-6 — Off-main-thread asset pipelines

3DTilesRenderer 0.4.x parses tile glTF on the **main thread** via three's `GLTFLoader`; there is no native glTF-in-Worker path. Draco and KTX2 decoders spawn their own workers, so wiring `GLTFExtensionsPlugin` with `DRACOLoader`/`KTX2Loader` moves the heaviest decode off-thread; MeshoptDecoder is supported since [0.3.40]. [VERIFIED] (CHANGELOG: `GLTFExtensionsPlugin` added [0.3.39] 2024.10.15). The library mitigates main-thread stalls by asynchronously processing child tiles ([0.4.8]) and throttling via download/parse queues rather than worker-parsing. `createImageBitmap` texture decode and transferable geometry buffers are the standard web levers; MVT vector-tile parsing in a worker is external to the library. [VERIFIED for library behaviour]. Verdict: worker KTX2/Draco decode **applies** (M-cost, low risk); a full worker glTF parse **does not exist** in the library and would have to be built, matching the operator's "no worker-side parsing of tiles" observation, which is a library limit not a config miss.

### Rq-7 — Batching stock building tiles while keeping per-tile reveal/tint/dissolve

BatchedMesh carries per-instance color/visibility but not arbitrary per-tile scalars (reveal phase, dissolve threshold) as first-class attributes. Two viable carriers: pack per-tile params into a data texture indexed by the per-instance id, or upload a per-tile parameter block via `THREE.UniformsGroup` (UBO, WebGL2). Both exist at r185. [VERIFIED] (three UniformsGroup; BatchedMesh docs). The reveal/tint/dissolve then reads the texture/UBO inside a chained `onBeforeCompile` patch. This is the only path that keeps the per-tile restyle while cutting draw calls, and it is why `BatchedTilesPlugin` (one material, no per-tile restyle) was correctly rejected. Critical caveat: three keys the program cache on `onBeforeCompile.toString()`, so identical patch bodies across variants collide unless `Material.customProgramCacheKey()` (exists at r185) differentiates them. Verdict: **applies as a bespoke build**, medium risk from the chained-patch and cache-key interaction.

### Rq-8 — "Render this frame" offline-quality still

Recommended ladder, cheapest to most photoreal. (1) Progressive SSAA: accumulate N sub-pixel-jittered frames into the HalfFloat target with the camera held still. Pure win, works with all 22 custom materials, no dependency. (2) Force finest tile LOD (error target → 0) and max shadow resolution for the single capture, then accumulate. (3) Tile-based capture: render the frame in tiles at a shifted projection for resolutions above the GL max renderbuffer, stitch on CPU. (4) `three-gpu-pathtracer` (gkjohnson): WebGL2, packs BVH+geometry into textures, supports GGX, textures, normal maps, emission, env maps, tiled rendering (`tiles` default (3,3), `bounces` 10, `renderScale`). [VERIFIED capability] (README/DeepWiki). Its hard blocker for PLUX: it requires standard PBR material data, so the 22 raw `ShaderMaterial`s and chained patches are **unsupported** without re-authoring each as a MeshStandardMaterial equivalent, and its BVH textures on the 7.7 M-vertex Dnipro set are a large VRAM cost. [VERIFIED constraint]. No citable M-series render-time figure was found. [UNVERIFIED]. Verdict: SSAA accumulation **applies** as the shipping still path; the path tracer **does not apply** to the self-lit custom-shader scene without a material rewrite.

### Rq-9 — iPhone 17 / iOS Safari WebGL2 state (2026)

Consolidated in section 3.

### Rq-10 — Dynamic resolution and upscaling on mobile web

Continuous render-scale (render to an offscreen target at a float scale, blit up) beats DPR stepping because it avoids visible resolution pops. The upscaler that fits WebGL2 is FSR1: EASU (edge-adaptive upsample) + RCAS (sharpen), spatial-only, no motion vectors, so it does not conflict with the no-TAA constraint. A WebGL/Shadertoy port (stXSWB) runs it in **17 texture taps** (12-tap EASU cross pattern + 5-tap RCAS cross), corroborated by AMD GPUOpen's FSR1 and RCAS manuals. [VERIFIED]. Thermal proxy: browsers expose no thermal API, so the only signal is frame-time drift on the CPU-side EMA PLUX already computes; a sustained rise triggers a render-scale drop. [VERIFIED absence of thermal API]. Mapbox GL, CesiumJS and deck.gl tier by device via the renderer string and pixel-ratio caps; no single primary doc quantifies their tier thresholds. [UNVERIFIED specifics]. Verdict: continuous render-scale + FSR1 EASU/RCAS **applies** as the primary mobile lever and is the highest-leverage mobile change, because it buys frame-time headroom directly inside the A19 thermal envelope.

### Rq-11 — Reduced shadow and lighting tiers for phones

Apple GPUs are Tile-Based Deferred Renderers with on-chip tile memory and no video memory, so bandwidth, not ALU, is the binding cost; MSAA is nearly free on-tile while large render targets and shadow-map sampling cost bandwidth. [VERIFIED] (Apple WWDC20 "Harness Apple GPUs with Metal"). Fitting levers: cap shadow distance (PLUX mobile keeps 1024² shadows to 30 km, far for a phone), update the shadow map at a lower frequency than the color frame, and bake approximate AO into tile data rather than compute it. HalfFloat MSAA×4 targets are bandwidth-heavy on TBDR; dropping to MSAA×2 or a smaller target on mobile is the direct saving. [INFERRED from TBDR model]. Verdict: distance cap + lower-frequency shadow updates + MSAA×2 **apply**, mobile-only, low risk.

### Rq-12 — HLOD and impostors for city-scale buildings

3D Tiles 1.1 supports HLOD natively: the tree "incorporat[es] Hierarchical Level of Detail (HLOD)," `refine` is REPLACE or ADD, implicit tiling gives quadtree/octree subdivision where each child's geometricError is half the parent's, and multiple contents let buildings+trees share a node. [VERIFIED] (OGC 3D Tiles spec 18-053r2; CesiumGS ImplicitTiling README). PLUX's baked city uses `refine ADD` with a root that has no content over GE-0 leaf cells, so there is no coarse tier and therefore no HLOD proxy at altitude; that is the structural reason far-field city density has no cheap representation. Octahedral impostors (billboard atlases baked from N view angles) are the standard far-field building/user-model proxy. [INFERRED, common practice]. Cesium OSM Buildings and Google 3D Tiles handle far-field density with REPLACE-refined coarse tiers, which PLUX deliberately lacks. [VERIFIED mechanism]. Note ADD refinement has known problems and CesiumGS has discussed deprecating it (3d-tiles #489). Verdict: adding a coarse merged REPLACE tier per cell, or octahedral impostors for far buildings and user models, **applies**, L-cost, and is the correct fix for altitude density.

### Rq-13 — GPU-compressed textures for user models

KTX2 with Basis Universal stays GPU-compressed into VRAM, transcoding at load to ASTC on iOS / BC7 on desktop, cutting texture memory **4× to 8×** versus the uncompressed RGBA that PNG/JPG become (a 2048² RGBA texture is 16 MB in VRAM regardless of the PNG's file size). [VERIFIED] (Khronos KTX Developer Guide; Basis Universal README; the 4–8× figure also appears on a vendor tool page and matches the Khronos guidance). UASTC is the high-quality mode for hero and normal maps, transcodes losslessly to ASTC and near-losslessly to BC7; ETC1S is smaller and lower quality. [VERIFIED]. three's `KTX2Loader` needs the Basis transcoder plus `renderer.detectSupport`. VRAM accounting in WebGL2 is via `renderer.info` (memory.textures/geometries) plus renderer-string heuristics. Verdict: **applies directly** to the ≤2048² user textures (S/M cost) and is the most direct relief for the iPhone 17 memory kills, because uncompressed texture residency is the dominant killable allocation.

### Rq-14 — Occlusion culling in WebGL2 (no compute)

GPU occlusion queries exist as `ANY_SAMPLES_PASSED` / `ANY_SAMPLES_PASSED_CONSERVATIVE` (WebGL2 baseline since Sept 2021), but results are asynchronous and one or more frames late, and iOS returns false positives: "It works on windows but not on iOS. On iOS I gets almost always false positive result." [VERIFIED] (MDN beginQuery/endQuery; webgl-dev-list). `EXT_disjoint_timer_query_webgl2` for GPU timing is generally absent on iOS. Software hierarchical-Z from a downsampled depth readback stalls on `readPixels`. The robust globe option is a conservative horizon/skyline occluder: Cesium's horizon culling discards tiles below the ellipsoid horizon cheaply on the CPU. [VERIFIED concept]. The operator's flagged trap is real: culling that feeds tile eviction can thrash the streaming loop, so any occlusion result must gate rendering only, never eviction. Verdict: horizon/skyline culling **applies** (CPU, safe); GPU occlusion queries **do not apply** on the iPhone 17 target.

### Rq-15 — Post AA, async compile, UBOs, discard reduction, bloom cost

**Async compile.** `renderer.compileAsync(scene, camera, targetScene)` exists (added r158, present r185) and uses `KHR_parallel_shader_compile`; prewarming avoids the first-appearance hitch. Measured baseline: the Frosted-glass example "spends several frames (74.6ms in total) blocked on shader compilation" on an M1 MacBook, and the gain "will only be an improvement for non-firefox browsers, due to the availability of the KHR_parallel_shader_compile extension." [VERIFIED] (three docs; r3f #3073; r158 PR #19752). **Post AA.** SMAA gives cleaner edges than FXAA at similar cost and handles dithered transparency better; FXAA blurs text and repeating patterns; CMAA2 sits between them but has no stock three pass. [VERIFIED] (SMAA/CMAA patent survey; mobile-AA thesis). On Apple TBDR, MSAA×4 is nearly free on-tile while post-AA costs a full-screen bandwidth pass, so MSAA stays the mobile default and SMAA is a desktop opt-in. [VERIFIED from TBDR model]. **UBOs.** `UniformsGroup` exists at r185 for WebGL2. [VERIFIED]. **Discard reduction.** `material.alphaToCoverage` exists at r185 and needs an MSAA context; replacing `discard` screen-door with alpha-to-coverage restores early-Z. [VERIFIED]. **Bloom.** Half-res, fewer-mip UnrealBloom in `EffectComposer` cuts cost and TBDR bandwidth; standard pmndrs practice. [INFERRED]. Verdict: async compile and half-res bloom **apply immediately, low risk**; SMAA and alpha-to-coverage **apply as desktop opt-ins** pending A/B against the byte-identical baseline.

### Rq-16 — "Simplified Nanite" on the web

Meshlet/cluster rendering with GPU-driven culling needs compute shaders, which WebGL2 lacks; the WebGL2-only options (`WEBGL_multi_draw`, transform feedback) cannot do hierarchical cluster selection. WebGPU has compute, and three's WebGPU renderer is production since r171 (Sept 2025), with Safari 26 shipping WebGPU on iOS 26. [VERIFIED for WebGPU availability] (three r171; WebGPU-baseline write-ups are secondary). For PLUX's low-poly OSM prisms the honest verdict: meshlet rendering targets multi-million-triangle meshes, not ~100-vertex extruded footprints, so the payoff is near zero even after a full WebGPU/TSL rewrite of the GLSL-string look. [INFERRED]. Verdict: **does not apply**; the geometry is the wrong shape for cluster LOD, and it is WebGPU-only.

### Rq-17 — Spatial acceleration for picking and height queries

`three-mesh-bvh` (gkjohnson, 0.9.x, 0.9.9 released Mar 3 2026) accelerates raycasts: set `raycaster.firstHitOnly = true` to use `raycastFirst` ("typically several times faster"), build the BVH in a worker (`useSharedArrayBuffer` for cross-worker sharing, SAH split for the most memory-efficient tree). [VERIFIED] (README/DeepWiki; libraries.io release list). For `heightAt` (currently 0.018–0.067 ms per CPU raycast [ASSUMPTION, operator-measured]) a per-tile BVH converts the terrain raycast into a log-depth traversal, and it accelerates picking across the 40k footprints. The catch is construction cost: BVH build on tile arrival competes with the same main thread that already stalls, so build in a worker and transfer. A uniform grid or quadtree over the 39k footprints is a lighter alternative for the near-2D footprint picking. [VERIFIED library; INFERRED streaming-construction tradeoff]. Verdict: **applies**, worker-built, keyed to the terrain epoch so per-tile trees dispose on refine.

## 3. iPhone 17 / iOS Safari consolidated hard limits

| Limit | Value | Source and date |
|---|---|---|
| WebGPU on iOS | Shipped Safari 26 / iOS 26, Sept 2025; usable by three's WebGPU renderer (r171+) | three r171 note; WebGPU-baseline articles (secondary, 2026) |
| WebGL2 support | Since iOS 15 (2021); default `WEBGL_debug_renderer_info` string "Apple GPU" | testmuai WebGL2 compat (2026) |
| Page memory ceiling (all memory incl. GPU) | 2–3 GB, device-dependent | Kimmo Kinnunen (WebKit), webgl-dev-list |
| WebKit jetsam base threshold | `min(3 GB, min(physical_RAM, jetsam_limit))`; conservative mode 50%, strict 65%, kill 100% | catchmetrics WebKit RAM deep-dive citing AvailableMemory.cpp (secondary) |
| Practical per-page crash range | ~300–450 MB on most in-use devices; iPhone 15+ ~1 GB+ | catchmetrics (secondary); Unity iOS WebGL crash reports |
| Anecdotal crash points | ~100 MB on 3rd-gen iPhone SE, ~200 MB on 8th-gen iPad, iOS 26.2 | lapcatsoftware, Jan 2026 (anecdotal, labelled) |
| Recent regression | CesiumJS/Unity WebGL "context lost" crashes on iOS 18.2–18.4 across many devices | Apple Developer Forums thread 778735 (anecdotal) |
| `EXT_disjoint_timer_query_webgl2` | Generally absent on iOS; no reliable GPU timing | webgl-dev-list; MDN |
| Occlusion query reliability | `ANY_SAMPLES_PASSED` returns false positives on iOS | webgl-dev-list |
| OffscreenCanvas WebGL2 | Since Safari 16.4 (2D first; WebGL/WebGL2 in later releases) | testmuai OffscreenCanvas (2026) |

The owner's tile storms and Safari reloads on the iPhone 17 Pro are the jetsam kill, not a frame-rate ceiling. The fix set is memory-first: KTX2 textures (Rq-13), LRU caps well below the 400 MB-per-renderer desktop tiers, `UnloadTilesPlugin`, and continuous render-scale (Rq-10). Since no performance number has ever been taken on a real phone, the first action is instrumentation, not optimization.

## 4. three.js 0.185 and 3d-tiles-renderer 0.4.x specifics

**Verified present in three.js r185:**
- `BatchedMesh`: `setColorAt` (Color or Vector4 for alpha), `getColorAt`, `setVisibleAt`, `perObjectFrustumCulled` (default true), `sortObjects` + `customSort`/`setCustomSort`, multi-draw via `WEBGL_multi_draw`. Constructor `new BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material)`. No generic per-instance custom-attribute API.
- `WebGLRenderer.compileAsync(scene, camera, targetScene)` — added r158; uses `KHR_parallel_shader_compile`.
- `WebGLRenderer.compile(scene, camera, targetScene)` — 3-arg form.
- `UniformsGroup` — UBO support on the WebGL2 renderer.
- `Material.onBeforeCompile`; program cache keyed on `onBeforeCompile.toString()`; `Material.customProgramCacheKey()` to disambiguate variants (required for Rq-7 batching).
- `NeutralToneMapping` constant (added r162).
- `Material.alphaToCoverage` (needs `antialias:true` MSAA context).
- `examples/jsm/csm/CSM.js` exists, but `setupMaterial` **assigns** `onBeforeCompile` (overwrites, does not chain). Do not use with PLUX's patches.

**Verified in 3d-tiles-renderer 0.4.x (0.4.28):**
- Minimum three.js **r167** from 0.4.18 onward (was r166 for 0.4.0–0.4.17; `BatchedTilesPlugin` needs r170 features per [0.3.41]).
- `BatchedTilesPlugin` with `textureSize` option ([0.4.5], 2025.02.14; moved to `plugins` subpackage in [0.4.0]).
- `ImageOverlayPlugin` ([0.4.11], 2025.07.01).
- `GLTFExtensionsPlugin` + `ReorientationPlugin` ([0.3.39], 2024.10.15); MeshoptDecoder support [0.3.40]; ReorientationPlugin azimuth/elevation/roll [0.4.11].
- `TilesFadePlugin`, `TileCompressionPlugin`, `UpdateOnChangePlugin` in the `plugins` subpath ([0.3.42], 2024.12.02).
- `UnloadTilesPlugin` ([0.3.46], 2024.12.24).
- `CesiumIonAuthPlugin` + `GoogleCloudAuthPlugin` ([0.3.36], 2024.07.25; `autoRefreshToken` [0.3.38]).
- `QuantizedMeshPlugin` ([0.4.9], 2025.05.07) — loads Cesium quantized-mesh terrain, with skirts and recommended-settings options.
- `load-error` events ([0.4.4]).
- LRUCache: `lruCache.maxBytesSize` / `minBytesSize` (require three ≥ r166); count `minSize`/`maxSize` default 6000/8000.
- Queues: `downloadQueue` maxJobs default 25, `parseQueue` maxJobs default 5 ([0.4.12], 2025.07.13, raised from 10 and 1). PLUX's 25/5 matches the current default.
- Instances share `processNodeQueue`, `lruCache`, `downloadQueue`, `priorityQueue` by default (v0.4.28).

**glTF parsing runs on the main thread** via three's `GLTFLoader`; only Draco/KTX2 sub-decoders use workers. No native worker-glTF-parse feature exists, so the operator's "no worker-side parsing of tiles" is a library limit, not a config miss.

## 5. Do-not-do list

- **Do not use the three `csm` addon.** `setupMaterial` assigns `onBeforeCompile`, overwriting PLUX's chained patches (StrandedKitty three-csm #26, unfixed at r185). Confirmed.
- **Do not adopt PCSS on the PCF path.** The three PCF path uses hardware-compare samplers; PCSS needs a non-compare blocker-search read. Confirmed by architecture.
- **Do not switch to VSM.** Every receiver becomes a caster; the operator's 768 MiB-at-8192² estimate is consistent with VSM's dual-moment target cost. Confirmed high-risk.
- **Do not use `BatchedTilesPlugin` for the stock buildings.** One material per batch kills the per-tile restyle/reveal/tint/dissolve. Confirmed by the plugin's single-material design.
- **Do not rely on GPU occlusion queries on iOS.** `ANY_SAMPLES_PASSED` returns false positives on iOS and lags ≥1 frame. New confirmation (webgl-dev-list).
- **Do not add TAA to denoise volumetric clouds.** TAA needs motion vectors the 22 custom materials do not emit and smears the screen-door dithers; the 8-step cloud path depends on TAA, so volumetric clouds inherit the problem. Confirmed trap.
- **Do not run `three-gpu-pathtracer` on the live scene.** It needs standard PBR material data; PLUX's raw `ShaderMaterial`s and chained patches are unsupported without re-authoring. New confirmation.
- **Do not keep the fixed-per-frame seating ease.** Without a `dt` term the ease speed is frame-rate dependent; use `1−exp(−dt/τ)`. New trap found.
- **Do not batch per-tile params without `customProgramCacheKey`.** three keys the program cache on `onBeforeCompile.toString()`; identical patch bodies collide unless `customProgramCacheKey` differentiates variants. New trap.
- **Do not attempt meshlet "Nanite" for OSM prisms.** WebGPU-only and pointless on ~100-vertex footprints. Confirmed.
- **Do not raise parse concurrency or blanket LRU on phones.** Already rejected by the operator (main-thread hitches, memory kills); the iOS jetsam data in §3 confirms memory headroom is the binding limit, not throughput.

## 6. Open questions and the experiment that settles each

1. **Does float64 texel-snapping the ULTRA cascade centre fully remove the crawl at ECEF magnitude?** Implement the translation-matrix snap; capture a static-camera time-lapse over a 10 s sun scrub; diff frames for sub-pixel motion. Threshold: zero net texel motion between adjacent frames at fixed camera.
2. **What is the actual iPhone 17 Pro per-page memory kill point for PLUX?** Instrument `renderer.info` plus available memory proxies; ramp resident tiles until jetsam; log the last-good byte total. No real-phone number exists yet; this gates every mobile decision.
3. **Does KTX2/ASTC on the ≤24 user models plus tighter LRU caps keep the page under the kill threshold for a full session?** A/B a scripted fly-through with and without KTX2 across 20 runs; record crash rate and peak resident bytes.
4. **Can the Hillaire LUT sky reproduce PLUX's authored solar-elevation key-light curves within an imperceptible delta?** Render LUT key colour vs the authored curve across elevation −18° to +60°; compute ΔE; gate on ΔE < 2.
5. **Does a worker-built per-tile BVH reduce net main-thread time given construction cost at PLUX's tile arrival rate?** Measure main-thread ms/frame with and without BVH during a dense refine burst; gate on net main-thread reduction during the burst, not just steady state.
6. **Is continuous render-scale + FSR1 visually acceptable on the A19 at mobile z18 imagery detail?** Blind A/B at render scales 0.6–1.0; measure detection threshold and sustained frame time under a 10-minute thermal soak.
7. **Does alpha-to-coverage change the baseline enough to fail the byte-identical test?** Pixel-diff the screen-door reveal against the shipped dither at matched MSAA; quantify changed-pixel count; it ships ULTRA-first regardless.
8. **What are `three-gpu-pathtracer`'s render time and peak VRAM on the 7.7 M-vertex Dnipro set on an M3 Pro if materials are re-authored?** Port one cell to MeshStandardMaterial; measure convergence to 512 spp and peak VRAM. No citable figure was found; this decides whether the path tracer is ever worth the material rewrite.