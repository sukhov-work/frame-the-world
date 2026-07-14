# WIP 2026-07-13 — Dnipro Slice 3: instanced trees — DONE (browser-VERIFIED)

**Mode:** implement/Deep (`/frame` + investigate-design-v3). **Gates: astro check 0/0 · vitest 473
(+14) · wix build Complete · browser-VERIFIED in `wix dev` via Playwright MCP.** Shots:
`verify-shots/slice3-01..04` (night overview · day overview Monastyrsky · 400 m riverbank seating ·
180 m close canopy).

## What shipped
~24.7k deterministic instanced trees baked INTO the enriched per-cell glbs and rendered by the
existing enriched `TilesRenderer` — no new renderer, no new precision handling.

### Bake (scripts/bake)
- NEW `lib/vegetation.mjs`: `fetchVegetation` (Overpass, own cache `osm-veg-*`), `extractVegetation`
  (points/rows/polys, outer rings only), `hashSeed` (FNV-1a) + `mulberry32` (NO Math.random —
  re-bakes byte-identical), `buildFootprintIndex` (spatial hash ~55 m buckets → point-in-any-building
  rejection), `scatterTrees`, `packTreeInstances`, `unitTreeGeometry`.
- **Data reality (Overpass probe):** Dnipro bbox has only **418 `natural=tree`** nodes; 202
  `tree_row` ways; 176+32 wood; 9 forest; 28 park; 1265 grass (grass NOT planted — grass ≠ trees).
  → placements = points (tagged height wins) + row sampling (`rowSpacingM` 9) + jittered-grid
  scatter (wood 13 m / park 24 m grid, GLOBAL per-class grid anchored at bbox SW so overlapping
  polys can't double-plant; per-cell hash rng; 15–85% cell jitter).
- Rejections: inside any building footprint (424), C6 excluder (polygon rules apply to bare points —
  tag rules no-op on empty tags), outside bbox; cap `maxTrees` 60k by hash-probability keep.
- **Result: 417 points + 2,754 row + 18,121 wood + 3,422 park = 24,714 trees · 94 tiles (4
  tree-only cells — cells are created for trees too, bounds/maxH extended) · 34.05 MB (+1.2 MB
  ≈ 50 B/tree).**
- `lib/gltf.mjs` `encodeGlb` REWRITTEN to compose nodes dynamically: optional buildings mesh +
  optional "ftw-trees" node = unit tree mesh (72-vert flat soup: 8-gon double-cone canopy y
  0.22–1.0 r 0.5 + prism trunk) + `EXT_mesh_gpu_instancing` {TRANSLATION VEC3, ROTATION VEC4 (yaw
  quat about +Y), SCALE VEC3 (radius/0.5, height, radius/0.5)}; `extensionsUsed` ONLY (never
  Required — non-supporting loaders degrade to one un-instanced tree, not a refused tile).
  ENU→glTF mapping (e, u, −n) same as buildings; translations at u=0 (re-seat lifts).
- `cities/dnipro.json` gains the optional `vegetation` block (omit → no trees, city-agnostic).
- Canopy-height rasters (ETH 10 m / Meta-WRI 1 m CC-BY) = **documented upgrade tier 4** in
  README (GeoTIFF/COG reader needs deps — public npm blocked here; recipe keeps the
  `packTreeInstances` contract so nothing downstream changes).

### Runtime (scene/enrichedBuildings.ts + tuning.ts TREES group)
- three 0.185 `GLTFLoader` registers `GLTFMeshGpuInstancing` BY DEFAULT (GLTFLoader.js:249, class
  :1682) → ONE `InstancedMesh` per cell; `GLTFExtensionsPlugin` only ADDS extensions (source-
  verified). Trees inherit cell streaming + LRU + per-cell terrain re-seat for free.
- load-model traverse: **`isInstancedMesh` branch FIRST** (InstancedMesh passes `isMesh` — without
  the branch it would get the building material + an EdgesGeometry of the unit tree). Swap to ONE
  shared `treeMat` (MeshStandardMaterial flatShading, `tokens.vecGreen` #2E4A3A), castShadow =
  `TREES.castShadow`, receiveShadow, `raycast = () => {}`.
- `setNight`: canopy albedo dims CPU-side — `treeMat.color = base × (1 − TREES.nightDim·night)`
  (live-verified #2e4a3a day ↔ #1d3126 night, both directions).
- `setSolidity` (FPV BUILDINGS slider): trees fade to `TREES.fpvMinOpacity` 0.15 at slider 0.
- dispose(): treeMat disposed with the other shared materials.

## TRAPS (load-bearing, source-verified in node_modules)
1. **InstancedMesh instanceMatrix LEAKS on LRU eviction**: 3d-tiles-renderer's disposeTile disposes
   geometry/material/textures but NEVER calls `mesh.dispose()`; `instanceMatrix` is an
   InstancedBufferAttribute on the MESH, freed only by the 'dispose' event `InstancedMesh.dispose()`
   fires (three WebGLObjects.onInstancedMeshDispose → WebGLAttributes.remove → gl.deleteBuffer).
   FIX: dispose-model handler calls `c.dispose()` on every InstancedMesh. Verified live: full LRU
   cycle 2.6 km → 30 km (0 meshes) → 2.6 km (68 rebuilt), zero console errors.
2. **`InstancedMesh.raycast` iterates EVERY instance** (no BVH in this repo) and GlobeControls
   raycasts the WHOLE scene on pointer-down (`EnvironmentControls._raycast` →
   `raycaster.intersectObject(scene)`; `firstHitOnly` does not prune within an object) → a 1.5k-
   instance cell would eat pivot picks. FIX: `raycast = () => {}` (the library's own pivotMesh
   pattern; returns undefined → contributes no hits, doesn't block traversal).
3. TS JSDoc: `@returns {stats:object}` makes astro check reject property access in .ts tests —
   use `Record<string,number>` in .mjs JSDoc.

## Browser verification (wix dev, Playwright MCP)
- 63–68 InstancedMesh cells / 14,774–21,084 instances streaming beside 72 building meshes; all
  castShadow + raycast-noop. quality tier `mid` (M3 floor).
- Seating verified visually at 400 m (riverbank) + 180 m (park slope): trees stand ON terrain,
  trunks+canopies read, tree rows along streets, island/park coverage matches OSM.
- Night: no glow, canopy merges into dark mass. Console: only the 2 known benign errors
  (members/my 403 anon + frog beacon).
- Steering recipe: `#p=` hash on FIRST load (skips Welcome), then `__cameraStore` requestFly +
  setTargetHeading/Tilt; time via `__timeStore.setTime` (13:00 UTC = 16:00 Dnipro daylight).

## UNVERIFIED tails
- FPV BUILDINGS-slider tree fade (same construction as the verified buildings path — not driven
  in actual FPV this session).
- Sub-M3 laptop + phone FPS (<150 MB resident DoD) — still no such device (carried from Slice 2).
- Trees add ~1 instanced draw/cell + 1 shadow draw/cell — no measured FPS delta on the M3 (felt none).

## Decisions recorded
- **Terrain (plan §Slice 3): keep Cesium World Terrain** — R1 runtime clamp never forced a co-bake;
  GLO-30 co-bake would be a downgrade vs rendered CWT. Recorded in plan + DECISIONS.
- Trees ride the enriched tileset (NOT a 4th renderer, NOT camera-anchored like pins) because
  cells already solve streaming/precision/re-seat; the instancing extension makes the marginal
  cost ~50 B/tree.

## Files
`scripts/bake/lib/vegetation.mjs` (NEW) · `scripts/bake/lib/gltf.mjs` (dynamic nodes + instancing)
· `scripts/bake/bake.mjs` (stage 4b) · `scripts/bake/cities/dnipro.json` (vegetation) ·
`scripts/bake/README.md` (trees + tier 4) · `src/components/globe/scene/enrichedBuildings.ts` ·
`src/components/globe/tuning.ts` (TREES) · `test/bake/vegetation.test.ts` (NEW 11) ·
`test/bake/bake.test.ts` (+3 glb/pack).

NEXT: Slice 5 (feed buildings+trees into the Pass-3 obstruction moat) · owner R2 hosting ·
optional HLOD coarse tier · Slice 4 splats (deferred).

Related: [[project/wip-2026-07-13-dnipro-slice2]] [[project/wip-2026-07-13-terrain-reseat]]
[[project/wip-2026-07-13-dnipro-slice1-bake]] [[patterns/globe-rendering]]
