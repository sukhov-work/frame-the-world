# wip 2026-09-06n — T77: the five owner rulings (2026-09-06m) executed

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order: "proceed with plan from
NEXT_SESSION_PROMPT.md". 2026-09-06 ≈21:33–23:00 local (UTC+3).

## Boot
- The l session's ship hook was STILL RUNNING at boot (fired on `/clear`, 21:32:53) — waited for
  it: PR #106 landed, master 71af0b7 == origin/master, clean, no SHIP_ATTENTION. Trap: `/clear`
  fires SessionEnd → the ship; never edit the tree until `ftw-session-ship.log` says "back on master".
- VPN FI, ion 401, budget 0/1 · 0/1 · 85 %. `wix dev` restarted with `.vite` aside; house :9333.
- Pre sweep `pre-2026-09-06n --quiet-s 25`: 11/14 (the Δ1 ease step at cityscape + fpv-eye, T103).
- Two edit-only agents in fresh worktrees `../ftw-wt-t92` (T92) and `../ftw-wt-t93` (used for T101),
  focused vitest only; patches in `~/.claude/ftw-wt-patches-2026-09-06n/` + `reports/`.

## Results (MEASUREMENTS §17; DECISIONS 2026-09-06n)
1. **T80 CLOSED + T104 DONE** — `verify-perf-baseline` prints `dt−gpu (T104)` (`!` when gpu > dt);
   every bloom-ON cell −2.6…−4.4, every bloom-OFF +2…+3; the T77 gate re-stated on dt p50 ≤ 15 (MET 14.2).
2. **T100 — frame challenge (from the k2 ladder logs, BEFORE editing):** at the failing rung the
   overlay/directShareK/directK were already 0 — the +4.9 codes are the OVERLAY retiring with the
   key's extinction, not the field band; the base rig reads 0.00 only because its look darkens 40
   codes across the ladder (ULTRA 5); RC2 0.0508 is chip-OFF. Built as ruled anyway:
   `ULTRA.shadowReleaseStartSin` (sin 0.2°) + `shadowReleaseBandSin` (0.0093) → `ULTRA_FIELD_RELEASE`
   via `fieldProfile()` on the chip's REACH condition (T96 allow-list entry `? ULTRA_FIELD_RELEASE`),
   `fieldBandTopSin` published, ladder +1 check per rig (19). Ladder u1: band landed, **T66 still
   fails 4.23** (was 4.94; moved to −0.14°); A/B arms E-a 4.67, E-b 3.82; invariant: in-shadow band
   67.4 at +0.5° → 75.0 at −0.5° on every arm. u0 19/19 byte-identical. Shipped the ruled default;
   OWNER CALL = the overlay's retirement (keyExtinctCurve tail) or re-state T66 (NEXT_SESSION §OWNER CALL).
3. **T101 DONE** — `ENRICHED.reseatDeepPendingHold`, `deepAnswerVerdict()` (seatQuiet), `CellSeat.deepPending`;
   arrival `rejected` +39,629 → +2 (`deepHeld` +2, pendingCells@end 0, end 0.000, collapsed 0).
4. **T92 DONE** — `FOCALCONE.fillTiltFadeStartDeg` 50 → `fillTiltFadeEndDeg` 70 on the LIVE orbit tilt
   (`focalConeFillTiltK`, exactly 1 below 50°); probe: tilt 74.9°, fill alpha 0, edge 0.700.
5. **T93 RE-CLASSIFIED + FIXED** — the toggles (luma profile; new `atmo-off` in `probe-sheets`): the
   band is far TERRAIN hazed by `ftwAerial` toward `tint × ftwAirLevel(cosG)` (~0.25–0.5 for a
   horizontal ray under a high sun) → darker than itself (84–89 under a 205 sky); NOT the earth, NOT
   the far plane. Fix: the LEVEL lobe relaxes to isotropic past `ULTRA.limbStartM` 40 km (fully by
   `limbEndM` 120 km; `limbGlsl`/`limbK` in scene/glsl.ts; `aerialLimb.test.ts`): band 84–89 → 149–153,
   the near field byte-identical by construction (every other catalogue pose < 40 km reach).
   150/350 first lifted only the far third — the darkening completes by ~100 km. The zoom sweep's
   FPV wedge is a separate shape (open under T93).

## Owner ruling 2026-09-06o (same session, after the report)
"t100 record for next session to go with your reccomendation" → **T100 option (a): spread the
OVERLAY's retirement** (DECISIONS 2026-09-06o, backlog T100, NEXT_SESSION §T100 — the first slice
next session). The owner's two questions (T77 standing vs the plan; phones) answered in
NEXT_SESSION §Where T77 stands: MEASURE done · slice 0 done but `compileAsync` · A done/closed but
lever 3 not built · B done but 7/8 deferred · C UNMEASURED · D NOT STARTED (phones measured, never
fixed; re-measure first, then T83).

## Gates
vitest 2,748/2,748 (175) · astro 0/0/9 · knip 0 · ladders 19/19 base, 18/19 ULTRA · reseat (above) ·
focalcone 7/7 · horizonband PASS · charter / ultra / uxbatch4 / post sweep → DECISIONS n.

## Traps learned
- A GLSL comment inside a template literal must not contain backticks (it broke the served bundle
  for ~30 s until fixed).
- The T96 fence: any new `ultraOn` read must be written onto the COST allow-list with its reason.
- `probe-sheets` shots are not frozen: boot-to-boot Δ1 noise on 0.4–10 % of pixels; prove
  byte-identity by geometry + unit test, or use the sweep's `--freeze`.
