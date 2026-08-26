# WIP 2026-08-26c — RENDERING CHARTER Group D: RC13 + RC17 SHIPPED, RC15 REFUTED BY MEASUREMENT

`/frame` implement, continuing `NEXT_SESSION_PROMPT.md` (close the charter). Group D was four rows
(RC13 · RC17 · RC16 · RC15). **Two shipped, one is refuted, one is open.**

Gates: **vitest 2,079/2,079 (140 files, +29)** · `astro check` 0 err / 0 warn / 6 hints ·
`npx knip` exit-0 · **NEW `scripts/verify-bake-ladder.mjs` 8/8** · `verify-rendering-charter.mjs`
**85/85 ALL PASS** · `verify-chernobyl` 8/8 · `verify-bldg-override` PASS · `verify-ultra` ALL PASS ·
`verify-eclipse` ALL PASS. **All five building bakes re-baked, re-uploaded and curl-verified LIVE on R2.**

## RC13 — the skirt costs ZERO vertices, because it is a TRANSLATION not an extrusion
The charter says "extrude a 3–5 m skirt". The naive reading — append a quad per bottom boundary
edge — was **measured on the real OSM2World intermediates at +59 % vertices bake-wide, +78 % on
`Building` alone**, against audit S13's own acceptance clause of **"+≤10 %"**. But the walls
already HAVE a bottom rim: lowering it is the same picture for **+0 vertices**. Both bakers do
that. Receipts — verts before → after: dnipro `5,050,380 → 5,050,380` (**+0**), dnipro-o2w
`7,714,731 → 7,729,149` (+0.19 %), st-albans-o2w `1,732,608 → 1,735,662` (+0.18 %),
chernobyl `82,422 → 82,422` (**+0**), chernobyl-o2w `358,329 → 360,228` (+0.53 %). **Every one of
those non-zero deltas is RECOVERED BUILDINGS from the dedupe fix below, not skirt.**
Two guards, both learned from real data rather than assumed (`lib/buildings.mjs`
`skirtFor` / `skirtForSoup`):
- **`base > 0.25 m` ⇒ no skirt.** OSM `min_height` / `building:min_level` means the mass is
  authored to start above ground; skirting fills a gap the mapper drew on purpose. Fires on
  66/127,890 in Dnipro, 6/1,212 in Chernobyl.
- **Y-extent < 0.5 m ⇒ no skirt.** The o2w bake runs `createTerrain=false` with no SRTM dir, so
  its ground is the plane u = 0 — and **`Cliff` (60) and `RetainingWall` (171) come back with
  `minY === maxY === 0`**, flat ribbons with no wall to extend. Lowering their "rim" buries a
  surface that currently renders. Caught in research, confirmed in the bake (one 0.31 m-tall
  "Building" at base 2.19 m in the ChNPP cell is refused by it).
Skirted counts: 1,206/1,212 · 1,642/1,706 · 26,099/26,126 · 127,824/127,890 · 132,407/133,314.

## RC17 — ONE schema, and the pick fence stops being a height floor
The two bakers wrote DIFFERENT shapes (`{id,osm,base,height,heightSource}` vs `{id,osm,cls}`), and
both variants of the same city ship side by side — so a runtime consuming either would have
behaved differently across the A/B seam. Unified in `scripts/bake/lib/meta.mjs` (schema **2**):
`{id, osm, cls, base, top, skirt, src}` + a `{schema, variant, skirtM}` header. **`base`/`top` are
MEASURED from the emitted vertices in both bakers**, never re-derived from tags — the extruder's
`params.height` is the EAVE with the roof above it, and the adapter has no tags at all; measuring
is the only definition that means the same thing on both sides.
Runtime: new pure `src/lib/globe/enrichedMeta.ts` (parse/refuse-unknown-schema/`isPickableClass`/
`cellUriOf`/`metaUrlForGlb`) + consumption in `scene/enrichedBuildings.ts`.
**THE DEFECT THIS REMOVES IS LIVE, NOT HYPOTHETICAL.** `ENRICHED.overrideMinPickHeightM = 2.5` was
a geometric proxy for a semantic question and failed in BOTH directions: a single-storey
outbuilding was unpickable, while **every street lamp, flagpole and 30 m transmission pylon
cleared it and was fully pickable AND rescalable**. The tuning comment claimed "~4.5 % of
features"; the shipped Chernobyl o2w bake is **30.6 % non-building (516 of 1,688), 273 of them
`HighVoltagePowerTower`** — wrong by ~7×. Browser-measured over one central-Dnipro view:
**89 non-building features RECLAIMED** from the old floor. The constant STAYS as the fallback for
a bake with no sidecar; only the hack is gone.

## THE ORDERING FIX THAT MAKES IT CORRECT (the part worth remembering)
The sidecar tells `load-model` a feature's class AND its true base — and load-model is where the
pristine per-run capture happens and where persisted U8 overrides are re-applied. A sidecar
landing afterwards would mean the first pick on a fresh cell silently used the old floor, and a
re-applied override would start easing about the SKIRTED base and have the pivot move underneath
it mid-ease. **Fix: the existing `FTW_ENRICHED_FORCE_CACHE` fetch plugin resolves the MODEL's own
fetch behind the sidecar** (`Promise.all([glb, primeMeta(u)]).then(([r]) => r)`). Race gone, at no
cost — the two fetches run concurrently and the sidecar is kilobytes against the cell's megabytes.
Consequently `f.baseY` is now **the building's TRUE base** (geometric min + `skirt`), which is what
all five of its consumers already meant by "base": the U8 scale pivot, the ghost rebase,
`growBoundsFor`, `bakedHeightM`, `buildingTopWorld`.

## THREE DEFECTS FOUND AND FIXED THAT NO CHARTER ROW NAMED
1. **The o2w cross-sub-box dedupe keyed on the glTF NODE NAME, and OSM2World names a node after
   the OSM `name` TAG when it has one** ("Building Sainsbury's", "Building Теплиця") — so the set
   collided on genuinely different buildings and dropped them silently. Re-keyed on
   `` `${cls}|${extras.osmId}` `` (present on 100 % of named mesh nodes; already read four lines
   later for the sidecar; class kept in the key so a `Building` and a `BuildingPart` on one
   element cannot cannibalise each other). **RECOVERED: +231 Buildings in dnipro-o2w, +24 in
   st-albans-o2w, +18 in chernobyl-o2w.** Deduped counts fell 20,521→20,281 · 423→399 · 1,367→1,319.
2. **A re-bake could never have reached a returning browser.** The R2 worker serves `.glb` as
   `max-age=31536000, immutable` and re-bakes REUSE FILENAMES. `buildTileset` now stamps
   `?v=<tilesetVersion>` on every content uri (propagates within the 5 min `tileset.json` is
   cached; safe because content dispatch reads the glTF MAGIC BYTES and only falls back to the
   extension — `TilesRenderer.parseTile:670`, `case 'gltf': case 'glb':`). **The runtime strips it
   back off** via `cellUriOf` — that string is the persistence key for U8 rows and banked cell
   seats, so leaving the version in would drop every saved edit on a version bump. The sidecar URL
   KEEPS it (twin lifetimes). All `tilesetVersion`s bumped.
3. **`droppedOutside`/`droppedPolygon` were logged but never persisted** — no baseline existed to
   regress a straddler-rule change against. Now in the o2w manifest. RC16 will need exactly those.

**The cache-buster's own trap, and it bit twice:** an `endsWith(".glb")` predicate stops matching a
`?v=`-suffixed URL and fails SILENTLY. It would have dropped the force-cache claim AND the sidecar
prime in `enrichedBuildings.ts` (fixed pre-emptively to `/\.glb(\?|$)/`), and it DID break
`verify-chernobyl.mjs`, which reported "the o2w tileset loaded but streamed ZERO cell glbs" against
a page streaming them perfectly. Four sites patched there.

## M11 TAKEN — and it REFUTES RC15's building half
New read-only `scripts/bake/terrain/measure-dsm-signature.mjs` (writes nothing, downloads nothing
uncached). Per footprint: DSM over its own pixels minus the median of a local bare-earth annulus
that excludes **every** footprint (a neighbour's roof is not bare earth), water, and the canopy.
**With a NEGATIVE CONTROL — the identical statistic on random NON-building pixels — without which
the number cannot be read at all**, because a pixel-vs-neighbourhood statistic has a spread on any
terrain that is not a plane.

| | footprints | control (random non-building px) | separable |
|---|---|---|---|
| Dnipro median | 0.39 m | 0.05 m | **+0.34 m** |
| Dnipro p95 | 5.78 m | 5.60 m | ~0 |
| Dnipro share > 5 m | 6.4 % | 6.2 % | ~0 |
| Chernobyl median | 0.45 m | −0.04 m | **+0.49 m** |
| Chernobyl p95 | 6.17 m | 5.88 m | ~0 |

**The tail is entirely control-dominated** — the 6.4 % of footprints with a ">5 m building
signature" is matched by 6.2 % of random ground. Mechanism: **95.7 % of Dnipro's footprints
(122,398/127,878) cover exactly ONE source pixel** (83.4 % at Chernobyl). At a 20.5 × 30.9 m
posting a median ~200 m² building is a third of a pixel, so the sample is an area-weighted blend
dominated by street and yard, and the roof contributes ~4 % of its height (median ratio 0.05).
Only 139 footprints (0.1 %) cover 17+ px, and those do register (median 6.4 m).
**Verdict: punching + inpainting footprints out of a 30 m DSM moves the served mesh ~0.34 m at the
median — below the noise floor of the statistic used to detect it, ~1 % of the source posting, far
under the L13 ~38 × 25 m served posting, and dwarfed by both M5's 14.20 m within-cell relief and
RC13's 4 m skirt.** RC15 as chartered should NOT be built. Same family as RC12/RC28.

**BUT THE CANOPY HALF IS REAL AND IS A DIFFERENT SLICE** (audit gap #11 names it in the same
breath; it is mechanically unlike buildings because a wood covers hundreds of CONTIGUOUS postings
and therefore fully occupies the sample):

| contiguous polygons (17+ px) | median | p75 | p95 |
|---|---|---|---|
| Dnipro wood/park (n 365) | **+1.01 m** | 4.10 | 10.36 |
| Chernobyl wood/park (n 77) | **+3.78 m** | 7.63 | 14.37 |

Chernobyl is 4× Dnipro — 40 years of unmanaged Polesian regrowth — and it is exactly where the
bake plants **166,599 trees ON TOP of a surface that already IS the canopy**. → **T58**.
Note this compounds with **T57** (Pripyat's unmapped self-seeded trees): planting more trees on a
canopy-inflated DSM doubles the error twice over.

## Files
`scripts/bake/lib/buildings.mjs` (skirt + guards) · **NEW `scripts/bake/lib/meta.mjs`** ·
`scripts/bake/lib/gltf.mjs` (cache-buster) · `scripts/bake/bake.mjs` · `scripts/bake/bake-osm2world.mjs`
(skirt, dedupe key, unified sidecar, counters) · `cities/{dnipro,chernobyl,st-albans}.json`
(`skirtM: 4`) + all six `tilesetVersion` bumps · **NEW `src/lib/globe/enrichedMeta.ts`** ·
`src/components/globe/scene/enrichedBuildings.ts` (prime/parse/fence/true-base + `debugSeats`
`skirt` + `pickFence`) · `src/components/globe/tuning.ts` (the constant's demotion, documented) ·
**NEW `scripts/bake/terrain/measure-dsm-signature.mjs`** · **NEW `scripts/verify-bake-ladder.mjs`** ·
`scripts/verify-chernobyl.mjs` (isGlb) · `scripts/verify-rendering-charter.mjs` (RC11 polled) ·
`test/bake/bake.test.ts` (+13) · **NEW `test/lib/globe/enrichedMeta.test.ts`** (16).

## Traps banked
- **`endsWith(".glb")` vs a `?v=` query fails SILENTLY** — see above; use `/\.glb(\?|$)/`.
- **`__globe.debugSeats` does not exist**; the DEV seam is **`__globe.enrichedSeats()`**.
- **`verify-rendering-charter`'s RC11 leg was sampling a CUMULATIVE-since-page-load counter once.**
  It read 9.8 % where the same engine measures 47 % at 10 s and 87 % at 120 s. Now polled. A memo
  that genuinely never re-asks still fails — the assertion did not weaken.
- **The 504-Outdated-Optimize-Dep trap has an ordering half nobody wrote down**: moving
  `.vite/deps` aside and THEN starting `wix dev` is not enough — the re-optimisation happens
  during the first warm load and invalidates the modules that load already fetched. `__globe`
  never appears. Bring the server DOWN again after the first warm load, restart, warm once more.
- The dev middleware strips the query (`astro.config.mjs`), so `?v=` works locally too.

## Still open in Group D
**RC16** (unified straddler rule + margin/crossfade ring) — its loudest defect (the name-collision
dedupe) already shipped here, but the rest needs an Overpass RE-FETCH at a widened bbox plus a
full OSM2World re-convert (~41 min for Dnipro alone), a new `marginM` config key, and a runtime
prism change; `regions.ts`'s bbox is machine-pinned to the bake bbox so the margin cannot just
widen it. The audit also orders S19 AFTER S11/RC14, which is unbuilt. **RC21** untouched.
Related: `mem:project/wip-2026-08-26-chernobyl-region` · `wip-2026-08-25-rendering-charter-groupE` ·
DECISIONS 2026-08-26c · T54 / T55 (CLOSED) / T58 (new).
