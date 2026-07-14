# WIP 2026-07-13 — Dnipro 3D Enrichment: Slice-0 browser-verify + Slice-1 REAL bake (DONE)

**Mode:** implement (Deep), `/frame` + investigate-design-v3. **Gates: astro check 0/0 · vitest 442 (+19 bake)
· wix build Complete. Both the Slice-0 gate AND the real Slice-1 bake are BROWSER-VERIFIED in `wix dev`
(Playwright MCP).** Shots: `verify-shots/slice0-01..06` (sample) + `slice1-01..03` (real bake).

## Slice-0 gate — PASSED (unblocks the enrichment)
Flew to the sample bbox; via `window.__globe` seams + a mask audit that REPLICATED the plugin's own
`bv.getSphere→ellipsoid.getPositionToCartographic→bboxContainsRad`:
- Enriched renders UPRIGHT (up-axis correct — the one thing synthetic data couldn't prove), gable+flat roofs.
- **R1 clamp-to-CWT seating correct:** `enriched.group.position.length()` 100.2 m ≈ `terrainHeightAt` 99.6 m;
  bases on the street, no float/sink. `ENRICHED.seatOffsetM` stays 0.
- **Mask clean at leaf level: 0 OSM tiles centered in bbox** at 1.2 km AND 520 m; OSM-only A/B shot (shot 06)
  shows the building-free hole. Shadows cast.
- **KNOWN-LIMIT CONFIRMED real+minor:** ~8 coarse OSM tiles (r 676 m–1.48 km) STRADDLE the bbox edge → a thin
  rim leaks in → **Slice-2 clipping-plane hole is genuinely needed** (not just nice-to-have).
- Traps learned: layer A/B is safe (`renderer.info.render.frame` advanced while a group hidden → screenshot
  fresh, not the stale-frame trap). Tilt convention is INVERTED: LOW tilt = top-down, ~86° = horizon.

## Density frame-challenge (Overpass, central Dnipro 6698 bldgs)
`building:levels` 45.2% · any-height 47.5% · `roof:shape` 9.5% · `roof:levels` 4.2%. The plan's "<10% height"
is the CITY-WIDE avg (periphery-dragged); central Dnipro is ~47% tagged → the LIGHT path gives a good result.

## Env capability (probed)
Java 21 ✓ · Python 3.10+PyPI reachable ✓ · OSM2World zip reachable ✓ · disk 103 GB ✓. **Docker daemon NOT
running** → heavy 3dfier/PostGIS path = code+recipe only. **Public npm BLOCKED** (registry=npm.dev.wixpress.com;
registry.npmjs.org→000) → `3d-tiles-tools` glb→3D-Tiles unavailable.

## Slice 1 — a NEW reproducible Node DATA-DRIVEN baker (owner-picked; runs+verifies HERE)
Owner picked this over OSM2World / heavy-Docker because it reuses the browser-VERIFIED glb+tileset writer and
runs end-to-end in this env. `npm run bake -- --city dnipro` (`--refresh` re-queries; `--out` overrides).
- **Files:** `scripts/bake/bake.mjs` (CLI/orchestrator) · `lib/geo.mjs` (WGS84 + local-ENU projection +
  ENU→ECEF matrix) · `lib/gltf.mjs` (GLB encoder w/ `_FEATURE_ID_0` + tileset writer) · `lib/exclusion.mjs`
  (C6 tag blocklist + polygon PIP) · `lib/buildings.mjs` (height inference + roof extrusion + ear-clip
  triangulation + PCA OBB — pure, the geometry engine) · `lib/overpass.mjs` (fetch w/ cache + mirror backoff)
  · `cities/dnipro.json` (per-city config) · `README.md` (recipe + upgrade tiers). Tests: `test/bake/bake.test.ts` (+19).
- **Pipeline:** Overpass footprints+tags (cached, `out geom`) → **C6 exclusion BEFORE tiling** (built-in
  military/critical-infra tag blocklist + per-city polygons; counts reported, no silent drops) → **height
  inference** (`height`→`building:levels×3m`→per-class default→generic 8m; base from `min_height`; roof from
  `roof:height`/`roof:levels` or span×pitch) → **roof-shaped extrusion** (flat=ear-clipped cap · gabled=OBB
  ridge over a watertight cap · hipped/pyramidal/dome=centroid pyramid; outward normals) → **spatial-grid
  3D-Tiles 1.1** (per-cell glb, ONE shared ENU→ECEF root transform so the R1 re-seat lifts every cell at once;
  child region bounding volumes from ACTUAL building extents → cull/stream; `_FEATURE_ID_0` per building).
- **REAL bake BROWSER-VERIFIED:** 3304 footprints → C6 excluded 21 (13 substations/1 plant/7 transformers) →
  54% real heights (1667 levels+126 height / 194 class / 1246 default) → **3233 buildings · 16 tiles · 171,957
  verts · 4.83 MB · maxH 129 m** → rendered upright+seated (`group.position.length` 101.3 ≈ terrain 101.3) +
  masked + streaming, 0 tile/shader errors. Meshes carry `_feature_id_0` (Slice-2 ready). Runtime edge recolor
  to 0x687d73 (OSM `landHi` sage) → reads as a seamless extension of the OSM style.
- **Wiring:** `ENRICHED.bbox` expanded to {35.03,48.452,35.06,48.472} to MATCH the bake extent (mask==enriched;
  byte-identical when the layer is OFF — StylizedTiles only uses ENRICHED.bbox when `PUBLIC_ENRICHED_TILES_URL`
  is set) · `.env.local` URL → `/enriched/dnipro/tileset.json` · `package.json` `bake` script · `.gitignore`
  `/public/enriched/` + `/scripts/bake/.cache/` · `ENRICHED.debugDistinctEdges` STILL true (verification A/B;
  Slice 2 flips it false when reconciling stylization).

## Known limits → Slice 2/3 (ranked)
1. **Single-point re-seat over a 2 km bbox** — one terrain-height lift (bbox centre); buildings near the river
   (lower terrain) can float/sink a few m. FIX = per-cell re-seat (cells are already separate tiles → lift each
   by its own centre's `terrainHeightAt`). Cheap, high-value.
2. **Boundary OSM leak** — straddle tiles → clipping-plane hole on the shared material (the ECEF prism).
3. **Single-LOD grid** — cells cull+stream but one detail level; add HLOD past the central core.
4. **Roof OBB overhang** on non-rectangular gabled plans; mansard/sawtooth/skillion → flat. Upgrade tiers
   (richer roofs): OSM2World (S3DB+textures, Java✓) then heavy 3dfier LOD2 (Docker) — recipe in the README.

## Owner feedback batch (2026-07-13, browser-VERIFIED; astro check 0 · vitest 442)
Owner saw only the central 2.2 km enriched + asked for 4 FPV UX items. All browser-VERIFIED (shots
`verify-shots/slice1-04..06`):
- **Bake EXPANDED** to ~5.9×6.3 km ({35.005,48.435,35.085,48.492}, grid 7×7) → 46 tiles · 731k verts ·
  20.5 MB · maxH 167 m; covers both Dnipro banks + across the bridge. `ENRICHED.bbox` synced to match.
- **FPV max focal = 500 mm** (`FPV.minFovDeg` 8→2.75; focalFromVerticalFov(2.75)=500). Verified camFov
  clamps 2.75° / HUD reads 500 mm.
- **FPV arrow-key WALK** (`FPV.walkSpeedMps` 22): held arrow integrates a ground-plane displacement along the
  horizontal look dir (◀▶ strafe) in `stepFpvPose`; `onFpvKey`/new `onFpvKeyUp` track pressed arrows; reset on
  entry. Verified ArrowUp moved the camera ~22 m/s. HUD hint "◀▲▼▶ WALK · DRAG LOOK · WHEEL ZOOM".
- **FPV BUILDINGS slider** (0=see-through wireframe, 100=solid shaded): `camera.fpvBuildingSolidity` → OSM
  `setGhostSolid(max(auto,s))` + enriched NEW `setSolidity(s)` (fill opacity 0.28→1 + edge 0.5→0.14). Verified
  0=wireframe / 100=solid. Files: `store/camera.ts`, `StylizedTiles.ts` (walk + solidity), `scene/enrichedBuildings.ts`
  (setSolidity), `panels/CameraTiltPanel.tsx` (Slider), `panels/FpvHud.tsx`+`styles/fpv-hud.css` (hint), `tuning.ts`.

## DEFERRED → ✅ DONE 2026-07-13 (browser-VERIFIED): TERRAIN ELEVATION / per-cell re-seat — see `mem:project/wip-2026-07-13-terrain-reseat`. Original notes:
Owner: "all buildings basically at water level — incorporate height/elevation into the terrain mesh (rough)
for precise sun/moon shot planning." ROOT: the enriched tileset is lifted by ONE terrain height (bbox centre)
→ a flat plane; over the 5.9 km bbox the riverbank drop isn't followed. FIX (needs browser): PER-CELL re-seat
— each grid cell is a separate tile → lift each by its OWN centre's `terrainHeightAt`. Frame-of-ref needs a
browser test: the tiles share ONE ENU root transform, so a cell's local +Z offset SHOULD map to geodetic up —
verify empirically, revert to single-lift if wrong. Also confirm CWT itself renders elevation (QuantizedMeshPlugin
— it should; if the ground is flat too, that's the deeper mesh-elevation task). This is the real "not flat" fix +
pairs with the full-city bbox. NOTE: `FPV.walkSpeedMps` 22 is brisk — tune if owner wants a slower walk.

## Next
Slice 2 (per-cell re-seat + clipping-plane hole + stylization reconcile via `_feature_id_0` + R2 custom-domain
host + full-city bbox) · then Slice 3 trees · Slice 5 feed Pass-3 occlusion. ODbL: footer credits OSM; make
"ODbL" explicit when the layer ships. wix dev is RUNNING. Regen: `npm run bake -- --city dnipro`.

Related: [[project/wip-2026-07-13-dnipro-slice0-spike]] [[project/wip-2026-07-13-dnipro-enrichment-research]]
[[patterns/globe-rendering]] [[patterns/sky-bodies-terrain]]
