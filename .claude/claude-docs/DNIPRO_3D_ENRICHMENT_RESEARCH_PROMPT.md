# Research Brief — Enriching Dnipro's 3D City & Landscape Fidelity

> **Purpose of this file:** a self-contained prompt to feed a web-research agent. It asks *where and how*
> to source more detailed, true-to-life 3D building models, terrain, and landscape features for **Dnipro,
> Ukraine**, in a **reliable, scalable, pluggable** way — Dnipro first, other cities later. The output is a
> **research report**, not code. Copy everything from "PROMPT BEGINS" down.
>
> **Owner-tunable scope levers** (edit these before feeding, then delete this note):
> - **Cost ceiling:** `free/open-only` · `≤ a few $100/mo` · `best money can buy — price is secondary`.
>   → *Default if unset:* cover the full spectrum but tier every option by cost + license.
> - **Fidelity target:** `better massing + roofs (LOD2)` · `photoreal mesh / splats` · `both, ranked`.
>   → *Default:* both, ranked by in-camera payoff per unit of effort.
> - **Build-effort appetite:** `drop-in data source only` · `willing to run an offline baking pipeline` ·
>   `willing to build a bespoke reconstruction/capture pipeline`. → *Default:* rank all three.

---

## PROMPT BEGINS

### Your role
You are a **senior geospatial-data research analyst**. Produce a rigorous, source-cited report that maps
the realistic options for **enriching the 3D fidelity of Dnipro, Ukraine** in a browser-based 3D globe
app, and lays out **how** to integrate each option. Optimize for decisions, not description: every option
must end in a recommendation with cost, license, coverage-over-Dnipro, integration effort, and risk.

### The mission, in one sentence
Find the best **reliable, scalable, and replaceable** way to get **more detailed and true-to-life 3D
buildings, terrain, and landscape features for Dnipro** — good enough to make **in-camera FPV shots and
photo alignment look real and to predict celestial/skyline events accurately** — with a design generic
enough to **swap the data source later** and **onboard other cities** the same way (Dnipro is instance #1).

### Product context (what this data feeds)
- A Wix-hosted, **client-heavy** web app ("Frame the World"). The user uploads a camera photo; the app
  extracts EXIF (GPS, focal length, heading, pitch, time) and **projects the photo as an oriented camera
  frustum + image plane at its real capture location on a stylized 3D globe with real buildings**. All 3D
  rendering happens **in the browser** (three.js). Wix is only a thin backend.
- The two use cases that make fidelity matter:
  1. **In-camera FPV & photo alignment** — the camera can drop to street level and sit *at the photo's own
     viewpoint and field of view*. The real skyline **silhouette, building heights, roof-lines, terrain
     relief, and even trees** must match what the photographer actually saw, so the uploaded photo lines up
     with the 3D scene. Occlusion accuracy (what blocks what) is the whole point.
  2. **Event prediction** — the app computes sun/moon/star positions (ephemeris) and shows where they rise
     /set/align **behind the real skyline**. This needs accurate **heights + terrain + surface obstructions
     (a DSM including buildings and vegetation), not just a bare-earth model**, to answer "will the moon
     clear that rooftop at 21:14?".
- "Current granularity is a fine **base truth**; I want to **enrich** it for the best, most realistic
  in-camera experience." So this is about **additive fidelity over a working baseline**, not a rebuild.

### Current data stack — the baseline to BEAT (do not re-recommend what we already run)
| Layer | Current source | Fidelity today | Gap |
|---|---|---|---|
| Buildings | **Cesium OSM Buildings** (Cesium ion asset 96188), streamed **3D Tiles** | **LOD1 flat-roof block extrusions** from OSM footprints + heights; one shared material | No roof shapes, no facades, missing/!wrong heights, no landmarks |
| Terrain | **Cesium World Terrain** (Cesium ion asset 1), quantized-mesh | ~global; ≈ tens-of-metres horizontal at Dnipro | Coarse near the ground; no fine relief, no riverbank/ravine detail |
| Imagery drape | **Esri World Imagery z19** + **CARTO dark** basemap | ~0.3 m ortho where available, graded/stylized | Seams at mid-zoom; not the bottleneck |
| Vector features | **OpenFreeMap** MVT (roads, waterways, water/green fills, street names) + **Natural Earth** | 2D metre-width ribbons + fills draped on terrain | No 3D vegetation, no trees as geometry |
| Engine | **three.js r185** + **`3d-tiles-renderer@0.4.x`** + `GlobeControls`; WebGL2 primary, WebGPU progressive; **`client:only` island in Astro 5** | Consumes **3D Tiles (b3dm / 1.1 glb), glTF, and quantized-mesh terrain**; **Cesium ion** account already wired (Community tier) | — |

Relevant local facts for Dnipro (from an OpenStreetMap/Overpass extract already done): **85,802 buildings,
only 2,568 with `roof:shape`, 1,766 with `building:part`** — i.e. OSM 3D richness is thin here, so any
approach that leans purely on OSM tags will look flat.

### Already investigated and REJECTED — do not re-propose without materially new evidence
- **Google Photorealistic 3D Tiles (P3DT):** verified to have **no coverage over Dnipro**, and its ToS
  forbids styling/derivation anyway. Dead for this app. (If you find this changed, that's a genuine finding.)
- **Overture Maps buildings via a Re:Earth-hosted 3D-Tiles endpoint:** the tileset parsed but **every glb
  content tile 500'd** server-side. (Overture *data itself* is still in scope — just not that hosted tiling.)
- **Flat per-building emissive "windows":** a rendering experiment, not a data question — out of scope.

### Hard constraints — every recommendation MUST satisfy these
1. **Client-side rendering.** Data must stream into **three.js via `3d-tiles-renderer`** (3D Tiles 1.0/1.1,
   glTF/glb, quantized-mesh) **or** be convertible to those. No server-side rendering. Mobile + sub-M3-laptop
   memory/perf budgets matter — flag anything that can't stream with LOD.
2. **Pluggable & replaceable.** Prefer a **data-source abstraction** (adapter per source, tunable, swappable)
   over a hand-built one-off. Dnipro = the first instance of a **repeatable per-city onboarding pipeline**.
3. **Licensing must be explicit and compatible** with a hosted commercial-ish web app (a small paid
   marketplace exists). State the license, attribution duty, redistribution/derivation rights, and cost for
   **each** source. Flag copyleft/share-alike (e.g. OSM ODbL), non-commercial-only, and research-only data.
4. **Wartime geo-sensitivity (Dnipro is an active-conflict city).** The app **already reduces public-pin
   precision** by policy. You must **explicitly research**: (a) which providers **restrict, blur, or
   embargo** high-resolution geospatial data over Ukraine; (b) **Ukrainian legal restrictions** on aerial
   /UAV survey, high-res mapping, and publication during **martial law** (and who authorizes exceptions);
   (c) the **ethical guardrails** so an enrichment layer for a civilian photography/astronomy tool does not
   become a targeting aid. Treat this as a first-class requirement, not a footnote. Keep the framing
   **defensive/civilian** throughout.
5. **Scalable to other cities** without bespoke per-city labor where possible — call out which options are
   "global, just point at coordinates" vs "requires per-city capture/curation".

### Research questions — cover ALL of these axes
Give each axis its own section. For every named source: **verify coverage over Dnipro specifically**
(48.46°N, 35.04°E — do not trust "global coverage" marketing), and give resolution/LOD, format, license,
cost, freshness/update cadence, and how it reaches three.js.

**A. Building geometry & massing (the biggest in-camera lever)**
- Open/vector-derived with heights: **Overture Maps buildings** (height/roof attributes + provenance),
  **Microsoft Global ML Building Footprints**, **Google Open Buildings** (verify Ukraine coverage — it may
  be Global-South-only), **EUBUCCO** and other EU building-stock+height datasets (verify whether Ukraine is
  included), **OSM building:levels/height** completeness for Dnipro, national **cadastre** footprints.
- Ready-made 3D city models: **CityGML / CityJSON LOD2/LOD3** for Dnipro or Ukraine (national/municipal
  open 3D programs?), academic 3D-city projects, Cesium ion asset marketplace, **Blackshark.ai** synthetic
  global 3D, **CyberCity3D**, and similar.
- Photogrammetric city meshes (commercial): **Maxar Precision3D / Vricon**, **Airbus**, **Hexagon HxGN**,
  **Nearmap** (verify Ukraine — likely US/AU/NZ/CA only), **Aerometrex**, **Bentley/Blom**, **Skyline
  PhotoMesh** outputs. For each: does Dnipro exist in their catalog, at what LOD, license, price, format.
- **NeRF / 3D Gaussian Splatting** for hero landmarks or districts: feasibility of capturing or
  reconstructing Dnipro landmarks from **existing** imagery/video (given wartime capture limits), tooling
  (nerfstudio, postshot, Luma, Polycam, gsplat), and **streaming splats into three.js** (e.g. spark,
  three-gaussian-splat, Luma web, PlayCanvas SuperSplat) — whole-city vs a few hero models.

**B. Terrain & elevation — and the DTM-vs-DSM distinction**
- Higher-res **DTM (bare earth)** and **DSM (surface, incl. buildings/trees)**: **Copernicus DEM GLO-30**,
  **FABDEM** (forest/building-removed DTM — check its license tier), **ALOS AW3D30** (free) vs **AW3D 5m/2m
  /0.5m** (commercial), **TanDEM-X** (90 m free / 12 m commercial), **SRTM/NASADEM**, **Airbus WorldDEM**,
  Maxar; any **Ukrainian national topographic / geodetic** elevation (Derzhheokadastr) or **LiDAR**.
- Explicitly recommend **which DSM/DTM to use for occlusion & event prediction** vs which for a smooth
  base, and how to feed it as quantized-mesh / heightmap into the renderer.

**C. Landscape & landcover (trees matter for FPV realism + occlusion)**
- Vegetation/tree canopy as data or geometry: **ETH Global Canopy Height (10 m)**, **Meta/WRI canopy**,
  ESA **WorldCover 10 m**, Copernicus land cover, **OSM `natural=tree`/`landuse`**, Overture landcover —
  and how to turn canopy-height + tree points into **instanced 3D vegetation** or an occlusion surface.
- Water bodies / riverbanks (the Dnipro river is a defining feature), land use, terraces/ravines.

**D. Imagery / textures (secondary — current ortho is adequate)**
- Better orthoimagery or texture sources for draping/texturing buildings: **Maxar, Nearmap, Bing, Sentinel-2,
  PlanetScope, national ortho** — only if they materially beat Esri z19 and are licensable. Keep brief.

**E. Ukraine- & Dnipro-specific open sources**
- National **NSDI / geoportal** of Ukraine, **public cadastral map** (Derzhheokadastr / land.gov.ua),
  **opendata.gov.ua**, **Dnipro city** open-data / GIS portals, OpenStreetMap-Ukraine community completeness,
  and any Ukrainian academic or commercial 3D-city-model efforts. Note access method, format, license,
  language, and current availability (some portals were taken down/restricted during the war — verify).

**F. Wartime legality, ethics & data availability (first-class — see constraint 4)**
- Which providers restrict/blur/embargo Ukraine high-res data; Ukrainian **martial-law** rules on aerial/
  UAV survey and high-res map publication; authorization paths; and a concrete **ethical guardrail list**
  for a civilian tool (what to include, what to keep coarse, how the existing reduced-precision policy
  helps). Cite the actual regulations/announcements where possible.

**G. Reconstruction / enrichment techniques (turn cheap data into better geometry)**
- **Footprints + heights → LOD1/LOD2 with roofs**: straight-skeleton roof reconstruction, **3dfier**
  (TU Delft), **OSM2World**, **Random3Dcity**, CityJSON tooling (**citygml-tools**, **cjio**, **val3dity**),
  QGIS/Blender/**BlenderGIS** workflows. What's the cleanest offline pipeline to bake Dnipro once?
- **Photogrammetry from imagery** (RealityCapture, Metashape, PhotoMesh) and **Gaussian-splat** pipelines —
  feasibility given wartime capture constraints (favor reconstruction from existing/archival imagery).
- Which technique gives the best **in-camera silhouette accuracy per unit of effort**.

**H. Integration & hosting path into the existing stack**
- For each top candidate, the concrete route to **three.js + `3d-tiles-renderer`**: converting CityGML/
  CityJSON/OBJ/glTF/LAS to **3D Tiles** (**Cesium ion self-tiling** — already wired; **CesiumGS 3d-tiles-
  tools**, **py3dtiles**, **tyler**), glTF for hero models (DRACO decoder already present), quantized-mesh
  for terrain. Where do tilesets **live** (Cesium ion hosting vs self-hosted static 3D Tiles on a CDN;
  note Wix Media file-size limits and that the backend is thin)? Client-side **memory/perf** budget and LOD/
  streaming behavior for each. An **offline "bake" step** (precedent: a Node script that fetches + packs
  data into `public/data/`) is acceptable and preferred over runtime heavy-lifting.

**I. The generic, replaceable per-city pipeline (the scalability deliverable)**
- Propose a **data-source abstraction / adapter design**: a small set of source "providers" (buildings,
  terrain, vegetation) behind a common interface, tunable and swappable, with **Dnipro as the first
  configured city** and a documented recipe to onboard a second city. Note which layers are global-drop-in
  vs per-city-curated.

### Evidence & quality bar
- **Cite every non-obvious claim** with a URL + the **access date**; prefer **primary sources** (provider
  docs, data-portal pages, license texts, academic papers, GitHub repos) over blogs/marketing.
- **Verify Dnipro coverage explicitly** — reject "global" claims you can't confirm at 48.46°N, 35.04°E.
- Give **real numbers**: resolution/LOD, price points (or "quote-only"), file sizes, update cadence.
- Distinguish **verified** vs **inferred** vs **unverified**; state confidence; list what you couldn't
  confirm as open questions.
- Flag every **license trap** (ODbL share-alike, non-commercial-only, research-only, no-derivatives).

### Ranking / decision criteria (weight in this order)
1. **In-camera payoff** for Dnipro — silhouette/height/roof/terrain accuracy for FPV alignment + event
   prediction. 2. **License permissiveness + cost.** 3. **Integration effort** into three.js/`3d-tiles-
   renderer` (+ client perf). 4. **Scalability & pluggability** to other cities. 5. **Freshness/updatability.**
   6. **Legal/ethical fit for wartime Ukraine.**

### Required deliverable format
1. **Executive summary** — the 3–5 highest-leverage moves for Dnipro, each one line with cost/license/effort.
2. **Master comparison table** — every candidate × {layer, Dnipro coverage (verified?), fidelity/LOD,
   format, license, cost, integration effort, freshness, wartime/legal note}.
3. **Three recommended "stacks"**, each a concrete buildings+terrain+vegetation combo with an integration
   sketch: **(a) free/open**, **(b) balanced (small budget)**, **(c) premium (price-secondary)**.
4. **Integration plan for the top recommendation** — data → conversion → hosting → `3d-tiles-renderer`,
   with the offline bake step and client-perf notes.
5. **The generic per-city pipeline** — the adapter/abstraction design + a "how to onboard city #2" recipe.
6. **Wartime legality & ethics** — findings + a concrete guardrail checklist.
7. **Risks, open questions, and what you could not verify.**
8. **Source appendix** — every URL with access date, grouped by axis.

## PROMPT ENDS


