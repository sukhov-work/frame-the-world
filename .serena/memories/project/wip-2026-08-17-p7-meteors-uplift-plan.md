# wip 2026-08-17 — P7 meteor showers SHIPPED (desktop) + UPLIFT_PLAN.md authored

## What shipped (Phase 8c P7 + R12)
- **`src/lib/ephemeris/showers.ts` (NEW)** — 21-row hand-curated bake (IMO cal2026 Table 5/6 +
  IAU MDC streamfulldata + Jenniskens 1994 B slopes; provenance + refresh path in the header;
  NOT Stellarium's GPL showers.json). `ShowerRow`: λ☉ window/peak · radiant + deg/DAY drift ·
  zhr (null = Var outburst rows JBO/AMO) · r · Vg · parent · per-side B (`bAsc`/`bDesc`,
  default 0.19 — there is NO general 0.9; GEM 0.39/0.72 asym, QUA 1.4/2.2).
- **λ☉ convention (the trap):** IMO/MDC use EQUINOX J2000. astronomy-engine `SunPosition()` is
  OF DATE → ~0.37° ≈ 9 h early in 2026. `sunLambdaJ2000` = `Rotation_EQJ_ECL` on the EQJ sun
  vector (anchors: 2000 equinox 0.001°, 2026-01-03 19:00 UT = 283.048°). `lambdaToMs` = Newton
  on mean rate (3 iter). **λ rate varies ±3% (Dec fast/Aug slow)** — tests must re-derive Δλ
  from real λ☉, never day-count × 0.9856 (that was the only test failure class).
- Model: `zhrAt` = ZHR·10^(−B|Δλ|) clipped to window; `visibleRateAt` = ZHR×sin(alt), γ=1;
  `showerNights` = darkness (sun<−18) ∩ radiant-up scan, moon interference = mwSeason
  convention at the night peak, **score = peak RATE × (1−i)** (≠ mwSeason minutes-shaped —
  firewall documented both headers); `meteorRateSeries` (rail feed); `upcomingShowerPeaks`
  (120 d, Var rows ride date-only).
- **Radiant = tracked target:** `showerTarget` in targets.ts (id `shower:PER`, kind "shower" —
  TargetKind/glyph ☄/OTYPE were pre-seeded; drifted per-call stateAt; magnitude null contract;
  facts member `{kind:"shower", row}`; `targetShortName` → code). Catalog three-touch:
  `showerEntry` (boost 0.9) + skyIndex spread + `shower:` branch in targetById. Everything
  (reticle/trail/ghosts/windows/edge chips/prefs persistence) inherited.
- **Surfaces:** TargetPanel `ShowerFacts` (apparition dates solved from λ☉ per scene day);
  PlanPanel `MeteorsCard` (MwCard grammar; row = setTime(best-night peak)+setTarget(radiant));
  TimeScrubber meteor layer (R12): `meteorPath` filled area y39→22 normalized to own ZHR,
  `--color-star` (meteors are shooting stars), only when tracked target IS a shower;
  CSS needs `path.`-qualifier to beat `.ts-curves path{fill:none}`.
- Tests: `test/lib/ephemeris/showers.test.ts` (22) — equinox/precession anchors, PER 2026 =
  Aug 12–13, GEM asymmetry, invariants re-derived from primitives, two-path agreement, table
  coherence sweep. **Gates: vitest 908/908 · astro 0 err/5 hints.**
- Browser-VERIFIED (wix dev + Playwright): search "perseids" → ☄ row → track → THE SHOWER
  facts → METEORS card 8 rows → ORI row click pins 2026-10-22 06:00 + tracks shower:ORI →
  rail area peaks at cursor. Shots `verify-shots/p7-01/02`. Console errors = pre-existing
  noise (play.google 401, anonymous members 403).

## Open tails (P7)
- Owner taste: METEORS card copy/row cap · meteor layer colour/height · "ACTIVE NOW" chip idea
  (a tracked in-window shower whose peak PASSED — e.g. PER on Aug 17 — has no card row; card =
  upcoming maxima only, by design).
- TargetPanel prints the CATALOG-magnitude footnote for null-mag targets (pre-existing — GC
  does the same); left untouched.
- /m twin rides M4. Real-device pass rides T1.

## UPLIFT_PLAN.md (NEW — the next-sessions ladder, owner 10-point order)
`claude-docs/UPLIFT_PLAN.md`: U1 2D-first mobile (+pinch hardening) → U2 FPV stability → U3
fullscreen map + FOV cone → U4 direction lines/visibility cones (PhotoPills-style, amber
past/blue future) → U5 closest-first loading → U6 foveation → U7 terrain precision (Dnipro) →
U8 per-building height override (localStorage). Evidence from 3 parallel scouts, all file:line
in the doc §1. Load-bearing (browser-UNVERIFIED hypotheses, high confidence):
- **FPV bug mechanisms:** governor tier-down + library LRU `minBytesSize` 0.3 GB floor >
  mid/low caps → permanent isFull → mass evict/re-stream ("full re-render") + enriched re-seat
  ("altitude change"); banked `zoomDelta` discharges at FPV exit ("jerk to orbit"); per-frame
  unsmoothed heightAt (temp-pin eye + enriched group seat); stale one-shot
  setResolutionFromRenderer after resize.
- **Foveation hooks are real:** LoadRegionPlugin RayRegion/SphereRegion; `loadAncestors=false`
  flips to distancePriorityCallback (closest-first).
- **Pinch leaks:** both viewport metas unrestricted; touch-action only 9 sites; /m minimap,
  .m-bottom, .m-actions, sheets, scrim bare; desktop canvas has NO touch-action.
- **U8 identity:** enriched `_FEATURE_ID_0` runs are per-building + already rewritten per
  frame (extrude feasible), but featureId is bake-sequential (OSM id DROPPED in overpass.mjs)
  → override keys need centroid checksum now, baker OSM-id fix at next re-bake.
Owner open questions live in UPLIFT_PLAN §4 (defaults attached, none blocking).

## Queue after this session
U1 (2D-first mobile) is next per owner order; P8/P9 + M4 resume after the ladder.
DECISIONS line: 2026-08-17-p7-meteors+uplift-plan.
