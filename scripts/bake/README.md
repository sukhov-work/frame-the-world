# `bake` — Dnipro 3D Enrichment buildings + trees pipeline (Slices 1–3)

Reproducible **offline** bake of roof-shaped enriched buildings **+ instanced trees** for one city →
self-hostable **3D Tiles**, streamed by `scene/enrichedBuildings.ts` and masked over the global Cesium
OSM Buildings inside the city bbox. Part of `.claude/claude-docs/DNIPRO_3D_ENRICHMENT_PLAN.md`
(Slices 1–3). **All inputs are public OSM (ODbL).**

```bash
npm run bake -- --city dnipro          # or: node scripts/bake/bake.mjs --city dnipro
#   --refresh   re-query Overpass (otherwise the on-disk cache is reused)
#   --out DIR   override the config's output dir
```

## What it does (the LIGHT Node path — fidelity tier 1 of 3)

```
Overpass footprints+tags  →  C6 exclusion  →  height inference  →  roof-shaped extrusion  →
spatial-grid 3D Tiles 1.1 (per-cell glb, shared ENU frame)  →  public/enriched/<city>/
```

- **Height inference** (the whole point — <10% of OSM buildings carry a height; ~47% in central Dnipro):
  `height` tag → `building:levels × levelHeightM` → per-class default → generic default. `min_height` /
  `building:min_level` set the base; `roof:height` / `roof:levels` or `span × roofPitch` the roof.
- **Roof shapes** from `roof:shape`: `flat` (ear-clipped cap), `gabled`/`round` (OBB ridge over a
  watertight cap), `hipped`/`pyramidal`/`dome`/… (centroid pyramid). Everything else → safe flat cap.
- **C6 exclusion applied BEFORE tiling** (`lib/exclusion.mjs`): a built-in sensitive-tag blocklist
  (military=*, landuse=military, building=military/bunker, power=substation/plant/generator/transformer)
  plus optional per-city polygon exclusions. Excluded counts are reported — no silent drops.
- **Seating = runtime clamp-to-CWT (R1).** Geometry is baked at ellipsoid **h = 0**; `enrichedBuildings.ts`
  lifts the whole tileset group onto the rendered Cesium World Terrain at runtime (CWT is WGS84-ellipsoidal;
  open DEMs are geoid-orthometric — never bake absolute Z). One ENU→ECEF root transform for the whole grid,
  so one lift seats every cell.
- **`_FEATURE_ID_0`** per building → Slice 2 can drive the shared building material's per-building tonal
  variation (`buildings.ts` reads `_feature_id_0`).
- **Trees (Slice 3, opt-in via the config's `vegetation` block).** OSM `natural=tree` points (Dnipro maps
  only ~418) + `natural=tree_row` sampling (`rowSpacingM`) + deterministic jittered-grid scatter over
  `natural=wood` / `landuse=forest` / `leisure=park` polygons (`spacingWoodM`/`spacingParkM`; grass is NOT
  planted). Placements are rejected inside building footprints and C6-excluded zones, clipped to the bbox,
  and capped (`maxTrees`, hash-probability thinning). Each cell glb gains ONE `EXT_mesh_gpu_instancing`
  node ("ftw-trees", ~50 bytes/tree) → three loads it as an InstancedMesh; streaming/LRU/per-cell re-seat
  are inherited. Everything is hash-seeded — re-bakes are byte-identical.

Output per city: `tileset.json`, `cell-<i>-<j>.glb` (one per non-empty grid cell), `bake-manifest.json`
(provenance + counts + the ODbL attribution string). Baked artifacts are git-ignored (they belong on R2).

## Wire it into the app

```bash
# .env.local
PUBLIC_ENRICHED_TILES_URL=/enriched/dnipro/tileset.json     # (restart wix dev — Vite reads .env at start)
# src/components/globe/tuning.ts — ENRICHED.bbox MUST equal the config bbox (mask extent == enriched extent)
```
Absent `PUBLIC_ENRICHED_TILES_URL` → the enriched layer is byte-identical-OFF.

## Per-city config (`cities/<city>.json`)

`bbox` [w,s,e,n] · `grid` (N×N cells) · `buildings` (`levelHeightM`, `defaultHeightM`, `roofPitch`,
`classDefaultsM`) · `vegetation` (optional — `spacingWoodM`/`spacingParkM`/`rowSpacingM`, `heightM`
class ranges, `canopyRadiusK`, `maxTrees`; omit the block to bake no trees) · `exclusion.polygons`
(C6 named sites) · `attribution` (ODbL) · `output`. Onboarding city #2 = a new config +
`npm run bake -- --city <name>`. Global-drop-in (point at coords): footprints, heights, vegetation.
Per-city-curated: the exclusion mask, class/height cleanup.

## Attribution (mandatory — ODbL)

The bake is a **derived database** of OpenStreetMap. Any deployment that streams these tiles MUST carry
*"Contains information from OpenStreetMap © OpenStreetMap contributors, made available under the ODbL"* in
the UI (the app footer already credits © OpenStreetMap contributors; make the **ODbL** explicit when the
enriched layer ships). The manifest carries the full string. Publish any redistributed derived DB under ODbL.

## Known limitations (v1) → fixes

- **Single-point re-seat over a large bbox.** The runtime lift uses ONE terrain height (bbox centre). Over
  ~2 km, buildings near the river (lower terrain) can float/sink a few metres. **Fix (Slice 2):** per-cell
  re-seat — each grid tile is a separate group, so lift each by its own centre's `terrainHeightAt`.
- **Boundary OSM leak.** Cesium OSM tiles straddling the bbox edge leak a thin rim inside it (leaf-centre
  mask is clean). **Fix (Slice 2):** the ECEF clipping-plane hole on the shared material.
- **Roof approximation.** Gable uses the footprint's PCA-OBB (slight overhang on non-rectangular plans);
  mansard/sawtooth/skillion fall back to flat. **Fix:** tier 2/3 below.
- **Single-LOD grid.** Spatial cells cull + stream, but there's one detail level (no coarse LOD). Fine at
  ~0.1–0.3 GB / city; add HLOD when scaling past the central core.

## Higher-fidelity tiers (upgrade paths — same tileset contract)

2. **OSM2World** (richer S3DB roofs + textures). Java 21 ✓ + `osm2world.org/download/...` reachable ✓.
   `java -jar OSM2World.jar --input dnipro.osm --output dnipro.glb` (local z=0 frame → keep
   `reseatToTerrain`), then wrap the glb with `lib/gltf.mjs` (verify the up-axis; OSM2World is Y-up).
3. **Heavy LOD2** (Overture/MS-ML footprints → height inference → 3dfier/City4CFD straight-skeleton LOD2
   roofs → CityJSON (`val3dity`) → `py3dtiles`/`pg2b3dm` Draco+batch-ids). Python 3.10 + PyPI reachable ✓,
   but needs Docker (PostGIS/GDAL) — **the Docker daemon was NOT running when this pipeline was built**, so
   this tier is a recipe, not yet run here. Dockerize the geo toolchain; this is the true "fill the height
   gap in the periphery" path.
4. **Canopy-height rasters for trees** (ETH 10 m / Meta-WRI 1 m, both CC-BY): real per-tree heights + tree
   placement OUTSIDE mapped OSM polygons (street trees the map misses). Needs a GeoTIFF/COG reader —
   a dependency this pure-Node pipeline deliberately avoids (public npm was blocked when built). Recipe:
   sample the raster at each candidate cell, keep cells > ~3 m canopy, height = raster value; keep the
   same `packTreeInstances` output contract and nothing downstream changes.

## Hosting (R2 — production)

```bash
# one-time per bucket (Cloudflare dash): create bucket → connect a CUSTOM DOMAIN (r2.dev serves NO
# CORS) → add the CORS policy from DNIPRO_SLICE0_SPIKE.md §Recipe (GET/HEAD, range/if-match headers,
# expose content-range/accept-ranges/etag; purge cache after editing CORS).
export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…   # never committed
node scripts/bake/upload-r2.mjs --city dnipro          # pure-Node SigV4 PUTs (no SDK/wrangler)
#   --dry-run   list what would upload
# then: PUBLIC_ENRICHED_TILES_URL=https://<custom-domain>/enriched/dnipro/tileset.json
```

Free tier (10 GB, zero egress) covers a single-city tileset (~33 MB full-city Dnipro). The signer
(`lib/s3sign.mjs`) is unit-gated in `test/bake/s3sign.test.ts`.
