# WIP 2026-08-26 — REGION #4: Chernobyl / Pripyat (buildings ×2 + GLO-30 terrain, LIVE on R2)

`/frame` implement. Owner ask: *"another high-fidelity OSM buildings and [Copernicus] height bake
around Prypyat city and Chernobyl Reactor, ~10×10 km patch to capture them both, full pipeline,
upload to R2"* — explicitly scoped AWAY from the remaining RENDERING CHARTER work (Group D + RC21
are untouched). *(Owner wrote "galileo height bake"; the pipeline's DEM is **Copernicus** GLO-30 —
both are EU flagship space programmes, read as the same ask.)*

Gates: **vitest 2,050/2,050 (139 files, +5)** · `astro check` 0 err / 0 warn / 6 hints ·
`npx knip` exit-0 · **`verify-chernobyl.mjs` 8/8 in headless CDP Chrome**. Dnipro / St Albans /
Everest bakes, caches, prefixes and the default runtime path: untouched throughout.

## The box
`[30.006, 51.352, 30.15, 51.442]` = **10.01 × 10.02 km** on **51.3973 / 30.0780**, the midpoint of
Pripyat centre (51.4053/30.0567) and ChNPP unit 4 / NSC (51.3893/30.0988) — they are only **3.45 km**
apart so one box holds both comfortably. Degree lengths evaluated at φ=51.397 (111.256 / 69.592
km-per-deg), each edge rounded OUTWARD. grid 10 → ~1 km cells (the proven streaming granularity).
**Deliberately OUTSIDE:** the TOWN of Chernobyl (51.2764/30.2219, ~15 km SSE) and the **Duga-1
radar** (51.3050/30.0685, ~10 km S) — both need a taller box than 10×10. Widening south to 51.30
for Duga = one bbox edit + re-bake of all three artifacts. `maxTrees` was left at 300k (unhit,
see below) partly to keep that option cheap.

## What shipped
- **`cities/chernobyl.json`** — base config + the `terrain` block. Tuned against a MEASUREMENT of
  the box, not against Dnipro: **721/1,275 footprints (56.5 %) already carry `height` or
  `building:levels`** (best-mapped box in the repo — the Pripyat community traced it building by
  building), modal tag is `building:levels=1` (416), and of the 554 untagged, 457 are
  `building=yes` with a **median footprint of 200 m²** → `defaultHeightM 6` (vs Dnipro's 8),
  Soviet-microdistrict `classDefaultsM` (apartments/dormitory 15 = a 5-storey slab).
- **`cities/chernobyl-o2w.json`** — `extends: chernobyl`, subGrid 2 (4 × ~5×5 km extracts, the
  proven extract size), same excludeModules / dropClassesRegex as the other two o2w bakes.
- **`terrain/geoid.mjs`** — added the `chernobyl` EGM2008 grid, `[30,51,31,52]` @ 0.25°, 5×5=25
  samples from `GeoidEval -n egm2008-5`. N moves only 3.5 m across the extent (21.96→25.41);
  bilinear reproduces GeoidEval at the probe point to **3.9 mm**. *(GeographicLib was installed
  but its geoid PGMs were not — `geographiclib-get-geoids` writes to /usr/local; fetched
  `egm2008-5.tar.bz2` to /tmp/glib and ran with `GEOGRAPHICLIB_DATA=/tmp/glib`.)*
- **`src/lib/globe/regions.ts`** — the `chernobyl` entry (bbox, `variants: ["chernobyl-o2w",
  "chernobyl"]`, terrain block). That is the WHOLE runtime change: `resolveEnrichedSelection`
  already routes a `#p=` pose into the containing region and segment-swaps the env URL, and
  `StylizedTiles` already reads `r.terrain`. **No env edit, no tuning.ts edit** — `variantBboxes`
  was retired into this registry on 2026-08-18.
- **`scripts/verify-chernobyl.mjs`** — 8-check CDP verification (new; the worked template for
  future regions).

## Numbers
| | classic | o2w | terrain |
|---|---|---|---|
| output | 1,212 bldgs · 72 tiles · 82,422 verts · **9.20 MB** · maxH 110 m | 1,688 features · 74 tiles · 358,329 verts · **16.94 MB** · maxH 125 m | 1,488 files · **3.6 MB** · L12 |
| trees | 166,599 (165,783 wood · 594 row · 198 park · 24 points; 1,829 rejected in footprints) | same set (byte-identical, same cache+seed) | — |
| R2 | 146 files / 8.87 MB → `enriched/chernobyl/` | 150 files / 16.25 MB → `enriched/chernobyl-o2w/` | 1,489 files / 3.46 MB → `terrain/chernobyl/` |

o2w classes: Building 1,172 · HighVoltagePowerTower 273 · PowerTower 106 · StreetLamp 61 · Wall 46
· Powerpole 17 · Railing 8 · RetainingWall 4 · PhotovoltaicPlant 1. (396 pylons is the ChNPP 750 kV
switchyard — proportionally the SAME as Dnipro's shipped 1,314+581 over 4× the area, so no new
exposure and no new decision.) Terrain probes: city-centre **bias 0.3 m / spread 2.3 m**,
extent-mid **0.0 / 2.0**, rim seam **Δ 0.5 m** — all default tolerances (6 / [12,25] / 4), which is
why `probeBiasTolM`/`probeSpreadTolM` are deliberately ABSENT from the config.

## THE C6 CALL (owner-reversible, flagged not buried)
The default blocklist matches **63** footprints in this box. `exclusion.tags` in `chernobyl.json`
replaces it with **the same list minus exactly one rule, `["power","generator"]`** — 54 stay
excluded (45 × `power=substation`, all `substation=minor_distribution` neighbourhood ТП kiosks;
9 × `military=*`, abandoned zone checkpoints/barracks). The 9 returned are reactor blocks 1
(r11600975), 2 (r11600976), 3 (w326145079, h=70), 6 (w278456952, never completed) and one diesel
house. **Why this is not a C6 breach:** C6 protects LIVE Ukrainian military and critical-energy
infrastructure; every object returned is a permanently shut-down RBMK block inside a
licensed-tourism exclusion zone, and OSM itself tags three of the four `disused:power=generator`
WITH their shutdown dates (1996-11-30 / 1991-10-11 / 2000-12-15). **The structures that actually
read as "Chernobyl" never needed the override at all** — the NSC (w456732992, h=110,
`roof:shape=round`), the sarcophagus (w500551951, h=65), reactor 4's ruins (w500551950,
`building=ruins`) and the 800 m turbine hall (r8705336, h=50) carry no `power=*` tag. Reactor 3
shares a wall with reactor 4, so omitting it punched a visible hole beside the arch — that is what
made the override worth making rather than shrugging at. **Revert = delete the `tags` key.**
The override flows into the o2w bake too (`bake-osm2world.mjs:126` builds its excluder from the
same merged config) — verified: all 8 landmark OSM ids present in BOTH bakes' `.meta.json`.

## THREE DEFECTS FOUND WHILE BAKING (all fixed, all pre-existing)
1. **`roof:height` was ADDED to a tagged `height` instead of subtracted from it** —
   `lib/buildings.mjs` `inferBuilding`. OSM's `height` is the TOTAL including the roof;
   `building:levels` counts storeys BELOW it. The extruder treated both as the eave, so every
   co-tagged building rendered taller by exactly `roof:height`. **Degenerate case: the NSC
   (`height=110 roof:height=110 roof:shape=round→gabled`) came out a 220 m ridge.** Fix subtracts
   only when `heightSource === "height"`, caps `roof:height` at `total − 1` so the total is
   preserved EXACTLY (clamping the eave afterwards overshoots by a metre), and **moves the
   `min_height` clamp below the roof block** — clamping base against the pre-roof total could
   seat it above its own wall top and invert every quad. +5 regression tests. Blast radius
   measured over every cached Overpass response: **164/128,649 Dnipro** (all small, worst renders
   20 m for a 10 m total), **0/25,510 St Albans**, 1/1,275 here. → **T55** (Dnipro not re-baked).
2. **The rim blend died on `ENFILE: file table overflow`** — the SYSTEM-wide table, squeezed by
   the IDE's `lake serve` + `lean --server` holding ~16k fds. The blend is ~1,000 serial CWT
   fetches and is **not idempotent**, so a mid-way crash means a full re-bake. Added
   `withFdRetry` (cwt.mjs, exported; used by blend.mjs too) and **narrowed both
   `.catch(() => null)`s to ENOENT** — an ENFILE swallowed there silently left a rim tile
   UNBLENDED, i.e. a height step at the seam nothing downstream would flag.
3. **`upload-r2.mjs --terrain` gated on `layer.json`, which mago writes BEFORE the blend/prune/
   probe.** So the interrupted tree from (2) would have uploaded clean-looking, unblended,
   unverified. Now also requires **`patch-info.json`** — the last thing `bake-terrain.mjs` writes,
   and the only honest completion marker. Verified by pointing it at the broken tree first.
Plus: **`bake-terrain.mjs`'s extent probe assumed `extentMaxDepth ≤ bakedMax`** while the city
probe already clamped — it printed its "topped out at L12" note, passed containment, then died on
a raw ENOENT for a level never written. Both probes and the rim check now clamp.

## L12, not L13 — the source, measured not assumed
`extentMaxDepth = maxDepth = 12` here vs 13 for dnipro/everest. **Copernicus GLO-30 coarsens
LONGITUDE sampling above 50° N** to hold ~30 m on the ground as meridians converge, so
`N51_E030` is **2400×3600 px (1.5″ lon × 1.0″ lat)** where `N48_E035` and `N27_E086` are both
3600×3600 (1.0″×1.0″) — measured off the cached COGs, not inferred. **mago clamps on
pixels-per-degree, not ground metres**, so the same ~30 m source lands one level shallower: asked
13, got 12. In ground terms this box is 29.2 × 30.9 m (nearer square than Dnipro's 20.7 × 30.9)
while L12 posts ~48 × 54 m, so ~⅓ of the source detail is unused. Judged not worth fighting —
29 m of relief across the probe tile, 2.3 m measured spread — and the only route to L13 is
resampling the COG in Node, which the 2026-08-18 ruling forbids outright. → **T56**.

## Browser verification (headless Chrome :9333, `/tmp/ftw-cdp`; the owner's :9222 was down)
`node --experimental-websocket scripts/verify-chernobyl.mjs 9333 verify-shots` → **8/8**:
region→`chernobyl-o2w` (not the dnipro registry head) · 14 o2w cell glbs, 0 errors · 32 terrain
tiles, levels 9-12, **max L12 as configured** · heights **131.2..174.3 m** over 5 probes ·
NSC cell **classic 110 m (was 220) / o2w 125 m** · `?enriched=chernobyl` → 12 classic glbs and
ZERO o2w · `?enriched=off` → nothing · Pripyat centre → 25 o2w glbs.
Shots: `verify-shots/chernobyl-0{1,2,3,4}-*.jpeg`. The 01 shot shows the NSC arch as a real
barrel dome (the o2w tier's payoff — the extruder's `round`→OBB-ridge cannot do it), the turbine
hall, the switchyard pylons and a ground readout of 141 m; the 04 shot shows Pripyat's slabs with
the forest closed through the city.

**TWO PROBE TRAPS cost most of the verify time, both false negatives:**
- **`performance.getEntriesByType("resource")` caps at 250 entries** and one settled globe frame
  issues **~1,700** requests (1,517 ArcGIS imagery alone). The first check read it and reported
  `enriched prefixes seen: []` against a page that was streaming the bake perfectly. Use the CDP
  `Network.responseReceived` log. *(Same family as the standing "a probe that reads a field which
  does not exist FAILS OPEN" trap.)*
- **The terrain patch is claimed by the ground renderer's `fetchData` hook only after the camera
  settles over the region** — well after the buildings land. A fixed 14 s settle read zero tiles
  on a page that went on to stream 32. Poll, don't sample once. Also `Network.setCacheDisabled`:
  a memory-cache hit fires `requestServedFromCache`, NOT `responseReceived`, so run 2 reported
  "no 200 for layer.json" against a working page.
- And one of MINE: traversing `__globe.enriched.group` and comparing `geometry.boundingBox.max.y`
  across meshes mixes LOCAL spaces under different parent transforms — the 152.7 m it reported
  was not the height of anything. Replaced with the baked-glb accessor max, which is the shared
  ENU frame and is the quantity the bug actually moved.

## R2 (LIVE, curl-verified through the Worker)
All three prefixes 200 + `access-control-allow-origin: *` + right content-types (`.glb` →
`model/gltf-binary` with `glTF` magic confirmed by ranged GET; `.terrain` →
`application/vnd.quantized-mesh`). `enriched/dnipro/` and `terrain/dnipro/` still 200 — no
regression. Bucket ≈ 430 MB of the 10 GB free tier. **The app in dev streams the LOCAL bakes by
design** (`.env.development.local` → `/enriched`, `/terrain`), so R2 is curl-verified, not
browser-verified — that split is intentional, not a gap.
**This bake is the first to ship `.meta.json` sidecars** (72 classic + 74 o2w, uploaded): the
writers already existed in both bakers, the other three bakes just predate them. That is RC17's
writer half arriving for free; RC17's runtime-consumption half is still open.

Related: `mem:project/wip-2026-07-18-st-albans-city2` (the onboarding pattern) ·
`mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule` (the terrain pipeline) ·
`scripts/bake/README.md` §Region #4 · T55 / T56 / T57 · DECISIONS 2026-08-26b.
