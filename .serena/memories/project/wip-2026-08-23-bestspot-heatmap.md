# WIP 2026-08-23/24 — FIND BEST SPOT observability heatmap [DESIGN LOCKED · S1+S2 SHIPPED]

Owner order 2026-08-23 (`/frame` + investigate-design-v3): PARK the eclipse taste pass, T46 LEO umbra
and the small fixes. This session = ONE new planning feature + map enrichment.
**Plan doc = `.claude/claude-docs/BESTSPOT_PLAN.md` — READ ITS `AS BUILT` APPENDIX FIRST.** The body
above it was written by a design pass and **building it proved the plan wrong in FIFTEEN places**;
the appendix has every correction, measured. Twin: DECISIONS §Recent 2026-08-23.

Gates: **vitest 1,560/1,560 (119 files, +187 from the 1,373/113 baseline, ZERO old-file regressions)** ·
`astro check` 0 err / 0 warn / 5 pre-existing hints · `npx knip` exit-0. All three re-run by the
orchestrator, not taken on report. **Verification tier: LOCAL ONLY — nothing has been in a browser
(S3–S7 unbuilt, so there is no rendered artefact yet).**

## Owner rulings 2026-08-24 (binding — plan §0)
- **R1 DRONE above 5 m.** Below: ground rules gate. At/above: only solid INTERIORS
  (`render_min_height ≤ h < render_height`). Owner *preferred* "a place I can climb to" ⇒ every cell
  also carries `groundReachable`.
- **R2 FPV = CENTRE SOURCE, renders NOTHING in the viewfinder.** Toggle on `tempPin || fpvActive`;
  solves at the walked eye (nadir if flying); re-toggle re-solves; leaving FPV keeps the field.
  **Plan §9 lists the exact three changes to un-park the FPV rendering.**
- **R3 field 3 m; 1 m for ULTRA only**; shortlist always re-solved at 1 m.
- **R4 GL overlay only** (MapWindow DOM twin deferred), **radial rim falloff**, and **the cylinder is
  REPLACED by a centre PLUMB LINE** + billboarded altitude chip + ground tick.

## THE ARCHITECTURE
**All-CPU, one long-lived module worker.** THE LOAD-BEARING INVARIANT: **the per-ray UPPER CONVEX HULL
is independent of BOTH eye height AND scene time** — so the scrubber and the altitude slider pay only
a max-angle query. M3 Pro @601²/1 m/K=24: hull 243 ms · query 108 ms · score 100 ms.
**NO (H,D) SLAB IS EVER MATERIALISED** (1 m × K=42 × 6 B = **139 MB**); fused = 1.9 MB @3 m.
**GPU REFUTED** (plan §2 F5, 3 breakers) · **shadow-map reuse REFUTED** (7 breakers). Do not re-propose.

## SHIPPED
`lib/geo/{bestSpotTypes,bestSpotTrack,bestSpotMetric,localDsm,horizonSweep,landcoverRaster}.ts` +
6 test files ≈ **9,500 lines**, + an ADDITIVE widening of `scene/vectorTiles.ts` (deck/pier/plaza
POLYGONS — `if (f.type !== 2) continue` was discarding a **29,054 m² deck** at 48.47831,35.05757, the
owner's hero location — plus road `subclass/surface/access/foot/layer`, the `landuse` layer,
`render_height`/`render_min_height`, a `brunnel` string, and **`parseTile` hoisted out of the
orchestrator closure to an exported pure `parseVectorTile`** because the widening was otherwise
observable only through a live network fetch).

## THE HEADLINE — BOTH BLOCKERS WERE AT SLICE SEAMS AND EVERY SLICE PASSED ITS OWN TESTS
1. **The bridge was scored as a PURE LIABILITY.** `RayEvidence.src` bound to the GROUND setter alone
   while `localDsm` keeps floating solids out of `surfaceTop`/`surfaceSrc` ⇒ a real deck published
   `src:"terrain"` and `silTangency`'s `!isBuiltSrc` early-return made the tangency kernel written FOR
   the bridge unreachable. **0.60799 WITH the deck vs 0.62306 with no bridge.** The metric's PIN 3
   passed only because its fixture hand-wrote `src:"deck"` on a ray the producer cannot emit.
   Fixed: `groundSrc/groundDistM` + `bandSrc/bandDistM`, `src` = the NEARER channel →
   **withDeck 0.88853 vs bare 0.69606**. Mirror-image bug guarded (gating the ground edge on the
   headline `src` scores **the water UNDER a bridge** as a built silhouette).
2. **47 % of the track's weight sat BELOW the horizon** where `f=0` is guaranteed — the ±3° shoulders
   are for `F_notch`/`C` only, and `exp(−max(0,alt)/2.5°)` does not decay below 0. Perfect open
   horizon at 1.7 m: **V = 0.5138, S = 0.41**, below §6's own legibility floor ⇒ **the best possible
   pedestrian cell rendered invisible**. Fixed with `windowLo/windowHi` + a HORIZON CEILING anchored
   at the eye's own dip (never 0 — that is what makes the lower window extension pay for a lifted
   sheet): **V 0.51376 → 0.96849, S → 0.69527**; a 15° courtyard still reads `v=0`.

`test/lib/geo/bestSpotComposition.test.ts` now drives the whole chain — **a per-slice suite cannot
catch a seam.** Every fix MUTATION-VERIFIED (revert→red→restore); the stacked pre-fix state
reconstructs `V = 0.5137554515047305` exactly, which is the proof no threshold was relaxed.
**PROCESS: the RED tests were UNTRACKED when the fix agents ran, so `git diff` could not prove the
assertions were not weakened. Commit red tests before handing them to a fix pass.**

## THREE MORE REAL BUGS — all "two conventions that look alike"
- `accessAt` compared an ABOVE-GROUND height to ABSOLUTE `solidBase/solidTop` ⇒ **R1's only aerial gate
  was silently off, a drone free inside every building.** Fixed by deleting the second site — the
  envelope test lives only in `localDsm.insideSolidInterior`; TypeScript rejects the old call.
- The landcover raster was in a **DIFFERENT FRAME** from the DSM (111_320 vs the true 111_199 m/°lat
  ⇒ **0.937 m @500 m, 1.875 m @1 km**, misregistering the mask 1–2 cells at the rim in a feature
  advertising 1 m). `localDsm` now owns one ENU frame; worst error **1.2e-5 m**.
- **23 of the 30 canonical (radius, cellM) specs produced an EVEN grid**, centre on a cell CORNER,
  while `discGridSpec` forces ODD. One shared `oddSpanCells` serves both.

## Things a future session must not relearn (beyond the plan's F1–F5)
- **`new Date(ms)` TRUNCATES to whole ms** — it silently dropped the outermost shoulder step, so the
  ±3° `F_notch` window quietly became ±2.5°. S3 will hit the same quantum.
- **Azimuth WRAPS** (Tromsø 359.97→404.60 inside one track) and **DECREASES in the southern
  hemisphere**. `unwrapTrackAzDeg` is the seam.
- **`eventTrack` returns null across the TROPICS, not the poles.** lat 0 is physics (the setting
  azimuth is stationary at the horizon); 2–14° was a bug (the shoulder march guarded ALTITUDE
  monotonicity while its progress predicate is AZIMUTH). Recovered. **S5's panel copy owes this a line.**
- **"The deck IS the standable strip over the river" is FALSE** — ZERO of 11,703 deck cells were
  `water` in a no-deck rebuild; the carriageway LINES already lift them out. The deck buys the
  **VERDICT** (`A_soft` 0.15→1.0), not the hard gate.
- The notch floor `Hg(az*)` reads **the WALL, not the gap** (az* straddles a flank BY CONSTRUCTION).

## OPEN — carried to S3+
1. **`F_sil` SATURATES TRIVIALLY** — 0.846 for BOTH the deck and the wall ⇒ `F ≈ P` in a city and the
   0.30-weighted framing term carries almost no ranking signal. **Owner-visible, S7.**
2. **R1's aerial gate is blind to FLOATING solids** — a drone at 12 m inside the Central Bridge deck
   reads as free air. Same bug class as the two blockers, same object. Pinned, NOT fixed (the producer
   is S3's feed).
3. `LandClass` has no AERIAL member ⇒ R4's distinct class is inexpressible (S4 decision).
4. `rail → blocked` and `intermittent → wetland` are inferences needing an owner ruling.
5. Multi-tile MVT seam assembly untested.
6. **`accessAt`'s 5th param is now `inSolidInterior: boolean`** from `localDsm.insideSolidInterior` at
   the SAME height. S3 must know.
7. **§5's T0 ≈ 105 ms / T1 ≈ 90 ms is a PROJECTION** — the 17 ms `buildLandGrid` is on a 21-building
   fixture tile, not dense Dnipro, and nothing ran inside a worker. `planElevationsM` drags
   comet/targets/showers into the worker chunk; S3 should measure the bundle.
8. **SEPARATE PRE-EXISTING DEFECT, out of scope: the FPV mini-map draws culverted drains as visible
   watercourses** (`minimapFeed` skips `line.tunnel`; the waterway kind hard-codes `tunnel:false`).

## Owner rulings R5-R8 (2026-08-24, second round) + SPEC_V2
**`.claude/claude-docs/BESTSPOT_SPEC_V2.md` (1,013 lines) SUPERSEDES plan §3.4 / §5 / §6 / §10.**
Produced by a 5-agent measurement pass (latency · framing · tuning · visual → consolidator).
- **R5 GRAZE replaces F_sil.** The `isBuiltSrc` provenance gate is DELETED — measured, it scored a
  grazing 8 km mountain ridge **0.0000**, below a blank wall and below empty sea. New kernel
  `cut × Q × dwell` (dwell = the body's travel in disc-radii while the edge cuts it). Ridge now
  **0.9897 grazing / 0.4830 perpendicular**; F-vs-P correlation **r² 0.997 → 0.392**; lattice
  stability ±20.3 % → ±2.3 %. Provenance survives only as soft confidence (tree 0.45, clamped ≤0.6).
- **R6 open at 1.7 m + AUTO-SUGGEST THE LIFT.** A real central-Dnipro disc at eye level is
  **97.7 % black, max 0.381, median 0.000**; at 57 m every cell clears 0.5. Probe 10/20/40/80 m at the
  24 m rung (~85 ms) and offer the LOWEST lift that clears — computed, never a constant.
- **R7 moon worth keeps multiplying, floor rises.** `M_eff = 0.35 + 0.65·M` (tunable, recompose class).
  Measured worth over 30 days: min 0.0003 / median 0.0290 / max 0.8639 ⇒ the moon map was black
  ~26 nights in 30.
- **R8 1 m accessibility EVERY solve (+59 ms); 1 m obstruction behind `REFINE THIS SPOT`** (~1.4 s —
  needs a 985 ms 1 m hull, 900 MB at K=40, must stream). **Forbid ULTRA above 300 m radius** (~12.2 s).
  1 m vs 3 m is only ρ 0.969 / 4 of the top 20.

## MEASURED — the plan's numbers were wrong
- **Budget off by 2× and 12×.** Real @3 m/300 m: T0 **58 ms** · T0.5 **490 ms** · T1 **343 ms** ·
  recompose **0.272 ms**. Wall clock: **55 ms to first ink** (24 m rung) → **731 ms refined**;
  cold tiles +260 ms. Scrub within a day **0 ms**. **No spinner** — the coarse sheet is the progress bar.
- **`horizonSweep.ts:254-257`'s memory ledger undercounts by 5.4× — it forgot the 400 m collar.**
  Hulls are **101 MB @3 m / 900 MB @1 m** at K=40.
- **THE HULLS ARE NOT DAY-INVARIANT.** +1 day moves `setAzDeg` −0.534° and matches **0 of 40**
  azimuths. Fix: snap the track lattice to an ABSOLUTE 0.25° grid ⇒ 37/39 shared. Six residency tiers,
  not three.
- **MISSING DATA RENDERS AS THE BEST SPOT ON THE MAP.** Truncated height data scores **0.6633** where
  truth is **0.0000**, at coverage 1.000 with openSky on all 40 rays. `known` means "found ≥1 sample",
  not "reached the trust radius". **Add `reachM` FIRST.** Rural terrain-only disc: uniform **0.47–0.66**
  at 100 % coverage. An all-`unknown` LandGrid returns **`hard = 1`** ⇒ it will rank a cell in the river.
- **It is ONE-SHOT** — no refinement as tiles stream in. Six items in SPEC_V2 §3.4.
- **All four kinds share one code path** — 5 branches, all in `bestSpotTrack.ts`. `horizonSweep` and
  `localDsm` contain ZERO kind references. But moonset needs K=52 vs sunset's 40 (+30 %); Tromsø 85.

## THE TUNABILITY ANSWER (owner requirement: taste-pass without rework)
**The solver MUST write a per-cell TERM BUFFER (59 B/cell), never a final score.** A compose pass then
produces `S` in **0.272 ms = 1,260× cheaper than the cheapest re-solve**. Every taste knob is
recompose/reweigh/repaint class. One versioned `BestSpotScoring` profile, patched live via
`__globe.bestSpotTuning({...})`, persisted as a PATCH in `ftw:view-prefs:v1`, with a fail-safe
`CLASS_OF` table (unknown path ⇒ `rebuild`) and an **EVERY FIELD IS LIVE** test that perturbs every
leaf. Physics / safety (the 11 hard-exclusion bits) / honesty floors sit in a block the patch cannot
reach. **Retrofitting the term buffer later IS the rework the owner ruled out — S3a lands first.**

## THE VISUAL ANSWER
Plan §6's contrast maths was computed against the wrong backdrop: **the default basemap is graded
satellite, 48× brighter than `--color-bg`**, and blending is LINEAR not sRGB. So a single alpha fails.
**VEIL/INK SPLIT** — `gl_FragColor = vec4(ink*aInk, aVeil)` on a raw ShaderMaterial with
`premultipliedAlpha` — decouples colour strength from map suppression. Map stays **70 % visible at the
worst cell, 88 % at the best**; 2.1–2.5× more discriminating than the plan's curve. Ramp INFERNO 11
stops (Turbo A/B only — measured non-monotone, the best spots go dark red). Contours `fwidth` isolines
every 0.10, halo-stroked **11.28:1**. Rim falloff 0.10. UNKNOWN = untouched map + two-tone dotted
boundary. **Plumb line gains a SCALE SPOKE** — projected length provably ≥ 0.707·altitude at EVERY
tilt, which solves the nadir degeneracy. Sheet `renderOrder 4` (NOT 9 — that is the depth-free band
and would flicker against the radar).

## NEXT
**S3** — worker + `BESTSPOT` tuning + `store/bestSpot` + `stepBestSpotFeed` in the FEEDS-LAST band
**immediately after `stepPlanFeed`** (NOT after `stepKeyLightAndShadow` — that is ~20 steps earlier and
on the other side of `++frameCount`) + the `__globe.bestSpot()` DEV seam + a **deliberate, reviewed
edit to `fences.test.ts`'s SANCTIONED store-bridge map** + the desktop-only shell gate AT THE READ.
Then **S4** GL sheet · **S5** desktop panel · **S6** residency · **S7** honesty · S8 /m · S9 chart.

Related: [[project/wip-2026-08-15-sunsets-in-frame]] · [[patterns/globe-rendering]] ·
[[project/wip-2026-08-22-ultra-track]] · [[project/wip-2026-08-13-planning-core-restructure]]
