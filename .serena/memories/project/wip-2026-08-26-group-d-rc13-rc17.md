# WIP 2026-08-26c — RENDERING CHARTER Group D: RC13 + RC17 SHIPPED, RC15 REFUTED BY MEASUREMENT (compacted 2026-09-06 from 12,192 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

> **NOTE (2026-09-06):** the Chernobyl region and both its bakes were DELETED 2026-09-02e (owner
> ruling 2026-09-02c). Its measurements below stay as evidence; the region is gone from `regions.ts`.

Group D was four charter rows (RC13 · RC17 · RC16 · RC15): two shipped, one refuted, one left open.
Gates: **vitest 2,079/2,079 (140 files, +29)** · `astro check` 0 err / 6 hints · `npx knip` exit-0 ·
NEW `scripts/verify-bake-ladder.mjs` 8/8 · `verify-rendering-charter.mjs` **85/85** · four other
verify suites PASS. All five building bakes re-baked, re-uploaded and curl-verified LIVE on R2.

## RC13 — the skirt costs ZERO vertices, because it is a TRANSLATION not an extrusion
The charter says "extrude a 3–5 m skirt". The naive reading — a quad per bottom boundary edge —
measured **+59 % vertices bake-wide (+78 % on `Building`)** on the real OSM2World intermediates,
against audit S13's own "+≤10 %" acceptance clause. But the walls already HAVE a bottom rim:
lowering it is the same picture for **+0 vertices**, and both bakers do that. Receipts: dnipro
5,050,380 → 5,050,380 (**+0**), dnipro-o2w +0.19 %, st-albans-o2w +0.18 %, chernobyl +0 —
**every non-zero delta is RECOVERED BUILDINGS from the dedupe fix below, not skirt.**
Two guards, both learned from real data (`lib/buildings.mjs` `skirtFor` / `skirtForSoup`):
- **`base > 0.25 m` ⇒ no skirt.** OSM `min_height` / `building:min_level` means the mass is authored
  to start above ground, so skirting fills a gap the mapper drew on purpose (fires on 66/127,890 in
  Dnipro).
- **Y-extent < 0.5 m ⇒ no skirt.** The o2w bake runs `createTerrain=false` with no SRTM dir, so its
  ground is the plane u = 0 — and **`Cliff` and `RetainingWall` come back with
  `minY === maxY === 0`**, flat ribbons with no wall to extend; lowering their "rim" buries a
  surface that currently renders.
Skirted counts: 1,206/1,212 · 1,642/1,706 · 26,099/26,126 · 127,824/127,890 · 132,407/133,314.

## RC17 — ONE schema, and the pick fence stops being a height floor
The two bakers wrote DIFFERENT sidecar shapes and both variants of a city ship side by side, so a
runtime consuming either behaved differently across the A/B seam. Unified in
`scripts/bake/lib/meta.mjs` (schema **2**): `{id, osm, cls, base, top, skirt, src}` + a
`{schema, variant, skirtM}` header. **`base`/`top` are MEASURED from the emitted vertices in both
bakers**, never re-derived from tags — the extruder's `params.height` is the EAVE with the roof
above it and the adapter has no tags at all, so measuring is the only shared definition.
Runtime: new pure `src/lib/globe/enrichedMeta.ts` (parse / refuse-unknown-schema /
`isPickableClass` / `cellUriOf` / `metaUrlForGlb`), consumed by `scene/enrichedBuildings.ts`.
**THE DEFECT THIS REMOVES WAS LIVE.** `ENRICHED.overrideMinPickHeightM = 2.5` was a geometric proxy
for a semantic question and failed in BOTH directions: a single-storey outbuilding was unpickable,
while every street lamp, flagpole and 30 m transmission pylon cleared it and was fully pickable AND
rescalable. The tuning comment claimed "~4.5 % of features"; the shipped Chernobyl o2w bake was
**30.6 % non-building (516 of 1,688), 273 of them `HighVoltagePowerTower`** — wrong by ~7×.
Browser-measured over one central-Dnipro view: **89 non-building features RECLAIMED**. The constant
stays as the fallback for a bake with no sidecar; only the hack is gone.

## THE ORDERING FIX THAT MAKES IT CORRECT (the part worth remembering)
`load-model` is where the pristine per-run capture happens and where persisted U8 overrides are
re-applied, so a sidecar landing after it means the first pick on a fresh cell uses the old floor and
a re-applied override eases about the SKIRTED base. **Fix: the `FTW_ENRICHED_FORCE_CACHE` fetch
plugin resolves the MODEL's own fetch behind the sidecar** (`Promise.all([glb, primeMeta(u)])`).
Consequently `f.baseY` is now **the building's TRUE base** (geometric min + `skirt`) — what all five
consumers already meant: the U8 scale pivot, the ghost rebase, `growBoundsFor`, `bakedHeightM`,
`buildingTopWorld`.

## THREE DEFECTS FOUND AND FIXED THAT NO CHARTER ROW NAMED
1. **The o2w cross-sub-box dedupe keyed on the glTF NODE NAME, and OSM2World names a node after the
   OSM `name` TAG when it has one** ("Building Sainsbury's") — so the set collided on genuinely
   different buildings and dropped them silently. Re-keyed on `` `${cls}|${extras.osmId}` `` (present
   on 100 % of named mesh nodes; class kept in the key so a `Building` and a `BuildingPart` on one
   element cannot cannibalise each other). **RECOVERED: +231 Buildings in dnipro-o2w, +24 in
   st-albans-o2w, +18 in chernobyl-o2w.**
2. **A re-bake could never have reached a returning browser.** The R2 worker serves `.glb` as
   `max-age=31536000, immutable` and re-bakes REUSE FILENAMES. `buildTileset` now stamps
   `?v=<tilesetVersion>` on every content uri (safe because content dispatch reads the glTF MAGIC
   BYTES and only falls back to the extension). **The runtime strips it back off** via `cellUriOf` —
   that string is the persistence key for U8 rows and banked cell seats, so leaving the version in
   would drop every saved edit on a version bump. The sidecar URL KEEPS it (twin lifetimes).
3. **`droppedOutside`/`droppedPolygon` were logged but never persisted** — no baseline existed to
   regress a straddler-rule change against. Now in the o2w manifest.

**The cache-buster's own trap, and it bit twice:** an `endsWith(".glb")` predicate stops matching a
`?v=`-suffixed URL and fails SILENTLY. It would have dropped the force-cache claim and the sidecar
prime in `enrichedBuildings.ts` (fixed pre-emptively to `/\.glb(\?|$)/`), and it DID break
`verify-chernobyl.mjs`, which reported "streamed ZERO cell glbs" against a page streaming them fine.

## M11 TAKEN — and it REFUTES RC15's building half
New read-only `scripts/bake/terrain/measure-dsm-signature.mjs`. Per footprint: DSM over its own
pixels minus the median of a local bare-earth annulus excluding every other footprint, water and
canopy — **with a NEGATIVE CONTROL (the same statistic on random NON-building pixels)**, without
which the number cannot be read at all.

| | footprints | control (random non-building px) | separable |
|---|---|---|---|
| Dnipro median | 0.39 m | 0.05 m | **+0.34 m** |
| Dnipro p95 | 5.78 m | 5.60 m | ~0 |
| Dnipro share > 5 m | 6.4 % | 6.2 % | ~0 |
| Chernobyl median | 0.45 m | −0.04 m | **+0.49 m** |

**The tail is entirely control-dominated**: the 6.4 % of footprints with a ">5 m building
signature" is matched by 6.2 % of random ground. Mechanism — **95.7 % of Dnipro's footprints
(122,398/127,878) cover exactly ONE source pixel**, so at a 20.5 × 30.9 m posting a median ~200 m²
building is a third of a pixel and the roof contributes ~4 % of its height. Only 139 footprints
(0.1 %) cover 17+ px, and those do register (median 6.4 m).
**Verdict: punching and inpainting footprints out of a 30 m DSM moves the served mesh ~0.34 m at
the median** — below the noise floor of the statistic used to detect it, and dwarfed by M5's
14.20 m within-cell relief and RC13's 4 m skirt. RC15 as chartered should NOT be built. Same
family as RC12/RC28.

**BUT THE CANOPY HALF IS REAL AND IS A DIFFERENT SLICE** — mechanically unlike buildings, because a
wood covers hundreds of CONTIGUOUS postings and therefore fully occupies the sample:

| contiguous polygons (17+ px) | median | p75 | p95 |
|---|---|---|---|
| Dnipro wood/park (n 365) | **+1.01 m** | 4.10 | 10.36 |
| Chernobyl wood/park (n 77) | **+3.78 m** | 7.63 | 14.37 |

Chernobyl was 4× Dnipro — 40 years of unmanaged Polesian regrowth — and it was exactly where the
bake planted **166,599 trees ON TOP of a surface that already IS the canopy** (→ **T58**; it
compounded with T57, Pripyat's unmapped self-seeded trees). The region is gone since 2026-09-02e,
but the Dnipro half of the finding stands.

## Files
`scripts/bake/lib/buildings.mjs` (skirt + guards) · NEW `scripts/bake/lib/meta.mjs` ·
`scripts/bake/lib/gltf.mjs` (cache-buster) · `scripts/bake/bake.mjs` · `bake-osm2world.mjs` ·
`cities/*.json` (`skirtM: 4`, all `tilesetVersion`s bumped) · NEW `src/lib/globe/enrichedMeta.ts` ·
`scene/enrichedBuildings.ts` · `tuning.ts` · NEW `scripts/bake/terrain/measure-dsm-signature.mjs` ·
NEW `scripts/verify-bake-ladder.mjs` · `scripts/verify-{chernobyl,rendering-charter}.mjs` ·
`test/bake/bake.test.ts` (+13) · NEW `test/lib/globe/enrichedMeta.test.ts` (16).

## Traps banked
- **`endsWith(".glb")` vs a `?v=` query fails SILENTLY** — see above; use `/\.glb(\?|$)/`.
- **`__globe.debugSeats` does not exist** — the DEV seam is `__globe.enrichedSeats()`.
- **`verify-rendering-charter`'s RC11 leg sampled a CUMULATIVE-since-page-load counter once**, so it
  read 9.8 % where the same engine measures 47 % at 10 s and 87 % at 120 s. Now polled, and a memo
  that genuinely never re-asks still fails — the assertion did not weaken.
- **The 504-Outdated-Optimize-Dep trap has an ordering half nobody wrote down**: moving
  `.vite/deps` aside and THEN starting `wix dev` is not enough — re-optimisation happens during the
  first warm load and invalidates the modules that load already fetched, so `__globe` never appears.
  Bring the server DOWN after the first warm load, restart, warm once more.

## Still open in Group D — CLOSED since (2026-09-06 note)
**RC16** (unified straddler rule + margin/crossfade ring) needed an Overpass re-fetch at a widened
bbox, a full OSM2World re-convert (~41 min for Dnipro), a `marginM` config key and a runtime prism
change — `regions.ts`'s bbox is machine-pinned to the bake bbox, so the margin cannot just widen it.
RC16 and RC21 both landed 2026-08-26d (RC21 shipped OFF) and the charter CLOSED:
`mem:project/wip-2026-08-26-rc16-rc21`.
Related: `mem:project/wip-2026-08-26-chernobyl-region` ·
`mem:project/wip-2026-08-26-rendering-charter-groupE` · DECISIONS 2026-08-26c · T54 / T55 / T58.
