# wip 2026-08-13/14 (session 4) — MOBILE M2: FPV touch — SHIPPED

Mode: implement (investigate-design-v3, Standard). Gates at exit: **vitest 738/738 (+2)** ·
astro **0/0/6 hints (= baseline)**. Phone-viewport (402×874) **browser-VERIFIED** (headed Chrome
CDP :9222 + wix dev :4321; shots `verify-shots/mobile-m2-01..02`); **REAL-DEVICE tier UNVERIFIED**
(pairs T1 — wake-lock physical dim + stick feel on glass). DECISIONS 2026-08-14 line = twin.
Working tree UNCOMMITTED (session-end auto-ship hook).

## What shipped
- `store/camera.ts` — `fpvWalkInput {fwd,right} −1..1 | null` + `setFpvWalkInput` (per-axis
  clamp). **DELIBERATELY NOT in clearAllTargets**: noteInteract fires clearAllTargets on EVERY
  canvas pointerdown — in FPV that pointerdown IS the look-drag, and walking-while-looking is
  the joystick's whole point. Divergence asserted by test (`test/store/camera.test.ts` — "SURVIVES
  clearAllTargets"). Backstop: the orchestrator FPV-exit branch calls setFpvWalkInput(null).
- `globe/StylizedTiles.ts` stepFpvPose — stick integrated beside fpvKeysDown into the world-space
  `fpvWalkOffset` (pivot invariant intact: only INPUT mutates the offset). Analog curve:
  **speed = walkSpeedMps · walkStickMaxMult · d²** (rim = Shift-sprint 66 m/s, ~58% deflection =
  arrow 22 m/s, centre = creep; direction normalized by raw magnitude so railed diagonals don't
  overshoot). Tunables `FPV.walkStickMaxMult 3` · `FPV.walkStickDeadband 0.06`.
- `globe/StylizedTiles.ts` onFpvPointer* — **pinch-FOV**: second (non-primary) pointer while the
  look finger is down → `fovTargetDeg = startFov · startDist/dist`, wheel clamps [2.75, 80].
  Look FREEZES during pinch (both fingers move); `fpvLastX/Y` stay fresh so the look resumes
  seamlessly when the pinch finger lifts; either lift ends the pinch; gap <8 px re-seeds
  (div-by-hair guard); `fpvPinchedDuringDrag` suppresses the sky-marker click on lift. Desktop
  mouse path byte-equivalent (mouse is always isPrimary; no second pointer exists).
- `components/mobile/FpvControls.tsx` + `styles/mobile/fpv.css` — WALK joystick (pointer-captured
  pad, unit-disc clamp, KNOB_TRAVEL 0.72, null-on-release + unmount) · ⤒/⤓ hold-to-fly =
  `setZoomRate(±CONTROLS.zoomRateMaxPerS)` (existing encoder identity: strictly vertical, floor
  eyeHeightM 1.7, ceiling tempEyeMaxM) · compact HUD row FOCAL·HDG·PITCH·EYE off `fpvHud` mirror
  (lib/format/readout + focalFromVerticalFov) · **Screen Wake Lock** while mounted (re-acquire on
  visibilitychange; typed via a local minimal interface — lib.dom variance). Mounted by
  MobileShell gated `tempFpv || fpvHud !== null`. **setPointerCapture in try/catch** — synthetic
  pointers (test dispatch) throw InvalidPointerId and would abort the handler.
- `pages/m.astro` — mounts the DESKTOP `panels/MiniMap` island as-is (fence rule 2 exempts
  m.astro; rule 1 untouched). `MobileLayout.astro` body gets `class="m"`: the reposition/shrink
  in fpv.css keys on `body.m .mm` so it wins by SPECIFICITY, not island-chunk CSS order (order
  is NOT guaranteed between mini-map.css and mobile css). 124 px, top-right under the HUD row.

## Measured (browser, CDP :9222, 402×874)
- Walk: 98.96 m / 1.5 s = **65.92 m/s** at full rail (expect 66); release stops dead (0 m);
  0° yaw disturbance.
- **Pivot invariant on touch: 0.0000 m drift** (max mid-drag AND final) across a 45° look-drag +
  reverse after a 99 m walk.
- Pinch: 55°→27.7° on 2× spread (expect 27.5, glide tail); pinch-in clamps at 80° (79.6 mid-glide);
  post-pinch one-finger look resumes (−25.2°).
- Two-thumb: walk CONTINUES through a simultaneous look-drag (39.6 m + 65.6 m through −24.3°) —
  the clearAllTargets divergence proven live.
- ⤒ 1.4 s: eye 1.7→16.88 m (proportional curve); ⤓ 3 s floors at exactly 1.7. HUD live.
- Wake lock: 1 request → granted on entry → released on exit.
- EXIT VIEW teardown: FPV off, joystick/HUD/minimap unmounted, fpvWalkInput null.
- Desktop smoke `/`: zero mobile DOM/chunks; mouse drag yaw −26° drift 0.0000 m; wheel −20.2°;
  arrows 15.6 m/0.71 s ≈ 22 m/s.

## TRAPS learned (also in DECISIONS)
- **The occlusion Chrome flags do NOT cover tab-backgrounding.** `--disable-backgrounding-occluded-windows`
  etc. keep an occluded WINDOW rendering, but a background TAB still has document.hidden=true and
  rAF fully parked — mid-session the owner opened tabs in the verify Chrome and every rAF-dependent
  probe read dead (encoder rates "inert", flight.update 0 calls/s) while setTimeout kept running.
  Re-select the tab (`browser_tabs select`) and guard probes with `if (document.hidden) abort`.
- `setPointerCapture(pointerId)` on a synthetic pointer throws → the whole React handler aborts
  before the store write. try/catch it in touch components.
- Store probing from page context: `await import("/src/store/camera.ts")` in dev returns the SAME
  module instance as the islands — legitimate seam probe.

## Open / next
- NEXT: 8b desktop-first (P4 Find az/el-over-dates skyline-filtered · P5 NPF/500 · P6 moon
  calendar) → M3 (mobile surfaces 8a P2/P3 + 8b). M1 tails unchanged (SKY long-tail, MAP tab).
- T1 real-device pass now also covers: joystick/pinch feel, wake-lock physical dim, alt-nudge
  reachability.
Related: [[project/wip-2026-08-13-m1-mobile-planning]] [[bugs/fpv-walk-orbit]]
[[project/wip-2026-08-13-slice7-phase8a]]
