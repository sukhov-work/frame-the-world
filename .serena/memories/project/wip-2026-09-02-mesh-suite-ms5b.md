# WIP 2026-09-02l — MESH SUITE MS5b (the owner's four fixes/tunings after testing MS5) — BUILT

**Status: BUILT; unit + type gates green; browser receipt in §Verification below (filled at exit).**
Mode: implement (investigate-design-v3 spine on `/frame`), tier Standard. Canonical: `.claude/claude-docs/
MESH_SUITE_PLAN.md` **§11.5 (MS5b as-built)** · §11 (the order) · §3 ladder (MS5b BUILT) · §5 recipe
(next = MS6). Prior: `mem:project/wip-2026-09-02-mesh-suite-ms5`. Bugs (both FIXED, the memories hold
the mechanism): `mem:bugs/bldg-menu-right-release` · `mem:bugs/orbit-drag-after-fpv-edit`. DECISIONS 2026-09-02l.

## Session facts (boot)
- MS5 landed as PR #95 (`8c9ce7f`) one minute after boot; the watcher restored master. Read-only until then.
- Four parallel research agents (metres path · rails map · right-button paths · gizmo lifecycle), 90–92 %,
  the two bug cruxes re-read by hand; both diagnoses CONFIRMED (the right-release one in the browser:
  macOS Chrome fires `contextmenu` on the press — the harness logs "menu open at press true").

## What shipped (full text §11.5)
- **§11.1 metres**: `FeatureSeat.dx/dz` (pristine, bake-local m) → `BuildingPick.footprintM` /
  `featureState().footprintM` → `bldgArmed` → `BldgEditArmed.footprintM` → chip `opReadout/opOriginal`
  (SCALE row `266 × 68.0 m (4.03 × 1.00)` · `was 65.9 × 68.0 m`) + `bldgOpLine` (label `⤢ … m · sx × sz`).
  Models: `Entry.sizeM3 [w, d, h]` (loaded bounds; pre-residency from the record's bbox `[x, z, y]`) →
  `UserModelInfo.sizeM3` → `ModelEditArmed.sizeM3` → `modelOpReadout/modelOpOriginal`, the menu head
  (triple × the committed scale), `modelOpLine` + the label's orig line. ONE formatter
  `formatMetres` / `formatDims` (`lib/format/readout.ts`; 2 dp < 10 m, 1 dp < 100 m, whole above).
- **§11.2 rails, two layers**: GESTURE rails per edit about the committed transform — `EDIT_MOVE_MAX_M`
  100 (new; `clampGizmoEdit` shortens the OFFSET from `start`), `EDIT_MIN_K/MAX_K` 0.1/10 (was 0.5/3) on
  every scale axis incl. the extrude height (`dragScaleK`/`clampEditK`) and the model's uniform scale;
  edits compound, no absolute cap; a non-finite read-back = "unchanged". SANITY rail (the contract):
  `SCALE_MIN_K/MAX_K` 0.001/1000 (was 0.1/10), `TRANSLATE_MAX_M` 5000 (was 60), `LIFT_MAX_M` 25 unchanged
  + absolute — on read (`sanitizeRow` drops), SYNC (`parseSyncEntry`), the engine commit
  (`applyTransformTarget`), the model read (`sanitizeModelTransform`) and PATCH (`parsePlacementBody`).
  The DEV seam `enrichedSetTransform` is the commit path → sanity rail only; relative semantics are a
  gesture property (harness leg 8c proves it with a real drag from 70 m out). Tile-volume pop ACCEPTED
  (guide `fpv-height` says so). Compatibility: old rows are inside the new rail (contracts §2/§7).
- **§11.3**: `onFpvPointerDown` `e.button === 2` → close menus + return (never claims `fpvDragId`);
  orbit `onPointerUp` ignores a right release (a right-click is no longer a click in orbit — stated);
  `menuConsumesPress()` (a menu opening during a live primary press sets the M3c `longPressFired`);
  `onFpvPointerEnd` reads that flag ONCE per release (`pressConsumed`).
- **§11.4**: `attachBldgGizmo` keeps the helper in the scene ONLY while attached (`setTarget` add/remove +
  `updateMatrixWorld(true)` on attach); `inScene` + `helperRoot()` on the handle and both DEV seams.

## Files
`lib/globe/bldgOverrides.ts` (constants, `clampGizmoEdit`) · `lib/globe/featureTransform.ts` (doc) ·
`lib/models/modelPlacement.ts` (doc) · `lib/wix/overrideRecords.ts` (doc) · `lib/format/readout.ts`
(NEW `formatMetres`/`formatDims`) · `scene/enrichedBuildings.ts` (dx/dz, footprintM) · `scene/userModels.ts`
(sizeM3) · `scene/bldgGizmo.ts` (helper lifecycle, `inScene`, `helperRoot`) · `StylizedTiles.ts` (guards,
`menuConsumesPress`, `pressConsumed`, footprintM/sizeM3 plumbing, op lines, DEV seams) ·
`store/bldgEdit.ts` · `store/modelEdit.ts` · `panels/BuildingEditChip.tsx` · `panels/ModelEditChip.tsx` ·
`panels/ModelUploadStep.tsx` (shared fmt) · `tuning.ts` (comments) · `lib/guide/guideContent.ts`
(`fpv-height`, `fpv-models`) · docs: plan §11.5 + §3 + §5 · `contracts.md` §2/§7 · `globe-tuning.md` ·
tests: bldgOverrides / modelPlacement / overrideRecords / bldgSync / modelRecords / buildingEditChip /
modelEditChip / store fixtures / userModels · harnesses: `verify-meshedit.mjs` (rails leg rewritten,
`rightClick`, leg 8c, `worldBaseline` relative counters, orbit legs 6b/14b with `orbitDragProbe` +
`controlSeesHelper`), `verify-usermodels.mjs` (real right-click legs 3/8, band, metres row, leg 6b),
`verify-bldg-override.mjs` (band (1.2, 10]).

## Verification receipt
- Unit: vitest **2,411/2,411 (161 files)** · `astro check` 0 err / 0 warn / 9 hints · knip clean.
- Browser (headless Chrome :9333, ONE fresh instance per suite, `wix dev`, Dnipro FPV pose):
  - `verify-meshedit.mjs` **PASS, 22 legs** (5th run; runs 1–4 were harness-environment reds:
    absolute world counters vs 5 members' rows, a `| head -1` that killed the Chrome launcher, the
    focus mirror pinned on the temp pin, an unfixed fly-out pose + a pixel-ray control): rails 90 m
    exact · sanity |t| 5000 m direction kept · sy 12 · lift 25 · row agrees; real right-click: menu
    open at press (macOS `contextmenu` on the press), still open 300 ms after the release, a left
    tap closes it and keeps the arm; MOVE 9.41 m; per-edit move from 70 m out +15.01 m → |t| 65.09 m
    (past the old 60 m rail); ROTATE 84.2°; SCALE sx 4.033 (past the old 3× band) with the chip
    `266 × 68.0 m (4.03 × 1.00)` / `was 65.9 × 68.0 m` + the label `⤢ 266 × 68.0 m · 4.03 × 1.00`
    (`verify-shots/meshedit-06-gizmo-scale.jpeg`); orbit drag after the session 275.1 m vs the
    pre-session baseline 299.4 m (−8 %), first hit a terrain Mesh @ 1028 m with 0 gizmo hits, both
    gizmos out of the scene, the aimed control saw 14 gizmo hits of 17; the MS3 legs green against
    the LIVE collection, world left clean.
  - `verify-usermodels.mjs` **PASS 11/11**: the 3 × 5 × 3 m box's SCALE row `3.00 × 3.00 × 5.00 m
    (1.00×)` at arm; real right-click open at press + survived the release + a left tap closed it;
    ROTATE 84.5°; SCALE 3.104× (past the old 3× band), row `9.31 × 9.31 × 15.5 m (3.10×)`; MOVE 0.79 m;
    orbit drag after the session 270.0 m, first hit Mesh @ 1028 m, 0 gizmo hits, control 19 of 22;
    reload / anonymous / MDL / click-to-place 46 m / cleanup (row + media).
  - `verify-bldg-override.mjs` **PASS** (the U8 twin): commit scale 3.64 (past the old 3× band);
    RESET + reload RELATIVE to the world's rows; the /m twin commits sy 4.855 on the building's own
    engine target (its row was already counted).
  - NOT re-run: the wider §4a-4 sweep (ultra / dusk / charter / eclipse / bestspot) — untouched modules.

## Traps (new)
- **The production world is never empty**: `BuildingOverrides` carried 5 members' rows at boot —
  every world-level counter in a harness must be RELATIVE to what boot found (`worldBaseline`).
- **`focusLatDeg/focusLonDeg` stay pinned on a temp pin** (the `#f=` boot keeps one) — measure an
  orbit drag by the camera's own `camGeo` + `camera.position`, never the focus mirror.
- **The FPV fly-out lands wherever the look left it** — re-seat on ONE fixed pose (`requestFly` +
  `setState({targetTiltDeg, targetHeadingDeg})`) before comparing two drags.
- **A positive control for a "no gizmo in the raycast" probe must AIM at the parked plane** — a pixel
  ray can miss a 100 km plane that is edge-on or behind the pixel's ground point.
- **`| head -1` on `verify-chrome.mjs` kills the launcher** (SIGPIPE) before Chrome is up.
- **A JSON edit spec with a stray quote fails silently-ish** — prefer Python raw strings for big edits.

## Taste calls / questions for the owner (not decided)
Lift stays 0–25 m absolute? · extrude shares the 0.1×–10× per-edit rule (assumed)? · the sanity
numbers 5 km / 0.001–1000× (a world-shared 1000× object is a moderation matter) · a right-click is no
longer a click in orbit · the tile-volume pop is accepted, not fixed.

## Next
MS6 (design-first): the my-uploads list, hide/delete/title, every member editing user meshes (MS3 sync
or an open PATCH with LWW), a lift seat if wanted, haze chaining on foreign materials, an orbit
hover/pick for models, `verify-usermodels` MS6 legs. Then T77 (the architecture + performance audit).
