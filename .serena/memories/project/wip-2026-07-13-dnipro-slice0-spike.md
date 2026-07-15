# Dnipro 3D Enrichment — Slice 0 de-risk spike (2026-07-13, implement/Deep)

**The analysis + integration half of Slice 0 is DONE + locally gated; the data-bake + R2 + browser-confirm
half is reduced to a one-command recipe + a flag flip.** Full verdict: `.claude/claude-docs/dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md`.
Gates: **astro check 0 · vitest 422 (+6 enrichedMask) · wix build Complete.** Runtime = BROWSER-UNVERIFIED
(no browser this session — all code is DEFAULT-OFF behind `PUBLIC_ENRICHED_TILES_URL`).

## The three hard unknowns — all RESOLVED
- **R1 vertical-datum seating (the #1 risk): runtime clamp-to-CWT.** CWT renders WGS84-**ellipsoidal**
  heights; GLO-30 = EGM2008 orthometric; **EGM2008 undulation over Dnipro = +20.42 m** (geoid above
  ellipsoid) → naive absolute-Z bake sinks ~20 m (+ ~2–6 m inter-DEM residual). Fix = DON'T bake absolute
  Z; bake relative geometry and lift the tileset to the rendered CWT at runtime (matches how Cesium OSM
  Buildings seat). Impl: `enrichedBuildings.ts` samples `terrainHeightAt(bboxCentre)` (= `ground.heightAt`,
  the ellipsoidal CWT raycast) and translates `tiles.group.position` along the centre geodetic up. Knobs:
  `ENRICHED.seatOffsetM` (browser nudge), `ENRICHED.reseatToTerrain` (false = trust ellipsoidal bake).
- **Masking OSM in-bbox: stop-traversal `calculateTileViewError` plugin** (3d-tiles-renderer **0.4.28**).
  Return truthy + `target.inView=false` → tile not marked-used/queued/traversed (no download, LRU-evicts).
  Test each tile's bounding-sphere CENTRE lat/lon (`tile.engineData.boundingVolume.getSphere` +
  `tiles.ellipsoid.getPositionToCartographic`, radians, group-local frame → offset-independent). Impl:
  `buildings.ts` `FTW_DNIPRO_OSM_MASK`, registered only when `maskBbox` passed. **KNOWN LIMIT (Slice 2):**
  coarse-ANCESTOR leakage at low zoom → pixel-exact hole needs THREE `clippingPlanes`. Leaf-centre test is
  clean at street level.
- **3rd TilesRenderer + streaming: plain `new TilesRenderer(url)` + `GLTFExtensionsPlugin{dracoLoader,
  meshoptDecoder}`** (no ion). setCamera/setResolutionFromRenderer/update loop; LRU + errorTarget tiering;
  seat via `group.position` (sanctioned). Impl: `enrichedBuildings.ts`.

## Toolchain verdict
- **OSM2World** = light/sample path: only light tool that emits **roof shapes** (S3DB) + **glb** direct,
  local z=0 frame (dovetails runtime clamp). **3dfier = LoD1 FLAT only** — NOT for roofs. Neither emits
  browser-ready 3D Tiles → need `glb→3D-Tiles` (`3d-tiles-tools`/`py3dtiles`).
- **R2:** `r2.dev` returns NO CORS → **Custom Domain required**. Free tier fine. Local proof sidesteps R2
  (serve sample from `public/`, same-origin).

## Files (all DEFAULT-OFF)
- `src/lib/globe/enrichedMask.ts` (pure: `GeoBbox`, `bboxToRadians/CenterDeg/ContainsRad/ContainsDeg`) + test.
- `src/components/globe/scene/enrichedBuildings.ts` — 3rd renderer + R1 re-seat.
- `scene/buildings.ts` — `maskBbox?` opt → mask plugin (import from `lib/globe/enrichedMask`).
- `tuning.ts` — `ENRICHED` group (bbox {35.038,48.457,35.053,48.467}, reseatToTerrain, seatOffsetM 0,
  errorTarget 16, edgeAngleDeg, edgeOpacity, debugDistinctEdges TRUE for the spike A/B).
- `StylizedTiles.ts` — reads `import.meta.env.PUBLIC_ENRICHED_TILES_URL`; if set: `maskBbox=ENRICHED.bbox`
  → `attachBuildings`, `attachEnrichedBuildings`, `stepEnrichedUpdate` (after stepBuildingsUpdate),
  quality fan-out, dispose, `__globe.enriched`. Absent → all null = byte-identical.
- `scripts/build-sample-dnipro-tiles.mjs` — pure-Node hand-bake: 12 central-Dnipro blocks (a few gable
  roofs) → `public/enriched-sample/dnipro/{tileset.json,buildings.glb}` (git-ignored, regen offline).
  Baked at ellipsoid **h=0** so the runtime re-seat is the ground-truth R1 test. glTF **Y-up** (local ENU
  (e,n,u)→gltf (e,u,-n) per the standard y-up→z-up); region bounding volume (geographic, seat-independent).

## Next session (browser tier — verification_blocked)
1. `node scripts/build-sample-dnipro-tiles.mjs` → `PUBLIC_ENRICHED_TILES_URL=/enriched-sample/dnipro/tileset.json`
   → `wix dev` → fly to Dnipro → confirm: accent-edged enriched buildings appear · OSM masked in bbox ·
   seating correct (tune seatOffsetM) · streaming. **Confirm the up-axis** (buildings upright, not on their
   side — the one thing synthetic data can't prove; fix = the known 90°).
2. Slice 1: OSM2World real bake (check Dnipro `roof:shape` density first) → glb→3D-Tiles; then heavy path.
3. R2 custom domain + CORS.

Related: [[project/wip-2026-07-13-dnipro-enrichment-research]] [[patterns/globe-rendering]]
[[patterns/sky-bodies-terrain]] [[patterns/photo-frustum]]
