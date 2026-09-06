# WIP 2026-08-23/24 — FIND BEST SPOT observability heatmap [S1+S2 SHIPPED] (compacted 2026-09-06 from 13,361 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

> **BEST SPOT is PARKED (2026-08-27; owner ruled it SUFFICIENT 2026-09-01).** S1→S7 all shipped and
> were browser-verified after this memo was written, so its "LOCAL ONLY / S3–S7 unbuilt" status is
> history. **Start at `.claude/claude-docs/bestspot/README.md`**, then `TRAPS.md`. Later digests:
> `mem:project/wip-2026-08-24-bestspot-s3-s7` · `mem:project/wip-2026-08-27-bestspot-park`.

**Plan doc = `bestspot/BESTSPOT_PLAN.md` — READ ITS `AS BUILT` APPENDIX FIRST**; the body above it
came from a design pass and **building it proved the plan wrong in FIFTEEN places**.
Gates at S1+S2: vitest 1,560/1,560 · `astro check` 0 err · `npx knip` exit-0.

## Owner rulings 2026-08-24 (binding — plan §0)
- **R1 DRONE above 5 m.** Below it the ground rules gate; at or above, only solid INTERIORS
  (`render_min_height ≤ h < render_height`) block. Every cell also carries `groundReachable`.
- **R2 FPV is a CENTRE SOURCE and renders NOTHING in the viewfinder** (plan §9 lists the three
  changes that would un-park the FPV rendering).
- **R3 field 3 m, 1 m for ULTRA only**; the shortlist is always re-solved at 1 m.
- **R4 GL overlay only**, radial rim falloff, and **the cylinder is REPLACED by a centre PLUMB LINE**
  plus a billboarded altitude chip and a ground tick.

## THE ARCHITECTURE
**All-CPU, one long-lived module worker.** THE LOAD-BEARING INVARIANT: **the per-ray UPPER CONVEX
HULL is independent of BOTH eye height AND scene time**, so the scrubber and the altitude slider pay
only a max-angle query. M3 Pro at 601² / 1 m / K=24: hull 243 ms · query 108 ms · score 100 ms.
**NO (H,D) SLAB IS EVER MATERIALISED** (139 MB); the fused form is 1.9 MB at 3 m. **GPU REFUTED**
(3 breakers) and **shadow-map reuse REFUTED** (7 breakers) — do not re-propose either.

## SHIPPED
`lib/geo/{bestSpotTypes,bestSpotTrack,bestSpotMetric,localDsm,horizonSweep,landcoverRaster}.ts` +
6 test files ≈ **9,500 lines**, plus an ADDITIVE widening of `scene/vectorTiles.ts`: deck/pier/plaza
POLYGONS (`if (f.type !== 2) continue` was discarding a **29,054 m² deck** at the owner's hero
location), road `subclass/surface/access/foot/layer`, the `landuse` layer, `render_height` /
`render_min_height`, and **`parseTile` hoisted out of the orchestrator closure to an exported pure
`parseVectorTile`** — the widening was otherwise observable only through a live network fetch.

## THE HEADLINE — BOTH BLOCKERS SAT AT SLICE SEAMS, AND EVERY SLICE PASSED ITS OWN TESTS
1. **The bridge was scored as a PURE LIABILITY.** `RayEvidence.src` bound to the GROUND setter alone
   while `localDsm` keeps floating solids out of `surfaceTop`, so a real deck published
   `src:"terrain"` and `silTangency`'s `!isBuiltSrc` early-return made the tangency kernel written FOR
   the bridge unreachable (0.60799 with the deck vs 0.62306 with no bridge). The metric's PIN 3 passed
   only because its fixture hand-wrote `src:"deck"` on a ray the producer cannot emit. Fixed with
   `groundSrc/groundDistM` + `bandSrc/bandDistM` and `src` = the NEARER channel; the mirror-image bug
   is guarded, since gating the ground edge on the headline `src` scores the water UNDER a bridge as
   a built silhouette.
2. **47 % of the track's weight sat BELOW the horizon**, where `f=0` is guaranteed, so a perfect open
   horizon at 1.7 m scored V = 0.5138 — below the legibility floor, rendering **the best possible
   pedestrian cell invisible**. Fixed with `windowLo/windowHi` plus a HORIZON CEILING anchored at the
   eye's own dip, never 0, which is what makes the lower window extension pay for a lifted sheet.

`test/lib/geo/bestSpotComposition.test.ts` drives the whole chain, because **a per-slice suite cannot
catch a seam.** Every fix was MUTATION-VERIFIED. **PROCESS: the RED tests were UNTRACKED when the fix
agents ran, so `git diff` could not prove the assertions were not weakened — commit red tests first.**

## THREE MORE REAL BUGS — all "two conventions that look alike"
- `accessAt` compared an ABOVE-GROUND height to ABSOLUTE `solidBase/solidTop`, so **R1's only aerial
  gate was silently off and a drone was free inside every building.** The envelope test now lives
  only in `localDsm.insideSolidInterior`.
- The landcover raster sat in a **DIFFERENT FRAME** from the DSM (111,320 vs the true 111,199 m/°lat
  = 1.875 m at 1 km), misregistering the mask 1–2 cells at the rim in a feature advertising 1 m.
- **23 of the 30 canonical (radius, cellM) specs produced an EVEN grid**, centring on a cell CORNER,
  while `discGridSpec` forces ODD. One shared `oddSpanCells` serves both.

## Things a future session must not relearn (beyond the plan's F1–F5)
- **`new Date(ms)` TRUNCATES to whole ms** — it silently dropped the outermost shoulder step, so the
  ±3° `F_notch` window quietly became ±2.5°.
- **Azimuth WRAPS** (Tromsø 359.97 → 404.60 in one track) and **DECREASES in the southern
  hemisphere**. `unwrapTrackAzDeg` is the seam.
- **`eventTrack` returns null across the TROPICS, not the poles.** lat 0 is physics; 2–14° was a bug —
  the shoulder march guarded ALTITUDE monotonicity while its progress predicate is AZIMUTH.
- **"The deck IS the standable strip over the river" is FALSE** — ZERO of 11,703 deck cells were
  `water` in a no-deck rebuild. The deck buys the VERDICT (`A_soft` 0.15→1.0), not the hard gate.
- The notch floor `Hg(az*)` reads **the WALL, not the gap**.

## OPEN at S2 — mostly closed by S3→S7 (2026-09-06 note)
Two outlived the slice: **`F_sil` saturates trivially** (0.846 for both a deck and a wall, so the
0.30-weighted framing term carried almost no ranking signal) — replaced by GRAZE under R5; and
**R1's aerial gate is blind to FLOATING solids**, so a drone at 12 m inside a bridge deck reads as
free air. Also pinned: `LandClass` has no AERIAL member; `rail → blocked` and
`intermittent → wetland` await a ruling; multi-tile MVT seam assembly is untested.

## Owner rulings R5–R8 (2026-08-24) — `bestspot/BESTSPOT_SPEC_V2.md` supersedes plan §3.4/§5/§6/§10
- **R5 GRAZE replaces F_sil.** The `isBuiltSrc` provenance gate is DELETED: measured, it scored a
  grazing 8 km mountain ridge **0.0000**, below a blank wall and below empty sea. The new kernel is
  `cut × Q × dwell`; F-vs-P correlation r² 0.997 → 0.392, lattice stability ±20.3 % → ±2.3 %.
- **R6 open at 1.7 m, and AUTO-SUGGEST THE LIFT.** A real central-Dnipro disc at eye level is
  97.7 % black; at 57 m every cell clears 0.5. Probe 10/20/40/80 m at the 24 m rung (~85 ms) and
  offer the LOWEST lift that clears — computed, never a constant.
- **R7 moon worth keeps multiplying, the floor rises**: `M_eff = 0.35 + 0.65·M`. Measured worth over
  30 days ran 0.0003 / 0.0290 / 0.8639 — the moon map was black ~26 nights in 30.
- **R8** 1 m accessibility every solve; 1 m obstruction behind `REFINE THIS SPOT`; **forbid ULTRA
  above 300 m radius** (~12.2 s).

## MEASURED — the plan's numbers were wrong (tables: `bestspot/MEASUREMENTS.md`, SPEC_V2)
- **Budget off by 2× and 12×.** Real at 3 m / 300 m: T0 58 ms · T0.5 490 ms · T1 343 ms · recompose
  0.272 ms; 55 ms to first ink → 731 ms refined. **No spinner** — the coarse sheet is the progress bar.
- **`horizonSweep.ts`'s memory ledger undercounts by 5.4× — it forgot the 400 m collar.** Hulls are
  101 MB at 3 m and 900 MB at 1 m, at K=40.
- **THE HULLS ARE NOT DAY-INVARIANT.** +1 day moves `setAzDeg` −0.534° and matches 0 of 40 azimuths;
  snapping the track lattice to an ABSOLUTE 0.25° grid gives 37/39 shared. Six residency tiers.
- **MISSING DATA RENDERS AS THE BEST SPOT ON THE MAP.** Truncated height data scores 0.6633 where
  truth is 0.0000, because `known` means "found ≥1 sample", not "reached the trust radius" — **add
  `reachM` FIRST**. An all-`unknown` LandGrid returns `hard = 1`, ranking a cell in the river.
- **It is ONE-SHOT** — no refinement as tiles stream in. Moonset needs K=52 vs sunset's 40.

## THE TUNABILITY ANSWER (owner requirement: taste-pass without rework)
**The solver MUST write a per-cell TERM BUFFER, never a final score.** A compose pass produces `S` in
~0.272 ms, over 1,000× cheaper than the cheapest re-solve, so every taste knob is
recompose/reweigh/repaint class. One versioned `BestSpotScoring` profile, patched live via
`__globe.bestSpotTuning({...})`, persisted as a PATCH in `ftw:view-prefs:v1`, with a fail-safe
`CLASS_OF` table (unknown path ⇒ `rebuild`). Physics, the 11 hard-exclusion safety bits and the
honesty floors sit in a block the patch cannot reach. **Retrofitting the term buffer later IS the
rework the owner ruled out.** (75 B/cell — corrected 2026-08-24d.)

## THE VISUAL ANSWER
Plan §6's contrast maths used the wrong backdrop: **the default basemap is graded satellite, 48×
brighter than `--color-bg`**, and blending is LINEAR, not sRGB, so a single alpha fails. The
**VEIL/INK SPLIT** — `gl_FragColor = vec4(ink*aInk, aVeil)` with `premultipliedAlpha` — decouples
colour strength from map suppression (70 % of the map visible at the worst cell, 88 % at the best).
Ramp INFERNO 11 stops; **Turbo measured non-monotone**, so the best spots went dark red. **The plumb
line gains a SCALE SPOKE**, projected length provably ≥ 0.707·altitude at EVERY tilt. Sheet
`renderOrder 4` — NOT 9, the depth-free band, which flickers against the radar.

## NEXT — all of S3→S7 shipped (2026-09-06 note)
The plan was executed: the worker, `BESTSPOT` tuning, `store/bestSpot` and `stepBestSpotFeed` in the
FEEDS-LAST band **immediately after `stepPlanFeed`** (NOT after `stepKeyLightAndShadow`, ~20 steps
earlier and on the other side of `++frameCount`), the `__globe.bestSpot()` DEV seam, the GL sheet,
the desktop panel, residency and the honesty lines. S8 /m and S9 chart were NOT built (T51).

Related: `mem:project/wip-2026-08-24-bestspot-s3-s7` · `mem:project/wip-2026-08-27-bestspot-park` ·
`mem:project/wip-2026-08-15-sunsets-in-frame` · `mem:patterns/globe-rendering` ·
`mem:project/wip-2026-08-22-ultra-track`
