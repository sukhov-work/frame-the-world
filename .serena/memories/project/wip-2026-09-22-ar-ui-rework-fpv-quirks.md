# wip 2026-09-22 — the AR small-screen pass · roll out · the AR guides · instant transitions · the carried pose · the mesh clearance · the /m planet boot from a hash — DONE (built + twin-verified; NOT released)

Mode: implement, Deep (`/frame` under investigate-design-v3; four parallel research agents, every claim cited). Owner order
2026-09-22 (the follow-up to `mem:project/wip-2026-09-19-ar-calibration-box-meshbugs` after the first phone tests).
Records: DECISIONS 2026-09-22 · ARCHITECTURE §7a′ (NEW) + §7f · `MOBILE_PLAN.md` header (the owner's screen-space rule) ·
`conventions/globe-tuning.md` §2026-09-22 · `contracts.md` (`ftw:ar-calib:v1` without roll) · backlog T147 addendum, T149–T151 ·
NSP · README gate line · the guide `mobile-ar-camera` (steps rewritten).
Gates: vitest **3,276 / 221** (+37 / +3) · astro **0/0/12** · tsc clean · knip: only pre-existing `normalizeModel` exports.
Browser (dev, house Chrome): NEW `verify-fpv-carry-2026-09-22` 29/29 · `verify-ar-calibration` 66/66 (was 52) ·
`verify-mobile-batch-2026-09-08` 127/127 · `verify-mobile-fixes-2026-09-18` ALL PASS (+ leg 1′) · `verify-ar-look` 39/39.

## AR on /m
- Layout (`mobile/ArCameraOverlay.tsx`, `styles/mobile/ar-camera.css`): one-row strip (title + `YAW · PITCH · mm`, no memo;
  `.m-arcal--on right: 3.9rem` because `MiniMap` folds to its puck while `arCam === "calibrate"`), the verdict column
  `.m-arcal__actions` = three `.m-act--icon` cells fixed on the LEFT rail, bottom `11.2rem + 120px + 110px + 12px` (the AIM stick
  renders 110 px — its 1 px border), the slider `.m-arcal__mixv` fixed on the RIGHT rail, bottom `--m-altcol-bottom + --m-altcol-h
  + 8px`, height `--m-armix-h = max(52, min(128, 100dvh − the mini-map − the column))`, `box-sizing: border-box`, a rotated range
  in `.m-arcal__mixtrack`; `body.m:has(.m-arcal__mixv) .m-arfloat` clears it. Every piece joins `body.mw-open … visibility: hidden`.
- Roll: `ArCalibration` = `{yawDeg, pitchDeg, camLongFovDeg, savedAtMs}`; `pinchSpread`; the video rotates by `arFrame.rollDeg`
  only. Pinch sign: `tan(fov'/2) = tan(fov/2) · spread` (was `/`). Default FOV 62 → **68°**.
- Guides: `scene/arGuides.ts` (DOM layer `.ar-guides` z 3; markers `.ar-guide--sun|moon|target`; SVG halo + ink paths per
  body × past/future) fed by `stepArGuides` (after `stepDayArcs`): `enabled = fpvActive && camNow.arLook`, sun = `sunDirW`, moon =
  `moonPosW − camera`, target = `targetDirW` when `sky.visible`, arcs = `dayArcs.arcs()` (NEW accessor: dirs/t01/fade/now01).
  `lib/sky/screenProject.projectCameraDir` (pure). Tunables `ARGUIDES`. Seam `__globe.arGuides()`.
- The drift (T149): H1 the narrow default (fixed to 68°, the guide says pinch near the EDGE) · H2 parallax on near buildings
  (calibrate on the sky) · H3 ease lag · H4 the compass gate on a downward tilt · H5 distortion.

## FPV / minimap (both shells)
- Instant: `FLIGHT.smoothTransitions` false → `createFlight(camera, {…, smooth: smoothFlights})`, `smoothFlights = () =>
  smoothFlightsOverride ?? (FLIGHT.smoothTransitions || smoothFlightsBootOn())`; `start(t, {cinematic: true})` reserved;
  `fovSnapPending` → `stepFovGlide` snaps once. The pref `smoothFlights` (a plain read, no `rearmed`). Seam `__globe.smoothFlights(on?)`.
  The five descent harnesses flip the seam first.
- Carry: `FpvJumpRequest` (partial), `fpvCarry {eyeM, pitchDeg, fovDeg}` recorded at exit (from `leavingKind === "temp"` — the
  branch nulls `fpvKind` first), `preFpvOrbit {altAboveGroundM, tiltDeg, fovDeg, mapMode}` captured on a fresh entry; entry
  order share → carry → plannedView → defaults; MapWindow desktop = `setTempPin` in FPV else a lat/lon jump; MyLocation +
  SceneActions send lat/lon only (`lastFpvFovDeg` retired); exit: `standOut = pin + walk`, `arrivalPose(back.alt, back.tilt)`,
  the /m 3D-entry returns to 3D, else `mapArrivalPose(…, back.alt)`.
- Clearance: `lib/globe/fpvClearance.ts` (`solidsFromColumn` top-down; `fpvClearance` → `{inside, standOnM}`; body = 1.7 m under
  the eye; `standingOnM` + `stepM`); `stepFpvMeshFloor` after the terrain re-seat: two `Raycaster` legs vs
  `[buildings.tiles.group, enriched?.tiles.group, userModels.occluderRoot()]`, `face.normal` → world (InstancedMesh composes
  its instance matrix), |up·n| < 0.3 = a wall = skipped, dedupe by object/faceIndex/instanceId; inside → `fpvMeshFloorAbsM =
  top; fpvEyeM = 1.7; fpvMeshLiftM` snapped; else the floor under the feet; lift up = at once, down = `seatStep` τ 200 ms; reset
  on entry + pin change. Seam `__globe.fpvClearance(on?)` (flipping resets the idle cadence), `__globe.fpvTestSolid(lat, lon,
  hM, sizeM)` (DEV: a closed box in the user-models group).
- The /m boot: `mobilePlanetHash` (computed before `isMobileShell` exists — the body class by hand) → `bootPoseAt(lat, lon, hdg,
  bootAltM, 0)` and the 3D-mode arm skips it.

## Traps learned
- The mapWindowChrome discovery guard reads `.className = "…"` in `scene/*` as a layer → children use `classList`.
- `intersection.normal` is flipped toward the ray; `face.normal` is the geometric, object-space one.
- Geometry legs on the 402 × 714 twin: `box-sizing`, padding and 1 px borders are real; "one row" ≠ equal box tops.
- A hash-only `Page.navigate` on the same document never re-boots the globe — a fresh tab per boot leg.
- A `requestFly` arrival altitude drifts with the terrain refine under the target (2,496 → 2,565 m) — assert "landed", ±5 %.
- The `/m` exit to the 2D chart still forces `setMapMode("2d")` unless the entry came from 3D.

Related: `mem:project/wip-2026-09-19-ar-calibration-box-meshbugs` · `mem:project/wip-2026-09-18-mobile-fixes-signout` ·
`mem:bugs/fpv-walk-orbit` · `mem:project/wip-2026-09-07-mobile-bestspot-ar`.
