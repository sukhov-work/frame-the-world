# WIP 2026-08-26 — REGION #4: Chernobyl / Pripyat — BUILT, THEN DELETED 2026-09-02e (compacted 2026-09-06 from 12,479 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

> **THE REGION IS GONE (2026-09-02e).** Owner ruling 2026-09-02c: no support for Chernobyl, and
> **Dnipro is the priority slice in any feature**. The `regions.ts` entry, both city configs, the
> geoid grid and all 1,785 R2 objects were deleted (0 remain); only local gitignored bake dirs
> survive. **What is kept below is the engineering that outlived the region**: the three pipeline
> defects, the GLO-30 L12 finding, and the verification traps. The region-specific configuration
> is history.

Gates at build: **vitest 2,050/2,050 (139 files, +5)** · `astro check` 0 err / 6 hints ·
`npx knip` exit-0 · `verify-chernobyl.mjs` 8/8 in headless CDP Chrome.

## The region, in one paragraph (history)
A 10.01 × 10.02 km box `[30.006, 51.352, 30.15, 51.442]` centred between Pripyat and ChNPP unit 4 /
the NSC (3.45 km apart), grid 10 → ~1 km cells. Two building bakes (1,212 classic / 1,688 o2w),
166,599 trees, a GLO-30 L12 terrain patch, ~430 MB on R2 behind ONE `regions.ts` entry — the whole
runtime change, because `resolveEnrichedSelection` already routes a `#p=` pose into the containing
region and segment-swaps the env URL. It was also **the first bake to ship `.meta.json` sidecars**
(RC17's writer half arriving for free). `scripts/verify-chernobyl.mjs` remains the worked
8-check CDP template for onboarding a region.

## The C6 call it forced (the reusable part)
The default blocklist matched 63 footprints; the config dropped exactly one rule,
`["power","generator"]`, returning 9 reactor-block features while 54 stayed excluded. The reasoning
is the part to reuse: **C6 protects LIVE Ukrainian military and critical-energy infrastructure**,
and every object returned was a permanently shut-down RBMK block inside a licensed-tourism zone,
which OSM itself tags `disused:power=generator` with shutdown dates. An exclusion override must be
argued against what C6 actually protects, and it must be reversible by deleting one key.

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

## Verification traps (the durable part — all three were FALSE NEGATIVES)
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

## R2 (standing fact, not Chernobyl-specific)
**The app in dev streams the LOCAL bakes by design** (`.env.development.local` → `/enriched`,
`/terrain`), so an R2 prefix is curl-verified through the Worker, never browser-verified. That
split is intentional, not a gap. Check content types on upload: `.glb` → `model/gltf-binary`
(confirm the `glTF` magic with a ranged GET), `.terrain` → `application/vnd.quantized-mesh`.

Related: `mem:project/wip-2026-07-18-st-albans-city2` (the onboarding pattern) ·
`mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule` (the terrain pipeline) ·
`scripts/bake/README.md` §Region #4 · T55 / T56 / T57 · DECISIONS 2026-08-26b.
