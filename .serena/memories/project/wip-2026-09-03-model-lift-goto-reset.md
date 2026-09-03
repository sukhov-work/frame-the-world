# WIP 2026-09-03 — MODEL LIFT (vertical drag) + MODELS-tab GOTO / RESET = MESH SUITE MS7 — BUILT

**Status: BUILT + browser-verified. Mode: implement (investigate-design-v3 spine on `/frame`), tier Standard.**
Owner order 2026-09-03 (after testing MS6): move user models VERTICALLY (imported base often at the
wrong height); default pinned to the terrain seat; may go PARTLY under ground but NEVER fully (stays
pickable/recoverable); add GOTO + RESET to MY PINS · MODELS rows. This is MESH SUITE **MS7** —
`MESH_SUITE_PLAN.md §14` is the as-built; DECISIONS 2026-09-03; backlog T74 updated. Closes §13.4's
first bullet + §11.5's lift question. Prior: `mem:project/wip-2026-09-02-mesh-suite-ms6`.

## The design that shipped (plan §14.1)
- **The lift is the THIRD seat — `UserModels.tU` (m above the terrain seat)**, provisioned LIVE
  (`+ UserModels.tU field added` -> 27 fields). `ModelTransform.liftM`; null = on the ground.
  The gizmo's anchor Y IS the stored lift (`liveBaseY` 0 -> `tU = anchor.y`); `rigToTransform` /
  `transformToRig` already carry `tU`. The scene writes it in ONE place `writeAnchor(e)` (east/north 0,
  Y = applied lift), rides the seat ease; `rebase` keeps Y, zeros east/north.
- **"Never fully into the texture" = a HEIGHT-AWARE FLOOR, railed on EVERY path.**
  `liftFloorM(scaledHeight)` keeps `MODEL_LIFT_KEEP` = max(0.25 x scaled height, 0.5 m) above the
  seat; `MODEL_LIFT_MAX_M` 50 is the absolute rail both ways. `clampLiftM` applied in the live drag
  (`clampModelEdit` rails against height x the CLAMPED scale, so a SHRINK re-lifts a sunk model),
  the engine commit, the server `applyModelPlacement` (floor at bboxY x new scale) and every read
  (`sanitizeModelTransform(rotDeg, scale, tU, heightM)`). UNKNOWN height -> lift pinned to 0.
  The gizmo grew `attachBldgGizmo` option `liftRail(start)` = { minM: liftFloorM(height*start.sx),
  maxM: 50 }; the model instance uses `lift: true`; the BUILDING instance keeps the byte-identical
  `[0, LIFT_MAX_M]` default (no regression).
- **MOVE owns the lift** (no new op): `modelOpIsEdited("move")` true when off the ground; MOVE's revert
  lands it (`revertModelOp("move")` -> liftM 0, placement kept); RESET ALL zeroes it too. Chip MOVE
  row + label show the lift; `modelStandpoint` raises its aim + min distance by the lift.
- **GOTO** = the placed row-click's stand-beside on its own button (`MyModelsActions.goto`, disabled
  when unplaced). **RESET** = `store/userModels.resetTransform(id)` -> ONE placement PATCH
  { lat, lon kept, rotDeg 0, scale 1, tU 0 } via `commitPlacement` (own OR shared row), lit only
  when placed AND `modelRowResettable`.

## Files (plan §14.2 has the full list)
provision (`tU`) · `lib/models/modelPlacement.ts` (constants, liftFloorM/clampLiftM, lift-aware
sanitize/clampModelEdit/editToFeatureTransform/modelStandpoint) · `lib/wix/modelRecords.ts`
(PlacementBody.tU, applyModelPlacement, PublicModel/ModelListItem.tU, modelRecord tU:null) ·
`store/modelEdit.ts` (MOVE owns lift) · `store/userModels.ts` (PlacementPatch.tU, resetTransform,
publicFromMine.tU) · `uploadMedia.ts` · `store/modelUpload.ts` (addMine) · `scene/bldgGizmo.ts`
(liftRail) · `scene/userModels.ts` (writeAnchor/heightFor, lift through seat/place/rebase/ease +
real-height re-rail on load) · `StylizedTiles.ts` (lift:true+liftRail, modelHeightM, commit/revert/
persist lift, MOVE readout) · `ModelEditChip.tsx` · `MyModelsTab.tsx` (goto/reset + buttons +
modelRowResettable) · `my-pins.css` · guide (fpv-models + my-models) · docs (plan §14, contracts
§4/§7, globe-tuning, ARCHITECTURE, backlog) · tests +7 files · `verify-usermodels.mjs` legs 6a+11b (20).

## Verification receipt
- vitest 2,435/2,435 (162 files) · astro 0/0/8 · knip 0. Live: `+ UserModels.tU field added` (27).
- Browser `verify-usermodels.mjs` PASS 20 legs (headless :9333, wix dev, Dnipro FPV, LIVE
  collection): 6a — a REAL Y-arrow drag moved the anchor -0.79 m (MOVE row "up -0.8 m"), a bury commit
  clamped to the floor -11.64 m across row+world read+scene (15.5 m model), +6.5 m lift; leg 7 reload
  re-applied +6.50 m; leg 10 click-to-place kept the lift; leg 11 fact line "up +6.50"; leg 11b RESET
  -> 0/1/0 (own+world+scene, spot kept, RESET dark GOTO lit); leg 14 GOTO stood beside; foreign SHARED
  edit / orbit hover / list delete green; no shader errors.
- NO-REGRESSION: `verify-meshedit` (building gizmo) is RED at its right-click-menu leg — PROVEN
  PRE-EXISTING/environment: it fails IDENTICALLY on master with my changes `git stash`ed ("open at
  press: false" — the macOS/headless `contextmenu`-on-press timing for the building's pose; the MS6
  memory records this class as a harness-environment red). The building lift path is byte-identical
  (default `liftRail` reproduces the old `[0, LIFT_MAX_M]` rail). `verify-bldg-override` re-run this
  session (receipt in DECISIONS 2026-09-03).

## Traps found (harness — for the next mesh session)
- A headless VERTICAL gizmo drag is ill-conditioned / near-zero screen gain at a street-level eye
  (the MS2 "Y ring edge-on" trap, for a TRANSLATE): a real Y-arrow drag moves the anchor only a
  little and the sign flips with the pose. The Y picker is a thin cylinder whose projected MIDPOINT
  pixel MISSES it under an angled view (perspective) — grab by SEARCHING fractions along the
  origin->handle line for the first that claims axis "Y". `requestFpvJump` aimed the model at the
  screen bottom (its lat/lon is the VIEWER point; the aim is finicky). SOLUTION used: prove the DRAG
  via the anchor/live it moves (direction-agnostic), Escape-cancel, then verify save/sync/floor/reset
  through `commitPlacement(tU)` — the exact call a release makes.
- A verify-loop that presses+releases several candidate points corrupts the drag bookkeeping so the
  final release does not run `finishModelDrag` (the anchor moves but nothing commits). Escape-cancel a
  non-target grab instead of releasing it; keep the committing gesture a single clean press-move-release.
