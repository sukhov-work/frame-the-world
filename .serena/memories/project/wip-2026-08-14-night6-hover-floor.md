# WIP 2026-08-14 night-6 — FIND standings: sky-aware pick floor + label lift [desktop-VERIFIED; session continues → M3c]

Owner bug: "some standings ignore mouse hover, seemingly at random" (repro
`#f=48.449313,35.102246,1.7,250.6,2.5,20.9&t=1786728571688`, moon standings 15.08·11% vs
12.01·21%) + "date labels get lost in day/twilight".

## Root cause (browser-measured, exact to 4 dp vs rendered DOM)
`findGhosts.pick()` gated on a FLAT `FINDGHOSTS.pickMinAlpha 0.08` while at civil twilight
(sun −5.8°) EVERY moon standing's effective alpha ran 0.026–0.079 (ramp × engine visibility ×
melt) — rings plainly visible (ringAlphaGain 2.2 widens the drawn band on a dark sky) but
hover+click dead. Labels worse: gate `labelA ≥ labelMinAlpha .06` hid 5/6, the shown one at
opacity 0.067. "Random" = the twilight visibility score drifting across the flat threshold
minute-by-minute.

## Fix (scene/findGhosts.ts + tuning.ts)
- NEW pure `findPickFloor(sunAltDeg)` (exported, 5 tests
  `test/components/globe/findPickFloor.test.ts` incl. the −5.8° repro pin < 0.026): smoothstep
  blend `pickMinAlphaNight .015` ("if it draws, it responds"; shader discard ≈.012) →
  `pickMinAlphaDay .08` (washed-invisible ghost must not steal a day sky click) across
  `pickSunAltLoDeg −8 → pickSunAltHiDeg +2`. update() recomputes per frame from
  sunDirW·geocentric-up; pick() + label gate use it.
- Label gate UNIFIED with interactivity: label shows iff `effAlpha ≥ pickFloor` (hoverable ⇒
  labeled; `labelMinAlpha` knob DELETED).
- Label display lift: `opacity = labelLiftA .32 + labelA·(0.95−labelLiftA)` — twilight labels
  0.02–0.07 → 0.33–0.36; day sun corridor 0.42 → ~0.57. Monotone, hover still brightens.

## Verified (desktop CDP :9222, wix dev :4321)
- Twilight moon: 6/6 standings hover (sceneHoverKey sweep matches keys), all labeled;
  shot `verify-shots/find-hover-fix-01-twilight-hover-1201.jpeg`.
- Day sun corridor (17:29, sun +23°): 24 standings eff .45–.50 all interactive, labels ~.57,
  every-3rd-day de-clutter intact, near-live-disc nowGap melt intact;
  shot `verify-shots/find-hover-fix-02-day-sun-corridor.jpeg`.
- Gates: vitest 856/856 (+5) · astro 0 err/5 hints.
- Hysteresis safe: hoverBoost×1.9 only ever RAISES alpha above the floor once picked.

Taste knobs NEW: `FINDGHOSTS.{pickMinAlphaDay .08, pickMinAlphaNight .015, pickSunAltLoDeg −8,
pickSunAltHiDeg 2, labelLiftA .32}` (replaced `pickMinAlpha`, `labelMinAlpha`).

Related: [[project/wip-2026-08-14-find-accuracy-labels]] [[project/wip-2026-08-14-find-rework]]
