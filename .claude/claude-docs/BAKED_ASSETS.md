# Baked Assets — buildings, terrain, regions (canonical domain doc)

Authored 2026-08-18 (post U7b). This is the ONE place that ties together the baked-asset
domain: what we bake, the rulings that shaped it, how the runtime consumes it, and the ops
runbooks. Script-level detail stays in `scripts/bake/README.md`; the dated decision record is
`DECISIONS.md` (2026-07-13 → 2026-08-18p); session logs live in the `mem:project/wip-*`
memories. If this doc and DECISIONS ever disagree, DECISIONS wins.

## 1. What exists (three bake families + one registry + one host)

| Family | Source | Tool | Output | R2 prefix |
|---|---|---|---|---|
| Buildings tier 1 — "classic" | OSM (Overpass) | pure-Node extruder (`bake.mjs`) | gridded 3D-Tiles 1.1, per-cell GLBs, per-building `_FEATURE_ID_0`, instanced trees | `enriched/<city>/` |
| Buildings tier 2 — "o2w" | OSM (tiled XML) | OSM2World jar + re-grid adapter (`bake-osm2world.mjs`) | same tileset CONTRACT as tier 1 (sibling dir/prefix) | `enriched/<city>-o2w/` |

Since 2026-08-19 (U8) BOTH building bakers also emit a `cell-<gi>-<gj>.meta.json` identity
sidecar per cell — `{ features: [{ id, osm, … }] }` mapping the bake-sequential featureId to
the stable OSM element id (`w<id>` / `r<id>#<ring>`; o2w adds `cls`). The OSM id can NEVER
ride `_FEATURE_ID_0` itself (float32 — exact only to 2^24; way ids are ~10^9). Purpose: the
per-building height-override keys (`ftw:bldg-overrides:v1` + the future BuildingOverrides
collection) upgrade from re-bake-fragile featureIds to OSM ids at the next re-bake; runtime
consumption is not built yet. Served/uploaded automatically (`.json` passes the dev middleware
and upload-r2's extension filter).
| Terrain patch | Copernicus GLO-30 (30 m DSM, free + commercial w/ attribution) | mago-3d-terrainer jar + post-bake tooling (`scripts/bake/terrain/`) | Cesium quantized-mesh pyramid + layer.json | `terrain/<city>/` |

- **Registry**: `src/lib/globe/regions.ts` — bundled pure data; the ONE source of truth for
  region bboxes, building-variant lists (best first) and terrain-patch configs (§4).
- **Host**: the private R2 bucket `frame-the-world-bucket` behind the path-agnostic Cloudflare
  Worker `frame-the-world.ievgen-sukhov.workers.dev` (CORS `*`, Range/206, content-types,
  `.json` 300 s / binaries immutable). Serving a new prefix needs ZERO Worker changes.

## 2. Final rulings (dated — the "why it is this way" ledger)

### Buildings (owner order 2026-08-18, DECISIONS 2026-08-18p)
1. **Best variant loads BY DEFAULT per baked region.** The o2w bake is the Dnipro default;
   the classic extruder bake stays uploaded as a fallback/AB seam. A `#p=`/`#f=` share into
   another baked region boots THAT region's best bake (boot-point wins).
2. **The user never chooses a variant.** BLD (desktop) and ▦ 3D DETAIL (/m) are a plain LIVE
   on/off (`buildings3d` pref + store, default ON; flows through the same `setActive` path as
   the /m 2D map — NO reload). The pre-2026-08-18 `enrichedVariant` pref is retired; stale
   keys are dropped by prefs sanitize.
3. **`?enriched=` survives as a DEV seam only**: `off|none|0` (no enriched + no mask — stock
   Cesium OSM), a bare variant name (A/B compares; mask bbox follows the OWNING region), or a
   verbatim URL/path.
4. Selection is ONE resolver call — `resolveEnrichedSelection` returns URL + mask bbox +
   region together, so the tileset streamed and the OSM mask/seat extent can never disagree
   (the old two-resolver sync trap).
5. Standing since Slice 0: no env URL → no enriched renderer, byte-identical app; OSM
   buildings inside a region bbox are masked out (stop-traversal plugin + pixel-exact clip
   prism) and the enriched set streams in their place, re-seated to rendered terrain (R1
   group clamp → per-cell → per-feature, all eased + plausibility-gated).

### Terrain (owner approval 2026-08-18 of UPLIFT Appendix A #1; DECISIONS 2026-08-18p)
1. **Free accuracy ceiling**: Copernicus GLO-30 self-baked to quantized-mesh — a ~50×
   effective-resolution uplift over what CWT serves the UA region (U7 audit: CWT tops out at
   L13 with 4-VERTEX quads there, ~2 km posting, +13…58 m landmark errors; the fine EU source
   stops at the EU border).
2. **Single-renderer composite** — never a second terrain renderer. The patch swaps tiles
   INSIDE the one ground renderer (§5), so heightAt, imagery drape, grade, fades, foveation
   and every seat consumer work untouched, and there is nothing to z-fight.
3. **Graceful degrade + no user control.** Outside the patch extent the globe is exactly
   current CWT; a missing patch tile = dead leaf, parent keeps rendering; the user has no
   terrain toggle (owner: "he should not have a choice"). Env unset = pure CWT byte-identical.
4. **Datum**: patch heights are ELLIPSOIDAL (mago's built-in EGM2008 geoid, N≈+20.4 m over
   Dnipro) — the same datum CWT renders, so the standing seat machinery needs zero datum
   handling and buildings re-seat onto the patch automatically.
5. **Seams are engineered, not hoped for**: (a) SPATIAL — a 3 km rim blend pulls patch
   heights onto the DECODED CWT surface at the extent edge (w=smoothstep; pure CWT at the
   edge), so served tiles meet CWT neighbours with no step at every level; (b) VERTICAL — the
   library's own machinery (out-of-set siblings become virtual children clipped from the
   shared parent + skirts = tile geometricError) covers LOD transitions, structurally the
   same way CWT refines past its own availability.
6. **Depth = L13** (≈38×25 m mesh posting ≈ GLO-30 native 31×21 m). mago silently clamps
   `-max` to its resolution heuristic; asked-14/got-13 is recorded and ACCEPTED — the L14
   gain was marginal. `extentMaxDepth`/`maxDepth` in the config keep the deep-detail clause
   ready if a finer source ever lands.
7. **C6**: 30 m native is SRTM-class already-public data (standing owner ruling); anything
   finer is an explicit owner republication decision. Purchases (WorldDEM Neo 5 m) wait until
   GLO-30 is judged in-scene (Appendix A #2, open).
8. **Licence**: adapted-product attribution is mandatory and shipped twice — the page credit
   line (index.astro) and the baked `layer.json.attribution`:
   "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and
   Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights
   reserved".

## 3. The terrain bake pipeline (`scripts/bake/terrain/`)

```
npm run bake:terrain -- --city dnipro          # ~90 s warm, fully self-verifying
node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro --terrain
```

Config = the `terrain` block in `cities/<city>.json`
(`extentBbox` · `extentMaxDepth` · `cityBbox` · `maxDepth` · `blendKm` · `output` ·
`attribution`). Stages (all in `bake-terrain.mjs`):

1. **Fetch** (`glo30.mjs`): anonymous HTTPS GETs of the 1°×1° COG GeoTIFFs from the AWS Open
   Data bucket `copernicus-dem-30m` (eu-central-1), cached in `scripts/bake/.cache/glo30/`.
   The WBM water-mask aux files (§7) are cached alongside (~140 KB each) but NEVER fed to the
   terrainer — a DEM-only staging dir is copied for it.
2. **Mesh** (mago-3d-terrainer 1.14.2 jar; auto-downloaded, sha256-pinned, cached): reads the
   COGs' own georeferencing, applies `--geoid EGM2008`, writes the z/x/y quantized-mesh
   pyramid + `layer.json` (octvertexnormals on by default; global-TMS tile coords).
3. **Rim blend** (`blend.mjs` + `qmesh.mjs`): every served tile within `blendKm` of the
   extent edge is decoded; verts inside the ring are pulled onto the decoded-CWT surface
   (`cwt.mjs` — ion asset-1 tiles fetched + cached with the U7 probe method) and the tile is
   splice-rewritten: ONLY the h-stream + header min/max change; u/v, indices, edge indices
   and extensions stay byte-identical. The blend is a pure function of (lon,lat,h) so
   parents/children/virtual-upsamples all converge — the pyramid stays self-consistent.
4. **Prune**: levels above `extentMaxDepth` outside `cityBbox` are deleted; `layer.json`
   availability is rewritten to match.
5. **layer.json post**: attribution set; then the HARD ASSERT — the runtime's arithmetic
   serve-set (§5) must be CONTAINED in the baked availability at every level, so a
   bake/runtime mismatch dies at bake time, never in the field.
6. **Probe verify** (receipts printed): decode real output tiles and compare — city-centre
   and extent-mid against the source COG + the embedded EGM2008 verification grid
   (`geoid.mjs`, bilinear over GeoidEval samples), and the westmost served tile's edge
   against live CWT. Shipped receipts: Δ 0.2 m / Δ −0.7 m / rim Δ −0.5 m.
7. **Emit**: `patch-info.json` + the exact `regions.ts` terrain block printed to console —
   copy it verbatim into the registry.

Shipped artifact (2026-08-18): 7,329 files · 10.97 MB · levels 0–13 over 34–36°E × 48–49°N,
rim-blended (19,045 verts / 535 tiles) — live at `terrain/dnipro/` on R2.

## 4. `regions.ts` — the registry contract

`src/lib/globe/regions.ts` is bundled pure data + O(1) helpers (`regionContaining`,
`regionOfVariant`, `regionById`). Zero fetches, zero failure modes; structural invariants are
unit-tested (`test/lib/globe/regions.test.ts`). It replaced `tuning.ENRICHED.bbox` +
`variantBboxes` + the hardcoded variant-name constant.

Per region: `id` · `bbox` (MUST equal the city bake bbox — it drives the OSM mask AND the
enriched re-seat extent; the old mask-extent==bake-extent coupling now lives here) ·
`variants` (R2 names under `enriched/`, BEST FIRST — `[0]` boots by default) · optional
`terrain` (verbatim from the bake's console snippet).

Consumers: `resolveEnrichedSelection` (buildings default + dev seam), the terrain-patch hook
(ALL regions' terrain cfgs are hooked at once — serve sets are disjoint, so the composite is
region-agnostic), the OSM mask/clip prism, and the enriched seat extent.

**Add-a-city runbook**
1. `scripts/bake/cities/<city>.json` (+`<city>-o2w.json` extends) → run both building bakes →
   `upload-r2.mjs --city <city>` / `--city <city>-o2w`.
2. Terrain (optional): add the `terrain` block → `npm run bake:terrain -- --city <city>` →
   `upload-r2.mjs --city <city> --terrain`.
3. Add ONE `BAKED_REGIONS` entry (bbox = bake bbox; variants best-first; paste the terrain
   snippet). `npm test` pins the invariants + serve-set parity.
4. `wix release`. Nothing else: the Worker is path-agnostic, selection/masks/patch all key off
   the registry.

## 5. Runtime composite mechanics (terrain)

`src/components/globe/scene/terrainPatch.ts`, wired in `scene/imageryGround.ts`:
- **`hookTerrainPatch`** wraps the QuantizedMeshPlugin instance's
  `createChild(level,x,y,available)` (wrapped BEFORE plugin registration, inside the ion
  assetTypeHandler, so every tile ever created passes the rule; `available` is the
  availability-ranges ARRAY and is passed through untouched). If the serve-set rule claims
  the tile, its `content.uri` is overridden to the patch URL. `expandChildren` counts forced
  content as a REAL child — that is how the quadtree descends past CWT's L13 over UA for free.
- **Serve-set rule** (pure, twinned `src/lib/geo/terrainTiles.ts` ⇄
  `scripts/bake/terrain/tiling.mjs`, parity-pinned by `test/lib/geo/terrainTiles.test.ts`):
  `z ≤ extentMaxDepth` → tile FULLY INSIDE `extentBbox` (straddlers keep CWT — the rim blend
  makes same-level neighbours meet); `extentMaxDepth < z ≤ maxDepth` → tile intersects
  `cityBbox`; `z > maxDepth` → never (virtual upsampling from patch parents continues).
- **`makeTerrainPatchFetchPlugin`** (priority −500, between QuantizedMeshPlugin −1000 and
  CesiumIonAuthPlugin 0): claims patch URLs with a PLAIN fetch — the ion Bearer token never
  reaches R2. Ion's `preprocessURL` appends `?v=` to every URL; harmless (the Worker keys on
  pathname).
- Base URL: `PUBLIC_TERRAIN_TILES_URL` (prod: the Worker `/terrain` base; dev: `/terrain`,
  served from `bakes/terrain/` by the astro.config middleware). Unset → the hook never
  installs → pure CWT, byte-identical.
- CWT's `layer.json` has `maxzoom 19`, so the plugin's tiling depth already covers L13 — no
  tiling internals are touched. Patch tiles share the per-level geometricError formula with
  CWT tiles, so SSE refinement and foveation treat them identically.

## 6. Ops runbook

- **Env**: `PUBLIC_ENRICHED_TILES_URL` (city anchor URL; the registry swaps the variant
  segment), `PUBLIC_TERRAIN_TILES_URL` (base), `PUBLIC_CESIUM_ION_TOKEN` (runtime CWT + the
  bake's rim-blend sampling), `CLOUDFLARE_*` (uploads/deploy — see upload-r2.mjs header).
  Both `.env.local` (prod values, used by build/release) and `.env.development.local`
  (same-origin dev paths) carry the two PUBLIC_ tile URLs.
- **Caching/versioning**: `.terrain`/`.glb` are `immutable` — a re-bake reuses filenames, so
  purge the Cloudflare cache or version the prefix on changes; `layer.json`/`tileset.json`
  self-heal in ≤5 min (300 s cache).
- **Budgets** (free tier, comfortably): R2 10 GB (enriched ≈33 MB + terrain ≈11 MB), egress
  free, Workers 100k req/day. A terrain-patch session pulls tens of tiles (~100 KB-class
  total) — negligible next to the building GLBs.
- **Verification**: `scripts/verify-terrain-patch.mjs` (raw-CDP; Node 20 needs
  `--experimental-websocket`) is the repeatable browser probe — REFINED-STATE GATED: it
  asserts only after deep (L12/13) tiles streamed and the city sample is stable, because
  heightAt's raw down-ray happily returns coarse-ancestor garbage during warm-up (Raycaster
  ignores `visible`; coarse CWT legitimately reads low/negative — the `clampGroundM`
  discipline exists for exactly this).
- **Production canary**: first prod exposure of the patch + o2w-default rides the next
  `wix release` (R2 CORS already proven for enriched; same Worker).
- **Traps** (each cost real time on 2026-08-18): geotiff.js-WRITTEN rasters carry geo-tags
  the Java terrainer ignores — never rewrite DEMs in Node, do height work post-bake on the
  tiles (the splice idiom) · mago silently clamps `-max` (30 m → 13) · WBM aux files must not
  reach mago's input dir · hash-only `Page.navigate` doesn't reload (the app reads `#p=` at
  boot — hop via about:blank) · verify-too-early = vacuous pass (see above).

## 7. GLO-30 auxiliary layers (cached, not yet consumed)

Each GLO-30 tile ships four aux rasters in the same bucket (`AUXFILES/`), same grid as the DEM:

| Layer | What it is | Size/tile | Potential uses here |
|---|---|---|---|
| **WBM** — Water Body Mask | 8-bit class raster: no-water / ocean / lake / river, recording where production flattened water surfaces | ~140 KB | (a) flatten/clean the river surface in a future re-bake (mago `-wm` is experimental — prefer applying WBM ourselves post-bake via the splice idiom); (b) drive the ground shader's water styling EXACTLY (today water darkening is a blue-dominant-pixel heuristic); (c) planning: knowing a frame looks ACROSS water enables reflection/glint hints (sunset-over-the-river is a core Dnipro shot); (d) authoritative shorelines where OSM polygons drift |
| HEM — Height Error Mask | per-pixel 1σ height error (float) | ~50 MB | accuracy labels/QA — e.g. a per-region "terrain ±N m" confidence figure for the planner |
| EDM — Editing Mask | which pixels were hand-edited in production | ~250 KB | provenance/QA only |
| FLM — Filling Mask | which voids were filled, and from what | ~236 KB | provenance/QA only |

The DEMs + WBMs for the Dnipro extent are already in `scripts/bake/.cache/glo30/`. Status:
deferred by design — the patch itself was the planning uplift; horizon profiles, planFeed and
occlusion improved automatically because they march the rendered terrain (`heightAt`).

## 8. Upgrade paths

- **WorldDEM Neo 5 m** (~$5.5k DSM+DTM, pre-war archive): decision AFTER the owner judges
  GLO-30 in-scene (UPLIFT Appendix A #2). C6: any public patch finer than 30 m is an explicit
  owner republication ruling; resampling a purchased 5 m source to 10–15 m public is the
  documented middle path.
- **Deeper mesh (L14)**: the serve-set rule + config already carry the
  `extentMaxDepth < z ≤ maxDepth` city clause (dormant at 13==13); it activates by config the
  day a finer source or a different mesher lands.
- **Buildings tier 3** (textures/realism) and canopy-height trees: documented in
  `scripts/bake/README.md` §Higher-fidelity tiers.
- **Cross-region live attach** (fly Dnipro→St Albans without a reload — today the boot
  region's bake is the only enriched set attached): named tail, registry-ready.
