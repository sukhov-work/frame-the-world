# Track C — Tests + math integrity

Format: one assertion per item, then `— check:` and `— anchor:`. Authored 2026-08-13; re-mine
DECISIONS since the baseline anchor at every audit start and append dated items.

TOC: 1 literature vectors · 2 golden gates · 3 trap→test coverage · 4 tests-alongside ·
5 tier honesty · 6 staleness/duplication · 7 suite speed · 8 goodhart guard

1. Load-bearing math is tested against LITERATURE vectors, not self-derived expectations:
   FOV (sensor DB + focal35), geohash, projection (ecefToGeodetic round-trips,
   rayEllipsoidIntersect), ephemeris (JPL-Horizons ±0.05° spot checks, Dec-21 subsolar −23.44°),
   kepler (Hale-Bopp ≤2′, Ceres ≤30″), moonlight (K&S-1991 quarter ≈ 9.1% — corrected
   2026-08-13 audit #1: the polynomial 10^(−0.4(0.026α+4e−9α⁴)) gives ≈0.0911 at α=90, which
   is what moonlight.test.ts asserts; the earlier "10.3%" here was wrong), and every new
   Phase-8 lib lands with its vector (NPF D850 ≈ 16.3 s · NGP↔GC round-trip · equinox/solstice
   twilight sanity).
   — check: map each `lib/{geo,ephemeris,sky}` module → its test file → the cited external
   vector; flag self-referential tests (asserting the code's own output).
   — anchor: /frame Phase-3; ASTRO_ENGINE plan DoDs; IMPLEMENTATION_PLAN §Phase 8 DoD.
2. Golden gates stand and still bite: `skyBudget.test.ts` (horizon glow < BLOOM.threshold),
   `lazyContract.test.ts` (walks ALL of src/, heavy-module static-import fence), quality-tier
   locks (high == pre-pass constants). A gate weakened/bypassed since baseline is a MAJOR.
   — check: git diff the gate tests since baseline; run each; confirm walk roots/thresholds
   still cover new code (new src dirs, new tuning groups).
   — anchor: S7-feedback batch (skyBudget); Phase A (lazyContract); quality.test.ts INVARIANT.
3. Trap→test coverage (Pesticide Paradox): every DECISIONS §Traps class that CAN be a cheap
   unit/static test HAS one (heightAt clamp consumers, zenith overflow clamp, MVT clip-at-parse,
   [hidden] CSS pairs are candidates); mine traps added since baseline and list the testable
   ones not yet encoded — that list is a standing audit deliverable.
   — check: walk §Traps top-to-bottom; classify each testable/untestable; diff against existing
   test files.
   — anchor: references/audit-mode.md step 2; DECISIONS §Traps.
4. Features ship tests ALONGSIDE (never after): every feature DECISIONS line since baseline
   names its test delta (+N); pure-visual work states why it has none (browser-tier only).
   — check: walk DECISIONS lines since baseline for the vitest delta.
   — anchor: /frame Phase-2; working agreements.
5. Verification-tier honesty: no DECISIONS/report claim says "verified" for browser/cloud
   behavior on unit-test evidence alone; tiers are named (local / browser-VERIFIED /
   wix-cloud-VERIFIED / UNVERIFIED); UNVERIFIED tags resolved by later ships get swept (the
   stale-tag class).
   — check: spot-read recent DECISIONS lines; grep docs for UNVERIFIED tags whose subject has
   since shipped/released.
   — anchor: /frame Phase-3 header; epistemic stale-tag lesson (imported 2026-08-13).
6. Test staleness + duplication: no test pins SUPERSEDED behavior (removed features — e.g.
   grow-on-zoom-era helpers — leave no orphaned tests/fixtures); shared math helpers live once
   (no copy-pasted deg/rad, WGS84, fixture builders across test files).
   — check: `npx jscpd test/` (if available) + grep for known-removed feature names; sweep
   test/helpers duplication.
   — anchor: Track E; 2026-07-11 pre-S7 refactor precedent.
7. Suite speed guard: the vitest wall stays seconds-class (~2 s at 704 tests, 2026-08-13);
   a slow test (>1 s single) names its reason or moves behind a flag — a slow suite stops
   being run.
   — check: `npm test` duration vs the dated baseline; list tests >1 s.
   — anchor: this file (dated baseline).
8. Goodhart guard: no single metric is the verdict — "tests green" never substitutes for the
   browser tier; fps-governor numbers never substitute for visual checks (shots); patch-mean
   ratios never substitute for a landmark look (the 2k-bake pattern: numbers AND eyes).
   — check: report language + recent session evidence pairs (number + shot) for visual changes.
   — anchor: laws.md (Goodhart); 2026-08-13 milkyway bake verification shape.
