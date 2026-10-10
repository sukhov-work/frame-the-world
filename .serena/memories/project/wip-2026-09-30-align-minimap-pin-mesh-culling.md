# wip 2026-09-30 — three owner follow-ups: ALIGN out · the pin follows the walker + the target glyph · user models: the far law + the eye-centred cover

Mode: implement · Standard (`/frame` under investigate-design-v3, portable core; no research agents — the code was read directly,
the diagnosis of item 3 PROVEN in the browser before the first edit). Records: DECISIONS 2026-09-30 · ARCHITECTURE §7a′ (pin
follow) + §7d (streaming) + §7f (ALIGN) · `conventions/globe-tuning.md` (§MS5 "The 2026-09-30 family" + the tail section) ·
`conventions/contracts.md` (world-models) · MOBILE_PLAN header · backlog T149 ruled, T152–T154 new · NSP. RELEASED the
same day on the owner's "deploy everything": ship `891261a` (PR #136) → **v1.36.23 LIVE** (canary 200/200, warm 170/0/0, live globe
gl=true; the edge bundles carry the batch — DECISIONS 2026-09-30b).

## 1. ⌖ ALIGN removed (owner: "confusing and redundant")
Deleted: the chip in `mobile/FpvControls.tsx` `ArLookToggle`, `AR_COPY.aligned`, `camera.requestArAlign` / `arAlignEpoch`,
`ArLookCtx.alignEpoch` + its branch in `scene/arLook.ts`, the orchestrator's `alignEpoch:` line, both `.m-aralign` rules
(fpv.css, ar-camera.css) and the `body.mw-open` hide. The rung notes name the long press: `GYRO ONLY (NO COMPASS) — HOLD AR TO
LINE THE VIEW UP` / `GYRO · ALIGNED (NO COMPASS — HOLD AR TO LINE IT UP AGAIN IF IT DRIFTS)`. Why it is safe: arming seeds the
relative rung from the view (`ladder.align(h, false)`), CONFIRM is the explicit align (`commitCalibration`).
`OrientationLadder.align(h, true)` stays (tested lib method, no UI caller). Guide `mobile-ar` list reworded.

## 2. The pin follows the walker + the RE-CENTRE target
- Rule (pure): `lib/globe/pinFollow.pinFollowDue(walkM, idleMs, FPV.pinFollowMinM 0.05, FPV.pinFollowSettleMs 400)`.
- Re-base: `StylizedTiles.followPinToEye` at the END of the posed block (after `camera.updateMatrixWorld()`), TEMP kind only:
  point = `camera.position − _fpvUpGeo·(fpvEyeM + fpvMeshLiftM)` → `ecefToGeodetic` → seed `tempPinKey / tempPinAppliedM (= the
  point's altM) / tempPinGroundM / tempPinSampled` and `fpvPinKey` BEFORE `setTempPin` (else `tempPinPoint()` resets the ground
  and the pin-change re-seat fires) → `reseatTempBasis(pinP)` (the pin-change re-seat's math, now a shared helper). The mesh
  floor state is KEPT (same column); a pin placed ELSEWHERE still resets it.
- Scope decision (mine, flagged to the owner): EVERY temp-pin FPV walk, not only with the map window up — one rule, one place;
  the mini-map card shows the same two dots. A photo FPV never follows.
- Measured (desktop twin): 84.5 m stick stroll → ONE store write, pin 0.5 cm from the eye, eye moved 2.6 cm across the re-base
  (the terrain ease still converging), u2 jumps unchanged; on a 12 m test-solid roof the floor is kept (eye 1.70 m above it).
- Icon: `panels/MapWindow.tsx` `.mw-recenter` now holds an inline SVG (`.mw-recenter__icon`: ring r 6.25 · dot r 2.1 · four
  ticks; 1.25rem, `currentColor`) — button still 2.1rem × 2.1rem (33.6 px). The guide calls it ⊙ (⌖ is FIND / TRACK / PHOTO
  PINS in the glyph table; ◉ is the EXPLORING chip); `GLYPH_WORDS["⊙"]`, golden row re-pointed.

## 3. User models — root causes + the fix
Measured BEFORE at the owner's pose `#f=48.494722,35.004545,96.3,121.0,-1.0,5.6` (scratchpad probe): 13 world rows known,
1 resident ("Bridge_old_1", centre 1.92 km); `Bridge_1` 4.37 km · `shar` 4.95 km · `bridge_train` 6.57 km idle; the view focus
9.04 km from the eye; cover 12 cells around the FOCUS. AFTER: cover 77 cells around the eye, 9 resident within 5 s.
- Cause A (the clip-in-and-out): `stepViewFocus` sets `_focus` = the forward ray's ELLIPSOID hit (the camera itself past the
  limb) and `reportViewport(focus)` planned a 4 km cover around it — pitch −3° → 3.1 km, −1° → 9 km, ≥ −0.3° → 0 km. A phone's AR
  aim wobbles across that continuously. Fix: in FPV report the EYE + `MODELS.fpvFetchRadiusM` 16 km (`maxCells` 96); the store
  sends the cover 16 cells a query (`fetchWorldCover`, parallel, merged by id, one failed chunk fails the read). The route and
  `MODEL_WORLD_MAX_CELLS` are unchanged.
- Cause B (never loads): residency = `distM ≤ 3 km` to the model's CENTRE. Fix: THE FAR LAW in `planResidency` —
  `farLoad = inView && frac ≥ 0.02 && dist ≤ 16 km`, `farKeep = resident && frac ≥ 0.012 && dist ≤ 18 km` (no view needed to
  keep); far rows after every near row, in view first then frac desc; `skipped` counts a refused far LOAD. Helpers:
  `modelReachM` (scaled box diagonal + pivot radius), `apparentFrac` (extent / (dist · 2·tan(vfov/2))), `inViewCone` (a cone to
  the frustum's corners + the sphere's angular radius + `farViewMarginDeg` 3). The scene reads the lens from the projection
  matrix (`1/P[5]`, aspect `P[5]/P[0]`).
- DEV seam: `__globe.userModels().models[]` carries `distM / frac / inView` of the last plan.
- The loaded bounds replace the record's bbox in `e.sizeM3` (a test GLB must be the size its record says, or the far law drops it).

## Gates
vitest 3,295 / 222 (3,276 / 221 before) · astro 0/0/12 · `scripts/verify-followups-2026-09-30.mjs` 53/53 on a fresh Chrome (leg A: a
SYNTHETIC world — `/api/world-models` + the GLBs fulfilled over CDP `Fetch`; leg B desktop pin follow; leg C /m) · regressions:
fpv-carry 29/29 · ar-look 38/38 · ar-calibration 66/66 · qaslice-cab ALL PASS · mobile-batch 127/127 · mobile-fixes ALL PASS.

## Traps learned
- An AGEING house Chrome (30 min, four sessions) dropped a CDP `keyUp` (the walker walked on; 7 cascading FAILs) and then hung at
  100 % CPU with `/json` silent → `close-verify-chrome.mjs` + relaunch; the harness now reads the page's own key log.
- zsh does not word-split `$h` in `for h in "a.mjs 9333"` — six MODULE_NOT_FOUND; chain harnesses through a bash script.
- `verify-perf-baseline`'s model ramp assumes one resident baseline per run — pose-dependent now (T154).
- `wix dev` start: a compound `rm -rf … && mv … ; npx wix dev` was denied by the permission layer — `mv` then `npm run dev`.

Related: `mem:project/wip-2026-09-25-mobile-ux-pass` (the ALIGN cell this removed) · `mem:project/wip-2026-09-22-ar-ui-rework-fpv-quirks`
(the pin-change re-seat + the mesh clearance) · `mem:project/wip-2026-09-02-mesh-suite-ms5` (residency + the cover).
