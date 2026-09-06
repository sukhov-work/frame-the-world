# dnipro-enrichment/ — the Dnipro 3D fidelity workstream (entry point, 2026-09-06)

Start at **`DNIPRO_3D_ENRICHMENT_PLAN.md`** — the execution source of truth for enriching Dnipro's
buildings and terrain beyond flat Cesium OSM: the offline bake that reconstructs roof-shaped LOD2
buildings from OSM footprints, drapes them on a free DEM, tiles them to 3D Tiles and self-hosts them
on Cloudflare R2. **`OSM2WORLD_EXPERIMENT_PREP.md`** (2026-07-14) is fidelity tier 2 — the OSM2World
variant, investigated to the point of a ready-to-run spike.

The bake **shipped**: it is live for Dnipro (127k buildings over 20×20 km) and for the other baked
regions. Where these two files and the as-built docs disagree, the as-built wins — operations,
rulings and the registry contract live in `../BAKED_ASSETS.md`, the script detail in
`scripts/bake/README.md`, and the rendering side in `../rendering/RENDERING_ARCHITECTURE.md`.
Research provenance (the brief, the external report, the slice-0 spike) is in `../archive/`.

Standing owner memo 2026-09-02c: the **Dnipro slice comes first in any feature**.
