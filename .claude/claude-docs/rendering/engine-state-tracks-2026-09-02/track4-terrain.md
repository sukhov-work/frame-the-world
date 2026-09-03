# TRACK 4: Terrain, seats/reseat, precision, buildings, models, bake (agent report, confidence 82%)

## Terrain (single vertical authority)
One ground `TilesRenderer` streams Cesium World Terrain (ion asset "1"); only surface anything is seated on. `UpdateOnChangePlugin` (`imageryGround.ts:318`). GLO-30 patch swapped inside this renderer: `hookTerrainPatch` wraps `QuantizedMeshPlugin.createChild` and rewrites `tile.content.uri` for tiles the serve-set claims (`terrainPatch.ts:58-76`); `fetchData` plugin at −500 claims patch URLs with plain `force-cache` fetch (`:90-106`). Serve-set: z ≤ `extentMaxDepth` → tile fully inside `extentBbox`; `extentMaxDepth` < z ≤ `maxDepth` → intersects `cityBbox`. Dnipro extent `[34,48,36,49]`, depths 13/13; Everest `[86,27,88,29]`; St Albans no patch (`regions.ts:32-75`). mago clamps to L13 (≈38×25 m posting). Datum: ellipsoidal at bake (`--geoid EGM2008`, `bake-terrain.mjs:124-133`); EXIF `GPSAltitude` deliberately NOT corrected — mitigation `max(sliderAlt, terrainH+1.7)` on the eye (`PhotoFrustum.ts:138`). "DO NOT ADD A RUNTIME GEOID" binding.

**`heightAt`** (`imageryGround.ts:1111-1140`): down-ray from 12 km along geodetic normal, `far = 24_000`, `intersectObject(tiles.group, true)`. `TilesGroup.raycast` delegates to `TilesRenderer.raycast` (`optimizeRaycast` default) — library walks the hierarchy by bounding volume and tests geometry only for tiles in `activeTiles` (`raycastTraverse.js:150-165`) — why M7 measured 1.00. `firstHitOnly` never set. `chooseTerrainHit` picks the deepest stamped tile (`terrainPick.ts`). Memoised in `HeightMemo` keyed on exact float64 `"lat,lon"` strings under `terrainEpoch` (`heightMemo.ts:54-58`); `null` never cached; on overflow the whole map is dropped. **`terrainEpoch` bumps on every ground `load-model`** (`imageryGround.ts:907-911`) — every finished terrain tile dumps the entire city-wide memo. Shadow twins carry `raycast = () => {}`. Consumers clamp `[0, 9000]` via `clampGroundM`/`sampleGroundM` (`terrain.ts:12-34`).

## Seats (`enrichedBuildings.ts`)
Bake sits at ellipsoid h = 0 in one ENU frame; lifted at runtime in four eased layers that sum to each footprint's own terrain — group (`:1625-1634`), cell (`:1636-1666`), per-building Y write into the non-indexed position attribute + edge CSR (`:1462-1582`), per-tree `instanceMatrix` m13 (`:1587-1611`). `seatStep`: `applied == null ? target : applied + (target−applied)·K` (`enrichedMask.ts:69-72`) — first sample snaps, refinements ease. Per-feature sampling gated by `cellGateM = max(45, observedRelief·1.5)` with `deferred`/`rejected` counters (`:1354-1377`), re-checked at apply ("poisoned pair" collapses to the cell plane and re-queues). `ensureLocated` one-shot per cell. Seat state survives LRU eviction via `seatCache` keyed by cell URI (RC9). CPU vertex mutation deliberate so occlusion sweeps, shadows and picks read the same arrays (`:118-127`).

## FPV eye
Temp-FPV eye = pin ground + up·eye + world walk offset; temp-pin ground sticky, clamped, eased once per frame (`TEMPPIN.groundEaseK` 0.12); walked eye re-samples ground every 4 m and eases delta at 0.08 (`StylizedTiles.ts:4740-4770`); `controls.adjustCamera` every FPV frame. DEV eye-jump ring >0.5 m. Orbit: street-floor guard samples view focus every frame below 50 km, clamps to `lastGround + 2 m` (`:5182-5210`); frustum/pins/placemarks `resnap()` every 120 frames — a snap, not an ease.

## Precision
World space raw unrotated ECEF; **no floating origin, no RTE, no `matrixWorldAutoUpdate` toggles**. Precision rides three's float64 CPU `modelViewMatrix` — tile geometry relative-to-centre (`CESIUM_RTC`), enriched cells and models local-metre geometry. Explicit camera-anchored RTC for Pins/placeMarkers/PhotoFrustum. **Float32 ECEF world-position varyings** in ground (`vFtwW`), buildings (`vFtwWPos`), models feed `ftwAerial`'s `wpos − cameraPosition` — ~0.5 m ulp on both operands, haze-only (ESTIMATED). Camera: `POSE.near 1 / far 1e9` at init, then `GlobeControls.adjustCamera` sets near = `max(lerp(1,1000,α), d−R−0.25R)` and far = horizon distance at `max(elev, MIN_ELEVATION 2550)` — ≈180,375 m in FPV, 24 depth bits, no `logarithmicDepthBuffer`. Shadow `normalBias` in world metres because ECEF float32 quantises ≈0.5 m.

## Enriched buildings / trees / bake
Gridded 3D-Tiles 1.1, `refine ADD`, root GE 512 no content, GE-0 leaf cells, ±80 m region pad, per-cell GLB with contiguous `_FEATURE_ID_0` runs + schema-2 `meta.json` sidecar `{id, osm, cls, base, top, skirt, src}`. **No draco/meshopt on the output** (raw float32) though both decoders wired on the client. Dnipro grid 20 → ≈1×1 km cells; o2w default. Trees: `EXT_mesh_gpu_instancing`, one `InstancedMesh` per cell, no LOD, no per-instance culling, raycast disabled, shadows on. Residency = library byte-LRU only (400/256/160 MB by tier, ULTRA 600); no cell-count or distance cap. OSM stock masked inside baked bboxes by stop-traversal plugin + 4-plane ECEF clip prism. Skirt: RC13 lowered the wall rim 4 m below base for +0 vertices. Straddlers: ownership by bbox intersection (RC16). Sizes MEASURED: dnipro classic 127,890 bldgs / 386 cells / 5.05 M verts / 161,823 trees / 155 MB; dnipro-o2w 133,437 features / 389 cells / 7.74 M verts / 227 MB; st-albans-o2w 26,187 / 36 cells / 50 MB; terrain dnipro 11.5 MB, everest 210 MB. Hosting: private R2 behind a Worker, binaries immutable, `.json` 300 s.

## Stock buildings (`buildings.ts`)
Shared material swap on `load-model`; synchronous per-mesh `EdgesGeometry(30°)` + `LineSegments` with no cap or deferral (`:290-294`); `polygonOffset` 0.5; Bayer screen-door reveal/solidity; `ftwAerial` haze on an *assigned* `onBeforeCompile` (`buildingMaterial.ts:161`). **Never seated** — ride CWT as ion clamped them; the U7b patch broke that invariant inside the extent annulus (audit gap #7; RC14 unbuilt).

## User models (`userModels.ts`)
ENU rig → anchor → body → GLB rebased by `groundFitOffset`; residency 3000 m in / 4000 m out, 24 models, 1.5 M tris, replanned every 12 frames; `GLTFLoader.loadAsync` on main thread, no worker, no GLB cache, no instancing; cast+receive shadows on every mesh; chained `patchModelShader` (haze + Bayer dissolve). Seat = `sampleGroundM(heightAt)` with 120 m fallback applied immediately, eased at 0.18, re-asked every 60 frames. No skirt, no `terrainEpoch` reference.

## Reseat mechanics
**Camera moves 500 m in temp-FPV (walk 22 m/s ≈ 23 s).** `stepEnrichedUpdate` (13) runs before `stepFpvPose` (18) and `stepGroundUpdate` (35) → seats sample last frame's ground (one-frame lag).
1. Ground: camera moved → re-traverse; new terrain tiles at errorTarget 2 device-px; each `load-model` → `terrainEpoch++` → **whole memo dropped city-wide**. One leg saw 406 epoch bumps.
2. Eye: every 4 m the walked point is raycast (guaranteed memo miss), sticky on null, delta eased K = 0.08/frame → τ ≈ 12.5 frames ≈ 0.21 s; the eye trails the ground ≈4.6 m horizontally at walk, ≈14 m at sprint — on a 10 % grade ≈0.5 m / 1.4 m vertical lag (ESTIMATED; MEASURED analogue 0.50 m tracked, 0.23 m max step over 302 m).
3. Seats: `rankPriorityCells` re-ranks top-4 cells by look-biased distance every 30 frames. 48/64 building + 30/40 tree samples go to those cells; 16 + 10 to the global round-robin. Cell centres 6/frame; group centre every frame.
4. Cost when memo cold: 6 + 64 + 40 + 1 ≈ 111 raycasts × 0.018–0.067 ms = **2–7 ms in that frame** (ESTIMATED), repeating until the memo re-warms; steady-state hit rates 42 % and 84 % on different legs.
5. Convergence: RC7 look-cone 50.3 % vs 33.9 % city-wide; audit bar (>0.9 in cone within 5 s) **not met**.

**A terrain tile refines under a building.** Tile crossfades over 700 ms — the ground moves visibly at once. `terrainEpoch++` dumps the memo. Cell centre re-samples within ≤17 frames and eases at 0.12 (τ ≈ 8 frames; 10 m → <1 cm in ≈0.9 s at 60 Hz). But `f.seatM` is sticky: layers sum to `f.seatM`, so the cell shift is cancelled by the feature residual and **the building holds its old absolute height until its own footprint is re-sampled** — ≤ ~0.55 s in a look-cone cell (48/frame over ≈1,550 features), otherwise 16/frame round-robin over ≈39,302 footprints ≈ **41 s** at 60 Hz; trees 10/frame over 60,527 ≈ **100 s** (ESTIMATED from MEASURED counts). If the new cell seat differs from the stale feature seat by more than the gate, the feature eases to the cell plane first, then to the fresh sample. **Every ease is per-frame, not per-second** — at 30 fps every settle takes twice the wall time. A cell with >8 touched runs re-uploads the whole buffer (`:1564-1582`), the normal case for a settling cell.

## Tunables (selected)
| name | value | file:line |
|---|---|---|
| `GROUND.errorTargetNear/Far` | 2 / 12 device px | tuning.ts:2450-2451 |
| `GROUND.fadeDurationMs / maxFadeOutTiles` | 700 / 300 | :2442,2445 |
| `GROUND.heightMemoCapacity` | 100,000 | :2494 |
| heightAt origin / far | 12 km / 24 km | imageryGround.ts:1120-1123 |
| `ENRICHED.reseatSamplesPerFrame` / `reseatEaseK` | 6 / 0.12 | :2187,2191 |
| `reseatFeatureSamplesPerFrame / Tree` | 64 / 40 | :2210,2213 |
| `reseatPriorityCells / RoundRobinShare / EveryFrames` | 4 / 0.25 / 30 | :2234,2237,2215 |
| `reseatFeatureMaxDeltaM / reseatReliefK` | 45 m / 1.5 | :2220,2228 |
| `reseatBoundsPadM` / bake `RESEAT_PAD_M` | 40 / 80 m | |
| `editUpdateRangeMaxRuns` / `overrideEaseK` | 8 / 0.18 | :2307,2261 |
| enriched `errorTarget` | 16 | :2326 |
| `FPV.walkReseatDistM / EaseK` | 4 m / 0.08 | :3107,3111 |
| `FPV.anchorGroundEveryFrames` | 30 | :3084 |
| `TEMPPIN.groundEaseK` | 0.12 | :3501 |
| `FRUSTUM/PINS/PLACEMARKS.resnapEveryFrames` | 120 | |
| `MODELS.loadRadiusM/unloadRadiusM/maxResident/triBudget` | 3000/4000/24/1.5 M | :3967-3975 |
| `MODELS.resnapEveryFrames / seatEaseK / fallbackGroundM` | 60 / 0.18 / 120 | |
| `PLAN.reseatQuietFrames` | 90 | :3582 |
| `ORCH.groundGuardMaxAltM / CONTROLS.zoomMinAltM` | 50 km / 2 m | |
| `FLIGHT.floorClearM / arrivalAltAboveGroundM` | 250 / 200 | |

## Measured
| quantity | value | status |
|---|---|---|
| `heightAt` cost | 0.018–0.067 ms/sample | MEASURED |
| samples/frame pre-RC11 | 30–45 (0.5–3 ms/frame) | MEASURED (derived) |
| memo hit rate | 84.0 % / 18,457 entries; 42 % on another leg | MEASURED |
| working set (Dnipro) | 39,302 bldgs + 60,527 trees / 101 cells | MEASURED |
| epoch bumps in one leg | 406 | MEASURED |
| `hitsPerSample` (M7) | 1.00 | MEASURED |
| `applyFeatureSeats` compare pass | ~0.2 ms | MEASURED |
| curvature residual | 0.568 m vs 14.20 m rms (4 %) | MEASURED |
| look-cone convergence (RC7) | 50.3 % vs 33.9 %; 4,570 gate rejections | MEASURED |
| walk re-seat tracking | 0.50 m over 302 m; max 0.23 m/sample | MEASURED |
| CWT over UA | L13 max, 4-vertex quads per ~2.4×1.6 km; +33…58 m landmark errors | MEASURED |
| depth | 24 bits, near 1.0 m, far 180,375 m; 0 shimmer in 10 legs | MEASURED |
| dz at 3/10/20 km | 0.54 / 5.96 / 23.8 m | ESTIMATED |
| DSM signature | footprints +0.34 m median (inert); canopy +1.01 m median, p95 10.36 m | MEASURED |
| per-cell relief spread | −20.6 → +82 m across 41 cells | MEASURED |
| cold-memo frame spike | 2–7 ms | ESTIMATED |
| off-cone feature refresh wrap | ≈41 s bldgs / ≈100 s trees @60 Hz | ESTIMATED |
| model arrival hitch | 20–200 ms | ESTIMATED |

## Limitations / traps
- Memo invalidation is global, not spatial.
- Sticky stale seats after a refine (tens of seconds off-cone).
- Ease is per-frame (no dt term anywhere in the seat path).
- Gate is structural: a footprint further than `max(45, 1.5·observed)` m from its cell centre never seats; MS1 moves beyond it slam onto the cell plane.
- Rigid box on one centroid; ±(slope × half-diagonal) residual; 4 m rim skirt hides downhill float (RC13). **§2.6 of RENDERING_ARCHITECTURE still says the skirt "is not built" — doc drift.** User models have no skirt.
- DSM, not DTM: trees planted on the canopy (T58).
- OSM stock buildings never seated (gap #7; RC14 unbuilt).
- CWT LOD garbage: negative/coarse heights while streaming — hence `clampGroundM`, sticky-null.
- `TilesGroup.updateMatrixWorld` only recurses when its own matrix changed — every cell write must force `updateMatrixWorld(true)`.
- Whole-cell buffer re-upload when >8 runs move; edge CSR co-mutation doubles it.
- `EdgesGeometry` on the main thread per stock tile, uncapped (UNVERIFIED on dense metros).
- User models: 120 m fallback applied immediately; `GLTFLoader` + texture upload main-thread; every mesh in every shadow pass.
- T76: fresh headless profile reads `heightAt = −2047` at the pin for the whole window.
- Float32 world-position varyings latent hazard if used for anything sharper than haze.

## Refuted
RC12 curvature (0.568 vs 14.2 m) · M7 fading parent (1.00) · RC28 log/reversed depth · runtime geoid (D4 binding) · RC15 DSM→DTM buildings (+0.34 m) · geomorphing · `TileFlatteningPlugin` · foveation on high · extruded base skirt (+59 % verts vs +0 rim lowering) · RC16 margin ring · enriched CSS-px SSE (2-level tileset).

## Open rows: T5, T7, T31, T58, T76, T77; RC7 convergence tail, RC9 warm-restore UNVERIFIED, RC14 unbuilt, audit gap #7.

## Gaps vs a modern engine (ASSESSMENT)
1. **Height lookup is a CPU raycast per footprint.** Modern: seat from a height field (per-cell height raster baked against the shipped L13 TIN, or a GPU heightmap). Inside a patched region the runtime raycasts the same file the bake wrote, so a bake-time per-feature (even per-vertex) seat against the post-blend L13 TIN would equal the runtime answer exactly at full LOD — the datum objection is moot there. Not moot for St Albans (CWT-only, ion-mutable) or while coarser LODs are on screen; runtime raycast stays as fallback/target-of-ease. **Single biggest "faster and more precise" lever**: all 39k footprints seated in one frame, no 41 s wrap, no gate.
2. Invalidation is global → spatially keyed (per-tile epoch / per-cell dirty bit from `load-model` bounding region) keeps 99 % warm.
3. Ease is frame-locked → dt-based `1 − exp(−dt/τ)`.
4. Rigid-box seating → footprint plane fit (3–4 samples → tilt) or terrain-conformed bases.
5. No floating origin / RTE; adequate today (hot geometry local-metre under float64 CPU matrices). Low priority.
6. No HLOD / meshlets / impostors: enriched 2-level ADD; far field is a cutoff (T7); models no LOD rungs.
7. Main-thread parsing: library parse queue, `GLTFLoader`, `EdgesGeometry`.
8. **No spatial index**: `three-mesh-bvh` absent from `node_modules` (verified); terrain uses tile bounding volumes then brute-force triangles; model/enriched picks brute-force.
9. Instancing/merging: good for trees, enriched soup; absent for user models (no GLB cache, no InstancedMesh per URL, no shadow leash, no KTX2).
10. Seats as CPU vertex writes → per-feature `dy` attribute + GPU offset removes whole-cell uploads; CPU arrays updated lazily for occlusion/pick.

Gaps not closed: sweep cost post-RC11 derived not re-measured; RC7 tail closure after DBG; T7 far-field inferred; `EdgesGeometry` dense-metro cost; "6 km bake fits the LRU" statement may be stale; `TRANSLATE_MAX_M` 60 vs code 5000 doc drift.
