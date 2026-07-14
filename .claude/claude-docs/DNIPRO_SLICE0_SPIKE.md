# Dnipro 3D Enrichment — Slice 0 De-Risk Spike (verdict + receipt)

**Date:** 2026-07-13 · **Mode:** implement (Deep) · **Plan:** `DNIPRO_3D_ENRICHMENT_PLAN.md` §Slice 0.
This closes the *analysis + integration* half of Slice 0. The *data-bake + R2 + browser-confirm* half is
reduced to a one-command recipe + a flag flip (see §Verification-blocked). Nothing here supersedes a
locked ADR.

---

## Verdict (what the spike proved)

1. **R1 — vertical-datum seating: RESOLVED. Strategy = clamp to CWT at RUNTIME (don't bake absolute Z).**
   Cesium World Terrain renders **WGS84-ellipsoidal** heights [DOCS cesium-dev groups thread; matches our
   own `ground.heightAt` returning `WGS84_ELLIPSOID.getPositionElevation` — `imageryGround.ts:358`]. Open
   DEMs are geoid-orthometric: **GLO-30 = EGM2008/EPSG:3855**, ALOS = EGM96. The **EGM2008 undulation over
   Dnipro (48.46, 35.05) = +20.42 m** (geoid ABOVE ellipsoid) [DOCS GeographicLib GeoidEval]. So a naive
   orthometric-as-ellipsoidal bake **sinks buildings ~20 m** (plus a ~2–6 m inter-DEM residual vs CWT's
   own source). The verified fix — matching how Cesium OSM Buildings already seat — is to **bake only
   relative geometry (roof−ground) and lift the tileset to the rendered CWT at runtime.** Implemented:
   `enrichedBuildings.ts` samples `terrainHeightAt(bboxCentre)` and translates `tiles.group.position` along
   the centre's geodetic up (one translation seats an ~city-block bbox within cm). `ENRICHED.seatOffsetM`
   is the residual nudge; `ENRICHED.reseatToTerrain=false` switches to trusting a CWT-consistent
   ellipsoidal bake. The sample is baked at ellipsoid **h=0** precisely so this re-seat is the ground-truth
   test of the strategy.

2. **Masking OSM buildings in-bbox: RESOLVED. Mechanism = stop-traversal `calculateTileViewError` plugin.**
   `3d-tiles-renderer@0.4.28` [CODE node_modules/3d-tiles-renderer/package.json]. A plugin returning truthy
   + `target.inView=false` stops a tile being marked-used / queued / traversed → **no download, no draw**,
   and a loaded one LRU-evicts [CODE TilesRendererBase.js:1013-1065; optimizedTraverseFunctions.js:219-223].
   We test each tile's bounding-sphere CENTRE lat/lon (`tile.engineData.boundingVolume.getSphere` +
   `tiles.ellipsoid.getPositionToCartographic`, the `ReorientationPlugin` idiom — radians, group-local
   frame so it's independent of the seat offset) against `ENRICHED.bbox`. Implemented: `buildings.ts`
   `FTW_DNIPRO_OSM_MASK` plugin, registered only when a `maskBbox` is passed.
   **Known limit (→ Slice 2):** a coarse ANCESTOR whose centre is outside the bbox but whose geometry spans
   it can leak OSM across the box at low zoom; a pixel-exact hole needs THREE `clippingPlanes` on the shared
   material. At street level (where the enriched set matters) the leaf-centre test is clean.

3. **3rd `TilesRenderer` at a plain URL + streaming/LOD: RESOLVED.** `new TilesRenderer(url)` (no ion) +
   just `GLTFExtensionsPlugin({dracoLoader, meshoptDecoder})` for DRACO/meshopt content
   [CODE TilesRendererBase.js:417; GLTFExtensionsPlugin.js:42-71]. Standard `setCamera` /
   `setResolutionFromRenderer` / `update()` loop; LRU `maxBytesSize` (0.4 GB default) + `errorTarget` (16)
   tier knobs; `dispose-model`/LRU eviction unload [CODE TilesRendererBase.js:950,1603-1656]. Implemented:
   `enrichedBuildings.ts`, wired into `StylizedTiles.ts` as step `stepEnrichedUpdate` + quality fan-out +
   dispose, entirely behind `PUBLIC_ENRICHED_TILES_URL` (absent → byte-identical to before).

4. **Toolchain for the bake: OSM2World for the light/sample path; a heavier LOD2 pipeline for production.**
   **OSM2World** is the only light-path tool that emits **roof shapes** (Simple-3D-Buildings gabled/hipped)
   and exports **glb** directly, in a local z=0 frame that dovetails with the runtime clamp [DOCS osm2world.org;
   wiki S3DB]. **3dfier is LoD1 (flat) only** [DOCS tudelft3d/3dfier] — do NOT use it if roof shapes are the
   goal; it's for DEM-accurate block heights. **Neither emits browser-ready 3D Tiles** → add a `glb →
   b3dm/3D-Tiles` step (`3d-tiles-tools` or `py3dtiles`). For the synthetic spike sample we skip all of this:
   `scripts/build-sample-dnipro-tiles.mjs` writes a valid glb+tileset in pure Node (no external tools —
   none were installed: no osm2world/3dfier/py3dtiles/pg2b3dm/wrangler here).

5. **R2 hosting: the `r2.dev` managed URL returns NO CORS headers → a Custom Domain is required** [DOCS
   Cloudflare R2 public-buckets]. Free tier (10 GB, zero egress) covers a single-city tileset. CORS recipe in
   §Recipe. For the local integration proof we sidestep R2 entirely by serving the sample from `public/`
   (same-origin, no CORS).

---

## Shipped this session (code-complete, default-OFF, browser-UNVERIFIED)

| File | What |
|---|---|
| `src/lib/globe/enrichedMask.ts` | pure bbox helpers (`GeoBbox`, radian conv, containment, centre) — 6 unit tests |
| `test/lib/globe/enrichedMask.test.ts` | containment/edges/centre/Dnipro-vs-Kyiv |
| `src/components/globe/scene/enrichedBuildings.ts` | 3rd `TilesRenderer` (plain URL, DRACO/meshopt, R1 runtime re-seat, streaming, dispose) |
| `src/components/globe/scene/buildings.ts` | `maskBbox` opt → `FTW_DNIPRO_OSM_MASK` stop-traversal plugin |
| `src/components/globe/tuning.ts` | `ENRICHED` group (bbox, reseatToTerrain, seatOffsetM, errorTarget, edges) |
| `src/components/globe/StylizedTiles.ts` | attach + `stepEnrichedUpdate` + quality fan-out + dispose + `__globe.enriched`, all gated on `PUBLIC_ENRICHED_TILES_URL` |
| `scripts/build-sample-dnipro-tiles.mjs` | pure-Node hand-baked sample (12 blocks, gable roofs) → `public/enriched-sample/dnipro/` (git-ignored, regen offline) |

**Verification receipt (local tier):** `astro check` **0 errors** · vitest **422 passed** (+6) · `wix build`
**Complete**. GLB validated (magic `glTF` v2, self-consistent length, aligned JSON+BIN chunks, 420 verts,
region 35.04°/48.46° rad, heights 0–46 m, ENU→ECEF root transform). Runtime behaviour = **UNVERIFIED**
(no browser this session).

---

## Verification-blocked (the browser + bake + R2 tier — exact next steps)

1. **Browser-verify the integration (local, no R2 needed).** `node scripts/build-sample-dnipro-tiles.mjs`
   → set `PUBLIC_ENRICHED_TILES_URL=/enriched-sample/dnipro/tileset.json` in `.env.local` → `wix dev` → fly
   to Dnipro (`window.__globe`, or search "Dnipro"). Confirm: (a) enriched buildings appear with **accent
   edges** (ENRICHED.debugDistinctEdges); (b) the OSM mass is **gone inside the bbox** (mask works) and
   present just outside it; (c) **seating** — bases sit on the terrain, not floating/sunk (tune
   `ENRICHED.seatOffsetM` if there's residual); (d) tiles **stream/LOD/unload** on zoom. Shots →
   `verify-shots/`.
2. **Up-axis sanity (the one thing the synthetic sample can't prove without eyes).** The sample authors
   glTF **Y-up** and relies on the standard 3D-Tiles y-up→z-up (+90° about X): local ENU (e,n,u) → glTF
   `(e, u, -n)`. If buildings render lying on their side, the fix is that known 90° — flip the mapping in
   the generator. Verify buildings stand upright and face out.
3. **Real bake (Slice 1 start).** OSM2World over a central-Dnipro OSM extract → glb → 3D-Tiles; check Dnipro
   `roof:shape` tagging density first (drives roof quality). Then the production heavy path (height
   inference + LOD2 roofs) per the plan.
4. **R2 (production hosting).** Custom domain + CORS (§Recipe), upload the tileset, point
   `PUBLIC_ENRICHED_TILES_URL` at it.

---

## Recipe

**Local browser proof (no cloud):**
```bash
node scripts/build-sample-dnipro-tiles.mjs
echo 'PUBLIC_ENRICHED_TILES_URL=/enriched-sample/dnipro/tileset.json' >> .env.local
wix dev   # fly to Dnipro; A/B by removing the env line to see the OSM baseline
```

**OSM2World sample bake (light path):** download the OSM2World jar (Java 21 present), fetch a small Dnipro
`.osm`/`.pbf` extract, then `java -jar OSM2World.jar --input dnipro.osm --output dnipro.glb` (S3DB roofs from
OSM tags; local z=0 frame → keep `reseatToTerrain:true`). Convert `dnipro.glb` → 3D-Tiles with `3d-tiles-tools`.

**R2 CORS (production):** create bucket → **connect a Custom Domain** (r2.dev won't serve CORS) → Settings →
CORS Policy:
```json
[{ "AllowedOrigins": ["https://<app-host>", "http://localhost:4321"],
   "AllowedMethods": ["GET", "HEAD"],
   "AllowedHeaders": ["range", "if-match", "content-type"],
   "ExposeHeaders": ["content-length", "content-range", "accept-ranges", "etag"],
   "MaxAgeSeconds": 3600 }]
```
Purge cache after editing CORS on a live custom domain; test with an explicit `Origin` header.

---

## Top open questions (need a human / browser)
1. **Up-axis** — is the standard glTF Y-up assumption right for our `3d-tiles-renderer` + these tiles? (browser, 2 min)
2. **Mask completeness at low zoom** — is coarse-ancestor OSM leakage acceptable for the spike, or fast-track the Slice-2 clipping-plane hole?
3. **Dnipro OSM `roof:shape` density** — enough for OSM2World roofs, or does Slice 1 need the height-inference heavy path immediately?

## Evidence / tool health
Two parallel research agents (installed `3d-tiles-renderer@0.4.28` source read for masking/plugin API,
conf 93%; external datum/OSM2World/R2 docs, conf 85%). Local tooling probe: Java 21 ✓, Python 3.10 ✓,
Docker ✓; **no** osm2world/3dfier/py3dtiles/pg2b3dm/wrangler/gltf-transform installed and `npx` can't
auto-install here → the real bake + R2 + browser run is the deferred tier above. Datum numbers are HIGH
confidence (GeographicLib + 4 corroborating sources); the ~2–6 m CWT inter-DEM residual is UNVERIFIED until
the browser seat check.
