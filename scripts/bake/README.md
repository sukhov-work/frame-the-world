# `bake` — Dnipro 3D Enrichment buildings + trees pipeline (Slices 1–3)

Reproducible **offline** bake of roof-shaped enriched buildings **+ instanced trees** for one city →
self-hostable **3D Tiles**, streamed by `scene/enrichedBuildings.ts` and masked over the global Cesium
OSM Buildings inside the city bbox. Part of `.claude/claude-docs/dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md`
(Slices 1–3). **All inputs are public OSM (ODbL).**

```bash
npm run bake -- --city dnipro          # or: node scripts/bake/bake.mjs --city dnipro
#   --refresh   re-query Overpass (otherwise the on-disk cache is reused)
#   --out DIR   override the config's output dir
```

## What it does (the LIGHT Node path — fidelity tier 1 of 3)

```
Overpass footprints+tags  →  C6 exclusion  →  height inference  →  roof-shaped extrusion  →
spatial-grid 3D Tiles 1.1 (per-cell glb, shared ENU frame)  →  bakes/enriched/<city>/
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

## Wire it into the app — dev streams LOCAL, build/release stream R2

```bash
# .env.local (production source — what wix build/release bake in):
PUBLIC_ENRICHED_TILES_URL=https://<worker>.workers.dev/enriched/dnipro/tileset.json
# .env.development.local (dev override — wix dev NEVER hits R2):
PUBLIC_ENRICHED_TILES_URL=/enriched/dnipro/tileset.json
# src/components/globe/tuning.ts — ENRICHED.bbox MUST equal the config bbox (mask extent == enriched extent)
```

The bakes live OUTSIDE `public/` (`bakes/enriched/<city>/`, git-ignored) so a build bundle never
ships hundreds of MB of derived tiles; in dev a `serve`-only Vite middleware (`astro.config.mjs`
`ftwLocalTiles`) serves them same-origin at `/enriched/*`. Restart `wix dev` after env changes.
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

## OSM2World variant bake (fidelity tier 2 — IMPLEMENTED 2026-07-14, parallel to the default)

`bake-osm2world.mjs` bakes the SAME city into a SIBLING output (`bakes/enriched/<city>-o2w/`) with
OSM2World-reconstructed geometry: every Simple-3D-Buildings roof shape OSM tags (vs the extruder's
flat/gable/pyramid approximations) plus real constructions — walls, fences, masts, street lamps,
bollards, fountains, pylons. **The default pipeline is untouched**: `bake.mjs`, `cities/dnipro.json`
and `bakes/enriched/dnipro` are never modified; the variant has its own config
(`cities/dnipro-o2w.json`, `extends: dnipro` so bbox/grid/trees stay identical) and its own R2 prefix.

```bash
node scripts/bake/bake-osm2world.mjs --city dnipro-o2w   # --refresh re-extract · --reconvert force Java re-runs
node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro-o2w   # → enriched/dnipro-o2w/ (Worker unchanged)
```

Pipeline: tiled Overpass XML (cached `.cache/o2w-*.osm`) → reference-safe C6 filter (`lib/osmXml.mjs` —
excluded ways/relations removed whole, excluded tagged nodes keep geometry but lose tags) → OSM2World
`convert` per sub-box (0.5.0-SNAPSHOT CLI, heavy modules excluded, ground Y=0, `keepOsmElements`) →
re-bin node classes into OUR grid (`lib/readGlb.mjs`; dedupe across sub-boxes; per-feature contiguous
`_FEATURE_ID_0`; empirical N/S handedness vote; C6 polygon gate) → our instanced trees
(`lib/vegetation.mjs`, same cache+seed → byte-identical to the default bake) → the REUSED
`encodeGlb`/`buildTileset`. Requires the OSM2World distro jar (git-ignored; see
`cities/dnipro-o2w.json` osm2world.jarNote) + Java 17+.

**Visual A/B (the point):** the camera pose lives in the URL hash, so the same link with a different
`?enriched=` value compares bakes at the identical pose (`src/lib/globe/enrichedVariant.ts`):
- *(no param)* → the default bake (`PUBLIC_ENRICHED_TILES_URL`, byte-identical behaviour)
- `?enriched=dnipro-o2w` → the OSM2World variant (falls back to same-origin `/enriched/dnipro-o2w/…` before upload)
- `?enriched=off` → stock Cesium OSM buildings (mask off)

Ships UNCOMPRESSED (spike-measured ≈1.4× the extruder bake); `gltf-transform weld+draco` gave 23× in
the spike but needs a DRACOLoader wired into the enriched runtime — a deliberate non-change for now.

### Onboarding another city (generic flow — worked example: St Albans, UK, LIVE on R2 2026-07-18)

Any number of cities coexist: each is a config + an output prefix, selected at runtime by
`?enriched=<name>`. The existing cities' bakes, work caches and the default runtime path stay
untouched throughout. For city `<name>` (St Albans shipped exactly this way):

1. **Configs.** `cities/<name>.json` — bbox `[west,south,east,north]` sized to the built-up area,
   `grid` ≈ 1 cell / km (the proven streaming granularity), `vegetation` (omit for no trees),
   `exclusion.polygons` (only for geo-sensitive regions — the built-in sensitive-tag blocklist
   always applies), `output: bakes/enriched/<name>`. For the OSM2World tier add
   `cities/<name>-o2w.json` (`extends: <name>` + the `osm2world` block — copy it from
   `st-albans-o2w.json`; `subGrid` so each extract stays ≲5×5 km). Worked example:
   `st-albans.json` (~6×6 km on 51.75153/−0.32567, grid 6) + `st-albans-o2w.json` (subGrid 2).
2. **Mask bbox (runtime, one entry).** A cross-city bake sits outside the default city's box, so
   list it in `ENRICHED.variantBboxes` (`src/components/globe/tuning.ts`, value = the config bbox
   verbatim); `resolveEnrichedBbox` (`src/lib/globe/enrichedVariant.ts`) routes the OSM-buildings
   mask and the re-seat extent to it at boot. Unlisted variants (dnipro-o2w — same box as the
   default) and the no-param default keep `ENRICHED.bbox` — the default path stays byte-identical.
   NOTE: this entry ships with the next `wix release`; until then production streams the new tiles
   but masks the OLD box (stock OSM z-fights the new city there).
3. **Bake.** `npm run bake -- --city <name>` (extruder tier) and/or
   `node scripts/bake/bake-osm2world.mjs --city <name>-o2w` → `bakes/enriched/<…>/`.
   Work caches are per-city (`.cache/o2w/<city>/`): the safe.osm/glb/log names are sub-grid-indexed,
   so a shared dir would let city #2 silently poison city #1's convert cache — never flatten it back.
   St Albans measured: 26,102 features / 21,814 trees / 36 cells / 49.5 MB / ~4 min cold.
4. **View (dev).** `http://localhost:4321/?enriched=<name>-o2w` — the dev middleware serves
   `bakes/enriched/*` same-origin, no R2 involved; fly to the city and share any view via the `#p=`
   pose hash. The plain URL keeps streaming the default city. (The BLD chip is a Dnipro-only
   default↔o2w toggle — `ENRICHED_VARIANT_NAME` in enrichedVariant.ts; other cities are URL-param
   only until a city picker exists.)
5. **Publish.** `node --env-file=.env.local scripts/bake/upload-r2.mjs --city <name>-o2w`
   → `enriched/<name>-o2w/` (the Worker is path-agnostic; zero changes). Verify:
   `curl -I <worker>/enriched/<name>-o2w/tileset.json` → 200 + `access-control-allow-origin: *`.
   Production then serves `?enriched=<name>-o2w` on the SAME env URL (the resolver swaps the path
   segment). To make a city the DEFAULT instead, point `PUBLIC_ENRICHED_TILES_URL` at it.

## Higher-fidelity tiers (upgrade paths — same tileset contract)

2. **OSM2World** — ✅ implemented above (`bake-osm2world.mjs`). Remaining upgrades inside the tier:
   draco decode wiring (23×), textured "realism" materials (off-by-default pattern), Geofabrik
   PBF + `osmium tags-filter` extraction for byte-reproducible production bakes.
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

## Hosting (R2 + Worker — production, LIVE 2026-07-14)

The tiles stream from a **private** Cloudflare R2 bucket fronted by a **Worker** gateway
(`r2-worker.mjs`). We use a Worker, not an R2 custom domain, because `r2.dev` public URLs serve **no
CORS** and the owner has no domain to bind — a Worker over a private bucket gives full CORS + Range
control on the free tier while keeping the bucket private. Three one-command stages, all reading
`.env.local` (the owner's `CLOUDFLARE_*` names are accepted; `R2_*` also work):

```bash
# 1 · upload the baked tileset (pure-Node SigV4 PUTs — no SDK/wrangler)
node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro    # --dry-run to preview
#    → s3://<bucket>/enriched/dnipro/*   (prefix = enriched/<city>, override with R2_PREFIX)

# 2 · deploy the Worker gateway (CORS + Range; PRESERVES the R2_BUCKET binding)
node --env-file=.env.local scripts/bake/deploy-worker.mjs             # --dry-run to preview

# 3 · point the client at the Worker (.env.local; restart wix dev — Vite reads env at start)
PUBLIC_ENRICHED_TILES_URL=https://<worker>.workers.dev/enriched/dnipro/tileset.json
```

Env (never committed): upload needs the S3 keys `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ACCESSKEY_ID` /
`CLOUDFLARE_SECRET_ACCESSKEY` / `CLOUDFLARE_R2_BUCKET`; deploy needs the Workers-Edit `CLOUDFLARE_API_TOKEN`
+ `CLOUDFLARE_ACCOUNT_ID`. Verify: `curl -H 'Origin: http://localhost:4321' -I <worker>/enriched/dnipro/tileset.json`
must carry `access-control-allow-origin: *`; the Worker root `/` returns
`{"service":"frame-the-world-tiles","ok":true}` (a pre-release canary).

**Free tier — comfortably safe.** R2: 10 GB storage (Dnipro full-city ≈ 33 MB), egress is **always free**,
Class A/writes 1M-mo (96 PUTs per upload), Class B/reads 10M-mo. Workers: 100k requests/day — one globe
view streams ≤ ~96 files, so ≈ 1,000 views/day before the cap, and browser `Cache-Control` (glb
`immutable`, tileset.json 5 min) collapses repeat requests. No paid resource is touched.

**Onboarding city #2 / expanding Dnipro (extensible by design).** The full recipe is §Onboarding
another city above (config → `ENRICHED.variantBboxes` entry → bake → upload). Storage-side it is
just `upload-r2.mjs --city <name>` → `enriched/<name>/…`, which the Worker **already serves with
zero changes** (it's path-agnostic). Widening the Dnipro bbox is just a re-bake + re-upload under
the same prefix. Re-bakes reuse
filenames → purge the Cloudflare cache (or version the prefix) when a glb changes; tileset.json is only
cached 5 min. Switching to a custom domain later is a pure client-URL swap. The SigV4 signer
(`lib/s3sign.mjs`) is unit-gated in `test/bake/s3sign.test.ts`.

## Terrain patches (GLO-30 quantized-mesh — SHIPPED 2026-08-18, design ruling in DECISIONS 2026-08-18p)

A parallel bake family: `scripts/bake/terrain/` turns free Copernicus GLO-30 (30 m DSM,
commercial-OK with attribution) into a Cesium quantized-mesh pyramid the runtime composites
over Cesium World Terrain INSIDE the bake extent — ~50× effective-resolution uplift over the
km-class CWT the UA region gets (the U7 audit, UPLIFT_PLAN Appendix A).

```bash
npm run bake:terrain -- --city dnipro          # fetch COGs → mago-3d-terrainer → rim blend → verify
node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro --terrain   # → terrain/<city>/
```

Config = the `terrain` block in `cities/<city>.json` (extentBbox / extentMaxDepth / cityBbox /
maxDepth / blendKm / attribution). Pipeline facts that cost real time (full log:
`mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule`):
- **Never rewrite the DEM rasters in Node** — geotiff.js's writer emits geo-tags the Java
  terrainer ignores (the mosaic landed at −180/90). Feed the ORIGINAL COGs; custom height work
  happens POST-BAKE on the `.terrain` tiles (`blend.mjs` splices only the h-stream + header
  min/max — `qmesh.mjs spliceHeights`).
- Heights become **ellipsoidal** via mago's built-in `--geoid EGM2008` (same datum as CWT ⇒
  the runtime seat machinery needs zero datum handling); `geoid.mjs` is the verification twin.
- The **rim blend** (3 km, w=smoothstep toward the DECODED CWT surface) is the spatial seam:
  served tiles meet their CWT neighbours with no height step at every level.
- mago **silently clamps** `-max` to its resolution heuristic (30 m → L13 ≈ native posting).
- The runtime serve-set rule lives twice — `src/lib/geo/terrainTiles.ts` ⇄
  `terrain/tiling.mjs` — pinned by `test/lib/geo/terrainTiles.test.ts`; the bake ASSERTS its
  layer.json availability contains the rule's output, so mismatches die at bake time.
- Runtime: `src/components/globe/scene/terrainPatch.ts` (createChild wrap + fetchData claimer
  on the ONE ground renderer) + the `lib/globe/regions.ts` registry + `PUBLIC_TERRAIN_TILES_URL`
  (Worker `/terrain` base; dev serves `bakes/terrain/` at `/terrain`). No user control (owner
  ruling); C6: 30 m native only.
