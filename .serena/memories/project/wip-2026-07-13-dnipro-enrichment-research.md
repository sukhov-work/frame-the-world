# wip 2026-07-13 — Dnipro 3D Enrichment: external research INCORPORATED → decision + sliced plan

Mode: design (/frame) · No code this session. Two owner turns: (1) wrote the research brief
`DNIPRO_3D_ENRICHMENT_RESEARCH_PROMPT.md`; (2) fed it to a web researcher, got
`DNIPRO_3D_ENRICHMENT_RESEARCH_RESULTS.md` (cited, accessed 2026-07-13), and asked to analyze + plan.
Output: `.claude/claude-docs/DNIPRO_3D_ENRICHMENT_PLAN.md` (execution plan/backlog) + DECISIONS
"2026-07-13 — DESIGN" + NEXT_SESSION headline. Verification: research-VERIFIED (external, cited); design
UNVERIFIED (no spike/code yet).

## DECISION
An **offline BAKE** of roof-shaped **LOD2 buildings** for Dnipro (open footprints + INFERRED heights →
3dfier straight-skeleton roofs → CityJSON → 3D Tiles), **SELF-HOSTED on Cloudflare R2**, with the client
**MASKING Cesium OSM Buildings inside the Dnipro bbox** and streaming the enriched tileset in their place.
Plus instanced trees from canopy-height rasters. Hero-landmark Gaussian splats = later/higher-risk add-on.
**All data $0** — cost is engineering + pipeline complexity, not licensing.

## Why this is the pick (and how it maps to locked ADRs — breaks nothing)
- **Reframes/RETIRES R4** (client-side S3DB roof reconstruction). R4's blocker: reconstructed roofs
  z-fight the streamed Cesium LOD1 prism, and culling the prism per-footprint needs a batch-id→OSM-id map
  + per-building sub-mesh culling the one-material swap can't do. **Bake-and-mask REPLACES buildings in the
  bbox instead of overlaying → the blocker is moot.** Client-side reconstruction is off the table.
- **Extends D1:** Cesium OSM Buildings stays the GLOBAL fallback; enriched tileset = a 2nd `TilesRenderer`
  masked to the bbox. Engine (three.js + `3d-tiles-renderer` + GlobeControls) unchanged.
- **Extends D13:** self-host OUR derived tiles on **R2, NOT Cesium ion Community** (ion Community is
  non-commercial/non-gov only; we have a paid marketplace). We STILL stream Cesium's own ion assets
  (World Terrain #1, OSM Buildings #96188); D13's "upgrade to Commercial at first sale" is unchanged.
- **Extends C6:** three rules baked into the pipeline — a military/critical-infra **exclusion mask**
  applied BEFORE tiling; **archival/pre-war imagery ONLY** (fresh UAV/aerial capture illegal under martial
  law, Art. 114-2 Criminal Code); reduced precision carried onto the enrichment layer.
- **Honors C1:** bake is OFFLINE/one-time; tiles static on a CDN; runtime = pure client streaming.

## Verified facts that shaped it (all cited in the RESULTS doc)
- **No ready-made open LOD2 for Dnipro** (unlike NL 3DBAG / DE / JP PLATEAU) → reconstruct, don't download.
- **Dead for Dnipro:** EUBUCCO (EU-27+NO/CH/UK) & JRC DBSM (EU-27) EXCLUDE Ukraine · Google Open Buildings
  not-Europe · Nearmap no-UA · Blackshark SYNTH3D commercial/hosted/geo-typical · Google P3DT still absent.
- **License TRAPS:** **FABDEM = CC-BY-NC-SA → REJECT** (use Copernicus GLO-30 or ALOS AW3D30) ·
  **ion Community = non-commercial → don't host our tiles there.**
- **The height GAP is the real problem:** <10% of buildings globally carry height; over Dnipro ~3% have
  `roof:shape`, <10% any height (our extract: 85,802 bldgs). Infer heights (`levels×3` → MS ML height →
  class default) — this is why the heavier reconstruction path beats a naive OSM extrude.
- **Hosting math:** 85,802-bldg Draco LOD2 tileset ≈ 0.1–0.3 GB → inside R2 free tier (10 GB, zero egress).
- **Splats = LANDMARKS not whole-city:** 5–15 hero splats (tens of MB) stream fine (Spark / mkkellogg
  GaussianSplats3D); reconstruct from ARCHIVAL photos only (COLMAP + gsplat). Whole-city not mobile-viable.

## Stack "b" (recommended production) + per-city config
Overture footprints (ODbL) + Microsoft ML footprints (covers UA) fallback → height inference → 3dfier/
City4CFD LOD2 roofs → CityJSON (val3dity) → py3dtiles/pg2b3dm 3D Tiles (Draco) → R2 (+CORS). Terrain
optional (Cop GLO-30 → ctb-quantized-mesh) — see R1. Trees: ETH(10m)/Meta(1m) canopy (CC-BY) + OSM tree
points → `InstancedMesh`/impostors. Per-city config keys: `{city,bbox,buildings{source,heightFallback,
roofs},terrain,vegetation,splatLandmarks,exclusionMask,quality}`; `bake --city dnipro --out r2://tiles/
dnipro`. Global-drop-in: Overture/GLO-30/canopy. Per-city-curated: landmark splats, height cleanup,
exclusion mask.

## Sliced backlog (full DoDs in the PLAN doc)
- **Slice 0 — DE-RISK SPIKE (next session):** hand-bake a few central-Dnipro blocks (OSM2World light path
  or ~50-footprint hand-extrude) → R2 test bucket + CORS → 2nd `TilesRenderer` + MASK Cesium OSM Buildings
  in the sample bbox → **RESOLVE R1 seating** → confirm stream/LOD/perf. DoD: roofed blocks correctly
  seated + Cesium hidden underneath, browser-verified; verdict on seating strategy + toolchain for Slice 1.
- **Slice 1 — full bake pipeline** (heavier Python/PostGIS/3dfier toolchain, likely Docker; NOT a node
  script — precedent `build-ne-labels.mjs` is only the "bake→artifact" PATTERN). Exclusion mask before tiling.
- **Slice 2 — client integration + Pass 2 stylization reconciliation** (does the baked tileset reuse the
  ONE-shared-material `onBeforeCompile` R2 tone/night work, or carry baked vertex colors / per-class
  materials from pg2b3dm + re-expose `_batchid`/`_feature_id_0`?). Perf bench sub-M3 + phone, <150 MB.
- **Slice 3 — trees + (optional) terrain** (co-bake GLO-30 only if R1 forces it; else keep CWT — 30 m ≈ CWT).
- **Slice 4 — hero splats (DEFERRED):** archival-photo AUDIT first (UNVERIFIED density) → COLMAP+gsplat →
  Spark; camera-anchored ECEF precision trap (pins/frustum class) + bloom/depth interaction.
- **Slice 5 — feed enriched geometry into Pass 3** (`lib/geo/occlusion.ts` + `horizonProfile.ts` — the moat;
  buildings+trees ARE the fine obstruction surface, NOT the coarse 30 m DSM).
- **Cross-cutting:** ODbL attribution in the UI footer + publish derived DB under ODbL (marketplace
  unaffected — a web service is not "conveying" the DB); per-city exclusion mask.

## Risks (ranked)
- **R1 (BIGGEST) — vertical-datum seating:** baked bldgs ref GLO-30 vs we RENDER Cesium World Terrain → they
  must agree or bldgs float/sink (cf. old "90 m sink"). Options: re-seat to CWT at runtime (have
  `terrainHeightAt`/`resnap`, but tileset is absolute-positioned) · co-bake GLO-30 terrain for the bbox ·
  reference the bake to CWT elevations offline. **Decide in Slice 0.**
- R2 — toolchain weight (OSM2World light vs 3dfier heavy: light for the spike, heavy for production quality).
- R3 — heights INFERRED → meter-scale error → validate event-prediction geometry vs known landmark heights.
- R4 — Pass 2 stylization assumed the Cesium OSM Buildings material (reconcile in Slice 2).
- R5 — archival photo density in Dnipro UNVERIFIED (gates Slice 4). R6 — 30 m terrain ceiling (river/ravine).
  R7 — CesiumJS splat-in-3D-Tiles is new (2025). R8 — 2019 ortho WMS wartime license unclear (keep Esri z19).

## Session forks — RECOMMENDED DEFAULTS (owner DISMISSED the AskUserQuestion dialog → proceed w/ defaults)
1. Session-1 = DE-RISK SPIKE first. 2. Sequencing = PIVOT to enrichment (Pass 1/2 browser-verify + GTAO
folds into the next browser session — it's blocked on a weaker-than-M3 box anyway). 3. Splats = DEFERRED.
Adjustable — slices are independent enough to reorder if the owner redirects.

## Files
`.claude/claude-docs/DNIPRO_3D_ENRICHMENT_PLAN.md` (new — plan/backlog) · `DNIPRO_3D_ENRICHMENT_RESEARCH_
RESULTS.md` (new — cited report) · `DNIPRO_3D_ENRICHMENT_RESEARCH_PROMPT.md` (the brief) ·
`NEXT_SESSION_PROMPT.md` (headline) · `DECISIONS.md` ("2026-07-13 — DESIGN"). No src/ changes.

Related: `mem:core` · `mem:project/wip-2026-07-12-rendering-pass2-dnipro-identity` (R4 reframed here) ·
`mem:patterns/globe-rendering` + `mem:patterns/sky-bodies-terrain` (buildings/terrain pipeline the bake
extends) · `RENDERING_QUALITY_PASS.md` (Pass 3 = Slice 5's consumer).
