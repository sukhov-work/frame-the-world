# Enriching the 3D Fidelity of Dnipro for "Frame the World": A Decision Report

The single best $0 move is an offline bake pipeline that reconstructs roof-shaped LOD2 buildings from Overture/OSM footprints, drapes them on a free open DEM, tiles them to 3D Tiles, and self-hosts them on Cloudflare R2 — replacing the flat LOD1 Cesium OSM Buildings inside a Dnipro bounding box; hero-landmark Gaussian splats built from archival photos are the highest-fidelity free add-on for in-camera realism. Everything below is ranked by in-camera payoff, then license/cost, then integration effort.

## TL;DR
- **Buildings (biggest lever):** Bake footprints + inferred heights into roof-shaped LOD2 geometry with 3dfier/City4CFD → CityJSON → 3D Tiles (py3dtiles/pg2b3dm), self-hosted on Cloudflare R2. Zero data cost; the binding constraint is ODbL share-alike (you must publish the derived building database under ODbL, but this does **not** block your paid marketplace).
- **Detailed meshes (highest fidelity, weighted most):** Reconstruct 5–15 hero landmarks as 3D Gaussian splats from **existing/archival** photos (COLMAP + gsplat/Brush), stream into three.js via Spark or mkkellogg GaussianSplats3D. Whole-city splatting is not feasible on mobile; a curated landmark set is. Zero data cost, owned-GPU compute only.
- **Terrain & trees:** Bake a quantized-mesh from **Copernicus GLO-30** (free & open) — **not** FABDEM, which is non-commercial. Add instanced trees from ETH/Meta canopy-height rasters (CC-BY). Use reconstructed building + tree geometry (not a coarse 30 m DSM raster) as the fine obstruction surface for sun/moon skyline-occlusion prediction.

## Key Findings

### Coverage verified over Dnipro (48.46°N, 35.04°E)
- **Overture / OSM building footprints:** present (local extract: 85,802 buildings), but only ~3% carry `roof:shape` and under 10% carry any height. Overture's only bulk height enrichment is US-only USGS 3DEP lidar, so heights over Dnipro must be **inferred**, not read. VERIFIED (footprints/coverage); INFERRED (exact local counts are your own extract, consistent with Overture's published "<10% globally have height").
- **EUBUCCO and JRC Digital Building Stock Model (DBSM):** both **exclude Ukraine** — EUBUCCO covers EU-27 + Norway/Switzerland/UK; DBSM covers EU-27 only. Genuine negative finding: neither is usable for Dnipro. VERIFIED.
- **Google Open Buildings:** does **not** cover Europe/Ukraine (Africa, South/SE Asia, Latin America, Caribbean only). Dead for Dnipro. VERIFIED.
- **Microsoft Global ML Building Footprints:** covers Ukraine (~2.0 GB, 288 files for Ukraine), ODbL/CDLA-Permissive-2.0. Footprints + some ML height estimates (height estimates are heavily US-weighted in recent releases). VERIFIED.
- **Copernicus GLO-30 DEM (30 m DSM, free & open):** covers Ukraine. Ukraine was **never** on the restricted list; only Armenia and Azerbaijan were restricted in older releases, and all were released in the 2023_1 release (24 Jul 2024). Attribution-only license. VERIFIED.
- **ALOS AW3D30 (30 m, free):** global, covers Dnipro; JAXA. Alternative/infill DEM. VERIFIED.
- **FABDEM (30 m bare-earth DTM):** global, covers Dnipro, best-in-class bare-earth accuracy — but the University of Bristol/Fathom dataset page states verbatim: *"The FABDEM dataset is licensed under a Creative Commons 'CC BY-NC-SA 4.0' license... This is a non-commercial and ShareAlike license... FABDEM may not be used for commercial purposes,"* with commercial queries directed to fabdem@fathom.global. **LICENSE TRAP — do not use in a commercial app.** VERIFIED.
- **ETH Global Canopy Height (10 m, CC-BY-4.0)** and **Meta/WRI 1 m canopy height (CC-BY)**: both global, cover Dnipro, usable for instanced trees + occlusion surface. VERIFIED.
- **Mapillary street-level imagery:** present in Dnipro via an active Ukrainian community, but density/recency unverified; CC-BY-SA (faces/plates auto-blurred). KartaView/Panoramax: no documented systematic Dnipro coverage. Yandex has proprietary Dnipro panoramas (not usable). VERIFIED (license/presence); UNVERIFIED (density).
- **Dnipro city geoportal (kadastr.apu.dp.ua):** publishes a **2019 orthophoto via WMS**; data.dniprorada.gov.ua content is CC-BY-4.0. National NSDI (nsdi.gov.ua) is restricted to government/local-authority access during martial law. **No open 3D building model (LOD1/LOD2/mesh) exists for Dnipro from any city, national, or EU source** — only 2D ortho + footprints. VERIFIED.
- **Google Photorealistic 3D Tiles:** still no Dnipro coverage; ToS still forbids styling/derivation. Confirmed dead (no change). VERIFIED.
- **Blackshark.ai SYNTH3D:** global synthetic 3D, but it is a commercial/partner product streamed from their servers or via an Unreal plugin, with geo-typical (not true-to-life) buildings and **no free self-hostable tier**. Not a fit for a free, three.js, true-to-life app. VERIFIED.
- **Nearmap / Maxar Precision3D-Vricon / Airbus / Hexagon / Aerometrex / CyberCity3D:** commercial, quote-only. Nearmap covers only the US, Canada, Australia, and New Zealand (Wikipedia: "up to 95% of Australia's population, 87% of the United States population, 75% of the New Zealand population, and 66% of Canada's population") — **no Ukraine coverage**. None confirmed to hold Dnipro in any free tier. Out of reach under the free ceiling. VERIFIED (Nearmap coverage); UNVERIFIED (others' Dnipro catalog — assume absent).

### Wartime legality & ethics (first-class)
- Ukraine's civilian airspace has been closed by NOTAM since 24 Feb 2022; civilian drone flights require military authorization under martial law. **Fresh UAV/aerial capture in Dnipro is effectively unavailable to a civilian** — reconstruction must use existing/archival imagery.
- Under **Article 114-2 of the Criminal Code of Ukraine** (added by Law No. 7189, adopted 24 Mar 2022): photographing Armed Forces positions is punishable by 3–5 years; **publishing/disseminating** such materials raises the term to **5–8 years**, and 8–12 years if done by a group or to aid the aggressor state. A civilian 3D city tool must exclude military and critical-infrastructure geometry.
- Ukrainian authorities advised all geospatial data owners to stop publishing/disseminating geodata via geoportals to prevent database breaches; the public cadastral map (map.land.gov.ua) was closed under Cabinet of Ministers Resolution No. 564 ("Some issues of maintaining and functioning of the State Land Cadastre under martial law," dated 7 May 2022) from the introduction of martial law.

## Details by Axis

### A. Building geometry & massing
No open LOD2 CityGML exists for Dnipro (unlike the Netherlands' 3DBAG, Germany, or Japan's PLATEAU). The clean free path is **reconstruction, not a ready-made model**:
- **Footprints:** Overture (ODbL, GeoParquet on AWS/Azure, carries a stable GERS ID and provenance) is the primary source; Microsoft ML footprints (ODbL/CDLA) are the fallback where OSM is thin.
- **Heights (the gap):** under 10% of buildings globally have an OSM height tag, and Overture adds bulk heights only from US-only USGS 3DEP lidar. Over Dnipro, derive heights from `building:levels` × ~3 m where present, then fall back to Microsoft ML height estimates and class-based defaults. Google's Open Buildings 2.5D height raster would help but is Global-South-only — not available for Dnipro.
- **Ready-made 3D models:** Cesium ion's free assets (Japan PLATEAU, Cesium OSM Buildings) hold nothing Dnipro-specific beyond your current baseline; Blackshark SYNTH3D is commercial. Nothing free clears the bar here.
- **Gaussian splatting / NeRF for landmarks (weighted heavily):** the single most photoreal free technique. COLMAP (BSD) does Structure-from-Motion from unordered internet photo collections (the "Building Rome in a Day" lineage; ~21K photos reconstructed central Rome). gsplat/Brush/Postshot train the splats; export to compressed `.spz`/`.sog`. Streaming into three.js is mature: **Spark** (WebGL2, LOD streaming via its `.RAD` format, multiple splat objects in one scene, formats ply/spz/sog/splat/ksplat), **mkkellogg GaussianSplats3D** (`.ksplat`), and **CesiumJS 3D Tiles 1.1 Gaussian splat tiling** (added 2025). The Reall3d viewer reports a 150M-point scene at 60 FPS desktop, 30 FPS on an iGPU laptop, and 25–40+ FPS on modern phones. Whole-city splats are not feasible on sub-M3/mobile budgets; **5–15 hero-landmark splats (each tens of MB compressed) are**. If a triangle mesh is needed for occlusion math, extract it with SuGaR/2DGS/GOF.

### B. Terrain & elevation (DTM vs DSM)
Use two conceptual layers:
- **Smooth cinematic base:** bake a quantized-mesh from **Copernicus GLO-30** (free & open, attribution-only) or **ALOS AW3D30**. Avoid FABDEM despite its superior bare-earth accuracy — its CC-BY-NC-SA license bars commercial use.
- **Occlusion & event prediction:** GLO-30 is a DSM (includes buildings/vegetation) but at 30 m is far too coarse to answer "will the moon clear *that* rooftop at 21:14?". The correct design is to let the **reconstructed LOD2 building geometry + instanced trees** provide the fine obstruction surface for the ephemeris occlusion test, using the 30 m DEM only for ground relief. Feed terrain into `3d-tiles-renderer` as quantized-mesh baked with `cesium-terrain-builder`/`ctb-quantized-mesh` to a static CDN. Flag: 30 m relief limits riverbank/ravine fidelity along the Dnipro River.

### C. Landscape & landcover
Trees are a real FPV/occlusion lever. Combine **ETH Global Canopy Height (10 m, CC-BY-4.0)** and/or **Meta/WRI 1 m canopy height (CC-BY)** with OSM `natural=tree` points and `landuse` polygons to place three.js `InstancedMesh` low-poly trees or billboard impostors, and to build the occlusion surface. ESA WorldCover (10 m) / Copernicus land cover classify vegetation/water/built for placement rules. The Dnipro River (the defining feature) uses OSM/Overture water polygons draped on terrain.

### D. Imagery / textures
Current Esri z19 (~0.3 m) is adequate; not the bottleneck. The Dnipro 2019 city orthophoto is a WMS service (not tiles) with unclear wartime licensing — do not depend on it. Sentinel-2 (10 m, free) is too coarse for street level. Keep the current ortho.

### E. Ukraine/Dnipro open sources
Dnipro runs an ArcGIS urban-planning cadastre geoportal (kadastr.apu.dp.ua) with a 2019 orthophoto WMS; data.dniprorada.gov.ua is CC-BY-4.0. National NSDI restricted to government during martial law; public cadastral map disabled since 24 Feb 2022. The OSM-Ukraine community is active. No open 3D building model exists for Dnipro.

### F. Wartime legality & ethics
See Key Findings. The app's existing reduced-pin-precision policy is the correct posture; extend it to the enrichment layer (guardrail checklist below).

### G. Reconstruction techniques — ranked by in-camera silhouette accuracy per unit effort
1. **Footprints + heights → LOD1/LOD2 with roofs** via 3dfier (TU Delft, straight-skeleton), City4CFD, or a straight-skeleton roofer → CityJSON. Best city-wide bang per unit effort; bake once. (CityGML tooling: citygml-tools, cjio, val3dity for validation.)
2. **Gaussian splats of hero landmarks from archival photos** (COLMAP + gsplat) — highest photoreal fidelity, but per-landmark labor and dependent on photo availability.
3. **Photogrammetric mesh from archival imagery** (COLMAP MVS / OpenDroneMap / Meshroom / RealityCapture free tier) — heavier and noisier from uncontrolled photos.
Satellite-stereo DSM: no free open stereo pairs over Dnipro confirmed; out of reach.

### H. Integration & hosting into the existing stack
- **Conversion to 3D Tiles:** py3dtiles (Apache-2.0), pg2b3dm (PostGIS → b3dm; supports CityGML via 3DCityDB v5 and per-feature material shaders), CesiumGS 3d-tiles-tools, or OSM2World (direct OSM → glTF/3D-Tiles with Simple-3D-Buildings roof shapes and PBR). DRACO is already in your stack; add KTX2/Basis + meshopt for textures. Hero splats → Spark or mkkellogg.
- **Hosting:** **Cesium ion Community is free but non-commercial/non-government only** — Cesium's docs confirm it gives "5 GB of storage" and 15 GB monthly streaming; the paid Commercial Individual tier starts at **$149/month ($1,788/yr)** with 50 GB storage / 150 GB streaming. Because "Frame the World" has a paid marketplace, **do not host tilesets on ion Community.** Self-host static 3D Tiles on **Cloudflare R2** (zero egress fees, 10 GB free tier), Pages, GitHub Pages, or jsDelivr — outside Wix (the Wix backend is thin and cannot host tilesets).
- **Size estimate:** an 85,802-building LOD2 Draco-compressed b3dm/glb tileset at roughly 1–4 KB/building lands on the order of **0.1–0.3 GB**, comfortably inside R2's free tier.
- **Blending with the global fallback:** hide Cesium OSM Buildings inside the Dnipro bbox (tileset masking / priority) and render the enriched local tileset on top.
- **Bake step:** a Node/Python script fetches sources into `public/data/`, runs reconstruction + tiling, and uploads to R2 — the preferred offline pattern over runtime heavy-lifting.

### I. The generic, replaceable per-city pipeline
Provider interface: `{ buildings, terrain, vegetation, splatLandmarks }`, each an adapter behind a common contract, tunable and swappable. A per-city config drives the bake:

```
city: dnipro
bbox: [35.00, 48.42, 35.10, 48.50]
buildings:  { source: overture, heightFallback: [osmLevels, msHeights, classDefault], roofs: 3dfier }
terrain:    { source: cop-glo30, format: quantized-mesh }
vegetation: { source: eth-canopy-10m, model: instanced-impostor }
splatLandmarks: [ { id: menorah-center, sources: archival }, ... ]
exclusionMask: military_critical_infra.geojson
quality: { mobile: lod1.3, desktop: lod2 }
```
Bake command shape: `bake --city dnipro --out r2://tiles/dnipro`. **Global-drop-in layers:** Overture buildings, GLO-30 terrain, canopy height (just point at coordinates). **Per-city-curated:** landmark splats, height cleanup, and the military/critical-infrastructure exclusion mask. Onboarding city #2 = write a new config, run the bake, publish under ODbL.

## Master Comparison Table

| Candidate | Layer | Dnipro coverage (verified?) | Fidelity/LOD | Format | License | Cost | Integration effort | Freshness | Wartime/legal note |
|---|---|---|---|---|---|---|---|---|---|
| Overture buildings | Buildings | ✅ footprints; <10% heights | LOD0 footprint + attrs | GeoParquet | ODbL (share-alike) | $0 | Med (bake) | Monthly | Footprints benign; exclude sensitive |
| Microsoft ML footprints | Buildings | ✅ (~2.0 GB UA) | Footprint + some ML height | GeoJSON/CSV | ODbL/CDLA | $0 | Med | Periodic | Benign |
| Google Open Buildings | Buildings | ❌ not Europe | — | — | CC-BY/ODbL | $0 | — | — | N/A |
| EUBUCCO | Buildings | ❌ EU-27+NO/CH/UK | LOD1 (heights) | GeoPackage/CSV | mostly ODbL | $0 | — | Static | Excludes UA |
| JRC DBSM | Buildings | ❌ EU-27 only | 2.5D | GeoParquet | EU open | $0 | — | 2025 | Excludes UA |
| Blackshark SYNTH3D | Buildings+terrain | ✅ (geo-typical) | Synthetic, not true | 3D Tiles (hosted) | Commercial | Quote | Low but paid | Continuous | Not true-to-life; not free |
| Nearmap / Maxar / Airbus / Hexagon | Photoreal mesh | ❌ (Nearmap US/CA/AU/NZ) | LOD2-3 mesh | Proprietary | Commercial | Quote | — | Varies | Out of reach |
| **Gaussian splats (COLMAP+gsplat)** | Landmark mesh | ✅ if archival photos exist | Photoreal | .spz/.sog/.ksplat | Your own (photos vary) | $0 (GPU) | High/landmark | On-demand | Use archival only; no fresh capture |
| Copernicus GLO-30 | Terrain (DSM) | ✅ | 30 m | COG/quantized-mesh | Free & open (attrib) | $0 | Low-Med | 2011–15 base | Benign |
| ALOS AW3D30 | Terrain (DSM) | ✅ | 30 m | GeoTIFF | Free (attrib) | $0 | Low-Med | Periodic | Benign |
| FABDEM | Terrain (DTM) | ✅ | 30 m bare-earth | GeoTIFF | **CC-BY-NC-SA** | $0 non-comm | — | V1-2 | **NC trap — reject** |
| ETH canopy height | Vegetation | ✅ | 10 m | GeoTIFF | CC-BY-4.0 | $0 | Med | 2020 | Benign |
| Meta/WRI canopy | Vegetation | ✅ | 1 m | GeoTIFF | CC-BY | $0 | Med | 2018–20 | Benign |
| ESA WorldCover | Landcover | ✅ | 10 m | GeoTIFF | CC-BY-4.0 | $0 | Low | 2020/21 | Benign |
| Mapillary | Imagery (SfM input) | ⚠️ sparse | Street-level | JPEG/API | CC-BY-SA | $0 | Med | Crowd | Auto-blurred; benign |
| Esri z19 (current) | Imagery drape | ✅ | ~0.3 m | Tiles | Basemap terms | $0 | In place | Varies | Keep |

## The Three Recommended Stacks (all $0 data cost)

**(a) MINIMAL / drop-in (no bake).** Overture/Microsoft footprints extruded by OSM `building:levels` + GLO-30 terrain quantized-mesh + canopy-height instanced trees. No roof shapes. Marginally better than baseline (adds terrain relief + trees). Compute: negligible. Use only as a stopgap.

**(b) BAKED — the expected default.** Footprints + inferred heights → 3dfier/City4CFD LOD2 with real roofs → CityJSON → py3dtiles/pg2b3dm 3D Tiles on Cloudflare R2; GLO-30 quantized-mesh terrain; ETH/Meta instanced trees; Cesium OSM Buildings hidden inside the Dnipro bbox. This is the recommended production stack: real roof-lines and heights fix the silhouette for FPV alignment and give the ephemeris test a usable obstruction surface. Compute: a few CPU-hours; storage ~0.1–0.3 GB (free-tier).

**(c) MAXIMAL / bespoke.** Stack (b) + 5–15 hero-landmark 3D Gaussian splats from archival photos (COLMAP + gsplat → `.spz`), streamed via Spark. Delivers the most true-to-life in-camera geometry at signature viewpoints. Compute: owned-GPU training per landmark; each splat tens of MB. Dependent on archival photo availability.

## Integration Plan for the Top Recommendation (Stack b)

1. **Extract:** Query Overture buildings for the Dnipro bbox from AWS S3 with DuckDB → GeoParquet; conflate Microsoft footprints where OSM is sparse.
2. **Heights:** Compute `height = levels × 3.0` where `building:levels` exists; else Microsoft ML height; else class default. Store per-feature.
3. **Roofs:** Run 3dfier (or City4CFD) with GLO-30 as the height reference to produce LOD2 CityJSON with straight-skeleton roofs; validate with val3dity.
4. **Tile:** Load CityJSON into 3DCityDB (PostGIS), run `pg2b3dm` (Draco on, per-class material shaders) → 3D Tiles 1.1 glb/b3dm. Alternatively py3dtiles direct from geometry.
5. **Terrain:** Download GLO-30 COG tiles for the bbox; `ctb-quantized-mesh` → static quantized-mesh tileset.
6. **Trees:** Rasterize ETH/Meta canopy height + OSM tree points → instanced-tree placement JSON consumed at runtime as three.js `InstancedMesh`.
7. **Host:** Upload all tilesets to Cloudflare R2; serve via public bucket URL with CORS.
8. **Client:** Point `3d-tiles-renderer@0.4.x` at the R2 tileset; mask Cesium OSM Buildings inside the bbox; keep DRACO decoder; add KTX2/meshopt. WebGL2 primary, WebGPU progressive.
9. **Perf:** Target <150 MB resident on mobile via LOD; the 3d-tiles-renderer handles streaming/unloading. Benchmark FPS on a sub-M3 laptop and mid-range phone before shipping.

## Wartime Guardrail Checklist (civilian/defensive framing)
- **Include:** generic residential/commercial massing, roof shapes, terrain, trees, rivers, publicly known civic landmarks.
- **Keep coarse:** exact building heights near sensitive sites; do not exceed the fidelity a tourist photo already reveals.
- **Exclude entirely:** military installations, air-defense sites, checkpoints, and critical infrastructure (power substations, key bridges as targets) — maintain a per-city exclusion mask.
- **Use archival/pre-war imagery only** for any reconstruction; never commission or use fresh UAV/aerial capture (illegal under martial law).
- **Never publish real-time or precise positions;** keep the existing reduced-pin-precision policy and apply it to the enrichment layer.
- **Respect Article 114-2:** no depiction/derivation of Armed Forces positions or air-defense activity.
- **Dual-use note:** even from open data, a highly detailed 3D model of an active-conflict city carries some dual-use risk; mitigate by excluding sensitive geometry, coarsening precision, and documenting that all inputs are public and pre-existing.

## Recommendations (staged, with thresholds)
1. **Ship Stack (b) for Dnipro now.** It is the highest ratio of in-camera payoff to effort at $0. Threshold to escalate: if FPV silhouette alignment error exceeds ~1–2 building-heights at hero viewpoints, add landmark splats (move to Stack c).
2. **Adopt ODbL compliance immediately:** publish the derived building tileset under ODbL with attribution ("Contains information from Overture Maps / © OpenStreetMap contributors, ODbL"). This satisfies share-alike; your marketplace (a "Produced Work"/service interaction) is unaffected because conveying a copy of the *database* is what triggers share-alike, not running a web service against it.
3. **Never use FABDEM in production** (CC-BY-NC-SA). Use GLO-30 or AW3D30.
4. **Do not host on Cesium ion Community** (non-commercial only). Self-host on R2.
5. **Build the per-city config + bake command first**, so Dnipro is instance #1 of a repeatable pipeline, not a one-off. Threshold to templatize further: once city #2 onboards in under a day of config-only work, freeze the adapter interface.
6. **For splats, first audit archival photo availability** (Wikimedia Commons, Flickr, Mapillary, pre-war tourism footage) per landmark before committing GPU time.

## Risks, Open Questions, and What Could Not Be Verified
- **Mapillary/archival photo density in Dnipro is unverified.** Landmark-splat feasibility (Stack c) hinges on it; audit before committing.
- **30 m terrain limits riverbank/ravine and fine-relief fidelity** along the Dnipro River — a hard ceiling without restricted/commercial data.
- **Building heights over Dnipro are inferred, not measured**, so absolute-height accuracy for event prediction will have meter-scale error; validate against known landmark heights.
- **ODbL share-alike on the derived building database is the binding legal constraint.** If any input carries a stricter clause (e.g. a CC-BY-SA or CC-BY-NC tile in a mixed dataset like EUBUCCO — moot here since it excludes Ukraine), it must be excluded.
- **Could not verify** whether Maxar/Airbus/Hexagon/Aerometrex hold Dnipro in any catalog; assume commercially available only via quote and out of scope under the free ceiling.
- **Dnipro 2019 orthophoto WMS licensing during martial law is unclear** — do not build on it without written terms.
- **CesiumJS 3D-Tiles Gaussian-splat tiling is new (2025)**; if you need splats *inside* the 3D-Tiles graph rather than as separate Spark objects, prototype it early to confirm `3d-tiles-renderer` compatibility.

## Source Appendix (grouped by axis; accessed 13 July 2026)

**A. Buildings**
- Overture buildings guide / schema / height concepts: https://docs.overturemaps.org/guides/buildings/ ; https://docs.overturemaps.org/schema/reference/buildings/building/ ; https://docs.overturemaps.org/schema/concepts/by-theme/buildings/
- Overture Jan 2024 release (USGS 3DEP US-only heights): https://overturemaps.org/overture-january-2024-release-notes/
- Overture license (CDLA/ODbL): https://registry.opendata.aws/overture/ ; https://overturemaps.org/about/faq/
- Overture height completeness ("<20% US, <10% globally"): https://openstreetmap.us/events/state-of-the-map-us/2023/building-heights-from-open-usgs-lidar-to-open-overture-maps/
- Microsoft Global ML Building Footprints (Ukraine ~2.0 GB / 288 files): https://tech.marksblogg.com/microsofts-global-ml-building-footprints.html ; https://github.com/microsoft/globalmlbuildingfootprints
- Google Open Buildings (not Europe): https://sites.research.google/gr/open-buildings/ ; https://atlas.co/data-sources/google-open-buildings/
- EUBUCCO (EU-27+NO/CH/UK): https://eubucco.com/ ; https://www.nature.com/articles/s41597-023-02040-2 ; https://zenodo.org/records/7225259
- JRC DBSM (EU-27): https://data.jrc.ec.europa.eu/dataset/a601a4a8-9289-4fc4-983a-25d54f957f3a
- Blackshark SYNTH3D: https://blackshark.ai/tech/page/2/ ; https://www.geoweeknews.com/news/a-new-plugin-brings-geospatial-3d-datasets-to-unreal-engine-5
- Nearmap coverage: https://en.wikipedia.org/wiki/Nearmap

**B. Terrain**
- Copernicus GLO-30 (free & open; restricted list): https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM ; https://registry.opendata.aws/copernicus-dem/ ; https://docs.digitalearthafrica.org/en/latest/data_specs/COP_DEM_specs.html
- GLO-30 license text: https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf
- FABDEM (CC-BY-NC-SA): https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn ; https://gee-community-catalog.org/projects/fabdem/
- cesium-terrain-builder / quantized-mesh context: https://cesium.com/learn/ion/optimizing-quotas/

**C. Vegetation/landcover**
- ETH Global Canopy Height (CC-BY-4.0): https://langnico.github.io/globalcanopyheight/ ; https://gee-community-catalog.org/projects/canopy/
- Meta/WRI 1 m canopy (CC-BY): https://registry.opendata.aws/dataforgood-fb-forests/

**E. Ukraine/Dnipro sources**
- Public cadastral map closure (Resolution 564; closed 24 Feb 2022): https://www.bulletin-esgeograph.org.ua/esg/article/view/92-ivanenko-114-123 ; https://www.gim-international.com/content/article/cadastre-in-wartime
- StateGeoCadastre / NSDI: https://eurogeographics.org/member/state-service-of-ukraine-for-geodesy-cartography-and-cadastre-stategeocadastre/ ; https://ggim.un.org/country-reports/documents/Ukraine_National_Report_2023.pdf

**F. Wartime legality**
- Drone/airspace closure & martial law: https://dronesgator.com/drone-laws-in-ukraine ; https://ts2.tech/en/kyivs-drone-law-crackdown-2025-guide-to-permits-no%E2%80%91fly-zones-wartime-rules/
- Reporting restrictions / air defense: https://www.reportingukraine.guide/martial-law
- Regulation of drones (LOC): https://maint.loc.gov/law/help/regulation-of-drones/ukraine.php

**G. Reconstruction**
- 3dfier / City3D / City4CFD (TU Delft): https://github.com/tudelft3d ; https://github.com/tudelft3d/City3D
- 3DBAG LoD2/LoD1 method + 3D Tiles viewer: https://arxiv.org/pdf/2201.01191
- COLMAP SfM (internet photo collections): https://colmap.github.io/ ; https://demuc.de/papers/schoenberger2016sfm.pdf
- Gaussian splat viewers (Spark, mkkellogg, Reall3d, CesiumJS): https://sparkjs.dev/ ; https://github.com/sparkjsdev/spark ; https://github.com/mkkellogg/GaussianSplats3D ; https://github.com/reall3d-com/Reall3dViewer ; https://www.worldlabs.ai/blog/spark-2.0 ; https://swyvl.io/blog/best-gaussian-splat-viewers/

**H. Integration & hosting**
- OSM2World (OSM→glTF/3D-Tiles, S3DB roofs): https://www.osm2world.org/ ; https://github.com/kiselev-dv/osm-cesium-3d-tiles
- py3dtiles / pg2b3dm / py3dtilers: https://pypi.org/project/py3dtiles/ ; https://github.com/Geodan/pg2b3dm ; https://geodan.github.io/pg2b3dm/dataprocessing/dataprocessing_citygml.html ; https://github.com/Oslandia/py3dtilers
- Cesium ion pricing/quotas (Community non-commercial, 5 GB/15 GB; Commercial $149/mo): https://cesium.com/platform/cesium-ion/pricing/ ; https://www.vendr.com/marketplace/cesium ; https://cesium.com/learn/ion/optimizing-quotas/

**Licensing**
- ODbL text/summary (share-alike, produced works): https://opendatacommons.org/licenses/odbl/1-0/ ; https://opendatacommons.org/licenses/odbl/summary/ ; https://en.wikipedia.org/wiki/Open_Database_License