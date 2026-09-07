# wip 2026-09-07h — MOBILE: BEST SPOT on `/m` + AR look-around in mobile FPV — DONE (device tier for AR = the owner's iPhone)

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-07g. Records: DECISIONS
2026-09-07h · backlog T116–T118 · `bestspot/README.md` banner · `MOBILE_PLAN.md` status · `NEXT_SESSION_PROMPT.md`.
Gates: vitest 2,917/186 (+62 tests, +5 files) · astro 0/0/11 · knip 0 · post sweep `post-2026-09-07h` vs
`post2-2026-09-07f`: draw-count gate 13/13 (Everest sunset skipped — 2 % tri drift = streaming), pixel diffs the
boot-to-boot band, `/m` differs by the fifth tab only.

## 1 · BEST SPOT on `/m` — the shape
- `mobile/TabBar.tsx` fifth item `◎ SPOT` (labels ≤ 6 chars; measured 69/69 px per cell at 375 px, no wrap).
- `mobile/BestSpotSheet.tsx` — the FIND idiom (always mounted, `open` sticky, `setOpen(true)` guarded by
  `!open`, `setOpen(false)` only at teardown — `setOpen` RESETS `heatmapOn` both ways, right for the desktop
  segment, wrong for a tab). No ULTRA/REFINE (fenced). Phone-only `◎ CENTRE HERE` = `setTempPin(focus)`.
  Honesty ladder: 3 inline BY KEY (`unmapped`, `obstruction`, `reach`) + `▸ 5 MORE CAVEATS`; warnings never fold.
  Rows: tap = select → `GO → RE-CENTRE HERE` / `◎ LOOK FROM HERE`; GO calls `previewSpot(null)` BEFORE `setTempPin`.
- `controls/bestSpotCopy.ts` — the pure copy moved VERBATIM out of `panels/BestSpotPanel.tsx`
  (`bestSpotStatusEntries` keyed; `spotNoteLine` the one join). `controls/**` must not import siblings
  (`mobileFence` rule 3) → `BestSpotKindOption` is shaped structurally, not `import type { ChipOption }`.
- Engine: `bestSpotAllowed = true` (kept as the ONE name; `fences.test.ts` "one gate, both shells, ULTRA
  desktop-only": TRUE + no shell term + no `mobileShell` in the sheet + `bestSpotArmed()` in BOTH `shellOn`
  composites + `mobile/**` never names `setUltra|ultraCellM|ultraMaxRadiusM|refineSpot|obstructionRefined|\bultra\b`).
  `bestSpotArmed()` keeps `buildings` + `enriched` + user models attached on `/m` in 2D mode — the solver
  flattens those meshes (`flattenTin`); without it the worker REFUSES `no-built-geometry` forever.
- Sheet ctx lost `mobileShell` (§6.10 (C) retired). Feed debug gained `stream` (stale/quietFrames/epochs).

## THE T116 TRAIL (how the mobile harness found a T77 regression)
- Symptom: `/m` ladder stopped at rung 0 (24 m, 729 cells, reach 0, `terrainOnly`), jobs 1, never re-solved
  even with 8 OSM meshes resident. Worker path: `noBuiltGeometry` → `postRefusal("no-built-geometry")`; the
  self-heal needs `builtEpoch` → `streamStale` → 90 QUIET frames → `postSolve`.
- `__globe.bestSpot().stream` (added): `seatEpoch` +60/s at a settled pose ⇒ `quietFrames` never accrued.
- `seatSettle().enriched.applyReasons` (added; per-reason counters in `applyFeatureSeats`): `treeWrite: 1`
  every pass, residuals 0, `treeOff` 0.
- Cause: `t.appliedM`/`t.seatM` are `Float32Array`; `target = seatM − cell.seatM` (float64, not float32-
  representable); `seatLand` returns the exact target within snap; the array stores float32(target);
  next frame `next !== applied` (~1e-7 m) → write again forever → `instanceMatrix.needsUpdate` EVERY FRAME
  (one tree set per cell) + `wrote = true` → `seatEpochN++`. Since 2026-09-06k (T77 C-1 `seatLand`).
- Fix: `lib/globe/enrichedMask.ts` `seatLandF32` (= `Math.fround(seatLand(…))`); the tree apply uses it and
  "off target" = `|target − next| ≥ seatSnapM`. Test reproduces 300/300 writes old vs ≤ 70 new.
- Probes kept: `scripts/probe-bestspot-mobile-ladder.mjs` (rung/jobs/reach/bld every 4 s on the twin),
  `probe-bestspot-mobile-seat.mjs` (seatEpoch + applyReasons).

## 2 · AR look-around — the shape
- Research (three agents, cited in DECISIONS 2026-09-07h): iOS `requestPermission()` synchronously in the
  tap (WebKit `processingUserGesture`; reject = no gesture, "denied" = Cancel or insecure); denial cached per
  origin for the Safari process; **iOS 13+ has NO Settings switch** (the brief's "Motion & Orientation
  Access" is iOS 12) → copy says quit-and-reopen Safari / Clear History. iOS α RELATIVE (xArbitraryZVertical,
  drifts); `webkitCompassHeading` = MAGNETIC heading of the TOP EDGE (+Y); 60 Hz no dedup; WebKit's Euler
  extraction flips at vertical (vectors are continuous). Chromium `deviceorientationabsolute` α = MAGNETIC
  (no declination in the chain); `requestPermission` exists on Chrome 151+ (no prompt). CDP 152: the legacy
  `DeviceOrientation.setDeviceOrientationOverride` = relative only; `Emulation.setSensorOverrideReadings`
  absolute-orientation quaternion (produced NO page events on the headless house Chrome). Dnipro
  declination +8.58° E (NOAA = BGS).
- `lib/geo/wmm.ts` — WMM2025 in-house (90 rows embedded, public domain; NOAA algorithm; 100 official test
  vectors ±0.01° D/I, H ±0.5 nT). Refresh Dec 2029 (WMM2030). Decision: no npm dep.
- `lib/sensors/deviceOrientation.ts` — `poseFromEuler` (look = R·(0,0,−1); yaw from the TOP edge when
  `lookHoriz < 0.08`; roll computed, NOT applied; screen angle affects roll only), `LookSmoother` (vector EMA +
  hysteresis dead-band), `specCompassHeading` (the spec's §A.1, cross-check only).
- `lib/sensors/orientationLadder.ts` — rungs `android-absolute` · `ios-compass` (offset = compass −
  topHeadingRel when accuracy ≤ 25° AND `topHoriz ≥ 0.35`; EMA τ 800 ms; holds upright) · `relative-aligned`
  (`align(camHeading, true)`) · `relative-unaligned` (seeded `align(camHeading, false)` at the first sample);
  `absoluteHoldMs` 500 keeps relative samples out while absolute streams.
- `scene/arLook.ts` — listeners in the engine (`deviceorientationabsolute` + `deviceorientation`), attach
  while `arLook && fpvActive && !flight`, the aim a closure value; the mirror writer is PUSHED in
  (`attachArLook({ mirror })`) — scene modules never value-import stores (`fences` "mirror-never-seats").
  WMM re-evaluated on 0.05° moves; the first evaluation must be explicit (`!Number.isFinite(declAtLat)` —
  a NaN compare silently left declination 0; the harness caught it).
- Orchestrator: `stepArLook()` (8.6, after `stepSkyTrack`); `const skyLook = arAim ?? skyTrackAim ??
  camNow.skyLook` on `FPV.arLookEaseTauMs` 70; look-drag + the aim stick's heading gated by `!arLook.live()`;
  `arLook.dispose()`; DEV `__globe.arLook()`.
- Store: `arLook` / `setArLook` (per-session, NOT persisted), `arAlignEpoch` / `requestArAlign`,
  `arLookState` / `_syncArLook` (HUD cadence). Tunables `FPV.ar*` (ease 70, smooth 50, deadband 0.25,
  stale 1500, compass max acc 25, minTopHoriz 0.35, offset τ 800).
- UI: `mobile/FpvControls.tsx` `ArLookToggle` (🧭 AR round chip above the AIM stick, `.m-arwrap` in fpv.css),
  `AR_COPY`, `arRungLine`, `⌖ ALIGN` on the relative rungs, a 3.5 s transient note then the rung line.

## Verification
- `scripts/verify-bestspot-mobile.mjs` 60/60 (lean twin; frame dt p50 41 ms at 4× throttle, heap 109 MB;
  finest 11 s incl. the refusal + heal). `scripts/verify-ar-look.mjs` 39/39 (synthetic samples through the
  real listeners; Chrome 152 `requestPermission` resolved granted from the chip's tap).
- Desktop `verify-bestspot.mjs` 96/101 by design (the D8 four).
- **Device Farm iPhone 17 Pro (iOS 26.3.1), `verify-shots/perf/devicefarm-mobile-h-2026-09-07T19-01-41.json`,
  ~6 device min, `--poses m --legs bestspot,ar --ramp 0 --soak-min 0`:** BEST SPOT boot 5.9 s, first ink 71 ms,
  rungs 24/12/6/3 m in 70/75/132/397 ms, finest 6.1 s after arming, 18,887/40,401 scored, reach 410 m, 1+4
  meshes; hold 95 s at dt 17/17 ms, CPU 6/7, LRU 3/78/2 MB, 11 hitches (load), alive at 107 s; marker preview
  entered FPV with the shortlist intact. AR: Appium `element.click()` ≠ WebKit user gesture →
  `requestPermission()` REJECTED ("TAP AGAIN" copy correct), zero events without the grant. Next farm try:
  `mobile: tap` (native) — untried. The owner's iPhone via the tunnel is the sure device tier (T117).

## Owner verdict 2026-09-07i
The owner tested BOTH features on the Pixel 6 Pro: "looks and works well" — the Android device tier for the
heatmap and for AR's rung 1 is his hands. The iPhone's real-world feedback arrives later (T117 stays an open
ear; not a blocker). The 2026-09-07g park is lifted — next session: the MAIN PLAN (lever 11 first).

## Traps learned
- A "settled" test in float64 over a Float32Array store is a write loop (T116). Decide settled in the
  array's precision.
- `NaN` sentinels never trigger `Math.abs(x − NaN) > k`.
- A transient UI note that replaces a status line hides the status from a harness reading textContent —
  keep transient notes short (3.5 s) and let the harness stream through them.
- `element.click()` through Appium/Safari WebDriver is not a user gesture for WebKit's permission APIs.
- Farm rule stands: never edit `src/` while the tunnel serves the phone (HMR reaches it).

Related: [[project/wip-2026-09-07-t106-pixel-read]] [[project/wip-2026-08-13-m2-fpv-touch]]
[[project/wip-2026-08-27-bestspot-park]] [[project/wip-2026-09-06-t77-six-worktrees]]
