# WIP 2026-09-05 — MESH SUITE MS8: VERTICAL ROTATION (pitch / roll) for user models — BUILT

**Status: BUILT + browser-verified; OWNER 2026-09-05: deployed and tested manually — "this concludes all
mesh-related work at the moment" (the MESH SUITE track is CLOSED; T74 / T78 closed; the taste calls
below are PARKED). Mode: implement (investigate-design-v3 spine on `/frame`), tier Standard.**
Owner order 2026-09-03 (after testing MS7 — "works well"): ROTATE was YAW-ONLY; add rotation about the
horizontal axes, "same principles as the lift". Backlog **T78 BUILT**; `MESH_SUITE_PLAN.md §15` is the
as-built; DECISIONS 2026-09-05. Prior: `mem:project/wip-2026-09-03-model-lift-goto-reset` (MS7).

## The design that shipped (plan §15.1)
- **Two more stored seats `UserModels.pitchDeg` / `rollDeg`** (degrees, null = upright), provisioned LIVE
  FIRST (`+ UserModels.pitchDeg field added`, `+ rollDeg` → **29 fields**). NOT a stored quaternion (the
  yaw column stays, legacy rows read upright, the chip / list / RESET speak degrees). `ModelTransform`
  gained both, REQUIRED (every fixture updated — the MS7 precedent).
- **The rotation = the intrinsic YXZ Euler triple** R = R_y(yaw)·R_x(pitch)·R_z(roll) = three's `Euler`
  order "YXZ". Pure pair `quaternionFromTilt` / `eulerFromQuaternion` in `lib/models/modelPlacement.ts`
  (three-free; mirrors `Quaternion.setFromEuler` / `Euler.setFromRotationMatrix('YXZ')`; unit-pinned as
  exact inverses). **Canonical read-back** (`canonicalTilt`): pitch in [−90, 90]; a tip past 90° folds
  into yaw+180 / pitch mirrored / roll+180 (the SAME rotation); the gimbal pole reads roll 0 (accepted).
- **The shared gizmo grew `tilt` (default false)** — `scene/bldgGizmo.ts`: ROTATE shows X + Z rings,
  `showE = false` (three shows the E ring whenever all three axes are on), XYZE off; the read-back
  decomposes the body's FULL quaternion (`yawDegFromQuaternion` is WRONG for a tilted body) into
  `raw.rotDeg/pitchDeg/rollDeg`; `sameT` compares them (`?? 0`). `FeatureTransform.pitchDeg?/rollDeg?`
  OPTIONAL, USER-MODELS ONLY; `rigToTransform`/`transformToRig` untouched; the BUILDING instance is
  byte-identical and its yaw-only rings are now PINNED by `verify-meshedit` ({X:false,Y:true,Z:false,E:false}).
- **The scene composes ONE quaternion** (`appliedQ`/`targetQ`, `setQ` = `quaternionFromTilt`; `placeRig`
  composes the whole rotation — a building-shaped place reads upright) and **SLERP-eases** a row change
  (`appliedQ.slerp(targetQ, xfEaseK)`, snap < 0.02°) — a foreign 180° roll turns the short way.
- **The lift floor is TILT-AWARE** ("never fully into the texture" under ANY rotation): `tiltedExtent(size,
  scale, pitch, roll)` = the rotated box's `topM` + `extentM` about the GROUND pivot in closed form (the
  second row of R = (cos p·sin r, cos p·cos r, −sin p); yaw changes nothing; dust snapped at 1e-12;
  span ≤ 1e-6 → null); `liftFloorFor(ext)` = `min(keep, extent) − top`, keep = max(0.25·extent, 0.5),
  railed ±50. Upright = MS7 to the bit (`liftFloorM(h) ≡ liftFloorFor({h,h})`, pinned); on its side half
  the depth may sink (5 × 3 box → −0.75); FLIPPED → POSITIVE floor, the model is HELD UP `keep`. Applied
  on every path: `clampModelEdit(raw, start, sizeM3)` (a `ModelSize` = a bare height (MS7 shape, a pole)
  or `[w, d, h]`), the engine commit, MOVE's `liftRail` from the committed tilt, the server
  `applyModelPlacement` from `bboxX/Z/Y` (`modelSizeM3`), every read `sanitizeModelTransform(rotDeg,
  scale, tU, size, pitchDeg, rollDeg)`; unknown box → pinned to 0.
- **ROTATE owns the tilt**: `modelOpIsEdited("rotate")` = yaw OR tilt (`isTilted`, 0.05°);
  `revertModelOp("rotate")` zeros all three; RESET ALL + the list `resetTransform` PATCH `{…, pitchDeg 0,
  rollDeg 0}`. Chip ROTATE row + label: `x° cw · pitch ±p° · roll ±r°` only when tilted; "was 0.0° cw,
  upright"; list fact line `⟲ ±p° · ±r°`; RESET lights for a tilt alone. `topWorld` = the tilted box's
  HIGHEST point (anchor-local `(0, topM, 0)`) so a flipped label is not underground.
- On the way: the chip FOLLOWS a store-side seat commit while armed (`modelSeatsDiffer` in the
  per-frame deadband — a pre-MS8 gap: a foreign edit / list RESET never refreshed `armed.committed`).

## Files (plan §15.2 has the full list)
provision (`pitchDeg`/`rollDeg`) · `lib/models/modelPlacement.ts` · `lib/globe/featureTransform.ts`
(optional fields) · `lib/wix/modelRecords.ts` · `store/modelEdit.ts` · `store/userModels.ts` ·
`uploadMedia.ts` · `store/modelUpload.ts` · `scene/bldgGizmo.ts` (`tilt`, `ringPx`) ·
`scene/userModels.ts` · `StylizedTiles.ts` (`tilt: true`, `modelSizeM3`, `startToModel`, deadband,
`ringPx` seam) · `ModelEditChip.tsx` · `MyModelsTab.tsx` · guide · docs (plan §15, contracts,
globe-tuning, backlog T78, DECISIONS, NEXT_SESSION_PROMPT) · tests (+9 net: modelPlacement +7,
modelRecords +1, scene +1; fixtures everywhere) · `verify-usermodels.mjs` (leg 4a + 11b tilt = 21
legs; `modelPxOnScreen`) · `verify-meshedit.mjs` (ring pin).

## Verification receipt
- vitest **2,444/2,444 (162 files)** (baseline 2,435) · astro 0/0/8 · knip 0 · live provision (29 fields).
- `verify-usermodels.mjs` **PASS 21 legs** (run 7): leg 4a — rings X+Y+Z (no E); a REAL X-ring drag →
  live pitch +60.8° (row "-86.4° cw · pitch +60.8° · roll 0.0°", body quaternion within 0.5°),
  Escape-cancelled; pitch 90 saved + synced (own row, world read, scene quaternion, chip row); side
  floor −0.75 m; a FLIP at −1000 m HELD UP +1.25 m (row, world read = the server floor, scene);
  upright again. Leg 11b: fact line "… ↑ +6.50 · ⟲ +25° · −10°", RESET → upright too. Legs 5–17 green.
- NO-REGRESSION: `verify-bldg-override` PASS · `verify-meshedit` PASS ×2 (incl. the right-click leg
  that was env-red at MS7, + the new §4a ring pin). The wider §4a-4 sweep NOT re-run (model-only changes).
- Shots `verify-shots/usermodels-11-tilted-side.jpeg`, `-12-flipped-floor.jpeg`.

## Harness traps found (mesh-work — read before the next model harness session)
- **A `\+` inside a template literal handed to the page collapses to `+`** (`\+90\.0°` → `+90.0°` →
  a regex of "one-or-more spaces") — keep regexes Node-side; test the DOM text after `evalJs`.
- **Three rotate rings overlap on screen**: `handlePx("X")` lands on a Y/Z ring pixel. New DEV seam
  `__globe.modelGizmo().ringPx("X", 36)` lists centre-line points; HOVER-search for `GZ.axis === "X"`
  (a hover claims nothing), THEN press — no press/Escape churn.
- **The T76-class coarse-eye trap** (reproduced on MASTER with MS8 stashed): right after a `#f=`
  reload the eye sits on a COARSE terrain tile while the model's seat has refined ~60 m lower (the seat
  read 19.5 m vs 85.5 m across runs), so `modelPx` projects thousands of px BELOW the frame (legs 3 and
  15). `modelPxOnScreen(id, label)` detects an off-viewport point, calls `GZ.standBeside(id)` (the MS6
  one-shot re-seats the eye on a warm page) and re-takes it — both legs pass.

## Open (owner taste, none blocking) — plan §15.4
YXZ order + ±90° canonical pitch · no rail on the tilt · pitch/roll only printed when tilted · `⟲`
glyph · GOTO / stand-beside still aims at `lift + h·scale/2` (a flipped model's true mid-height is below
the pivot — small taste tail) · the E ring off · the label height at the highest corner, centred on the
pivot. NEXT: **T77** (the audit; NEXT_SESSION_PROMPT).
