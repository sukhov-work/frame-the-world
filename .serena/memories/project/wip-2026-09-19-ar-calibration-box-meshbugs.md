# wip 2026-09-19 — AR CALIBRATION + CAM + THE GYRO-LED LADDER · the 5 m BOX · three mesh bugs — DONE, NOT RELEASED

Mode: implement, Deep (`/frame` under investigate-design-v3; four parallel research agents). Owner order 2026-09-19.
Records: DECISIONS 2026-09-19 (+ §Traps "a body-less /api write 403s") · backlog T145 (hook exists) T146 T147 T148 ·
`wix-headless.md` §12b · `contracts.md` §2 (`ftw:ar-calib:v1`) · `NEXT_SESSION_PROMPT.md` · the guide (`mobile-ar-camera`, the box step, lift 300).
Gates: vitest **3,239 / 218** (+86 / +6) · astro **0/0/12** · knip **0**. Browser (dev, house Chrome): `verify-ar-look` 39/39 ·
NEW `verify-ar-calibration` 52/52 · `verify-mobile-batch-2026-09-08` 127/127 · `verify-modelupload` PASS (+ leg 1b box) ·
`verify-usermodels` 21 legs · `verify-meshedit` PASS (lift 300). NOT released (no deploy was asked).

## 1a · The gyro-led ladder — `lib/sensors/yawTrim.ts` (pure) + `orientationLadder.ts` rebuilt around it
- DIAGNOSIS (cited in DECISIONS): the iOS rung tracked the compass with a 0.8 s EMA (compass-led in all but name); the Android
  rung took `deviceorientationabsolute` (TYPE_ROTATION_VECTOR, magnetometer-fused) raw. Chromium's `deviceorientation` =
  TYPE_GAME_ROTATION_VECTOR ("must not use the magnetometer"); WebKit = Core Motion `xArbitraryZVertical`. No raw magnetometer
  on the web; Generic Sensor = the same sensors (no second code path worth having).
- `YawTrim.observe(obs, t, rate)`: first fix EXACT → `acquireMs` 1500 @ τ 800 → steady τ 8000 capped 1.5°/s → FROZEN if rate
  > 30°/s or < 400 ms after, or window (1 s, ≥ 5 samples) MAD > 4° or median slope > 2°/s → |innovation| > 20° must persist 3 s
  (5 s calibrated) then slew 6°/s down to 2° (hysteresis `slewing`) → `maxStepMs` 250. `reacquire()` keeps bias + calibrated.
- Ladder: `trimFrame` "abs" (direct absolute: obs ≡ 0, offset = bias) | "rel" (Android fused: obs = absYaw − relYaw paired
  ≤ 50 ms; iOS: obs = compass − topHeadingRel, gated accuracy ≤ 25, topHoriz ≥ 0.35, **screenUp ≥ 0.2**) | "none" (align/seed).
  A change of frame re-acquires; a relative gap > 1 s re-acquires. `ArRung` union UNCHANGED (UI copy intact); `ArAim.fused`.
- Tunables: `FPV.arCompassOffsetTauMs` 8000 · `arTrimMaxRateDegPerS` 1.5 · `arTrimFreezeRateDegPerS` 30 · `arCompassMinScreenUp` 0.2.
- Numbers: unit swing direct > 15° / fused < 1° / back within 0.5°; browser twin direct 42.0° / fused 0.00°.

## 1b · CAM + visual calibration
- `lib/sensors/arCalibration.ts` (pure): `ArCalibration {yawDeg = COMPASS BIAS, pitchDeg, rollDeg, camLongFovDeg, savedAtMs}`,
  `ftw:ar-calib:v1`, rails (pitch/roll ±30, FOV 30–110, default **62°** [ASSUMPTION]), `videoLayout` (the shared pixel focal),
  `dragToAimDelta` (grab-the-world, ÷ cos pitch floored 0.2), `pinchTwist`, `stepCalibration`, `smoothRollDeg`.
- `lib/sensors/arFrame.ts`: mutable per-frame record (roll, vFov, viewPitch) written in `stepArLook`, read by the overlay's rAF.
- `lib/sensors/arCamera.ts`: constraints (720p/30 ideals), `pickMainBackCamera` (Chrome `camera2 N, facing back` → lowest N; iOS
  labels never matched), `classifyCameraError` + copy.
- `scene/arLook.ts`: ctx `calBiasYawDeg / calPitchDeg / calDraftYawDeg / calCommitEpoch`; `ladder.setUserBias`; aim = smoothed +
  draft yaw + pitch; seed + ALIGN pass `cameraHeading − draft`; commit → `ladder.commitCalibration(draft)` → pushed
  `opts.calibrated(bias|null)`; `roll()` (EMA 120 ms, HELD at a degenerate look).
- `store/camera.ts`: `arCam` off|view|calibrate · `arCalibration` · `arCalDraft` (yaw = the DRAG, rest absolute) ·
  `stepArCalDraft` · `confirmArCalibration` (epoch; no-sensor fallback folds the drag itself) · `_onArCalibrated` ·
  `resetArCalibration` · `cancelArCalibration`. `setArLook` line untouched (pinned verbatim).
- `mobile/ArCameraOverlay.tsx` + `styles/mobile/ar-camera.css`: feed z 1 / pad z 5 / panel z 11; panel seated LEFT of the mini-map
  (`right: 10.6rem`, `top: 2.9rem`). `FpvControls`: CAM chip inside `.m-arwrap` above AR (only while AR on), `useLongPress`,
  `wantCalibrate` ref so the ONE `requestPermission()` site serves both; `data-cal` on the AR chip. `--m-altcol-h` 200 px via `:has(.m-cambtn)`.
- `controls/useLongPress.ts` (T145's hook): timer + release verdict by `timeStamp`; `touchend` for a finger; the callback may
  decline the timer's call (no user activation).

## 2 · The box — `lib/models/primitives.ts` (`boxGlb`, `PRIMITIVES`, `primitiveFile`) + `store/modelUpload.beginPrimitive`
Synthetic GLB `File` → `begin([file], 0, "glb")` → `setTitle(def.title)`. 24 verts + normals + one matte material (metallic 0).
Button row under the dropzone in `panels/UploadFlow.tsx` (`data-act="add-box-5m"`). `/m` has no upload dialog (T148).

## 3 · Mesh bugs
- (a) `LIFT_MAX_M` 25 → 300, `MODEL_LIFT_MAX_M` 50 → 300 (server clamps share the constants). Pinned literals lived in FOUR tests
  + `verify-meshedit` + `verify-usermodels` + `test/components/globe/userModels.test.ts` (a literal 50 — grep the NUMBER too).
- (b) ROOT CAUSE: bare `DELETE` → no content type → `checkOrigin` 403 on the live `http:` origin (live probe 403 vs route).
  `lib/api/dataFetch.jsonWriteInit` + fence `test/lib/api/jsonWrites.test.ts`. Also: action note above the list, 404 = deleted,
  tombstone-aware `loadMine`, `unsubArmedModelGone` (declared BELOW `modelArmed` — the TDZ trap).
- (c) ROOT CAUSE on /m: `stickyOverlayPx` 256 → 512 on the first flat frame = a fresh-instance overlay rebuild = every composite
  gone (57/57 white, +4.2 s). Fix: `flatGround || isMobileShell` → the one rebuild on frame 1 (0/22 white after). Desktop `high`:
  0 rebuilds. Desktop boot-`mid` + promote-at-FPV-exit (RC18) = T146, PLAUSIBLE not proven. Probe: `scripts/probe-white-ground.mjs`.

## Traps learned
- A harness that reads a fast value through the HUD mirror (every 3rd frame; ~120 ms under 4× throttle) measures ITS OWN lag
  (29.5° "error" at 157°/s) — read `__globe.arLook().aim` synchronously after `dispatchEvent`.
- A screenshot found the panel under the mini-map; assert RENDERED rects (panel vs `.mm` / `.m-joy--aim` / `.m-altcol`).
- The touch-action audit and any `css.indexOf(".sel {")` test read a selector's FIRST block — put grouped `body.mw-open …` rules LAST.
- The guide's search goldens are ranking-sensitive: a new topic body with "compass" broke the `comp` query; keys shared by 3 topics fail the alias fence.
- A source-scan fence will catch your own doc comment quoting the bad pattern — proof the probe can match.
- `rm -rf` of the `.vite` copy I moved aside was denied by permissions: `node_modules/.vite.aside.*` may linger (harmless, ignored).

Related: `mem:project/wip-2026-09-07-mobile-bestspot-ar` · `mem:project/wip-2026-09-18-mobile-fixes-signout` ·
`mem:bugs/ground-checkerboard-flicker` · `mem:project/wip-2026-09-03-model-lift-goto-reset`
