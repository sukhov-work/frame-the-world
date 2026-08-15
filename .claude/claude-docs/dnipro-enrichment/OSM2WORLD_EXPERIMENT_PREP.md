# OSM2World Experiment — Investigation & Preparation

**Date:** 2026-07-14 · **Mode:** research + design (investigate-design-v3 method: 3 parallel cited agents →
falsification-gated synthesis) · **Owner ask:** *"more realistic (and precise-to-real-world) buildings and
other 3D elements and constructions"* for Dnipro. This is the **fidelity tier 2** named in
`scripts/bake/README.md §Higher-fidelity tiers` — now investigated to the point of a ready-to-run spike.
Nothing here supersedes a locked ADR; it **extends** the Dnipro enrichment plan
(`DNIPRO_3D_ENRICHMENT_PLAN.md` Slice 1, "roof-fidelity upgrade path").

---

## TL;DR — verdict

**OSM2World is the right realism upgrade, and it drops into our existing pipeline more cleanly than
expected.** Three facts de-risk it:

1. **The coordinate frame aligns for (almost) free.** OSM2World's glTF writer negates Z, emitting
   POSITION = **(east, up, −north)** — *byte-identical* to our baker's `gv(e,n,u) = (e, u, −n)`
   (`scripts/bake/lib/buildings.mjs:181`). No rotation, no axis swap. [glTF writer `GltfOutput.java`
   z-negation; internal frame `VectorXZ`/`MetricMapProjection`] — **must confirm N/S handedness on one cell**
   (both external agents flagged this at ~75%; it's a 1-line Z-flip if ever wrong).
2. **Its default vertical model matches our runtime seating.** With no `srtmDir` set,
   `terrainInterpolator = ZeroInterpolator` (flat ground **Y=0**) and buildings sit at ground level →
   exactly what our "bake at ellipsoid h=0, clamp to Cesium World Terrain at runtime" (R1) assumes.
3. **The jar runs here today.** Java 21.0.7 ✓ (needs 17+); the distro is reachable
   (`osm2world.org/download/files/latest/OSM2World-latest-bin.zip` → **HTTP 200, 478 MB**, probed
   2026-07-14); Overpass + Geofabrik reachable (probed 200/302).

**What it buys us (the owner's headline):** every Simple-3D-Buildings **roof shape** OSM carries, plus
**walls/fences/hedges, bridges, tunnels, power lines + pylons, masts/chimneys, street furniture, retaining
walls, cliffs, piers** — real constructions our current footprint-extruder cannot produce.

**The one real cost:** OSM2World does not emit our `_FEATURE_ID_0` vertex attribute, so per-building tone
(`buildingMaterial.ts`) and per-building terrain re-seat (`enrichedBuildings.ts`) don't get free per-building
identity. It is **recoverable** (see §5 decision 1) via `keepOsmElements=true` + a labeling pass in our
adapter, or we accept per-cell granularity. Everything else (streaming, LRU, masking, per-cell re-seat,
trees, R2 hosting) is preserved because **we keep our own tileset writer and re-grid OSM2World's mesh into
our 10×10 cells** — we do **not** use OSM2World's own tile output.

**Recommended shape:** `convert` OSM2World → geometry-only stylized glb → **re-bin into our grid via a new
~150-line adapter that reuses `encodeGlb`/`buildTileset` unchanged**. Confidence to proceed to a spike: **high**.

> ✅ **PRODUCTION ADAPTER SHIPPED 2026-07-14 (browser-VERIFIED) — `bake-osm2world.mjs`, a PARALLEL
> variant on R2 with a `?enriched=` same-pose A/B seam; the default pipeline untouched. See §10.**
> ✅ **SPIKE DONE 2026-07-14 (browser-VERIFIED) — verdict VIABLE, green-light the full adapter. See §9.**
> All four DoD questions answered: axis `(east,up,−north)` confirmed (1362/1362 buildings land in-bbox),
> ground Y≈0 seats on CWT, per-building identity free via `extras.osmId`, and buildings-only MB/cell is
> tiny (max central cell 1.219 MB raw → **52 KB weld+draco**). §1–§7 below are the pre-spike investigation;
> §9 records the measured results + corrections (the distro is **0.5.0**, not 0.4.0 — CLI differs).

---

## 1 · What OSM2World gives us (capabilities — cited)

**Maturity / license.** Latest release **0.4.0 (2025-01-21)**, JRE 17+; actively developed (master is
0.5.0-dev, roof reworks landing mid-2026); **MIT-licensed software** (the OSM wiki's "LGPL" is stale),
default style + textures **CC0**. Output-data obligation is **ODbL from our OSM input** (attribution:
"© OpenStreetMap contributors") — same as today. [github.com/tordanik/OSM2World `LICENSE.txt`; `doc/changes.txt`;
osm2world.org/download]

**Roof shapes (Simple-3D-Buildings) — every shape OSM tags, and more.** `world/modules/building/roof/`:
Flat, Gabled, Hipped (+SideHipped), HalfHipped (+SideHalfHipped), Pyramidal, Skillion, Gambrel, Mansard,
Round, Dome, Onion, Cone, Saltbox, Sawtooth, Spindle, Complex, Chimney. Honors `roof:height`,
`roof:levels`, `roof:angle`, `roof:orientation`, `roof:direction`, `building:part` (multi-part buildings),
window/door geometry, and `building:colour`/`roof:colour`/`building:material`. Our current baker does
flat/gable/pyramid/hipped approximations only → this is the direct realism win.

**Other 3D elements ("constructions") — all ON by default, toggle via `excludeWorldModule`.**
`O2WConverterImpl.createModuleList`: Building, **Barrier** (walls/fences/hedges/retaining walls),
**Bridge**, **Tunnel**, **Power** (lines + pylons/towers), **Mast** (masts/chimneys), StreetFurniture
(benches/lamps/bollards/advertising), Road + Railway + Aeroway (surfaces, lanes, markings), Water (rivers/
riverbanks), Pool, Sports, Golf, **Cliff**, Parking, TrafficSign, SurfaceArea (land cover), ExternalModel,
Indoor, Tree. Disable classes with e.g. `excludeWorldModule = AerowayModule; IndoorModule; GolfModule`.

**Output formats.** glTF **2.0**, **glb first-class** (`GltfFlavor {GLTF,GLB}`), OBJ+MTL, POV, O2W.PBF,
OpenGL images; `.gz`/`.zip` suffixes honored. **No Draco / no meshopt / un-indexed / unwelded** geometry
(`GltfOutput.java`, in-code `TODO consider using indices`) → a `gltf-transform weld+draco` post-step is the
size lever. LOD 0–4 (default 4), one LOD per file.

**Textures / stylization.** The default style ships CC0 photo-PBR textures (why the distro is 478 MB).
**There is no `useTextures` boolean** — for our flat "dark mass, lit edges" look, pass a custom
`--config stylized.properties` whose materials are **color-only** (define `material_<NAME>_color`, omit
`material_<NAME>_texture0_dir`) + `useBillboards=false`. A textureless material emits a flat base-color glTF
material with no `TEXCOORD_0`.

---

## 2 · Critical integration facts (cross-verified, cited)

| Fact | Detail | Source | Confidence |
|---|---|---|---|
| **Up-axis + N/S** | glTF POSITION `(east, up, −north)` == our `(e,u,−n)`; local +Y = geodetic up | `GltfOutput.java` z-negation; `buildings.mjs:181` | 90% (verify 1 cell) |
| **Origin** | OSM2World origin = **data-bounds centre**, which ≈ our bbox centre **48.46/35.05** — free alignment; only georef in plain glTF is a non-standard `scene.extras.origin={lat,lon}` (no transform node / no CESIUM_RTC) | `O2WConverterImpl` `osmData.getCenter()`; `GltfOutput.writeJson` | 90% |
| **Projection** | `MetricMapProjection` = Mercator-metric, vs our **exact ENU** (`geo.mjs:projectEN`); over 7×9 km the planar residual is sub-metre→few-metre, absorbed by the runtime re-seat | `MetricMapProjection.java` | 80% (verify edge drift) |
| **Elevation** | default `terrainInterpolator=ZeroInterpolator` (flat Y=0) + `eleCalculator=BridgeTunnelEleCalculator` (buildings at ground, bridges/tunnels offset); **DEM opt-in only via `srtmDir`** → leave unset to keep ground=0 | `O2WConfig.terrainInterpolator/eleCalculator/srtmDir` | 90% |
| **Compression** | none — un-indexed, uncompressed; our own `encodeGlb` is also uncompressed, so re-emitting is contract-consistent | `GltfOutput.java`; `gltf.mjs` | 95% |
| **Security filter** | **no per-tag filter** — `excludeWorldModule` drops whole classes only; C6 military/critical-infra must be stripped from the **OSM input** upstream | `O2WConverterImpl` | 90% |

**We do NOT use OSM2World's native `tileset` exporter.** It exists (master-only) and bakes an ECEF
transform, but on its **own zoom-15 slippy scheme**, material-batched content (no per-building id), and
`asset.version "1.0"` — it does **not** match our per-cell 10×10 grid, which the runtime's per-cell terrain
re-seat, masking, and streaming/LRU all key on. Use `convert -o glb` + our re-grid instead.
[`output/tileset/TilesetOutput.java`; `TilesetCommand.java` `ZOOM=15`]

---

## 3 · The drop-in contract we must satisfy (from the codebase, `file:line`)

Our runtime (`scene/enrichedBuildings.ts`) + material (`scene/buildingMaterial.ts`) require, and our
existing bake writer already produces:

- **tileset.json:** root `transform` = ENU→ECEF at the bbox centre, **h=0** (`gltf.mjs:163`,
  `geo.mjs:enuToEcefMatrix`); root `geometricError` **512**, empty content, `refine:"ADD"`; leaves
  `geometricError` **0**, `content.uri = cell-<i>-<j>.glb` (`bake.mjs:154`); `boundingVolume.region` in
  **radians** with heights padded `[−80, maxH+80]` (`RESEAT_PAD_M`, `bake.mjs:141,160`).
- **Per-cell glb:** non-indexed **TRIANGLES**; attributes **POSITION** (+min/max), **NORMAL**,
  **`_FEATURE_ID_0`** (FLOAT SCALAR, one **contiguous run per building**, global ids) (`gltf.mjs:72-77`);
  no `_batchid` needed. `buildingMaterial.ts:141,149,185` reads `attribute float _feature_id_0` for R2
  per-building tone; `enrichedBuildings.ts:309` scans `featureRunsOf(fid.array)` for per-building re-seat.
- **Ground = 0:** all Y is relative metres above the cell plane; no absolute/orthometric Z anywhere
  (`buildings.mjs`, `geo.mjs`, manifest `seating:"runtime clamp-to-CWT"`).
- **Trees:** an `EXT_mesh_gpu_instancing` node **"ftw-trees"** per cell (TRS ~40 B/tree, `extensionsUsed`)
  (`gltf.mjs:99-111`). **Strip OSM2World's own trees** (`excludeWorldModule=TreeModule`) and inject ours —
  the runtime branches `isInstancedMesh` vs `isMesh` (`enrichedBuildings.ts:252,276`); OSM2World's plain-mesh
  trees would take the building material and miss night-dim + occlusion re-seat.

**Reusable unchanged for an OSM2World path** (Agent B, 93%): `gltf.mjs` (`encodeGlb`, `buildTileset`,
`regionRad` — source-agnostic: they take flat `positions/normals/featureIds` arrays), `geo.mjs` (frame math),
`exclusion.mjs` (`makeExcluder`/`DEFAULT_EXCLUDE_TAGS`/`pointInPolygon`, repurposed to filter input OSM),
`vegetation.mjs` (keep our instanced trees), `upload-r2.mjs` + the R2 Worker (already live).
**Must be new:** a `readGlb()` (inverse of `encodeGlb`) and a **triangle-binning adapter** replacing the
footprint aggregator/extruder (`buildings.mjs` + `bake.mjs:70-95`).

---

## 4 · The pipeline (ordered; runnable-here / blocked-here)

```
OSM extract (bbox)  →  C6 pre-filter  →  OSM2World convert → stylized geometry-only glb  →
  readGlb + re-bin into 10×10 grid (+ assign _feature_id_0, inject our trees)  →
  encodeGlb + buildTileset (REUSED)  →  [optional gltf-transform draco]  →  upload-r2 (LIVE)
```

1. **OSM extract for `[35.0,48.42,35.1,48.5]`.**
   - *Spike (zero install, runnable-here):* add a second Overpass query to `lib/overpass.mjs` that emits
     **`.osm` XML**: `[out:xml][timeout:180];(nwr(48.42,35.0,48.5,35.1);>;);out meta;` (the `>;` pulls
     referenced nodes; `out meta;` adds version/timestamp attrs OSM2World's XML reader wants). The bbox is
     ~7.4×8.9 km → a few MB. Reuses the existing mirror-cycling/backoff (`overpass.mjs:36-55`).
   - *Production (one install):* Geofabrik `ukraine-latest.osm.pbf` (probed 302→mirror; ~868 MB, daily) →
     `osmium extract --bbox 35.0,48.42,35.1,48.5`. OSM2World reads `.pbf` directly too.
2. **C6 pre-filter (BEFORE OSM2World — first-class, per the mask contract).** Drop the
   `DEFAULT_EXCLUDE_TAGS` set (`exclusion.mjs:9-19`: `military=*`, `landuse=military`,
   `building=military/bunker`, `building:use=military`, `power=substation/plant/generator/transformer`).
   - *Runnable-here:* a ~50-line Node XML pass over the `.osm` reusing `makeExcluder()` verbatim (preferred —
     reuses tested logic), or push negative filters into the Overpass query.
   - *Production:* `osmium tags-filter --invert-match --omit-referenced in.pbf military landuse=military
     building=military building=bunker power=substation power=plant power=generator power=transformer -o safe.pbf`.
   - *Polygon exclusion* (`config.exclusion.polygons`, empty for v1) needs a Node point-in-polygon pass
     (reuse `pointInPolygon()` `exclusion.mjs:22`) — tag-filters can't do spatial. Non-blocking now.
3. **OSM2World → stylized geometry-only glb (runnable-here).**
   `java -Xmx4g -jar OSM2World.jar --input safe.osm --output dnipro.glb --config stylized.properties`
   (0.4.0 legacy CLI: `--input/--output/--config`; master adds a `convert` subcommand — 0.4.0 suffices, we
   don't need the master-only `tileset` exporter). `stylized.properties`: color-only materials (no
   `_texture0_dir`), `useBillboards=false`, `createTerrain=false`, `renderUnderground=false`,
   `srtmDir` unset (ground=0), `keepOsmElements=true` + `exportMetadata=ID` (for identity, decision 1),
   `excludeWorldModule=TreeModule; IndoorModule; AerowayModule` (+ optionally Road/SurfaceArea — decision 3),
   `--lod 2`.
4. **THE ADAPTER (new, ~150 lines, runnable-here — the load-bearing piece).** `readGlb()` parses the glb
   (JSON chunk + BIN accessors — exact inverse of `encodeGlb`); bin each triangle into the 100 cells by
   centroid→lon/lat (reuse `Math.floor(((x−w)/(e−w))*grid)`, `bake.mjs:83-84`); accumulate each cell's
   `region` bbox + maxH from triangle verts; **assign a contiguous `_feature_id_0` run per OSM2World
   building node** (decision 1); inject our instanced trees per cell (`vegetation.mjs`); re-emit each cell
   via **the reused `encodeGlb` + `buildTileset`** so every leaf keeps its region volume + the shared
   ENU→ECEF root (what the per-cell re-seat / streaming / masking depend on).
5. **(Optional) compression (runnable-here, no install):** `npx @gltf-transform/cli@4.4.0 draco cell.glb`
   — a net-new size win (today's glbs are uncompressed).
6. **Upload (LIVE):** `node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro` → the Worker
   already serves it. A `tilesetVersion` bump (`cities/dnipro.json`) distinguishes the OSM2World bake.

---

## 5 · Owner decision forks

1. **Per-building identity — recover it or accept per-cell? (the main trade.)** OSM2World won't emit
   `_FEATURE_ID_0`, but with **`keepOsmElements=true`** it keeps geometry grouped per OSM element (split by
   material within an element), and **`exportMetadata=ID`** attaches the OSM id. So our adapter (step 4) can
   **stamp a contiguous `_feature_id_0` per OSM2World building node** — recovering per-building tone + re-seat
   without connected-component labeling. Inflating the *intermediate* glb doesn't hurt us: we re-merge into
   one soup per cell anyway, so our *final* per-cell size is unaffected. **Recommend: attempt recovery;
   fall back to per-cell tone/re-seat** (fine at the 10×10 grid — within-cell relief is the small residual
   the per-cell plane already handles). *Verify in the spike that the glb node structure preserves
   per-building grouping.*
2. **Textures — strip (stylized) or keep (realism)?** The C2 "accuracy AND beauty" tension. **Recommend
   strip for v1** (geometry-only ≈ today's 33 MB, matches the flat look; textured city output balloons to
   hundreds of MB — hostile to mobile <150 MB and R2). Keep textured OSM2World as an optional **realism
   tier** later, mirroring the off-by-default "realistic mode" pattern.
3. **Which modules?** The owner wants "buildings + other constructions" → keep **Building, Barrier, Bridge,
   Tunnel, Power, Mast, StreetFurniture, Cliff, Water**. **Exclude** `TreeModule` (we inject ours),
   `IndoorModule`, `AerowayModule`, `GolfModule`. **Open:** Road/Railway/SurfaceArea add heavy triangles and
   we already render a vector road/water web — **recommend excluding them initially** (revisit if the ground
   reads flat next to the 3D structures).
4. **Data source — Overpass-XML (spike) vs Geofabrik+osmium (production).** Overpass-XML for the first spike
   (nothing to install), graduate to PBF+osmium for reproducible production bakes + reliable tag-level C6.
5. **Single-tile vs re-grid — re-grid, decisively.** A single big glb loses per-cell region volumes → no
   frustum culling / streaming / LRU (whole city resident) and collapses per-cell re-seat to one bbox-centre
   lift (re-introducing the "all at water level" ±80 m class the per-cell re-seat fixed). Not mobile-viable.

---

## 6 · Tool availability (probed 2026-07-14)

| Tool | Here? | Get it | For |
|---|---|---|---|
| Java 21.0.7 | ✅ | — | run OSM2World (17+) |
| OSM2World jar | ❌ | `curl osm2world.org/download/files/latest/OSM2World-latest-bin.zip` — **200, 478 MB, runnable-here** | OSM→glb |
| Overpass | ✅ reachable | — (probed: 30 bldgs in a 200 m box) | `.osm` XML extract |
| Geofabrik UA PBF | ✅ reachable | 302→mirror, ~868 MB | production extract |
| osmium-tool | ❌ | `brew install osmium-tool` (bottled arm64, seconds) | bbox extract + tag C6 (production) |
| gltf-transform CLI | ❌ | `npx @gltf-transform/cli@4.4.0` — **no install** | draco/meshopt |
| node/npx | ✅ | — | adapter, upload |
| disk | ✅ 96 GB free | — | 478 MB distro + 868 MB PBF + outputs |

---

## 7 · Risks / unknowns (ranked)

1. **N/S handedness** — source says `(e,u,−n)` matches us, but confirm on 1 cell (a mirrored city is a
   1-line Z-flip). **Verify first.**
2. **Output size** — un-indexed/uncompressed + richer geometry (roofs/barriers/power) → could blow the mobile
   <150 MB / R2 budgets. **Measure MB/cell in the spike;** mitigate with LOD, module exclusion, gltf-transform.
3. **Identity vs size** (decision 1) — verify the glb preserves per-building node grouping.
4. **Mercator vs ENU edge drift** — sub-metre→few-metre over the bbox; verify no visible drift at edges.
5. **JVM heap** — no default `-Xmx`; a single large-extract `convert` can OOM. `-Xmx4g` estimate; raise or
   split by sub-bbox if needed.
6. **CLI/version** — 0.4.0 legacy CLI is stable for our glb path; avoid the master-only `tileset` exporter.

---

## 8 · The concrete de-risk spike (next session — "Slice 1.5")

A tight experiment that answers every risk before investing in the full adapter:

1. `curl` the OSM2World 0.4.0 jar; unzip.
2. Overpass-XML extract of a **~1 km² central-Dnipro** box → Node C6 filter (reuse `makeExcluder`).
3. Write a first `stylized.properties` (color-only materials, ground=0, keepOsmElements=true,
   exportMetadata=ID, exclude Tree/Indoor/Aeroway, LOD 2).
4. `java -jar OSM2World.jar --input safe.osm --output sample.glb --config stylized.properties`.
5. **Inspect** `sample.glb`: axis (does +Y = up, is N/S correct?), node structure (per-building grouping?),
   triangle count + bytes, material colors.
6. Prototype `readGlb()` + re-bin **one cell** → write `tileset.json` via the reused `buildTileset` →
   point `PUBLIC_ENRICHED_TILES_URL` at the local sample → `wix dev` → fly to Dnipro → **A/B vs the current
   bake** (roofs richer? seated correctly? size/cell acceptable?).
7. **DoD:** a written verdict on axis, seating, per-building-identity feasibility, and MB/cell — enough to
   green-light (or reshape) the full adapter. *This mirrors the successful Slice-0 spike discipline.*

---

## 9 · Spike results & verdict (2026-07-14 — "Slice 1.5", browser-VERIFIED)

**VERDICT: VIABLE — green-light the full adapter.** All four DoD questions answered; every ranked risk
resolved or quantified. Executed end-to-end HERE (jar → Overpass-XML extract → C6 → `convert` → inspect →
adapter → `wix dev` A/B). No tracked source changed → `astro check` 0/0 · vitest 513 unchanged. Spike
scaffolding (git-ignored) lives at `scripts/bake/spike-osm2world/`; **`readGlb.mjs` + `03-adapter.mjs` are
the proven seed of the real adapter.** Browser shots: `verify-shots/o2w-slice15-01..03`.

### DoD scorecard
| Question | Verdict | Evidence |
|---|---|---|
| **Axis + N/S handedness** | ✅ `(east, up, −north)` == our `gv(e,u,−n)` | Adapter re-bin: **north=−Z lands 1362/1362 (100%)** buildings inside our bbox; north=+Z lands **0**. `+Y` up: POSITION Y∈[−1, 70] m = building heights. Browser: river/bridge/street-grid geographically correct — not mirrored. The prep-doc's ~75% axis unknown is now **certainty**. |
| **Ground seating** | ✅ Y≈0, seats on CWT | min Y = −1.0 m ⇒ ground at 0 (matches bake contract h=0 + runtime clamp-to-CWT, R1). Browser @646 m & @276 m: building bases flush on the street grid, no float/sink. |
| **Per-building identity** | ✅ fully recoverable, free | `keepOsmElements=true` → one **named** node per element, each carrying `extras.osmId` (e.g. `"Building w294038853"`, `extras:{osmId:"w294038853"}`). Adapter filters `Building*` nodes → contiguous `_feature_id_0` run per building. No connected-component labeling needed (prep-doc §5.1 concern dissolved). |
| **MB/cell** | ✅ risk neutralized | Buildings-only re-bin = **2.91 MB / 21 cells**; densest cell (4,5) **1.219 MB** uncompressed vs the current baker's same cell **0.855 MB** (~1.4×). **weld + draco crushes cell 4,5 → 52 KB (23×).** Whole richer city draco'd ≈ a few MB — well under the mobile <150 MB budget. |

### Corrections to §2 / §4 / §6 / §8 (measured — supersede the pre-spike text)
- **The distro is `0.5.0-SNAPSHOT`, not 0.4.0**, and uses the **modern subcommand CLI** — §4/§8's
  `--input/--output` is WRONG for it. Working invocation (the `--add-exports` are mandatory on Java 21):
  `java --add-exports java.base/java.lang=ALL-UNNAMED --add-exports java.desktop/sun.awt=ALL-UNNAMED
  --add-exports java.desktop/sun.java2d=ALL-UNNAMED -Xmx4g -jar OSM2World.jar convert -i safe.osm -o out.glb
  --config stylized.properties --lod 2`.
- **Origin = data-bounds centre, and Overpass `>;` inflates it.** `scene.extras.origin` here = 48.5178977 /
  34.9481931 (NOT the box centre) because `>;` recurses whole long linear ways (roads/power) far outside the
  box → **raw glb bbox 200 km wide, and the raw 25.66 MB is ~89% roads/surfaces, not buildings.** Harmless:
  the adapter re-bases by the constant ENU offset `projectEN(osmOrigin, ourBasis)` = E −7521 / N +6443 m, and
  it means **you must measure buildings-only, never the raw file.**
- **No `_texture0_dir` ⇒ genuinely 0 textures/images** (color rides a `COLOR_0` attribute we drop). §1's
  "there is no useTextures boolean" workaround is a non-issue in 0.5.0 as long as you don't
  `include standard.properties`. Output is **non-indexed TRIANGLES, POSITION+NORMAL+COLOR_0**, one flat scene
  (node[0]="OSM2World scene" → children, **no per-node transforms** — all geometry in one frame).
- **`excludeWorldModule = Tree/Indoor/Aeroway` is not enough.** RoadModule/RailwayModule/SurfaceAreaModule are
  on by default and dominate bytes + extent. Either exclude them too, or — simpler, what the adapter does —
  **filter by node class**: keep `Building*` (+ chosen constructions), drop `Road*`/`Surface*` (we already
  render a vector road/water web).

### The "other constructions" the owner asked for — present + node-classified
Building 1362 · Road 1543 (+RoadJunction 739 / RoadCrossing 544 / RoadConnector 232) · **PoleFence 71 ·
Wall 23 · RetainingWall 4 · ChainLinkFence 3 · MobilePhoneMast 1 · StreetLamp 26 · BollardRow 7 ·
AreaFountain 3** · SurfaceArea 63 · Waterway 43 · SurfaceParking 19. Walls/fences/masts/lamps/fountains are
all real geometry, selectable per class in the adapter.

### Recommended shape for the full adapter (the Slice-1.5 → production step)
1. Promote `spike-osm2world/readGlb.mjs` → `scripts/bake/lib/readGlb.mjs` (tracked); build
   `scripts/bake/bake-osm2world.mjs` mirroring `bake.mjs`'s CLI + output, **reusing `encodeGlb`/`buildTileset`/
   `geo.mjs`/`vegetation.mjs` verbatim** (all confirmed source-agnostic this spike).
2. **Production extract** = Geofabrik `ukraine-latest.osm.pbf` → `osmium extract --bbox` → `osmium tags-filter
   --invert-match --omit-referenced` (reference-safe C6, vs the spike's node-drop simplification). OSM2World
   reads `.pbf` directly.
3. **Draco** is the size lever (23×): either wire a `DRACOLoader` into the enriched `GLTFExtensionsPlugin`
   (mirror the OSM path) + `gltf-transform weld+draco` per cell, OR ship uncompressed (1.4× current, still under
   budget). Inject our instanced trees per cell (`vegetation.mjs`, unchanged). Re-bake reproducibly →
   `upload-r2.mjs --city dnipro` (LIVE) → bump `tilesetVersion`. A/B on a sub-M3 box for the <150 MB DoD.

### Open owner decisions (from §5, now with data)
Identity → **recover** (free via `extras.osmId`). Textures → **strip for v1** (done). Constructions → pick
which classes (walls/masts cheap + rich; roads/surfaces excluded — we have the vector web). Draco-decode wiring
vs ship-uncompressed → a ~1-hour call during the build.

---

## 10 · Production adapter — SHIPPED as a parallel variant (2026-07-14, browser-VERIFIED)

**`scripts/bake/bake-osm2world.mjs` is live** (`node scripts/bake/bake-osm2world.mjs --city dnipro-o2w`),
and the variant streams from R2 at `enriched/dnipro-o2w/`. **The default pipeline is untouched** —
`bake.mjs`, `cities/dnipro.json`, `public/enriched/dnipro` and the default runtime path are byte-identical;
the variant has its own config (`cities/dnipro-o2w.json`, `extends: dnipro`) and is reached only through
the **`?enriched=` A/B seam** (`src/lib/globe/enrichedVariant.ts`, one call at `StylizedTiles.ts`):

| URL | What renders |
|---|---|
| *(no param)* | the default extruder bake — behaviour byte-identical |
| `?enriched=dnipro-o2w` | the OSM2World variant (env-URL segment swap → R2) |
| `?enriched=off` | stock Cesium OSM buildings (mask off too) |

The pose lives in the `#p=` hash → the same link with a different param = a same-pose visual A/B.
Shots: `verify-shots/o2w-adapter-01..05` (650 m pair, 260 m close-up pair, Cesium-off).

**Bake numbers (full city [35.0,48.42,35.1,48.5], grid 10×10, LOD 2):** 95 tiles · 3.89 M verts ·
110.22 MB uncompressed · 29,216 features = **26,104 buildings** (extruder bake: 26,569 footprints; the
remainder = OSM2World fault-tolerant skips + multipolygon merging) + **3,112 constructions** (PoleFence
1,919 · Wall 491 · StreetLamp 279 · HighVoltagePowerTower 155 · RetainingWall 103 · ChainLinkFence 46 ·
PowerTower 40 · Powerpole 16 · Cliff 11 · BollardRow 9 · masts/flagpoles/hedges/billboards) · the SAME
24,714 tree placements as the default bake (same cache + seed) — an A/B differs only in structures.

**The correction §9 missed — origin drift.** The spike's constant-ENU-offset re-base is valid only when
`scene.extras.origin` is near the city. With full sub-box extracts, `>;` relation recursion inflates each
glb's data bounds 100+ km → the origin lands far away → Mercator-vs-ENU drift scattered half the city
(first run: 11,156/27,920 buildings in-bbox, densest cell SW-shifted ~2 km). The production adapter
**inverts OSM2World's `MetricMapProjection` exactly per vertex** (formula disassembled from the
0.5.0-SNAPSHOT jar: `S = 40075016.686·cos(lat0)`; `x = ((lon+180)/360)·S − x0`;
`z = (ln((1+sinφ)/(1−sinφ))/4π + 0.5)·S − y0`; glTF POSITION = `(x, ele, −z)`) → true lat/lon →
`projectEN` into our frame. After: 26,104/27,920 in-bbox, 91 feature cells (extruder 90), densest = the
city centre. The empirical N/S handedness vote stays as a bake-time guard.

**Honest verdict on the owner's question ("does OSM2World achieve more precision + extra objects, or is
it pointless?"):** it genuinely delivers — real S3DB roof shapes, `building:part` massing, courtyard
holes, and thousands of real constructions the extruder cannot produce. Two trades to weigh in the A/B:
(1) **size** — 110 MB vs 32.8 MB uncompressed (~3.4×); levers = `gltf-transform weld+draco` (23×
spike-measured, needs a DRACOLoader wired into the enriched runtime path) or `--lod 1`; (2) **untagged
heights** — OSM2World applies its own defaults, which sometimes read LOWER than our class-tuned
`classDefaultsM` (Soviet apartment blocks) — a per-place fidelity regression the extruder wins on.
Neither bake replaces the other today: they are true siblings, and the owner picks by eye.

**Reference-safe C6 without osmium** (`lib/osmXml.mjs`): excluded ways/relations are removed whole;
excluded TAGGED nodes keep their geometry but lose their tags — no dangling references (exercised live:
−126 elements, 13 nodes stripped). Geofabrik PBF + `osmium tags-filter` remains the documented
byte-reproducible upgrade.

---

## Pointers
`scripts/bake/README.md §Higher-fidelity tiers` (tier 2 = this) · `DNIPRO_3D_ENRICHMENT_PLAN.md` Slice 1 ·
`scripts/bake/{bake,lib/gltf,lib/buildings,lib/geo,lib/exclusion,lib/vegetation,lib/overpass}.mjs` (the reuse
surface) · `scene/enrichedBuildings.ts` + `scene/buildingMaterial.ts` (the runtime contract) ·
`../archive/DNIPRO_SLICE0_SPIKE.md` (the spike template). Sources: github.com/tordanik/OSM2World (`GltfOutput.java`,
`O2WConfig.java`, `O2WConverterImpl.java`, `MetricMapProjection.java`, `world/modules/**`,
`console/commands/**`, `doc/changes.txt`, `LICENSE.txt`), github.com/tordanik/OSM2World-default-style
(`standard.properties`), osm2world.org/download + /blog, wiki.openstreetmap.org/wiki/OSM2World.
