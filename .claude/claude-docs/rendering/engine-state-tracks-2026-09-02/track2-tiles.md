# TRACK 2: Tile streaming, LOD, culling, caching, imagery, vector/label layers (agent report, confidence 82%)

## Findings — as-built mechanisms (cited)

**Three `TilesRenderer` instances, no shared cache, no shared queues** (queues and LRU are per-instance, `TilesRendererBase.js:445-525`).

- **Ground** (`scene/imageryGround.ts:247`): Cesium World Terrain, ion asset `"1"` (`tuning.ts:1729`), via `CesiumIonAuthPlugin({autoRefreshToken, assetTypeHandler})` (`:260-283`) which registers `QuantizedMeshPlugin` **lazily** on `type === "TERRAIN"`. `QuantizedMeshPlugin.useRecommendedSettings` pins `tiles.errorTarget = 2` at init (`QuantizedMeshPlugin.js:129-131`); the module then overwrites `errorTarget` every frame with an altitude ramp (`imageryGround.ts:1292`). Skirts: length = `tile.geometricError` (`QuantizedMeshPlugin.js:260,281`) — hundreds of metres at wide-view LODs; `lib/globe/terrainSkirt.ts` clips the skirt out of the shadow pass via `drawRange`.
- **GLO-30 patch** (`scene/terrainPatch.ts:57-77`): wraps the QM plugin instance's `createChild` **before** registration; tiles claimed by the serve-set rule get `tile.content = {uri: patchUrl}`; `expandChildren` then counts them as real children — the quadtree descends past CWT's L13 ceiling over UA. A −500-priority `fetchData` plugin (`:92-106`) claims patch URLs with plain `fetch` (`force-cache` for `.terrain`) so the ion Bearer never reaches R2. Registry: `lib/globe/regions.ts` (dnipro/st-albans/everest, `maxDepth 13`).
- **Ground plugin order** (`imageryGround.ts:35-45`): QM (−1000) → `FTW_TERRAIN_PATCH` fetch (−500) → `FTW_UNLIT_TERRAIN_PLUGIN` (−100, `:289-307`: swaps `MeshStandardMaterial` → per-tile `MeshBasicMaterial` with polygonOffset 1; must run before the overlay wraps materials) → `TilesFadePlugin` (−2; `fadeRootTiles:true, fadeDuration 700 ms, maximumFadeOutTiles 300`, `:311-316`) → `UpdateOnChangePlugin` (`:318`, ground only) → `LoadRegionPlugin` (`:324`) → `ImageOverlayPlugin` (−15, `:379-384`). Grade chains `onBeforeCompile` on `load-model`, anchored at `alphamap_fragment` (after the composite).
- **`UpdateOnChangePlugin`** skips `update()` unless the camera MVP changed or `needsUpdate` fired (`UpdateOnChangePlugin.js:59-80`). The ground's traversal *and its LRU rest-trim* run only on frames where something moved; fovea adapter and knob changes dispatch `needs-update` explicitly (`tileFoveation.ts:80-84`; `imageryGround.ts:1180,1198`), `setLruBank` deliberately does not (`:1206-1211`). During initial load the orchestrator forces `needsUpdate` each frame (`:1354`).
- **Stock buildings** (`scene/buildings.ts:120-121`): Cesium OSM Buildings ion `"96188"`; plugins: `CesiumIonAuthPlugin` → `GLTFExtensionsPlugin{draco, meshopt}` → `LoadRegionPlugin` → `FTW_DNIPRO_OSM_MASK` (`:181-193`), a `calculateTileViewError` plugin that sets `inView=false` when a tile's bounding-sphere centre falls inside any baked region bbox (stop-traversal mask). Straddling ancestors leak, so both shared materials also carry a 4-plane ECEF clipping prism with `clipIntersection` + `clipShadows` (`:235-241`). Style by material swap on `load-model` — **no `BatchedTilesPlugin`** (locked, `:31-32`; the plugin forces one material, `BatchedTilesPlugin.js:17-19`; it would kill F1 reveal, R2 tint, ghost screen-door). Each tile gets a per-tile `EdgesGeometry` `LineSegments` child (`:290-291`) and `castShadow=true` (`:286`). No `TilesFadePlugin` here (per-material WeakMap fights the shared-material invariant, `tuning.ts:2131-2138`); reveal is a Bayer screen-door over tile age.
- **Enriched** (`scene/enrichedBuildings.ts:428`): `new TilesRenderer(PUBLIC_ENRICHED_TILES_URL)`; `errorTarget = 16` (`:442`); `GLTFExtensionsPlugin` (`:444-446`); `FTW_ENRICHED_FORCE_CACHE` fetch claimer at −500 (`:495-507`, `.glb` only, joins the `meta.json` sidecar fetch); `LoadRegionPlugin` (`:509-511`). Tileset is two-level `ADD`, root GE 512 over **GE-0 leaves** (`scripts/bake/lib/gltf.mjs:161-178`, `bake.mjs:206`), so `errorTarget` only sets the stream radius. Trees are `EXT_mesh_gpu_instancing` → one `InstancedMesh` per cell (`:105-112,1043-1049`); `dispose-model` must call `InstancedMesh.dispose()` (`:1281-1285`).
- **SSE idiom**: `error = geometricError / (distance · sseDenominator)`, `sseDenominator = (2/proj[5]) / resolution.height` (`TilesRenderer.js:567,1032-1034`). Buildings/enriched feed **CSS px** via `setResolutionFromRenderer` (`buildings.ts:198`); the ground alone feeds **device px** (`imageryGround.ts:412-415`). All three re-fit on resize (`StylizedTiles.ts:815-820`).
- **U5 closest-first** (`lib/globe/loadPriority.ts`, `tuning.ts:1490-1522`): buildings + enriched set `loadAncestors=false` (`buildings.ts:137`, `enrichedBuildings.ts:436`) → library's `distancePriorityCallback` (`TilesRendererBase.js:152-181`); custom download comparator divides distance by `(1 + k·max(0, look·toTile))` in FPV, `k = 1.5` (`loadPriority.ts:77-96,108-135`; aim refreshed per frame `StylizedTiles.ts:4845-4853`). Ground excluded by construction. Parse queue keeps the library callback.
- **U6 foveation** (`scene/tileFoveation.ts`): one `LoadRegionPlugin` per renderer with a `RangedRayRegion` (stock `RayRegion` is infinite — pierces the globe; `:26-43`) + a `SphereRegion` around the eye; regions authored in tiles-group-local space via `group.matrixWorldInverse` (`:96-108`). Region error = `GE − regionET + baseET`, merged with camera error by `max` (`LoadRegionPlugin.js:161-163`; `TilesRendererBase.js:1024-1030`) — regions only **add** detail; buildings/enriched relax base target by `peripheryFactor` (`quality.ts:163-172`); ground base never relaxed. `foveation: null` on `high` (`tuning.ts:660-661`) — desktop has no foveation.
- **Queue caps**: library defaults 25 download / 5 parse (`TilesRendererBase.js:445-449`); mid 12/3, low 8/2 (`tuning.ts:1515-1519`); `high` = `null` → captured defaults. `ImageOverlayPlugin` runs a 10th queue (`processQueue.maxJobs = 10`, visible-tiles-first, `ImageOverlayPlugin.js:106-127`). All nine tile queues freeze on `visibilitychange`/`pagehide` via `autoUpdate=false` (`StylizedTiles.ts:2926-2945`).
- **RC18 lever split** (`quality.ts:313-330`): inside FPV a *promote's* tile levers land immediately, renderer levers park; a demote parks whole.
- **LRU** (`LRUCache.js:81-96,342-348`): defaults 0.3/0.4 GiB min/max, `unloadPercent 0.05`; `hasBytesToUnload = unused && cachedBytes > minBytesSize || …` — one unvisited tile plus a cache above the **floor** starts eviction; the cap is not consulted. Per scheduled unload ≤ `max(5%·excess, 5%·minBytesSize)` bytes (`:385`). Repo pairs floor = 0.75·cap on tiers (`quality.ts:43-45`; a cap below the 0.3 GiB default floor inverts the band → parse-discard-redownload loop). **RC20 flip bank** (`tuning.ts:739-763`; `quality.ts:92-105`; `StylizedTiles.ts:5604-5622`): after each FPV boundary crossing the ground floor is raised to `min(0.92·cap, cap − 16 MiB)` for 45 s, mid/low only. `applyLruBand` is the one writer of the ground's byte band (`imageryGround.ts:1055-1065`), also dividing the cap by the mip factor because the library bills manual mip chains at 1× (`TiledImageSource.js:47-50`).
- **Culling**: (a) tileset traversal frustum test on bounding volumes (`TilesRenderer.js:1039-1041`, `traverseFunctions.js:190-221`); (b) the far plane, re-fit from the ellipsoid horizon every frame incl. FPV, gates traversal (`MIN_ELEVATION = 2550` → ~180 km far); (c) three per-object culling is **disabled** on tile meshes (`autoDisableRendererCulling` default true → `frustumCulled=false`, `TilesRenderer.js:56-72,818-821`). Per-tile edge `LineSegments` and shadow twins are added in `load-model`, after that pass, so likely keep three's default per-object culling (UNVERIFIED at runtime). **No occlusion culling**. **No HLOD** for the enriched bbox (T7). Altitude gates: ground group hidden and `update()` skipped above 3,000 km (`imageryGround.ts:1272-1275`; `tuning.ts:1562`), fade 750→380 km; decor/graticule fade 250→150 km; stars gone below 250 km (`stars.ts:446,485-486`); labels 100–900 km; streets <5 km; vector web <15 km; buildings gated on `/m` 2D and the BLD chip (`StylizedTiles.ts:4183-4197`), never by altitude on desktop. Shadow twins off above 30 km / in flat 2D (`:1358-1362`). **No impostors/billboards**.
- **Imagery**: `XYZTilesOverlay` Esri `{z}/{y}/{x}`, `levels: 20` desktop / 19 coarse-pointer (`imageryGround.ts:345-349`; `levels` is a COUNT), `fetchOptions {cache:"force-cache"}`; CARTO dark overlay attaches only in dark ground mode (`:363-368,1341-1348`); its opacity is a live uniform. Composite per terrain tile: `RegionImageSource.fetchItem` draws source tiles into a `resolution²` canvas → `CanvasTexture`, sRGB, `generateMipmaps=false`; single-tile ranges take a `.clone()` fast path (`RegionImageSource.js:67-118`). Source zoom = smallest level whose pixel width ≥ `resolution/rangeWidth` (`ImageOverlayPlugin.js:1570-1598`) — texel density is slaved to mesh split depth; `errorTarget2dDeep 0.35` buys z17–18 on the chart. Bytes billed via `MemoryUtils.getTextureByteLength` into the tile's LRU cost (`ImageOverlayPlugin.js:327-347`). **ULTRA** stamps `anisotropy 16` and a hand-built **4-level** mip chain (`tuning.ts:837,860`) at creation by wrapping `TiledRegionImageSource.prototype.fetchItem` (`imageryGround.ts:1069-1095`); levels built with `drawImage` halving (`:1000-1024`; `lib/globe/mipChain.ts`). **Sticky-composite invariant**: `overlayResolutionPx` only ratchets up (`quality.ts:183-190`; `StylizedTiles.ts:5596-5602`) — a resolution change is a fresh-instance overlay rebuild (`imageryGround.ts:1163-1185`, `__overlayRebuilds`).
- **Esri HTTP-200 placeholder** (`lib/globe/esriPlaceholder.ts:1-62`): 2,521-byte JPEG, detected by length + FNV-1a-32 `0x92d9118f`; parent fetched and quadrant-cropped up to 3 levels (`tuning.ts:2500`); per-tile/8×8-block sentinel memo skips GETs.
- **Cache layers**: HTTP `force-cache` on Esri/CARTO/patch/enriched `.glb`/MVT; iOS-only service worker, cache-first, 6,000 entries / 7 days (`public/sw.js:4-25`); desktop relies on Chrome disk cache (~95% `fromDiskCache`, `measure-tile-cache.mjs`).
- **Vector/labels**: `vectorTiles.ts` — OpenFreeMap MVT z14 only (`tuning.ts:2588`), ring 1–2 around focus, parsed on the **main thread** (`@mapbox/vector-tile` + `pbf`, `:397-398`), `Map` cache of 56 parsed tiles (`:601-633`). `vectorFeatures.ts` builds one `BufferGeometry`+`Mesh` per tile per kind (ribbons/fills, `MeshBasicMaterial`, `:348-357`), vertices seated on a 6×6 `heightAt` lattice, 8 raycasts/frame, 1 build/frame (`tuning.ts:2726-2729`), 48 built tiles retained. `streetNames.ts` — one `CanvasTexture` per name (44 px, `:148-175`), shared unit `PlaneGeometry` quad per label on the terrain, `depthWrite:false`, `depthTest` off in flat 2D (`:207-220`), selection every 20 frames, 40 labels max. `geoLabels.ts` — one `LineSegments` for boundaries + a **DOM** div pool (`position:fixed`, direct style writes every frame, ≤28 labels, `:112-195`). `minimapFeed.ts` mirrors clipped features to a store.
- **Draw structure per frame** (ESTIMATED; no measurement exists): ground = 1 draw per visible terrain tile (`MeshBasicMaterial`) + 1 `ShadowMaterial` twin per tile below 30 km (+ depth-pass draws under ULTRA terrain cast); OSM buildings = 2 draws per tile (fill + edges) ×(1 + shadow maps); enriched = 3 per cell (fill, edges, instanced trees) ×(1 + shadow maps); user models = 1–25 per model, ≤24 resident; vector web = 1 per (tile, kind); streets ≤40 quads; bloom ≈12 fullscreen draws. Composites: ~450 live at Dnipro; 101 loaded enriched cells hold 39,302 buildings + 60,527 trees (`tuning.ts:2486-2491`).

## Renderer config table

| Renderer | Source | errorTarget | LRU (high / mid / low / ULTRA) | Queues (high / mid / low) | Plugins in order |
|---|---|---|---|---|---|
| ground | ion `1` CWT + R2 GLO-30 patch (L13) | altitude ramp 2 (≤60 km) → 12 (750 km); mid 3, low 5; flat-2D deep 0.35 ≤1.2 km (`tuning.ts:2450-2471`) | 400/320/192/600 MB cap, floor 0.75·cap; bank 0.92·cap 45 s (mid/low) | 25/5 · 12/3 · 8/2 (+overlay 10) | ion(QM −1000) · patch fetch −500 · unlit −100 · Fade −2 · UpdateOnChange · LoadRegion · ImageOverlay −15 |
| buildings | ion `96188` OSM | 16 / 24 / 40; ULTRA 12; ×1.5–1.6 periphery in foveated FPV | 400/256/160/600 MB | 25/5 · 12/3 · 8/2 | ion · GLTFExtensions(draco+meshopt) · LoadRegion · `FTW_DNIPRO_OSM_MASK` |
| enriched | R2 `enriched/<variant>/tileset.json` | 16 (stream radius only — GE-0 leaves) | 400/256/160/600 MB | 25/5 · 12/3 · 8/2 | GLTFExtensions · `FTW_ENRICHED_FORCE_CACHE` −500 · LoadRegion |

## Tunables & budgets

| Name | Value | file:line | Bounds |
|---|---|---|---|
| `QUALITY.tiers.*.overlayResolutionPx` | 512 / 256 / 256 | tuning.ts:664,679,703 | composite size, Esri source zoom, GETs |
| `GROUND.overlayResolution2dPx` | 512 (sticky-up) | tuning.ts:2402 | flat-chart composite |
| `GROUND.fadeDurationMs / maxFadeOutTiles` | 700 / 300 | :2442,2445 | dissolve; snap threshold |
| `GROUND.errorTargetNear/Far`, `errorNearAlt/FarAlt` | 2/12, 60 km/750 km | :2450-2471 | terrain SSE ramp |
| `GROUND.errorTarget2dDeep`, `error2dDeepAltM/BlendAltM` | 0.35, 1.2/6 km | :2463-2467 | chart z17-18 |
| `GROUND.heightMemoCapacity` | 100,000 | :2494 | seat memo |
| `GROUND.placeholderMaxLevelsUp` | 3 | :2500 | sentinel fallback |
| `LOADING.fpvBiasK` / `queueCaps` | 1.5 / 12-3, 8-2 | :1513-1519 | download order, concurrency |
| `FOVEATION.regionErrorTargetM` | bld 8 · enr 4 · gnd 2 (GE metres) | :1540 | fovea refinement |
| `tiers.*.foveation` | mid 1400/160/1.5 · low 900/110/1.6 | :685,696 | ray range, eye radius, periphery |
| `QUALITY.lruBank` | 0.92 · 16 MiB · 45 s · mid/low | :743-763 | flip retention |
| `ultraDesktop` | bld ET 12, LRU 600/600 MB | :781-785 | ULTRA tiles |
| `ULTRA.anisotropy / mipLevels` | 16 / 4 (+32.8 % VRAM) | :837,860 | drape filtering |
| `TILESETS.esriMaxLevel/Coarse`, `cartoMaxLevel` | 19 / 18 / 20 | :1736-1749 | source depth |
| `GATES.groundActiveAlt/FadeTop/FadeBottom` | 3,000 / 750 / 380 km | :1562-1572 | ground traversal + reveal |
| `SHADOWS.maxAltM`, `ULTRA.terrainCastMaxAltM` | 30 km | :433,1074 | twin/caster draws |
| `VECTOR.tileCacheMax/maxBuilds/latticeBudget/buildBudget` | 56 / 48 / 8 / 1 | :2665-2729 | MVT cache, raycasts/frame |
| `STREETS.maxVisible / selectEveryFrames / canvasPx` | 40 / 20 / 44 | :2598-2644 | label textures |
| `LABELS.maxVisible` | 28 | :2564 | DOM labels |
| `MODELS.maxResident / triBudget` | 24 / 1.5 M | :3972-3973 | user-model residency |

## Measured numbers

| Metric | Value | Where | Date/tier |
|---|---|---|---|
| Ground LRU at rest, desktop | 109.8 MB vs 322.1 MB floor (trim never arises) | DECISIONS:1150; groupE memory | 2026-08-26 high — MEASURED |
| Rest-trim churn | ~600 Esri GETs per 2D↔FPV leg, cache pinned at 145/144 MB, cap 192 | DECISIONS:1205 | 2026-08-21 headless `low` — MEASURED |
| Extra tiles from ground `errorTarget` 0.05 / HQ region | **0** at 895 m and 5,969 m | T44 row | 2026-08-22 desktop — MEASURED |
| Live drape composites, Dnipro | 452/452 chained (chip at boot); 321 mid-session (2 chained) | RENDERING_ARCHITECTURE §2.6 | high — MEASURED |
| Mip-chain build cost | 5.36 ms/composite (JS readback) → 0.06 ms (`drawImage`) | mipChain.ts header; DECISIONS:1154 | MEASURED |
| CWT over Dnipro | max level 13; L13 tiles are 4-vertex quads (~2.4×1.6 km) | UPLIFT_PLAN App. A | 2026-08-18 — MEASURED |
| Esri placeholder | 2,521 B, FNV 0x92d9118f; z19 an island at Everest | esriPlaceholder.ts:5-17 | MEASURED |
| U5 stream latency (warm cache, M3 Pro) | buildings mean 376 ms/max 540; enriched tail ~1.9 s; 0 hitches/4 s walk, EMA ~21 ms | u5 memory | weak evidence |
| U6 first-tile after FPV entry | enriched 185–221 ms, ground 528–624 ms, buildings 1.1–1.3 s; 0 hitches/8 s, EMA 16.7 ms | u6 memory | warm cache |
| `heightAt` memo | 84 % hit over 18,457 entries; 406 terrain epochs/leg | RENDERING_ARCHITECTURE §1.7; tuning.ts:2486-2491 | MEASURED |
| Enriched working set | 101 cells, 39,302 buildings, 60,527 trees | tuning.ts:2486-2488 | MEASURED |
| HTTP revalidations removed by `force-cache` | ~60/reload; ~95 % fromDiskCache | imageryGround.ts:336-340; sw.js:6-7 | MEASURED |
| Composite bytes | 512² RGBA ≈ 1 MiB (+CARTO 2 MiB); "1.5–3 MiB per ground tile" | tuning.ts:746 | ESTIMATED |
| Draw calls / triangles per frame | **NONE recorded.** `frame.calls`/`frame.tris` HUD rows exist (`GlobeCanvas.tsx:1053-1054`, `debugCatalog.ts:165-178`) but no value appears in DECISIONS or memories | — | UNMEASURED |

## Limitations, caveats, traps

- Composite boundaries are C0-discontinuous (`mipChain.ts:3-14`; §2.6).
- Creation-time levers (anisotropy, mips, overlay resolution) reach almost nothing mid-session on desktop (ground cache never turns over) — delivered by reload.
- Floor-driven eviction (`LRUCache.js:348`): a mode flip marks the previous working set unused in one frame; the bank retains at most `cap − 16 MiB` and expires at 45 s.
- Parse is main-thread glb decode (`tuning.ts:1500-1503`); RC18 live-promote raises parse jobs 2→3→5 mid-viewfinder — documented hitch risk.
- `UpdateOnChangePlugin` staleness: an error-target/region change with a parked camera needs an explicit `needsUpdate` kick (`imageryGround.ts:1176-1180`).
- T33 upstream bug — `_onTileVisibilityChange` reads `tileInfo.get(tile).range` unguarded; locally patched (`imageryGround.ts:386-410`).
- `levels` is a COUNT in `XYZTilesOverlay` (`:329-331`).
- Overlay rebuild = fresh instances — re-adding the same overlay nests the fetch wrapper (`:332-335`).
- Esri 200-placeholder defeats `load-error`/`resetFailedOverlays`, `force-cache` and the SW pin it.
- Terrain skirts cast/receive — must leave the shadow pipeline (`terrainSkirt.ts`).
- CSS-px vs device-px SSE split — ion OSM buildings refine ~2× coarser than the ground on retina (audit gap #15).
- MVT parsing, `EdgesGeometry` construction, canvas compositing and mip halving all run on the main thread; no workers anywhere in the tile path (only BEST SPOT uses a worker).
- Ground `raycast` goes through the library BVH (`TilesGroup.js:19-30` → `raycastTraverse`), but every `heightAt` miss is retried (null never memoised).
- Checkerboard/flicker (T5): prime suspect the Bayer screen-door dissolve with a stuck `age<1` plus LOD churn 1500→200 km; never reproduced under instrumentation.

## Already refuted / rejected

| Candidate | Reason | Citation |
|---|---|---|
| `BatchedTilesPlugin` | single material, no per-tile material swap → kills reveal/tint/ghost/edges | buildings.ts:31-32; BatchedTilesPlugin.js:17-19 |
| Desktop refinement region / HQ 3D MAP (T44) | zero extra tiles even at errorTarget 0.05 — availability-capped | T44; §2.1 |
| Foveation on `high` for far-field | ground region error = GE − 2 + 2 = GE; beats camera only beyond 1568 m > 1400 m cap | audit §4 |
| Geomorphing between LODs | `heightAt` is a CPU raycast; fades snap on motion; TIN has no vertex correspondence | audit §4 |
| `TileFlatteningPlugin` under footprints | no tessellation on 38×25 m posting; self-confirming height fixed point | audit §4 |
| KTX2/Basis + texture budget for composites | baked GLBs carry no textures | audit §4 |
| Horizon/limb culling for tiles | exists via far plane (`MIN_ELEVATION 2550`) | audit §4 |
| Ground download look-bias | fovea region error already the primary key; overlay has its own visible-first queue | audit §4 |
| Full auto mip chain | transparent-border bleed; only RC25's capped chain | charter §6 |
| Occlusion culling | out of scope until a conservative horizon profile exists | charter §6; audit #20 |
| Rest-trim churn on desktop (T34/M13) | cache rests below the floor on `high` | DECISIONS:1150 |
| Re:Earth Overture buildings | every glb 500 over Dnipro | tuning.ts:1758-1764 |
| CARTO raster street labels | blurry, cannot scale with zoom | tuning.ts:1745-1748 |
| Coarse-parent seat raycast hit (M7) | `hitsPerSample` 1.00 | §2.1 |

## Open backlog rows: T1, T5, T7, T19, T29, T33, T34, T43 (#10/#15/#20/#21/#22/#23/#24), T48, T56, T73, T77.

## Gaps vs a modern engine (ASSESSMENT)

1. No GPU-driven or occlusion culling. Culling is CPU tileset frustum + far plane only; building shaders `discard` (defeats early-Z). A conservative horizon-profile occluder exists in `lib/geo/occlusion.ts` but never reaches the renderer.
2. No HLOD / impostors. Enriched leaves are GE-0 with a single root; OSM buildings have no coarse proxy; T7 unbuilt.
3. Draw-call structure is per-tile, per-decoration. Edges double every building tile's draws; shadow twins double ground draws; no batching (`BatchedMesh` + per-instance attributes for birth/seed would reconcile with the shared-material invariant). Nothing is measured — first action is reading `frame.calls` at the Dnipro FPV pose.
4. No worker-side parsing (glb parse, `EdgesGeometry`, MVT decode, canvas composite, mip halving all block the main thread).
5. No virtual texturing / texture streaming by VRAM (byte LRU is a proxy, not a VRAM budget); no compressed formats.
6. No prefetch prediction beyond the FPV look-bias comparator and the eye bubble.
7. No temporal AA / reprojection; MSAA on the composer target only.
8. Governor is frame-time-only; memory/thermal/network invisible.

Gaps not closed: no per-frame draw-call/triangle numbers exist anywhere; runtime `frustumCulled` state of edge `LineSegments`/shadow twins inferred from source order; buildings/enriched LRU resting bytes on desktop never recorded; composite VRAM per tile is arithmetic; mid/low and all mobile numbers are headless or absent (T1).
