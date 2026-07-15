# WIP 2026-07-14 — Owner R2 hosting LIVE + OSM2World experiment prep

Two-part `/frame` session (investigate-design-v3 method). Part A shipped (ops); Part B is a prep doc.
Local gates unchanged (ops/docs only): **astro check 0/0 · vitest 513**. Tiles are curl-verified; the
globe-paints-from-R2 browser check is the one marked tail.

## Part A — R2 hosting (LIVE, all stages) — the Slice-2 (d) owner-gated tail is DONE
**Live:** `https://frame-the-world.ievgen-sukhov.workers.dev/enriched/dnipro/tileset.json`

The owner's `.env.local` uses `CLOUDFLARE_*` (not `R2_*`) and a **Cloudflare Worker over a PRIVATE bucket**
(`frame-the-world-bucket`) — a better path than the old custom-domain recipe (r2.dev has no CORS + no domain
to bind; a Worker gives full CORS/Range control on the free tier while the bucket stays private). Env keys:
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESSKEY_ID`, `CLOUDFLARE_SECRET_ACCESSKEY`, `CLOUDFLARE_R2_BUCKET`
(S3 upload) + `CLOUDFLARE_API_TOKEN` (Workers-Edit, for deploy).

Stages:
1. `scripts/bake/upload-r2.mjs` — now reads `CLOUDFLARE_*` (fallback `R2_*`). Uploaded 96 files · 32.49 MB
   → `enriched/dnipro/` (all HTTP 200). `node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro`.
2. `scripts/bake/r2-worker.mjs` (NEW) — the gateway: CORS `*` + OPTIONS 204 + Range/206 + content-type
   (httpMetadata→ext fallback) + Cache-Control (glb immutable, tileset.json 300 s) + `/` health JSON +
   city-agnostic (serves any `enriched/<city>/…` key from the private bucket).
3. `scripts/bake/deploy-worker.mjs` (NEW) — pure-fetch multipart PUT to the Workers API, **preserves the
   `R2_BUCKET` binding** (`metadata.bindings`) + `main_module:"worker.js"` + compat 2026-07-13. A bare PUT
   wipes the binding. Snapshot the current script first (`GET .../workers/scripts/frame-the-world`) for
   rollback. `node --env-file=.env.local scripts/bake/deploy-worker.mjs`.
4. `.env.local`: `PUBLIC_ENRICHED_TILES_URL=https://frame-the-world.ievgen-sukhov.workers.dev/enriched/dnipro/tileset.json`
   (consumed at `StylizedTiles.ts:172` → `attachEnrichedBuildings({url})`). Same-origin `/enriched/…` fallback
   kept as a comment (baked artifacts git-ignored → released/CI build MUST use R2). Restart wix dev after.

Verified (curl): tileset 200 + `access-control-allow-origin:*`; OPTIONS 204; Range 206 `bytes 0-99/522048`;
full glb glTF magic; root `{"service":"frame-the-world-tiles","ok":true}`.

**Free tier:** R2 10 GB (33 MB used) · egress always free · Class A 1M / Class B 10M per mo · Workers
100k req/day (~96 files/view ⇒ ≈1k views/day; browser cache cuts repeats). No paid resource touched.

**Extensible:** city #2 / wider bbox = `bake --city X` → `upload-r2.mjs --city X` (→ `enriched/X/…`, Worker
unchanged); only `PUBLIC_ENRICHED_TILES_URL` moves. Custom domain later = a client-URL swap only.

**TRAP:** `node --env-file=.env.local …` is the robust env load — `env $CFENV node` did NOT split the var
into separate `NAME=VALUE` assignments (the API token never reached the process → "missing env"); `--env-file`
also parses past the multi-line PEM in `.env.local`. Sandbox allowed the PUTs (network egress works).

## Part B — OSM2World experiment prep (deep investigation)
Doc: `.claude/claude-docs/dnipro-enrichment/OSM2WORLD_EXPERIMENT_PREP.md` (3 cited agents: capabilities 87% · bake-contract
93% · integration 88%). **Verdict: viable, recommended as fidelity tier 2 (owner: "more realistic buildings
and other 3d elements and constructions").**

Load-bearing facts (cited in the doc):
- **Axis aligns for free:** OSM2World glTF writer negates Z → POSITION `(east, up, −north)` == our baker's
  `gv(e,n,u)=(e,u,−n)` (`buildings.mjs:181`). Verify N/S on 1 cell (both agents ~75% here).
- **Ground Y=0 by default** (`terrainInterpolator=ZeroInterpolator`, no `srtmDir`) → matches the runtime
  clamp-to-CWT (R1). Use `eleCalculator=NoOpEleCalculator`/`createTerrain=false` for strictly flat.
- **Runs here:** Java 21 ✓; distro `osm2world.org/download/files/latest/OSM2World-latest-bin.zip` = 200/478 MB;
  Overpass (30 bldgs in a 200 m probe) + Geofabrik reachable.
- **Gives us:** every S3DB roof + walls/fences/hedges/bridges/tunnels/power+pylons/masts/street-furniture/
  cliffs (default-on; `excludeWorldModule=…` toggles). MIT software; textures CC0; output ODbL from OSM.
- **NO Draco/meshopt, un-indexed** → gltf-transform post-step for size. **NO `_FEATURE_ID_0`** (batches by
  material) → per-building tone/re-seat degrade unless recovered.

Pipeline: OSM extract (Overpass-XML here / Geofabrik+osmium prod) → **C6 pre-filter on the INPUT** (reuse
`makeExcluder`, `exclusion.mjs`) → `java -jar OSM2World.jar --input safe.osm --output x.glb --config
stylized.properties` (color-only materials, ground=0, keepOsmElements=true, exportMetadata=ID, exclude
Tree/Indoor/Aeroway, LOD 2) → **NEW adapter: `readGlb()` (inverse of `encodeGlb`) → re-bin triangles into the
10×10 grid by centroid (`bake.mjs:83-84` idiom) → assign `_feature_id_0` per OSM2World building node → inject
our instanced trees (`vegetation.mjs`) → REUSE `encodeGlb`+`buildTileset` unchanged** → optional draco →
`upload-r2.mjs`.

Reuse unchanged: `gltf.mjs`, `geo.mjs`, `exclusion.mjs`, `vegetation.mjs`. New: `readGlb()` + triangle-binner
(replaces `buildings.mjs` extruder + `bake.mjs:70-95` footprint aggregation). Do NOT use OSM2World's own
`tileset` exporter (own zoom-15 scheme, no batch ids — misses our per-cell contract, which the runtime's
per-cell re-seat/masking/streaming depend on).

Owner forks: `_feature_id_0` recover (`keepOsmElements`+adapter labeling, recommended) vs accept per-cell;
textures strip (v1, small) vs realism tier later; modules keep structures / exclude roads+surfaces (we have a
vector web); single-tile vs **re-grid** (decisive). **NEXT = the "Slice 1.5" 1-cell spike (steps §8 of the doc).**

Related: `mem:project/wip-2026-07-13-dnipro-slice2` (R2 tooling origin) · `scripts/bake/README.md` §Hosting +
§Higher-fidelity tiers · `dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md` Slice 1 · `mem:patterns/globe-rendering`.
