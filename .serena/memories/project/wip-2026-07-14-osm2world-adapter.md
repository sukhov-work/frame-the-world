# WIP 2026-07-14 — OSM2World PRODUCTION ADAPTER: shipped as a PARALLEL VARIANT, live on R2, A/B seam (DONE)

`/frame` + investigate-design-v3 (implement, Deep). Owner directive honored end-to-end: **the current
pipeline/models/behaviour are UNTOUCHED** — `bake.mjs`, `cities/dnipro.json`, `public/enriched/dnipro`
and the default runtime path are byte-identical. The o2w bake is a SIBLING the owner compares by eye.
Gates: **astro check 0/0 · vitest 525 (+12) · browser-VERIFIED** (Playwright MCP in wix dev; shots
`verify-shots/o2w-adapter-01..05` — same-#p-pose pairs @650 m + @260 m + Cesium-off).

## What shipped
- **`scripts/bake/bake-osm2world.mjs`** — orchestrator: tiled Overpass-XML extract (subGrid 2×2, cached
  `scripts/bake/.cache/o2w-*.osm`) → reference-safe C6 → OSM2World `convert` per sub-box (0.5.0-SNAPSHOT
  CLI + mandatory `--add-exports`; heavy modules excluded: Tree/Indoor/Aeroway/Road/Railway/SurfaceArea/
  Water/Parking/Sports/Golf/Pool/TrafficSign/BicycleParking/Bridge/Tunnel — all names verified against the
  jar) → multi-glb adapter re-bin (dedupe by element name across sub-boxes; dropClassesRegex belt;
  per-feature contiguous `_FEATURE_ID_0`; empirical N/S handedness vote; C6 polygon gate at real centroid)
  → OUR trees (vegetation.mjs, same cache+seed → byte-identical 24,714 placements — A/B differs ONLY in
  structures) → REUSED `encodeGlb`+`buildTileset`. Converts mtime-cached (15–77 s each; `--reconvert`).
- **`scripts/bake/lib/osmXml.mjs`** — `subBoxes` + `fetchOsmXml` (mirror cycling, cache) + `c6FilterXml`:
  REFERENCE-SAFE C6 in pure Node — excluded ways/relations removed WHOLE; excluded TAGGED nodes keep
  geometry, lose tags (self-closed) → no dangling refs. Live: −126 elements, 13 nodes stripped. osmium
  tags-filter stays the documented reproducible upgrade.
- **`scripts/bake/lib/readGlb.mjs`** — promoted spike inverse of encodeGlb (+Buffer input; round-trip test).
- **`scripts/bake/cities/dnipro-o2w.json`** — `extends: dnipro` (shallow merge in loadCityConfig) →
  bbox/grid/vegetation/exclusion IDENTICAL to the base ⇒ mask extent + cells + trees match, and
  `upload-r2.mjs --city dnipro-o2w` works UNCHANGED (reads cfg.output; prefix `enriched/dnipro-o2w`).
- **`src/lib/globe/enrichedVariant.ts`** + ONE call at `StylizedTiles.ts:172` — the A/B seam:
  `resolveEnrichedUrl(envUrl, location.search)`: no param → env URL EXACTLY (unit-locked byte-identical
  default) · `off|none|0` → undefined (tileset AND mask off = stock Cesium OSM) · name → swap the
  second-to-last path segment (`…/enriched/dnipro/…` → `…/enriched/<name>/…`; no env → same-origin
  `/enriched/<name>/tileset.json` for pre-upload local A/B) · contains "/" → verbatim. Pose persists in
  the `#p=` hash → SAME-POSE compare by reload.

## THE load-bearing fix (the spike's blind spot)
Constant-ENU-offset re-base is only valid near the origin. Full sub-box extracts + `>;` relation recursion
inflate each glb's data bounds 100+ km → `scene.extras.origin` far away → **Mercator-vs-ENU drift ~2 km**:
first run put only 11,156/27,920 buildings in-bbox, densest cell (2,1) SW-shifted, 44 cells. FIX =
**exact per-vertex inverse of OSM2World's `MetricMapProjection`** (disassembled from the jar via `javap -c`:
`S=40075016.686·cos(lat0)`; `x=((lon+180)/360)·S−x0`; `z=(ln((1+sinφ)/(1−sinφ))/4π+0.5)·S−y0`;
glTF POSITION=(x,ele,−z)) → lat/lon → `projectEN` into our frame. After: **26,104/27,920 in-bbox
(extruder: 26,569 footprints), 91 feature cells (extruder 90), densest (6,5) = city centre.**

## Numbers (LOD 2, full city)
95 tiles · 3.89M verts · **110.22 MB** (vs extruder 32.8 MB, ~3.4×) · 29,216 features = 26,104 Buildings +
3,112 constructions (PoleFence 1,919 · Wall 491 · StreetLamp 279 · HVPowerTower 155 · RetainingWall 103 ·
ChainLinkFence 46 · PowerTower 40 · Powerpole 16 · Cliff 11 · BollardRow 9 · Railing 8 · masts/flagpoles/
hedge/billboard/NodeModelInstance 24) · maxH 101 m · MB/cell max 4.00 (6,5). Manifest:
`public/enriched/dnipro-o2w/bake-manifest.json`. **R2 LIVE: 97 files/105.14 MB → `enriched/dnipro-o2w/`**
(Worker city-agnostic, unchanged; curl CORS `*` + glTF magic).

## Browser-verified (wix dev + Playwright)
- default → R2 `dnipro-real-2` streams, 34 tiles (**closes the carried "globe paints from R2" tail**).
- `?enriched=dnipro-o2w` → R2 `dnipro-o2w-1` streams (11 cells + trees, NO shader/tile errors, seated
  flush on CWT; buildingMaterial/tone/ghost/re-seat all inherited — same runtime contract).
- `?enriched=off` → enriched absent, Cesium OSM back in-bbox.

## Honest verdict (the owner's question)
OSM2World **does** deliver the precision ask: real S3DB roof shapes, `building:part` massing, courtyard
holes, thousands of constructions the extruder can't make. Trades to weigh IN THE A/B: (1) size 3.4×
uncompressed — levers: gltf-transform weld+draco (23× spike-measured; needs a DRACOLoader wired into the
enriched `GLTFExtensionsPlugin` — deliberately NOT done to keep runtime untouched) or `--lod 1`;
(2) UNTAGGED buildings take OSM2World's own height defaults, sometimes LOWER than our class-tuned
`classDefaultsM` (Soviet apartment blocks) — a per-place regression the extruder wins on (possible knob:
OSM2World config defaults, uninvestigated). Neither bake replaces the other; owner picks by eye.

## Traps (new this session)
- Rewriting `safe-*.osm` every run invalidates the convert mtime cache → C6-filter ONLY when the raw
  extract is fresh.
- `dropClassesRegex` `"Rail"` prefix ate `"Railing"` (street furniture) → use `"Railway"`.
- wix dev intermittently serves an SSR "TypeError" error page (curl fine, browser broken) after idle →
  restart wix dev (same recovery class as the 504-optimize-dep trap).
- The first #p restore can still be mid-glide when you screenshot — wait for the URL hash to be REWRITTEN
  (normalized `#p=…` = settled) before pairing A/B shots.

## 10 km extent + BLD toggle (same day, owner ask — browser-VERIFIED; astro 0/0 · vitest 530 (+5))
Both bakes expanded to **~20×20 km (~10 km radius)**: `dnipro.json` bbox **[34.915,48.37,35.185,48.55]**
(centre unchanged 48.46/35.05), **grid 20** (~1 km cells), `maxTrees` 200k (hash-uniform thinning would
have visibly thinned in-city parks at 60k; landed under cap at 161,823), versions `dnipro-real-3` /
`dnipro-o2w-2`, o2w `subGrid` 4 (16 extracts ~5×5 km); `ENRICHED.bbox` matched (regen-BOTH rule in the
comment). **Classic: 127,890 bldgs · 386 tiles · 149.14 MB** (single 62 MB Overpass fetch OK).
**o2w: first pass 577 MB → measured per-class verts: PoleFence 59.3% + ChainLinkFence 3.3% of ALL
vertices (every fence post rendered; sub-pixel beyond ~1 km) → dropped via `dropClassesRegex` (converts
mtime-cached, adapter-only re-run ~3 min) → FINAL 127,097 bldgs + 5,662 constructions · 7.71M verts ·
223.76 MB · max cell 4.97 MB.** R2: 388 files/142.30 MB `enriched/dnipro/` + 391 files/213.46 MB
`enriched/dnipro-o2w/` (grid-10 era cells remain as harmless orphan keys — tileset.json ignores them).
**BLD chip** (CameraTiltPanel, after SAT; only when `PUBLIC_ENRICHED_TILES_URL` set): one click ↔
CLASSIC/O2W via `toggleVariantUrl` (new helpers `ENRICHED_VARIANT_NAME`/`isVariantActive`/`toggleVariantUrl`
in enrichedVariant.ts, +5 tests) — **reload-based BY DESIGN** (a live tileset swap would tear down the
enriched renderer's seating/occlusion/edges state mid-frame; the `#p=` pose hash makes the reload land at
the identical view). CSS: `.ct-bld` narrow chip + `.ct-row` flex-wrap (5th chip wraps, never clips).
Verified: chip → `dnipro-o2w-2` streams from R2 at the same 48.532/35.131 periphery pose (~8.9 km out,
proving the radius), chip again → clean URL + `dnipro-real-3`. Shots `verify-shots/o2w-10km-01..02`.
CARRIED: no-HLOD reads building-empty above ~20 km over the now-bigger bbox — the coarse tier matters more.

## Local-dev tiles — dev NEVER hits R2 (same day, owner ask; astro 0/0 · vitest 530 · browser+build-VERIFIED)
Bakes moved OUT of `public/` → **`bakes/enriched/<city>/`** (git-ignored `/bakes/`): with 372 MB under
public/, every `wix build` would have shipped the tiles as dead bundle weight (prod streams R2 anyway) —
client bundle measured **24 MB** after. Dev serving = `serve`-only Vite middleware in `astro.config.mjs`
(`ftwLocalTiles` — /enriched/* → bakes/enriched/*, glb/json content-types, never part of a build) +
NEW **`.env.development.local`** (mode precedence beats .env.local) →
`PUBLIC_ENRICHED_TILES_URL=/enriched/dnipro/tileset.json`. Production: `.env.local` keeps the R2 Worker
URL; build runs production mode → never reads the dev file (grep-verified the R2 URL in dist).
Verified: dev rootURL local, `dnipro-real-3` streams, **0 workers.dev resource entries**; BLD chip →
`/enriched/dnipro-o2w/…` `dnipro-o2w-2`, still 0 R2 (the segment swap rides the LOCAL env URL — the
whole A/B works offline). R2 re-confirmed pushed: both tilesets full (386 + 389 cells, manifests, glb
magic). `cities/*.json` output → bakes/…; bake.mjs got ONE cosmetic hint-line fix (strip `bakes/` in the
printed URL). TRAP: `@ts-check` astro.config + untyped Vite plugin = 5 implicit-any errors →
`/** @returns {import("vite").Plugin} */`. Fresh clone: comment the dev override out (falls back to R2)
or re-bake locally.

## Next candidates
Owner A/B verdict on o2w vs extruder (the point of all this) → if o2w wins: draco wiring + LOD/height-default
tuning; if extruder wins: keep o2w as an option per city. Also open: dayArcs skyline fold · WS4-D subject
shadow timeline · optional HLOD · Phase 6 marketplace. wix dev NOT running (stopped at session end).

Related: `mem:project/wip-2026-07-14-osm2world-slice1.5-spike` (the seed) · `OSM2WORLD_EXPERIMENT_PREP.md`
§10 · DECISIONS "2026-07-14 (LATEST — OSM2World PRODUCTION ADAPTER)" · `scripts/bake/README.md` §OSM2World.
