# WIP 2026-08-24 — BEST SPOT S3a→S7 SHIPPED AND BROWSER-VERIFIED [FEATURE COMPLETE]

Owner order: proceed with `NEXT_SESSION_PROMPT.md`, full implementation + verification of the
heatmap, no regressions, **most precise calculations in ULTRA**; everything already researched in
`BESTSPOT_PLAN.md` + `BESTSPOT_SPEC_V2.md` stands. Twin: DECISIONS §Recent **2026-08-24c**.
Predecessors: [[project/wip-2026-08-23-bestspot-heatmap]] (S1+S2 floor, design).

## GATES
**vitest 1,902/1,902 (130 files, +342 over the 1,560/119 baseline)** · `astro check` 0 err / 0 warn /
5 pre-existing hints · `npx knip` exit-0 · **`scripts/verify-bestspot.mjs` 100 PASS / 0 FAIL, exit 0,
reproduced twice.** Tier: **LOCAL + BROWSER**. Wix cloud UNVERIFIED (prod dark behind the
nameserver gate). Shots `verify-shots/bestspot-01…08`.

## THE HEADLINE — EVERY UNIT GATE WAS GREEN WHILE THE FIELD WAS A CONSTANT
First browser run, dense central Dnipro: published RG8 measured **`rMin === rMax === 187`** — ONE
distinct value across all 31,417 scored cells — beside `heightProvenance {enriched:0, osm:0}` and a
healthy `builtDensityPerKm2 54.7`. **No building geometry ever reached the worker's DSM**, so every
cell saw the same open horizon. That is plan §11's *"single most dangerous failure mode"* (warm,
confident, uniform) firing at the owner's hero location, top-8 spread **0.4 %**.
Two causes, both measured:
1. **`▦ 3D DETAIL` was OFF in that browser's `ftw:view-prefs:v1`** — `buildings.setActive(false)`
   **removes** `tiles.group` from the scene, so `flattenTin` traversed an empty group.
2. **No epoch watched BUILDING tile arrivals.** The feed's three streaming epochs were the *ground*
   tileset, the MVT version, and the enriched **re-seat** counter (re-seats of already-loaded
   features, not arrivals). A disc solved before buildings streamed never re-solved.
Fixed: `builtEpoch` on both building tilesets' `load-model`/`dispose-model`; and because the engine
*knew* both facts and said nothing, a disc with dense MVT and **zero** building meshes now
**REFUSES** (`"no-built-geometry"`) rather than painting warm.
**After: 31 distinct score bytes; mean byte 0 at the 1.7 m eye → 159 at a 56.7 m sheet** (the
pre-fix disc measured 187 at BOTH lifts — there was no mass to clear). Top-8 spread **56 %**.

## NINE MORE DEFECTS ONLY A BROWSER COULD FIND
- **`postMessage` transferred `conformM`, which `composeField` hands out BY REFERENCE** from the
  resident rung → the first post detached the worker's own copy and every later post threw
  `An ArrayBuffer is detached and could not be cloned`, freezing the on-screen `scoringHash` and
  killing `.ab()`. **Un-catchable in vitest — `postMessage` there has no transfer semantics.**
- **`postingOf` returned `cellM` for every input ALGEBRAICALLY** (two `known` factors cancelled), so
  the panel printed `OVER TERRAIN AT ~3 m` — a **C2 violation**. Replaced by TIN vertex density:
  **58.5 m Dnipro vs 35.9 m Everest** (old formula returned 3.0 at both).
- The 1 m refine ran fine; **the store mirror rebuilt `topK` from the last *rung* message** and threw
  the refined row away.
- **`waitRefined` returned on `refinedMs > 0 && !solving`, neither of which carries solve identity** →
  the S6 checkpoints straddled a phase boundary. The SCRIPT was wrong, not the engine: with only the
  wait replaced, scrub measures **+0** and radius **+156**.
- The mid-reservoir negative **was not on the water** (its 300 m disc scored 8,050 cells). Hill-climbing
  the engine's own LandGrid → **48.479450, 35.048099** = 0 scored / 31,417 blocked.
- **The cross-model check was vacuous twice**: asked at the scrubber's instant (sun 7.35° down), and
  `blockedNow` is **structurally true at `t0Ms`** — the refracted contact, where the airless centre
  is −0.87°, below any non-negative skyline. Re-expressed as a `skylineAltDeg` spread: **66.2°**
  across the disc's own two extremes.
- **`window.__globe.scene` was never exposed**, so **all seven of S4's "read the LIVE material"
  done-checks lived only in vitest against constructor arguments.** `__globe.bestSpotSheet()` now
  asserts them live (max sampled `aVeil` **0.3000**, 601² `NoColorSpace` `LinearFilter`).
- `.g` INACCESSIBLE was read as 170; it is 85 — the confusion was D1 wearing a hat (at a 55 m sheet
  `hard = inSolid ? 0 : 1`, so the river becomes standable *air*).
- Rural thresholds (`coverage < 0.5`, `unmapped > 0.3`) described REACH; the shipped prior gates
  **open-sky credit**. `coverage < 0.5` would also make the EVEREST row unpassable by construction.

## PERF PINS — A WALL-CLOCK BUDGET INSIDE A 12-WAY-PARALLEL VITEST MEASURES THE RUNNER
Three pins red under load with **zero** regressions (3 m solve **646 ms standalone vs 1,335–1,522
in-suite**). `test/lib/geo/_perf.ts` expresses them in **reference-machine ms**, calibrated
**PER ITERATION** — a single up-front calibration was measured reporting `k = 1.04` while the solves
it normalised ran 1,335 ms (contention is bursty). **And the calibration workload had to grow to
32 M iterations (~27 ms): anything shorter FITS INSIDE ONE SCHEDULER QUANTUM and reports exactly
1.00 under any load** (4 M reads 3.6 ms quiet AND 3.6 ms at load average 110). Budgets unmoved; all
five pins falsified by mutation; 5 consecutive green suites + green under 10 extra spinners.

## WHAT SHIPPED (by slice)
- **S3a** `lib/geo/bestSpotScoring.ts` — 54 leaves, `CLASS_OF` invalidation table, `resolveScoring` /
  `sanitizeScoringPatch` / `scoringHash` / `scoringDiff`, PHYSICS/SAFETY/HONESTY blocks with **no key
  path from a patch**, EVERY-FIELD-IS-LIVE walk. **R7** `M_eff = 0.35 + 0.65·M` — exactly 1 for sun
  kinds so **no sun number moved**; median moon night 0.020 → 0.256.
- **S3b GRAZE** replaces `silTangency`'s provenance gate: `cut × Q × dwell`. Grazing 8 km ridge
  **0.0000 → 0.9912**, perpendicular 0.4843; **F↔P r² 0.997 → 0.393**; lattice stability ±20.3 % →
  ±2.3 %. τ stored SPLIT BY SOURCE so `graze.conf.*` is recompose. RED golden table committed first.
- **S3c** `scoreMask` **1.8–1.9×** · **`reachM`** + `openSky` gated on it (truncated disc 0.6633 →
  0.5530, `openSky` 40/40 → 0/40; with `refuseBelowReachM = collarM 400` it withdraws entirely,
  unmapped 0.000 → 0.726, and costs **0 cells** on a good disc) · the fused pass ≡ `cellScore` ·
  the **75 B/cell TERM BUFFER, never `S`** (60 B was a lie: `gap.*` could not be recompose without
  `floorDeg/depthDeg/widthDeg/rhoStar`) · absolute azimuth snapping **0/40 → 36/39**.
- **S3d** long-lived module worker (**126 KiB / 50.6 KiB gz**, astronomy-engine ≈ half of it, no
  three) + client + feed + six tiers + 24/12/6/3 m ladder + 90-frame refinement debounce.
  **Cancellation is cooperative, never `terminate()`** — a `postMessage` cannot interrupt a running
  680 ms rung, and terminating discards the state the next job needs.
- **S4** veil/ink split (`premultipliedAlpha` + a shader with NO `<premultiplied_alpha_fragment>`),
  ONE RG8 `LinearFilter` texture with the ordinal `.g`, `fwidth` contours + density dropout, rim
  falloff, plumb line + **scale spoke** (`max(sin θ, cos θ) ≥ 0.707` at every tilt — the nadir fix),
  top-K markers. **`renderOrder 4`, NOT 9** (9 is the depth-free band → flicker vs the radar).
- **S5** third `planfind` segment + `controls/{InstrumentSlider,ChipRow}` (shared tier, pure leaf).
- **S6** the residency pin — **it was RED as built**: `solveRung` called `buildDsm` unconditionally
  and the hull cache is keyed on `dsm.ground` IDENTITY, so a 2→400 m drag paid 39 hulls against a
  pinned 0. The kernel's own pin was green. Fixed with a `sourcesEpoch`.
- **S7** built-density prior (floor **1/km²** = √(26.6 × 0.048)); an **evidence gate, never a score
  penalty** — it withholds open-sky credit. Rural: 1,225,263 visits withheld, `S>0.6` frac **0.0000**
  (pre-fix 0.470–0.661 uniform). 1 m accessibility every solve; 1 m obstruction behind
  `REFINE THIS SPOT` (measured **1,504 ms**, `obstructionRefined: true`).

## MEASURED, BROWSER
first ink **45.4 ms** warm · refined **523.8 ms** · rungs 3/6/12/24 = 356/90/23/6.7 ms · within-day
scrub and a 2→400 m lift drag both build **ZERO** hulls · radius change **+156** · a weights patch
costs **exactly ONE job** and is `recompose` · drag adds **1.1 ms** to the idle frame.

## OPEN / CARRIED
1. **`terrainPostingM` measures the RENDERED TIN (36–98 m), not the source DEM limit (~145 m L13
   bake).** Honest for the DSM — the DSM is built from exactly those vertices — but the renderer
   refines past L13 at a 1,200 m camera. A source-limit read needs per-tile LOD, not a vertex count.
2. **`blockedNow` is unusable as the cross-model quantity at ANY instant** (see above). The check now
   compares `skylineAltDeg`; the "open" half is a RATIO because `planFeed` sweeps to 3,000 m while
   the disc's evidence reaches ~407 m.
3. `graze.conf` / `reliefHiDeg` are unswept judgements and now LIVE — the first taste-pass targets.
4. The mask-ratio pin (1.74× vs a 1.7 floor under load) and the fused-score pin (428/450) are the
   two thinnest; `spin()` cannot see memory-bandwidth contention (a 100 MB streaming pass reads 1.69
   where register arithmetic reads 1.00). A streaming calibration is the fix if either goes red.
5. **`wix dev` MUST be restarted after this lands** — a new worker entry + store triggers Vite's
   "Outdated Optimize Dep"; every island 504s and nothing mounts. Cost a cycle this session.
6. S8 `/m` twin and S9 MapWindow/MiniMap DOM twin remain deferred by owner ruling.

Related: [[project/wip-2026-08-23-bestspot-heatmap]] · [[patterns/globe-rendering]] ·
[[decisions/session_workflow]] · [[project/dev_environment]]
