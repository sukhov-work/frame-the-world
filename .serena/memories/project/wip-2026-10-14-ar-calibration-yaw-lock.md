# wip 2026-10-14 — AR CALIBRATION: the drag is YAW-ONLY by default · ↕ PITCH frees both axes (owner order; "a very small functional tweak … make sure not to regress … iPhone … both farm tests and chrome tests")

Mode: implement · Quick (`/frame` under investigate-design-v3, portable core; no research agents — one surface, the code read
directly). Records: DECISIONS 2026-10-14 (+ 2026-10-14b for the release + the farm) · ARCHITECTURE §7f (the calibration paragraph) ·
MOBILE_PLAN header · backlog **T164** (the carry harness's pre-existing leg) · the guide `mobile-ar-camera` (a 6th step) · NSP.

## The change (five src files, one pure function, one store flag, one cell)
- `lib/sensors/arCalibration.ts`: `ArCalAxes = "yaw" | "free"` · `AR_CAL_AXES_DEFAULT = "yaw"` · `gateAimDelta(d, axes)` — yaw-only
  keeps the yaw WHOLE (the stroke's lateral component, never a projection of the diagonal) and zeroes the pitch; `"free"` passes both.
  The pinch (`spread`) is not an axis and is never gated.
- `store/camera.ts`: `arCalAxes` + `toggleArCalAxes()`; `setArCam("calibrate")` resets to `"yaw"` on EVERY entry — a per-visit
  toggle, never persisted (nothing new in `ftw:ar-calib:v1`); **the gate lives in `stepArCalDraft`** (every caller obeys the lock,
  the pad stays a dumb pointer-delta feeder — `CalibrationPad` still calls `dragToAimDelta` bare).
- `mobile/ArCameraOverlay.tsx`: a FOURTH `.m-act m-act--icon` cell **↕ PITCH** (`data-act="ar-cal-axes"`, `aria-pressed`,
  `m-act--accent` only while on — CANCEL's ink while off; `AR_CAL_COPY.pitch`) at the TOP of `.m-arcal__actions`: ↕ PITCH · CANCEL ·
  RESET · CONFIRM top-down (the owner: "just above cancel"). The column is bottom-anchored → it grew one 44 px cell UPWARD; no CSS
  geometry rule changed (ar-camera.css comment only). The twin: tops 112 · 164 · 216 · 268, bottom 312 vs the stick 324, the strip 46–69.
- Tests: `arCalibration.test` (the gate: whole yaw, a clean 0 pitch — never −0, free passes through, a yaw-only `stepCalibration` step
  moves yaw + the pinch only) · `mobileArCamera.test` (the lock on entry, the toggle, the per-visit reset after CANCEL and after
  CONFIRM, the 4-cell DOM order, `aria-pressed` + the accent, the source fence: the store's `gateAimDelta` line + the pad without it —
  COMMENTS STRIPPED, the fence caught its own header comment first). The two CONFIRM tests that expect a pitch now toggle first.

## Verification
- Gates: vitest **3,368 / 225** (3,363 → +5) · `astro check` **0 / 0 / 26 hints** (23 → 26; none in the edited files).
- `verify-ar-calibration` **74/74** (was 66; `--shots` → `verify-shots/ar-cal-02-calibrating.jpeg` + `ar-cal-02b-pitch-free.jpeg`):
  a 60 × 30 px DIAGONAL under the lock = −5.01° yaw (want −5.00) / 0.00° pitch, the view's pitch −0.03 → −0.02, the readout
  `YAW −5.0° · PITCH +0.0°`; ↕ PITCH tapped → a 30 px vertical drag −0.03 → +2.49° with the yaw untouched; CONFIRM stores −5.01 / 2.51;
  the next entry (after a CONFIRMED free visit) is yaw-only again.
- Regressions in turn on the one house Chrome: `verify-ar-look` 38 PASS · 0 FAIL · `verify-mobile-batch-2026-09-08` 127/127 ·
  `verify-mobile-fixes-2026-09-18` ALL PASS · `verify-fpv-carry-2026-09-22` **27/29 — PRE-EXISTING, PROVEN**: the same two
  mesh-clearance checks fail identically with the change, on a re-run, and with `src/` STASHED back to `b32b4fb` → T164.
- The farm leg: `tools/devicefarm/ios-ar-axes-2026-10-14.mjs --prod` (DOM reads only: the strip's `YAW · PITCH · mm` readout parsed,
  the cells' `aria-pressed`, the HUD's PITCH cell as the second witness; a NATIVE hold opens calibration — the AR chip's own 500 ms
  timer while AR is on; the motion + camera sheets accepted through `getAlertText`/`acceptAlert`; a native 90 × 60 pt diagonal from the
  screen centre in eight legs). Dry run OK (iPhone 17 Pro iOS 26.3.1 HIGHLY_AVAILABLE). Runs on the LIVE site after the release.

## Traps learned
- The first `wix dev` after moving `.vite` aside serves `504 Outdated Optimize Dep` for EVERY dep — the globe never boots ("globe up"
  times out at 90 s with no page error beyond the island hydration failures). Restart once, `curl` `three.js` / `zustand.js` /
  `astronomy-engine.js` from `/node_modules/.vite/deps/`, then the harness.
- A source-scan fence (`expect(src).not.toMatch(/gateAimDelta/)`) catches its own doc comment — strip comments before matching.
- `git stash push -- src/` + the harness + `git stash pop` is the cheap "is it mine?" proof for a harness failure (≈ 4 min); the
  dev server HMRs but the harness boots fresh pages. An ancient unrelated `stash@{0}` (branch `claude/t80g`) lingers — leave it.

Related: `mem:project/wip-2026-09-19-ar-calibration-box-meshbugs` (the calibration's birth) · `mem:project/wip-2026-09-22-ar-ui-rework-fpv-quirks`
(the column) · `mem:project/wip-2026-09-25-mobile-ux-pass` (CONFIRM at the bottom) · `mem:project/wip-2026-10-13-collision-lighting-building-colour` (the sticky box T164 touches).

## RELEASED + THE FARM (DECISIONS 2026-10-14b) — v1.36.30 LIVE (ship `e5edaac` PR #143), farm-verified on the iPhone 17 Pro
- Ship: the hook in the foreground → `claude/ship-20261014-013751` → landed after 60 s, mirror synced, `package.json` 1.36.30. Release: the
  comment 244 bytes; **set `FTW_SHIP_DAEMON=1`** so `release.sh` runs inline (else it re-launches itself detached and a background Bash returns
  at once); canary 200/200 · warm 170/0/0 · `verify-prod-globe` gl=true; the edge's `MobileShell.DWhJHxHJ.js` carries `ar-cal-axes`.
- The farm, run 1: **a WebDriver `element.click()` on the AR chip is not a user activation** — TAP AGAIN flashed, no motion sheet (the
  2026-09-07 finding again). Run 2: **a NATIVE XCUITest tap (`performActions`) raised "Would Like to Access Motion and Orientation",
  accepted → AR armed** — the first farm run ever to arm AR. A native 850 ms hold → CALIBRATE AR + the camera sheet, accepted (T147 q3).
  The locked native 90 × 60 pt diagonal: `YAW −41.7° · PITCH +0.0°` (the phone lay face-up — HUD PITCH −79.8° — so the `cos(pitch)` floor
  0.2 made 90 pt worth 42° of yaw; the lock is what was measured); ↕ PITCH on → `YAW −83.4° · PITCH +5.6°`; CANCEL kept nothing; a second
  hold re-opened LOCKED (no camera sheet the second time). **11/12 — the FAIL was the harness's A2b: WebKit returned the shorthand
  `borderRadius` undefined; `borderTopLeftRadius` now (fixed after the run, not re-run).** PNGs + JSON:
  `verify-shots/perf/devicefarm-ar-axes-1014-2026-10-13T22-50-56*`.
- Traps: `getAlertText` polling prints a webdriverio ERROR line per miss (harmless noise); read a longhand through `getComputedStyle` on
  the device; the ↕ PITCH cell's `sameInk` vs CANCEL flips to false once lit (expected — the accent).
