# TRACK 1: Frame pipeline, renderer, post chain, adaptive quality (agent report, confidence 87%)

## Renderer construction (`GlobeCanvas.tsx`)
- `new WebGLRenderer({canvas, antialias:false, powerPreference:"high-performance"})` L79-83. No `precision`/`logarithmicDepthBuffer` → three defaults `highp` / `false`. `preserveDrawingBuffer` default false.
- DPR: `setPixelRatio(min(devicePixelRatio, QUALITY.tiers[deviceTier].dprCap, leanDprCap))` L129-131; re-applied per tier only when the effective DPR changes (A9 guard L575-581 — `composer.setSize` reallocates every RT).
- Colour: `outputColorSpace = SRGBColorSpace` L132; `toneMapping = NeutralToneMapping` L135 (ACES/AgX rejected: desaturate the cyan accent, tuning.ts:540); `toneMappingExposure` 1.0. Tone map + sRGB encode happen in `OutputPass`.
- Space backdrop is `scene.background`, never `setClearColor` (sRGB clear into linear HalfFloat rendered navy) L172-184.
- Shadows: `shadowMap.enabled = tiers[deviceTier].shadowsEnabled || ultraBoot` L154; `shadowMap.type` never set → `PCFShadowMap`. One `DirectionalLight` sun L262; `mapSize = min(ultraBoot ? 8192 : tier px, lean 1024, maxTextureSize)` L278-283. Ortho box seeded from `SHADOWS.*` L284-293, refit per frame by the orchestrator. ULTRA cascades: extra `DirectionalLight`s at `intensity 0`, `shadow.autoUpdate=false`, boot-only L318-343.
- `HemisphereLight` L354-358 — world position never set → "sky" = ECEF +Y off-ULTRA (AB2).
- Camera near/far: constructed 0.1/100 then owned by `controls.adjustCamera` every frame — 1.0 m near, 180,375 m far, 24 depth bits.

## Post chain L361-380, L506-563
- `composeTarget = WebGLRenderTarget(drawingBufferSize, {type: HalfFloatType, samples: BLOOM.msaaSamples=4})` → `EffectComposer(renderer, composeTarget)` → `RenderPass` → `[GTAOPass @ index 1, only if AO.enabled]` → `UnrealBloomPass(0.4, 0.5, 0.9)` → `OutputPass`.
- `EffectComposer` clones the target → **two MSAA4 HalfFloat full-res targets**. `UnrealBloomPass` allocates `renderTargetBright` + 5 mips × 2 = **11 HalfFloat RTs**, ~12 fullscreen draws. GTAO would add normal + gtao + pd RTs and a full extra scene render; today `AO.enabled=false` → never constructed (tuning.ts:410).
- Bloom is gated off on `low`, on lean mobile, and while the flat chart is on (L913-917).
- `antialias:false` rationale: only OutputPass draws to the backbuffer. MSAA on the composer target is the **only** AA; no FXAA/SMAA/TAA.

## rAF loop L839-1056
1. `requestAnimationFrame(tick)`; skip if `ctxLost || document.hidden` (re-seat governor clock).
2. `debugPush("frame.dt")` before the gate; `governor.step(dt)`.
3. ULTRA pin edge → `pendingTier = "high" | deviceTier`; else `gov.changed → pendingTier`.
4. `planTierApply(pending, tileTier, fpvActive, livePromoteInFpv)` → renderer half, tiles half, `markGateDirty`.
5. `tilesHandle.update()` (bracketed as `frame.cpu`) — **never skipped**.
6. Bloom flat gate; lean flat-DPR re-apply.
7. **RC21 gate** `frameNeedsRender(...)` — ships OFF (`GATE.enabled=false`), skips only `composer.render()` + PiP blit together.
8. `renderer.info.reset()` (autoReset off — HUD owns reset so calls/tris are whole-frame incl. shadow + composer + PiP); `gpuTimer.begin()`; `composer.render()`.
9. **/m PiP (RC19)**: cached scene render into `pipRT` (HalfFloat) when `pipNeedsRender(pose, age, PIP)`; `shadowMap.autoUpdate` forced false during that pass; scissored one-triangle blit **every** frame (`toneMapped` must stay true — RT holds raw linear HDR).
10. `gpuTimer.end()`; pushes `frame.draw/calls/tris/gpu`.
- Resize: `renderer.setSize(w,h,false)` + `composer.setSize` + gate dirty. Context loss: stop driving, realloc composer on restore. GPU timing: `EXT_disjoint_timer_query_webgl2` ring (`lib/globe/debugGpuTimer.ts`), HUD-only.

## Adaptive quality (`lib/globe/quality.ts`)
- Signals: `WEBGL_debug_renderer_info` string, `navigator.deviceMemory`, `hardwareConcurrency`, `maxTextureSize`, `(pointer:coarse)`. `detectDeviceTier`: software GL or `<8192` tex → low; WEAK_GPU regex / mem≤4 / cores≤3 → low; STRONG_GPU ∧ mem≥8 ∧ cores≥8 → high (mid if coarse); else mid (quality.ts:333-380).
- Ceiling `low→low, coarse→mid, else high`; floor `high→mid, else low`. Lean mobile overrides on any coarse pointer.
- Governor: EMA `ema += 0.1·(dt−ema)`; `downFrames 100`, `upFrames 240`, `cooldownMs 2500`; hitch = raw dt > 50 ms (quality.ts:433-495; tuning.ts:625-633). Sees **CPU-side rAF dt only**.
- RC18 split (`planTierApply`, quality.ts:316-328): outside FPV both halves land; inside FPV a promote lands tile levers immediately, renderer half parks; a demote parks whole. Renderer half = DPR/composer realloc, bloom, AO gate, overlay px; tile half = error targets, LRU cap/floor, queue caps, foveation, street/lattice budgets. Shadows follow the **device** tier, never the governor (L587-593).
- "high == byte-identical": tier levers return `null` on high = captured library defaults; locked by `test/lib/globe/quality.test.ts:207-260, 283-290`.
- ULTRA = override profile, not a tier (quality.ts:203-234): `ultraTileLevers` returns `base` **by identity** when off; look side is `mix(legacy, ultra, 0)` + snap-to-zero under 1e-4. Gate `hqAllowed = !isMobileShell && !coarsePointerShell` (StylizedTiles.ts:1042); `ultraBootSnapshot()` memoises the boot read (`lib/globe/ultraBoot.ts:62-76`).

## Per-frame step order (StylizedTiles.ts:7261-7316)
| # | Step | Purpose | Cadence |
|---|---|---|---|
| 1 | FrameTiming | `dt = min(now−last, 100)` | every |
| 2-4 | ZoomBrakeAndEase · ControlsUpdate · DampedVerticality | GlobeControls tick, zoom brake, up damping | every |
| 5 | MobileBuildingsGate | BLD/2D detach gate | every |
| 6-7 | BuildingsUpdate · EnrichedUpdate | `tiles.update()` ×2 (no UpdateOnChange) + enriched seat sweep | every |
| 8-13 | FlightUpdate · ExploreJourney · FpvTransitions · SkyTrack · FpvPose · FovGlide | flight, explore, FPV, tracking, eye pose, FOV | every |
| 14-15 | GeodeticAltitude · ViewFocus | `alt`; analytic ray→ellipsoid focus (no raycast); U5 aim epoch; U6 fovea pose | every |
| 16–24 | IdleDrift → TiltGlide → HeadingGlide → Mobile2dLocks → ZoomGlide → EncoderRates → FocalEncoder → StreetFloorGuard → LocationFinderFlyTo | camera glides/encoders | every |
| 25 | FpvSolidity | solidity ease; anchor `heightAt` every 30 frames | throttled |
| 26 | FpvHudAndSkyMarkers | HUD mirror | every 3 frames |
| 27 | PoseMirrorAndViewport | store/URL mirrors | 12 / 96 frames |
| 28 | UltraGate | sole writer of `ultraOn` | edge only |
| 29 | GroundUpdate | errorTarget ramp, eases, twins, sticky overlay px, LRU bank, `tiles.update()` (UpdateOnChange-gated) | every |
| 30 | EphemerisResample | `sampleEphemeris` when |Δt| > 1000 ms | ~1 Hz scene time |
| 31 | Eclipse | topocentric disc → `eclipseK` | every |
| 32 | UltraLook | exposure/haze/hemi eases | every while ULTRA on |
| 33 | KeyLightAndShadow | key colour/intensity, handoff, ortho refit (`_shadowFocus`, 128 m quantised extent), cascades, terrain cast gate | every; cascade re-render on triggers / 1500 ms |
| 34–37 | SkyBodies · SkyTarget · FindGhosts · SkyHover | impostor uniforms; hover pick | hover every 4 frames |
| 38 | FrustumResnapAndTick | photo resnap | 120 frames |
| 39–43 | ArrivalReframing · PinsUpdate · PinHover · TempPinMarker · PlacementMarker | pins resnap /120; hover raycast /4; temp-pin /6; placing /2 | throttled |
| 44–46 | GraticuleAndAtmosphere · Stars · DayArcs | uniforms | every |
| 47–52 | PlannedView · AimCones · GeoLabels · StreetNames · BldgEdit · UserModels | streets reseat /240, select /20; vector /240; models residency /12, resnap /60, density /30 | throttled |
| 53 | VectorFeatures | lattice build 8 heightAt/frame | budgeted |
| 54–56 | MinimapFeed · PlanFeed · BestSpotFeed | plan horizon `terrainBinsPerFrame 3 / meshesPerFrame 2`; mirrors /12 | time-sliced |

**Raycasts per frame (desktop high, street):** seat sweep up to 6 cell + 64 feature + 40 tree `heightAt` calls (tuning.ts:2187,2210,2213), each a memo probe first, misses = recursive `Raycaster.intersectObject(ground.tiles.group, true)` with **no BVH** (imageryGround.ts:1115-1129; `null` never memoised); vector lattice ≤8; plus throttled picks. Whole chain in one try/catch with 2 s error-log throttle.
**Per-frame allocations seen:** `gatePose` literal + `sun` array (GlobeCanvas L938-946), `pipCapture` → 2×`Float64Array(16)` per drawn frame (L965); PiP `pose` literal; `_hemiSky0.clone().lerp(...)` per frame under ULTRA (StylizedTiles.ts:5804); `stars.update({...})` literal (:6624-6644); three's `intersectObject` result arrays per heightAt miss.

## Tunables & budgets (selected)
| Name | Value | file:line |
|---|---|---|
| `BLOOM.msaaSamples` / strength/radius/threshold | 4 / 0.4/0.5/0.9 | tuning.ts:378-382 |
| `AO.enabled` / maxAltM/radiusM/samples/intensity | false / 12 000/10/16/0.6 | :410-425 |
| `SHADOWS.mapSize / maxAltM` | 4096 / 30 000 | :444,433 |
| `SHADOWS.boundsM/boundsAltK/maxBoundsM/viewFitK/boundsQuantM` | 1600/0.6/5000/1/128 | :450-486 |
| `SHADOWS.lightDistM/depthMarginM/bias/normalBias/radius` | 8000/3500/−2e-4/0.75/2 | :488-508 |
| `SHADOWS.minSunElevSin/fadeBandSin` | 0.008/0.0523 | :513-532 |
| `PIP.maxStaleMs` | 250 | :558 |
| `GATE.enabled/maxStaleMs/restMs` | false / 200 / 6000 | :590-599 |
| `QUALITY.governor` | budget 35 ms · restore 13 · α 0.1 · down 100 · up 240 · cooldown 2500 · hitch 50 | :625-633 |
| `tiers.high/mid/low.dprCap` | 2 / 1.5 / 1.25 | :651,676,690 |
| `tiers.*.shadowMapSize` | 4096/2048/1024 | :654,679,693 |
| `tiers.*.bloom / shadowsEnabled` | T,T / T,T / F,F | |
| `tiers.*.lruBytesMB / groundLruBytesMB` | 400/400 · 256/320 · 160/192 | |
| `tiers.*.groundErrorNear / buildingErrorTarget` | 2/16 · 3/24 · 5/40 | |
| `leanMobile` | dpr 1.25 (2d 1.5), bloom off, shadow 1024 | :711-722 |
| `ultraDesktop` | bldg SSE 12 · streets 64 · lattice 12 · LRU 600/600 | :790-810 |
| `ULTRA.shadowMapSize/shadowRadius/shadowBiasM/shadowNormalBias` | 8192/4/0.6 m/0.45 | :1007-1063 |
| `ULTRA.lightDistM/depthMarginM/boundsAltK/maxBoundsM` | 60 000/30 000/1.1/18 000 | :1087-1093 |
| `ULTRA.cascades`, `cascadeMaxStaleMs`, `cascadeRefreshDeg`, `cascadeMoveFrac` | ladder / 1500 / 0.25° / 0.12 | :1122-1159 |
| `ULTRA.exposureTauMs/hazeTauMs/photoTauMs` | 950/700/420 | |
| `ENRICHED.reseat*SamplesPerFrame` | 6/64/40 | :2187,2210,2213 |
| `SKY.sampleIntervalMs` | 1000 | :66 |

## Measured numbers
| Metric | Value | Where | When/tier | Kind |
|---|---|---|---|---|
| Frame time, city, ULTRA off→on | 30.7 → 36.1 ms (33→28 fps, +18 %) | DECISIONS 2026-08-22j | dev build 1600×950 @ DPR 2, owner M3 Pro | MEASURED |
| Everest ULTRA on | 29.3 ms | same | | MEASURED |
| Cascade ladder cost | mountain 31.2→34.2 ms (+9.6 %), city 47.0→50.3 ms (+7 %); +168 MB VRAM over cascade 0's 536 MB | ULTRA_ARCHITECTURE §13.1 | 2026-08-27 | MEASURED |
| Shadow target VRAM | 4096² ≈128 MiB, 8192² ≈512 MiB (RGBA8 + D24) | RENDERING_ARCHITECTURE §2.2 #4 | | ESTIMATED |
| Bloom RTs / draws | 11 HalfFloat RTs, ~12 fullscreen draws | source count | | ESTIMATED |
| `heightAt` cost | 0.018–0.067 ms/call | tuning.ts:2204-2205 | warm Dnipro FPV | MEASURED |
| heightAt memo hit rate | 42 % (warm FPV) · 84 % over 18 457 entries | | RC11 | MEASURED |
| Ground LRU at rest (high) | 109.7 MB vs 322.1 MB floor | §2.1 | | MEASURED |
| Depth | 24 bits, near 1.0 m, far 180 375 m | §2.1 | RC28 | MEASURED |
| GPU timer sample / rAF median | 7.3 ms · 33.4 ms | DEBUG_HUD_PLAN | headless tier-low | MEASURED (report-only) |
| Desktop refinement lever | errorTarget 0.05 → **0** extra tiles | §2.1 | | MEASURED |
| RC19 PiP saving | not on record | | | UNVERIFIED |
| RC21 gate saving | never soaked; ships off | | | UNVERIFIED |
| Draw calls / tris on owner HW | not recorded anywhere (HUD exists) | | | UNVERIFIED |

## Limitations, caveats, traps
- Governor is CPU-clock only; GPU time is HUD-only, absent on Firefox/Safari.
- RC21 gate buys GPU/power, not CPU: `tilesHandle.update()` and all three `tiles.update()` run every frame. A false negative is a frozen globe.
- Construction-time levers: `shadow.mapSize` latched; `shadowMap.enabled` flip recompiles every material; anisotropy/mip chain stamped at composite creation → delivered by reload.
- `shadow.bias` is a near→far fraction — ULTRA authors it in metres.
- Terrain casting fails silently without `shadowSide=FrontSide`.
- Directional-light order truncation: a non-caster before a caster drops the caster's shadow (`WebGLLights.js:295-305`).
- Tone mapping is skipped into any RT; PiP blit `toneMapped` must stay true.
- `FullScreenQuad.dispose()` kills the shared triangle.
- `onBeforeCompile` program-cache key is `toString()`; chained patches must be named functions with uniforms declared in `<common>`. CSM would clobber the two chained patches.
- AO⇄ULTRA coupling: `updateAoEnabled` gates on `tier==="high"` and the ULT chip pins high.
- Shadows follow the device tier, not the governor — a `low`-detected device never gets shadows.
- LRU floor/cap inversion (`minBytesSize ≥ maxBytesSize` → every parse discarded).
- TDZ trap: orchestrator `let`s below the ephemeris seam throw inside `applyQualityTier` at attach → placeholder globe.
- HemisphereLight ECEF +Y in baseline (AB2).

## Already refuted / rejected
| Candidate | Reason | Citation |
|---|---|---|
| `antialias:true` on the renderer | only OutputPass draws to the backbuffer | GlobeCanvas L76-78 |
| ACES / AgX | desaturate cyan accent | tuning.ts:540 |
| `PCFSoftShadowMap` | deprecated, rewritten to PCF | `WebGLShadowMap.js:99-101` |
| VSM | every receiver casts → 768 MiB at 8192² | ULTRA_ARCH §10 |
| PCSS | not in npm; needs raw depth read, loses hardware PCF | §10 |
| three CSM library | assigns `onBeforeCompile`, +3 lights recompile; hand ladder shipped instead | §10, §13.1 |
| Real-time GI | owner-accepted rejection | §10 |
| WebGPU (D12) | TSL/NodeMaterial required; `onBeforeCompile` ignored | QUALITY_PASS WS1 |
| Half-rate PiP | composer overwrites the rect → 30 Hz flicker | pipCache.ts |
| Predicate-based on-demand render | 40+ sources / 20 files / ~14 no-snap eases → heartbeat | frameGate.ts |
| ULTRA as 4th tier | `caps[tier]` type error + `TIER_ORDER` assertion | quality.ts:203-208 |
| ULTRA `dprCap` raise | inert behind `min(devicePixelRatio,…)` | quality.ts:212-214 |
| Log-depth / reversed-Z | 24 bits over 1 m–180 km, no shimmer in 10 legs; 22 ShaderMaterials to touch | §2.1 |
| DPR foveation | ceiling is heat/jetsam, not fill | FPV_FIDELITY_AUDIT §4 |
| Custom depth material to drop RGBA8 colour attachment | saves bandwidth, not VRAM | tuning.ts:438-443 |

## Shader inventory (for "further shader optimizations")
22 raw `ShaderMaterial`s / 0 Raw / 5 `onBeforeCompile` patches + 1 direct GTAO source patch, modules: baseEarth, atmosphere, aimCones, findGhosts, bestSpotSheet, graticule, skyTarget, placeMarkers, tangentOverlay, sky, dayArcs, skyGhosts, stars, Pins, buildingMaterial, enrichedBuildings, imageryGround, userModels, GlobeCanvas. No `compileAsync` / `KHR_parallel_shader_compile` use anywhere.

## Gaps vs a modern engine (ASSESSMENT)
- No frame graph / RT pooling: ~13 full-res HalfFloat RTs (2 MSAA + 11 bloom) plus shadow maps and PiP RT statically allocated; no aliasing/transient pool.
- No GPU-time budget in the loop; governor cannot distinguish GPU-bound from CPU-bound; three coarse DPR rungs rather than continuous render scale; no dynamic resolution / upscaler.
- No temporal AA / post AA (TAA would need jitter + motion vectors across 22 raw ShaderMaterials).
- No occlusion culling (no GPU queries/HZB).
- No WebGPU path (D12 parked; the look is GLSL-string-based).
- No async shader compilation — first-appearance compiles land on the frame.
- No BVH for terrain picks; no `BatchedMesh`; no instancing for user models.
- No unified per-frame CPU budget scheduler: time-slicing is piecemeal with independent frame-modulo gates; no ms-budgeted task queue.
- No VRAM governor: memory pressure inferred from coarse-pointer heuristics and tier LRU caps, never measured; no KTX2/Basis.
- Shadows: no cascade dispatch (union via mask multiply), no contact hardening; the sun map re-renders every `render()`.
- Present and modern-adjacent: on-demand render gate (off), cached PiP, lever-split governor, GPU timer ring, HUD with p95/1 %-low, exact off-state proofs.

Gaps not closed: no recorded draw-call/triangle/GPU-ms numbers on the owner's machine; RC19 saving not on record; RC21 skip ratio unsoaked; steps 2–4, 8–13, 16–24, 39–52 characterised from roster + grep, not full reads; `frame.cpu` vs `frame.draw` split on desktop unmeasured (CPU- vs GPU-bound at street level is open).
