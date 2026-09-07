# wip 2026-09-07d — the audit's rulings executed (T110 FINE bins · T112 BEST EFFORT · T111 the skyline FOLD) + T106 re-shaped (EdgesGeometry + the string mask on integer keys) — DONE

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-07d: proceed with the brief;
**T110 + T111 per my recommendation**; **T112 "best effort even below 50 %"** — precise occlusion for long
lenses, desktop at least, mobile unless it costs frames (my call: mobile keeps the full precision).
Records: DECISIONS 2026-09-07d · MEASUREMENTS §23 · backlog T106 re-shaped, T110/T111/T112 FIXED · audit
addendum · NEXT_SESSION_PROMPT refreshed. Gates: vitest 2,829/179 · astro 0/0/11 · knip 0 · pre/post sweeps
12/14 (the same two known rows).

## T110 — the fine profile (lib/geo/horizonProfile + occlusion, scene/planFeed, tuning PLAN)
- `PLAN.azBins` 1440 (0.25°) desktop AND `azBinsLean` 1440; `terrainAzBins` 120 marched coarse then
  `foldCoarseProfile` (known-aware) into the fine profile; meshes/trees write fine.
- `occlusion.sweepMeshEdges`: per-vertex cache (eye-relative f32 + az/alt/dist + prism verdict; module
  scratch keyed on positions/matrix/frame), `raiseSpan` between consecutive samples (≤ 45°), subdivision cap
  scaled with binCount, `sweepMeshEdgesSliced(startTri, deadlineMs)` with a 64-triangle deadline check
  (256 let a 10 ms frame through on the phone twin). `azAltOfRelInto` = the allocation-free az/alt.
- `planFeed`: the mesh phase is bounded by TIME (`PLAN.sweepBudgetMs` 3 / `sweepBudgetMsLean` 1.5,
  `meshesPerFrame` 4 as the ceiling, `triCursor` resume, ≥ 1 chunk per frame); `debug().sweep`; the
  orchestrator keys `azBins`/`sweepBudgetMs` on `lean`; DBG rows `planning.sweepMs/sweepTotalMs`.
- MEASURED (`scripts/probe-skyline-fine.mjs`, `--lean` = touch + 402×714@3 + 4 cores + 4× CPU throttle):
  desktop 200 mm pose 60 meshes 56 ms / 22 frames / worst 3.2 ms; twin ~250 ms / ~130 frames / worst 3.2.
  14 % of the horizon read > 0.5° lower than the 3° box-max.

## T112 — best effort per bin
- `store/plan.profileKnown` (identity-stable beside `profileBins`); `sampleBinsKnown` (both known → lerp; one
  known → its value over ITS OWN span; none → null); `sampleProfile` = that ?? floor; `skylineSamplerFor(gate)
  → SkylineView {altAt, coverage, partial}` = THE gate (real eye + `withinGuard`; NO coverage clause;
  `skylineBinsFor` deleted); `mirrorSampler(bins, known)` for consumers whose eye is the anchor.
- Radars: `fractureRunsBySkyline` keeps null samples in the run (plain band). aimCones takes the view.
- Libs: `ProfileFn → number | null`; `skylineVerdict` (frameFinder), `horizonVerdict` (sunEventFrame),
  `traceStates` → "unknown" per sample; the rail's dotted `trace-unknown` path. `PlanBodyState.skylineKnown`.
- Fence: `test/components/skylineConsumers.test.ts` (every `s.profileBins` reader reads `profileKnown`,
  uses `mirrorSampler`/`skylineSamplerFor`, never `sampleBins`). `PLAN.minCoverageForGaps` stays for BEST SPOT.
- Side finding fixed: the store-mirror signature now carries `mirrorSerial`.

## T111 — the skyline fold
- FpvHud rows: `BEHIND SKYLINE` badge from `store/plan.sun/moon` when `marker.up && skylineKnown &&
  blockedNow && skylineAltDeg > 0` (a real obstruction — a sun under the bare dip is "set"); SkyGotoChips
  `fh-chip--behind`; `marker.up` stays geometric (skyAim GOTO).
- Both rails: `AltSample.azDeg`, `curvePathsByState` → `.ts/.md-curves__body--blocked` dashed.
- MeteorsCard `✕ SKYLINE`; `EclipseRow.peakAzDeg` (solar via Equator/Horizon topocentric); TargetPanel +
  TargetSheet: `useSkylineAt(latKey, lonKey)` + `peakBehind` → `· BEHIND SKYLINE` on eclipse + NEXT SESSIONS
  rows (parity fence green).
- dayArcs + skyTrail: `skylineFold()` multiplies `aFade` by `DAYARC.skylineBehindAlpha` 0.35 at rebuild;
  `update` ctx gains `skyline {sample, key}` (the orchestrator's `arcSkylineFor(anchor)`: plan eye within
  `skylineGuardM`, key = `profileBins` identity); `__globe.dayArcsFold()`. Verified: sun 102/145, moon 137/145
  folded at the street eye; shots `verify-shots/t111/03-*.jpeg`, `04-m-*.jpeg`.

## T106 — re-shaped (the two hot loops)
- The Pixel profile by LEAF: three `EdgesGeometry` 1,832 ms + string-keyed mask 873 ms (not the fingerprint).
- `lib/globe/fastEdges.buildFastEdges` = three r0.185's algorithm with its quirks on integer keys (0.1 mm
  rounded ids via open addressing, `ua·N+ub` directed edge keys, the same normal math, emission order kept) +
  `srcIndex`; `enrichedMask.segmentRunsFromSources` (the party-wall rules on exact-bit keys, −0 folded);
  `scene/edgesGeometry.buildEdgesGeometry` (falls back to three for non-plain attributes) in BOTH handlers.
- Seams: `__globe.enrichedLoad()` (handler ledger) · `__globe.enrichedBench(n)` (in-page A/B + identity).
- In-page A/B on resident cells: desktop 33 cells 527 → 57 ms edges, 240 → 17 ms mask; twin 17 cells 865 →
  114, 455 → 33; mismatch 0/0. Left: the biggest cell's whole handler 65 ms on the twin → slice (b).
- TRAP: a multiply-xor hash on float bits put every vertex in slot 0 (350 ms quadratic) — murmur finalizer.

## Traps learned
- `--compare pre` at tolerance 0 has a streaming/LOD noise floor (a whole imagery tile 13 %); prove pixel
  identity at the seam. The first post sweep overlapped `src/` edits (HMR) — discarded, re-run as `post2`.
- `Emulation.setEmulatedMedia` does not flip `matchMedia("(pointer: coarse)")`; use touch emulation.
- `set…CPUThrottlingRate 4` + the phone metrics is the desktop's phone-shaped main thread.
