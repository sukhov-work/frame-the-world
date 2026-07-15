# WIP 2026-07-14 — OSM2World "Slice 1.5" 1-cell de-risk spike (DONE, browser-VERIFIED)

`/frame` + investigate-design-v3 (implement, Deep, heavy verify). Executed `dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP.md §8`;
verdict recorded as `§9` there. **VERDICT: VIABLE — green-light the full adapter.** No tracked source touched
→ gates unchanged **astro check 0/0 · vitest 513**. Browser shots `verify-shots/o2w-slice15-01..03`.
Scratch (git-ignored): `scripts/bake/spike-osm2world/` — jar in `dist/`, artifacts in `work/`, scripts
`readGlb.mjs` (the reusable inverse of encodeGlb), `01-extract-and-filter.mjs`, `02-inspect-glb.mjs`,
`03-adapter.mjs`, `work/stylized.properties`. **`readGlb.mjs` + `03-adapter.mjs` = the proven seed of the
production adapter.**

## VERDICT — the 4 DoD questions (all answered)
1. **Axis + N/S handedness — CERTAIN (was ~75%).** OSM2World POSITION = **(east, up, −north)** == our
   `gv(e,u,−n)`. Proof: adapter re-bin with north=−Z lands **1362/1362 (100%)** buildings inside our bbox;
   north=+Z lands **0**. `+Y` up (Y∈[−1,70] m). Browser: river/bridge/street-grid geographically correct — not mirrored.
2. **Ground seating — Y≈0** (min −1.0 m) matches the h=0 bake contract + runtime clamp-to-CWT (R1). Browser
   @646 m & @276 m: building bases flush on the street grid, no float/sink.
3. **Per-building identity — FULLY RECOVERABLE FREE.** `keepOsmElements=true` → one NAMED node per element,
   each with `extras.osmId` (`"Building w294038853"`, `extras:{osmId:"w294038853"}`). Adapter filters
   `Building*` nodes → contiguous `_feature_id_0` per building. No connected-component labeling.
4. **MB/cell — risk NEUTRALIZED.** Buildings-only re-bin **2.91 MB / 21 cells**; densest cell (4,5)
   **1.219 MB** raw vs current baker's same cell **0.855 MB** (~1.4×) → **weld+draco 52 KB (23×)**. The raw
   25.66 MB glb was **89% ROADS** (RoadModule on + Overpass `>;` extent-recursion to a 200 km bbox).

## Facts that CORRECT the prep doc (now in dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP.md §9)
- **Distro is `0.5.0-SNAPSHOT`, NOT 0.4.0** → modern subcommand CLI (prep doc's `--input/--output` is WRONG):
  `java --add-exports java.base/java.lang=ALL-UNNAMED --add-exports java.desktop/sun.awt=ALL-UNNAMED
  --add-exports java.desktop/sun.java2d=ALL-UNNAMED -Xmx4g -jar OSM2World.jar convert -i safe.osm -o out.glb
  --config stylized.properties --lod 2` (the `--add-exports` are MANDATORY on Java 21).
- **`stylized.properties` that yields 0 textures** (color rides `COLOR_0`, dropped): NO `include
  standard.properties`; `createTerrain=false renderUnderground=false useBillboards=false
  useBuildingColors=false keepOsmElements=true`; srtmDir unset → ground Y=0; `excludeWorldModule =
  TreeModule; IndoorModule; AerowayModule` — **but that's not enough**: RoadModule/RailwayModule/
  SurfaceAreaModule are on by default and dominate bytes+extent → also exclude them OR (what the adapter does)
  filter by node class.
- Output: **non-indexed TRIANGLES, POSITION+NORMAL+COLOR_0**; one flat scene (node[0]="OSM2World scene" →
  children, **no per-node matrix/TRS**). `scene.extras.origin` = data-bounds centre (here 48.5178977/34.9481931,
  NOT our bbox centre — `>;` inflates it). Adapter re-bases by the constant ENU offset
  `projectEN(osmOrigin, ourBasis)` = E −7521 / N +6443 m; normals pass through unchanged (same frame convention).
- Classes present (owner's "other constructions"): Building 1362 · Road 1543 (+junctions) · PoleFence 71 ·
  Wall 23 · RetainingWall 4 · ChainLinkFence 3 · MobilePhoneMast 1 · StreetLamp 26 · BollardRow 7 ·
  AreaFountain 3 · SurfaceArea 63 · Waterway 43. Fault-tolerant: 26 buildings skipped (self-intersecting /
  min_level>levels), logged non-fatal.
- **Enriched tileset is a visual DROP-IN:** `buildingMaterial.ts` swap works, `__globe.enriched` streamed 9
  cells, NO shader-link/tile errors (only console errors = benign anonymous-member 403 + blocked Wix telemetry).
- **Draco decode caveat:** the enriched path ships UNCOMPRESSED today → to bank the 23× win, wire a
  `DRACOLoader` into the enriched `GLTFExtensionsPlugin` (mirror the OSM path), else ship uncompressed (~1.4×).

## Adapter shape (proven in 03-adapter.mjs — reuses gltf.mjs+geo.mjs+vegetation.mjs unchanged)
readGlb → filter `Building*` nodes → per-vertex re-base `e=X+offE, n=(−Z)+offN, u=Y` (normals pass through) →
bin by centroid lon/lat into our 10×10 grid (bake.mjs idiom) → `_feature_id_0` per building → REUSE
`encodeGlb`+`buildTileset`. Handedness resolved empirically (count buildings inside bbox per sign).

## NEXT (the full adapter — Slice 1.5 → production)
`scripts/bake/bake-osm2world.mjs` mirroring `bake.mjs` (CLI + output); promote `readGlb.mjs`→`lib/readGlb.mjs`
(tracked); production extract = Geofabrik PBF + `osmium extract --bbox` + `osmium tags-filter --invert-match
--omit-referenced` (reference-safe C6); node-class filter (keep Building* + chosen constructions, drop
Road*/Surface*); inject our trees (vegetation.mjs, unchanged); draco-decode-wiring vs ship-uncompressed;
re-bake → `upload-r2.mjs --city dnipro` (LIVE) → A/B on a sub-M3 box.

## Exit — records DONE
`dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP.md §9` (verdict) + top pointer · DECISIONS "2026-07-14 (LATEST — Slice 1.5)" ·
mem:core Next step · this memory · NEXT_SESSION_PROMPT. `.env.local` restored to the R2 URL · wix dev stopped ·
screenshots in `verify-shots/`. Related: `mem:project/wip-2026-07-14-r2-hosting-osm2world-prep` (the prep).
