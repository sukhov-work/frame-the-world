# Dnipro 3D Enrichment — Plan & Backlog

**Provenance.** Distilled from `DNIPRO_3D_ENRICHMENT_RESEARCH_PROMPT.md` (the brief) →
`DNIPRO_3D_ENRICHMENT_RESEARCH_RESULTS.md` (the cited external report, accessed 2026-07-13) + this
session's analysis against our locked ADRs and current build state. This doc is the execution source of
truth for the enrichment workstream (peer of `RENDERING_QUALITY_PASS.md`). Nothing here supersedes a
locked ADR without a dated `DECISIONS.md` line.

---

## Decision (what we're building)
**An offline BAKE pipeline that reconstructs roof-shaped LOD2 buildings for Dnipro from open footprints +
inferred heights, tiles them to 3D Tiles, and SELF-HOSTS them on a CDN — and the client MASKS Cesium OSM
Buildings inside the Dnipro bbox and streams the enriched tileset in its place.** Plus instanced trees from
canopy-height rasters. Hero-landmark Gaussian splats are a later, higher-risk add-on. **All data is $0**;
the cost is engineering + pipeline complexity, not licensing.

This is the highest ratio of in-camera payoff (silhouette accuracy for FPV photo-alignment + a usable
obstruction surface for event prediction) to effort, at zero data cost.

### How it maps to the locked stack (no ADR is broken)
- **Reframes R4** (the deferred client-side S3DB roof-reconstruction slice). R4's blocker was that
  *client-side* reconstructed roofs z-fight the streamed Cesium LOD1 prisms and cleanly culling the prism
  per-footprint needs a batch-id→OSM-id map + per-building sub-mesh culling the one-material swap can't do.
  **Bake-and-mask sidesteps this entirely: you REPLACE the buildings in the bbox, you don't overlay them.**
  R4 (client-side reconstruction) is effectively retired in favor of the offline bake.
- **Extends D1** (globe engine). Cesium OSM Buildings stays the **global fallback**; the enriched tileset
  is a second `TilesRenderer` masked to the Dnipro bbox. Engine unchanged (three.js + `3d-tiles-renderer`).
- **Extends D13** (Cesium ion). We **self-host our OWN baked tiles on Cloudflare R2, NOT Cesium ion
  Community** — ion Community is non-commercial/non-government only and "Frame the World" has a paid
  marketplace. (We still *stream* Cesium's own hosted assets — World Terrain #1, OSM Buildings #96188 —
  via ion; D13's "upgrade to Commercial at first sale" plan is unchanged. Only our derived tiles go to R2.)
- **Extends C6** (wartime geo-sensitivity) with three hard rules baked into the pipeline: a
  military/critical-infrastructure **exclusion mask** applied before tiling; **archival/pre-war imagery
  only** for any reconstruction (fresh UAV/aerial capture is illegal under martial law); and the existing
  reduced-precision posture carried onto the enrichment layer. See §Wartime guardrails.
- **C1 (client-heavy) is honored:** the bake is OFFLINE (one-time), tiles are static on a CDN, runtime is
  pure client-side streaming via `3d-tiles-renderer`. No server-side rendering, no Wix compute.

---

## Session forks — RECOMMENDED DEFAULTS (owner dismissed the question dialog; adjustable)
1. **Session-1 scope = DE-RISK SPIKE FIRST.** Hand-bake a small central-Dnipro sample before investing in
   the full pipeline (proves the hard unknowns — see §Slice 0).
2. **Sequencing = PIVOT TO ENRICHMENT.** The pending Pass 1/Pass 2 browser-verify (shader-compile over
   Dnipro, tiering A/B, GTAO enable) folds into the *next real browser session* — it's been blocked on a
   weaker-than-M3 box + a browser loop, and enrichment is mostly offline pipeline work that doesn't need
   the browser until integration.
3. **Landmark splats = DEFERRED** behind the buildings bake (Slice 4). Highest fidelity, highest risk.

If the owner prefers otherwise, adjust the slice order below — the slices are independent enough to reorder.

---

## Verified facts that shape the plan (from the report; each cited there)
- **No ready-made open LOD2 model exists for Dnipro** (unlike NL 3DBAG / DE / JP PLATEAU). The free path is
  *reconstruction*, not a download.
- **Negative findings (do not pursue):** EUBUCCO (EU-27+NO/CH/UK) and JRC DBSM (EU-27) **exclude Ukraine**;
  Google Open Buildings is **not** Europe; Nearmap has **no Ukraine** coverage; Blackshark SYNTH3D is
  commercial/hosted + geo-typical (not true-to-life); Google P3DT still absent over Dnipro. Confirmed dead.
- **License traps:** **FABDEM is CC-BY-NC-SA → REJECT** for a commercial app (use Copernicus GLO-30 or
  ALOS AW3D30 instead). **Cesium ion Community is non-commercial → do not host our tiles there.**
- **The height gap IS the problem:** <10% of buildings globally carry a height; over Dnipro only ~3% have
  `roof:shape` and <10% any height (our own extract: 85,802 buildings). Heights must be **inferred**, not
  read → this is why the heavier reconstruction path (below) earns its complexity over a naive OSM extrude.
- **Hosting math:** an 85,802-building Draco LOD2 tileset ≈ **0.1–0.3 GB** → inside Cloudflare R2's free
  tier (10 GB, zero egress).
- **Splats are feasible for LANDMARKS, not the whole city:** 5–15 hero splats (tens of MB each) stream fine
  (Spark / mkkellogg GaussianSplats3D); whole-city splatting is not mobile-viable. Reconstruct from
  **archival** photos only (COLMAP + gsplat).

---

## The pipeline (Stack "b" — the recommended production stack)
Data sources (all $0): **Overture** buildings (ODbL, GeoParquet on AWS) primary + **Microsoft Global ML
Footprints** (covers Ukraine, ~2 GB) as fallback where OSM is thin → **height inference**
(`building:levels × ~3 m` → MS ML height estimate → class default) → **3dfier / City4CFD** straight-skeleton
LOD2 roofs → **CityJSON** → **py3dtiles / pg2b3dm** (Draco on, per-class materials) → **3D Tiles 1.1** →
**Cloudflare R2** (public bucket + CORS). Terrain (optional, see risk R1): **Copernicus GLO-30** →
`ctb-quantized-mesh` → static quantized-mesh. Trees: **ETH (10 m) / Meta (1 m) canopy height** (CC-BY) +
OSM `natural=tree`/`landuse` → three.js `InstancedMesh` low-poly / impostors.

### Per-city config (the pluggable contract — Dnipro = instance #1)
```
city: dnipro
bbox: [35.00, 48.42, 35.10, 48.50]
buildings:  { source: overture, footprintFallback: msml,
              heightFallback: [osmLevels, msHeights, classDefault], roofs: 3dfier }
terrain:    { source: cop-glo30, format: quantized-mesh }   # optional — see R1
vegetation: { source: eth-canopy-10m, model: instanced-impostor }
splatLandmarks: [ { id: <landmark>, sources: archival } ]   # Slice 4
exclusionMask: dnipro_military_critical_infra.geojson       # C6 — load-bearing
quality:    { mobile: lod1.3, desktop: lod2 }
```
Bake command shape: `bake --city dnipro --out r2://tiles/dnipro`. **Global-drop-in layers** (point at
coordinates): Overture buildings, GLO-30 terrain, canopy height. **Per-city-curated:** landmark splats,
height cleanup, the exclusion mask. Onboarding city #2 = new config + run the bake + publish under ODbL.

---

## Sliced backlog (each slice = one or more sessions; DoD explicit)

### Slice 0 — DE-RISK SPIKE ✅ DONE (2026-07-13, browser-VERIFIED: up-axis upright · R1 clamp-to-CWT seating · OSM mask clean at leaf level · straddle-leak confirmed → Slice-2 clipping planes; `mem:project/wip-2026-07-13-dnipro-slice1-bake`)
Prove the *hard unknowns* on a tiny hand-baked sample (a few central-Dnipro blocks) before building the
pipeline. **Deliberately crude data — this validates INTEGRATION, not data quality.**
- Fastest path to pixels: **OSM2World** (OSM → glTF/3D-Tiles with Simple-3D-Buildings roofs, one tool) OR a
  hand-extrude of ~50 footprints; tile; upload to an R2 test bucket with CORS.
- Wire a second `TilesRenderer` at the R2 URL into the globe; **mask Cesium OSM Buildings inside the sample
  bbox** (hide/skip tiles whose bounds fall in the box).
- **Resolve R1 (vertical-datum seating):** do the baked buildings sit correctly on our *rendered* Cesium
  World Terrain, or do they float/sink? Decide the seating strategy here (§Risks R1).
- Confirm the R2-hosted tiles stream + LOD + unload under `3d-tiles-renderer`; check mobile-ish perf.
- **DoD:** a handful of roofed Dnipro buildings visible on the globe, correctly seated, streamed from R2,
  with Cesium OSM Buildings hidden underneath them — browser-verified in `wix dev`. A written verdict on
  the seating strategy + toolchain choice (OSM2World light path vs 3dfier heavy path) for Slice 1.

### Slice 1 — Buildings bake pipeline ✅ DONE (2026-07-13, browser-VERIFIED)
**Built as a reproducible Node DATA-DRIVEN baker** (`scripts/bake`, `npm run bake -- --city dnipro`) — owner
picked it over OSM2World/heavy-3dfier because it reuses the browser-verified glb+tileset writer and runs+verifies
in-env (Docker daemon down + public npm blocked here). 3233 Dnipro buildings → 16-tile 3D-Tiles (4.83 MB), C6
exclusion applied before tiling, height inference (~54% real), `_feature_id_0` per building, seated + masked +
streaming. **OSM2World + heavy 3dfier LOD2 (below) = the roof-fidelity UPGRADE tiers** (recipe in
`scripts/bake/README.md`), not the shipped path. Original plan text:
The full offline bake per §pipeline + §per-city config. Height inference, 3dfier LOD2 roofs, CityJSON
validation (`val3dity`), 3D-Tiles tiling, R2 upload, and the `bake --city` command + config file.
- Precedent for the "bake script → artifact" pattern exists in-repo (`scripts/build-ne-labels.mjs`,
  `scripts/build-star-catalog.mjs`) — but this bake is a heavier, separate geo toolchain (Python/PostGIS/
  GDAL/3dfier), likely Dockerized, NOT a `node script.mjs`. Budget for that.
- **Exclusion mask applied BEFORE tiling** (§Wartime guardrails) — first-class, not bolted on.
- **DoD:** the full Dnipro bbox baked to a ~0.1–0.3 GB 3D-Tiles set on R2, reproducible from `bake --city
  dnipro`, ODbL-attributed, sensitive geometry excluded.

### Slice 2 — Client integration + stylization reconciliation
> **✅ SHIPPED 2026-07-13 (browser-VERIFIED; astro check 0 · vitest 459 · wix build):** per-cell terrain
> re-seat · the 4-plane ECEF clipping-prism hole (straddle-leak fixed pixel-exactly; `bboxClipPrismEcef` +
> `clipIntersection`/`clipShadows` on the shared OSM materials) · stylization reconciled via option (a) —
> a NEW shared factory `scene/buildingMaterial.ts` consumed by BOTH tilesets as separate instances (the
> per-tileset one-shared-material invariant holds; separate because the clip prism must not clip the
> enriched set), R2 tone keyed on the baked `_feature_id_0`, debug edges off · full-city bake
> [35.00,48.42,35.10,48.50] grid 10 → 26,569 bldgs · 90 tiles · 32.8 MB · pure-Node SigV4 R2 uploader
> (`scripts/bake/upload-r2.mjs`, dry-run-verified). **Open tails:** R2 bucket/custom-domain/CORS = owner
> Cloudflare action; sub-M3 + phone FPS benchmark; optional HLOD coarse tier (box is empty of buildings
> above ~20 km — enriched SSE-culls, OSM correctly clipped). `mem:project/wip-2026-07-13-dnipro-slice2`.
> Original plan text:
- Point the enriched `TilesRenderer` at the production R2 tileset; mask Cesium OSM Buildings in the bbox;
  keep DRACO; add KTX2/meshopt for textures. WebGL2 primary, WebGPU progressive.
- **Reconcile with Pass 2 (Dnipro identity) stylization:** R2 per-building tone variation + the future
  night-window pattern were built against the Cesium OSM Buildings shared material. Decide whether the
  baked tileset (a) reuses the same shared-material `onBeforeCompile` stylization, or (b) carries baked
  vertex colors / per-class materials from `pg2b3dm`. Keep the ONE-shared-material invariant if (a).
- **DoD:** enriched Dnipro buildings render with the project's stylized look, tiered by the Pass 1 quality
  system, browser-verified; FPS benchmarked on a sub-M3 laptop + a mid-range phone (<150 MB resident target).

### Slice 3 — Trees + (optional) terrain
> **✅ SHIPPED 2026-07-13 (browser-VERIFIED; astro check 0/0 · vitest 473 · wix build):** ~24.7k
> deterministic trees (OSM tree points + tree_row sampling + seeded scatter over wood/forest/park,
> building-footprint + C6 rejection) baked as **`EXT_mesh_gpu_instancing` nodes INSIDE the enriched
> per-cell glbs** (~50 B/tree, +1.2 MB) → three loads ONE InstancedMesh per cell, inheriting the
> streaming/LRU/per-cell re-seat; shared vecGreen flat-shaded material, night-dimmed, shadow-casting,
> FPV-slider-faded, raycast-excluded. Canopy-height rasters (ETH/Meta) = documented upgrade tier
> (`scripts/bake/README.md`). **Terrain decision RECORDED: keep Cesium World Terrain** — R1's runtime
> clamp never forced a co-bake. `mem:project/wip-2026-07-13-dnipro-slice3-trees`. Original plan text:
- Instanced trees from ETH/Meta canopy height + OSM tree points/landuse (placement JSON baked → runtime
  `InstancedMesh`/impostors). Night-dimmed like the vector web.
- Terrain: **only if R1 forces a co-bake** — otherwise keep Cesium World Terrain (30 m GLO-30 is not a
  meaningful upgrade over CWT for the ground; the buildings + trees are the win).
- **DoD:** trees placed and seated on terrain, occlusion-relevant, tiered; terrain decision recorded.

### Slice 4 — Hero-landmark Gaussian splats (deferred; highest fidelity)
- **First: audit archival photo availability** per landmark (Wikimedia Commons, Flickr, Mapillary, pre-war
  tourism footage) — Stack "c" hinges on this and it's UNVERIFIED.
- COLMAP (SfM) + gsplat/Brush → `.spz`/`.sog` → stream via **Spark** or **mkkellogg GaussianSplats3D**.
- **Integration risk = the camera-anchored ECEF precision trap** (same class as pins/frustum: float32
  cancellation at ~6.4e6 m) + splat alpha/depth interaction with the EffectComposer bloom pipeline. Treat
  as a bespoke slice.
- **DoD:** 5–15 hero splats placed at true ECEF locations, precision-stable at street level, streamed on
  demand; measured against real photos.

### Slice 5 — Feed the enrichment into Pass 3 (the astro/obstruction moat)
> ✅ **DONE 2026-07-14 (browser-VERIFIED; vitest 506 · astro check 0/0 · wix build).** Shipped WITH
> the full Pass 3: pure `lib/ephemeris/planner.ts` + `lib/geo/horizonProfile.ts` +
> `lib/geo/occlusion.ts` (NO-Raycaster silhouette sweeps — building edges az-adaptively subdivided,
> slice-3 trees as canopy spheres straight from the `EXT_mesh_gpu_instancing` TRS, OSM vertices
> rejected inside the mask prism) + `scene/planFeed.ts` (time-sliced builds; photo-apex/FPV-eye
> anchor; 3 km trust) + PlanPanel jump-to-time chips. Live: sun clears the real Dnipro skyline
> +37 min after astronomical sunrise; park anchor's skyline is canopy-driven (trees ARE occluders).
> **DoD tail carried:** validate against a surveyed landmark height.
> `mem:project/wip-2026-07-14-pass3-obstruction-moat`. Original step:
- The reconstructed buildings + trees ARE the fine obstruction surface for `lib/geo/occlusion.ts` +
  `horizonProfile.ts` (per the report: don't use the coarse 30 m DSM). Better geometry → better "will the
  moon clear that rooftop?" prediction. Direct synergy with the already-queued Pass 3.
- **DoD:** occlusion/horizon-profile reads the enriched geometry within the trust radius; event-prediction
  accuracy validated against known landmark heights.

### Cross-cutting (every slice)
- **ODbL attribution in the UI footer:** "Contains information from Overture Maps / © OpenStreetMap
  contributors, ODbL" + GLO-30 / canopy attributions. Publish the derived building DB under ODbL. (The
  paid marketplace is unaffected — running a web service against the DB is not "conveying" it.)
- **Exclusion mask** maintained per-city.

---

## Risks & open questions (ranked)
- **R1 — Vertical-datum seating (BIGGEST unknown; Slice 0 must resolve).** Baked buildings are height-
  referenced to GLO-30; we *render* Cesium World Terrain. If they disagree, buildings float/sink (cf. the
  old "90 m sink" bug). Options: (a) **re-seat baked buildings to CWT at runtime** — we already have
  `terrainHeightAt` raycast + `resnap` machinery, but the tileset is absolute-positioned so this is
  non-trivial; (b) **co-bake GLO-30 terrain** for the bbox so buildings + ground share a datum, and swap
  terrain inside the box too; (c) reference the bake to CWT elevations sampled offline. Decide in Slice 0.
- **R2 — Toolchain weight.** The heavy path (Overture→DuckDB→height-inference→3dfier→CityJSON→3DCityDB→
  pg2b3dm) is powerful but Python/C++/PostGIS-heavy vs the project's usual Node baking. The light path
  (**OSM2World**, OSM→3D Tiles direct with S3DB roofs) is far simpler but only as good as thin OSM tags.
  Recommend: light path for the Slice-0 spike, heavy path for Slice-1 production (it fills the height gap).
- **R3 — Building heights are INFERRED, not measured** → meter-scale absolute-height error → validate the
  event-prediction geometry against a few known landmark heights before trusting predictions.
- **R4 — Stylization reconciliation** (Slice 2): the Pass 2 shader work assumed the Cesium OSM Buildings
  material. Baked tiles may need their own material path or must re-expose `_batchid`/`_feature_id_0` (the
  bake controls this — pg2b3dm can emit per-feature batch ids).
- **R5 — Archival photo density in Dnipro is UNVERIFIED** → Slice 4 (splats) is gated on the audit.
- **R6 — 30 m terrain ceiling** limits riverbank/ravine fidelity along the Dnipro River — a hard limit
  without restricted/commercial data (out of reach). Accept for v1.
- **R7 — CesiumJS 3D-Tiles Gaussian-splat tiling is new (2025)**; if we ever want splats *inside* the
  3D-Tiles graph (vs separate Spark objects), prototype `3d-tiles-renderer` compatibility early.
- **R8 — Dnipro 2019 orthophoto WMS wartime licensing is unclear** → do not build on it. Keep Esri z19.

---

## Wartime guardrails (C6 extension — bake these in, don't bolt on)
Civilian/defensive framing throughout. From the report's legal findings (Article 114-2 of the Criminal
Code; martial-law airspace closure; cadastral-map closure under Resolution 564):
- **Include:** generic residential/commercial massing, roof shapes, terrain, trees, rivers, publicly-known
  civic landmarks.
- **Keep coarse:** exact building heights near sensitive sites — do not exceed the fidelity a tourist photo
  already reveals.
- **Exclude entirely (per-city exclusion mask):** military installations, air-defense sites, checkpoints,
  and critical infrastructure (power substations, key bridges as targets).
- **Archival/pre-war imagery ONLY** for reconstruction; never fresh UAV/aerial capture (illegal under
  martial law).
- **Never publish real-time or precise positions;** carry the existing reduced-pin-precision policy onto
  the enrichment layer.
- **Respect Article 114-2:** no depiction/derivation of Armed Forces positions or air-defense activity.
- **Dual-use note:** document that all inputs are public + pre-existing; mitigate residual risk by excluding
  sensitive geometry and coarsening precision.

---

## What the report explicitly says NOT to do
Cesium ion Community hosting (non-commercial) · FABDEM (CC-BY-NC-SA) · Google/EUBUCCO/JRC/Nearmap/Blackshark
for Dnipro (excluded or unfit) · fresh aerial/UAV capture (illegal) · whole-city splatting (not mobile-viable)
· depending on the 2019 ortho WMS (unclear wartime license).

---

## Pointers
`DNIPRO_3D_ENRICHMENT_RESEARCH_RESULTS.md` (the full cited report + source appendix) ·
`DNIPRO_3D_ENRICHMENT_RESEARCH_PROMPT.md` (the brief) · `RENDERING_QUALITY_PASS.md` (Pass 1/2/3 — Slice 5
feeds Pass 3) · `mem:project/wip-2026-07-13-dnipro-enrichment-research` · `mem:patterns/globe-rendering` +
`mem:patterns/sky-bodies-terrain` (current buildings/terrain pipeline the bake extends) ·
`mem:project/wip-2026-07-12-rendering-pass2-dnipro-identity` (R4 reframed here).
