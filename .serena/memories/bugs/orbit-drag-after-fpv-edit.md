# BUG (owner report 2026-09-02j) — FIXED 2026-09-02l (MS5b §11.4): after editing meshes in FPV, an ORBIT ("3D map") drag went too slow or barely moved — nothing hung, the drag SENSITIVITY broke

## Symptom (owner, desktop)
"after some editing of meshes in FPV when I move back to 3D map dragging around it becomes too
slow and sometimes it just doesn't (or barely) drags around, nothing hangs."

## Mechanism (CONFIRMED against the installed sources: three 0.185.0 · 3d-tiles-renderer 0.4.28)
- `TransformControls` owns a DRAG PLANE: `TransformControlsPlane`, a `PlaneGeometry(100000, 100000)`
  Mesh whose MATERIAL is invisible but whose `raycast` is intact (`examples/jsm/controls/
  TransformControls.js` ~1910), a child of the helper root (`getHelper()`).
- `detach()` only flips `_root.visible`; `TransformControlsRoot.updateMatrixWorld` refreshes
  `worldPosition` ONLY while an object is attached, so after any FPV edit the plane (and the pickers)
  stay parked at that building's ECEF surface position; its orientation is whatever the last axis
  drag left (`_dirVector` is module-global) — the "sometimes".
- three's `Raycaster` ignores `visible` (`Raycaster.js` `intersect()` gates on layers only;
  `Mesh.raycast` has no visible check). `EnvironmentControls._raycast` =
  `raycaster.intersectObject(scene)[0]` (`firstHitOnly` only shortens the tiles traversal); the
  drag PIVOT (pointerdown `pivotPoint.copy(hit.point)`), `getPivotPoint` and `_getPointBelowCamera`
  all use it; `GlobeControls._raycast` only adds an ellipsoid FALLBACK when there is no hit.
- MS2 added the helper to the scene at boot and never removed it (the no-op raycast sweep
  deliberately spared the plane — a no-op there silenced every drag). Before any edit the plane sat
  at the ECEF origin, 6,371 km behind the terrain — which is why MS2 shipped clean; after an edit it
  sat ON the city and won the first hit from most orbit angles. A wrong pivot → a wrong drag sphere
  (`GlobeControls._updatePosition`) → the ground lags the pointer; a ray that misses the pivot
  sphere ends the drag (`resetState`) — "sometimes it just doesn't". MS5's second gizmo instance
  (the model rig) doubled the exposure.

## Fix (as built — `scene/bldgGizmo.ts`, the ONE `attachBldgGizmo` both instances share)
The helper is a scene child ONLY while something is attached: `setTarget` adds it on attach
(`scene.add(helper)` + `helper.updateMatrixWorld(true)` so a same-frame hover/press sees fresh
picker matrices) and removes it on detach (`helper.parent.remove(helper)`); nothing of the gizmo is
raycastable or drawn between sessions. `inScene` on the handle (`readonly`) and on both DEV seams
(`__globe.bldgGizmo().inScene`, `__globe.modelGizmo().inScene`); `helperRoot()` (DEV) hands a
harness the root for a POSITIVE CONTROL. Pinned: `verify-meshedit` leg 14b + `verify-usermodels` leg
6b — an IN-PAGE FPV exit (`__cameraStore.setTempFpv(false)`; a reload would discard a parked helper
and hide the bug), a fixed 220 px ground drag measured by the CAMERA's own ground point (`camGeo` +
`camera.position` — the store's `focusLatDeg` mirror stays pinned on a temp pin), compared with a
baseline drag taken before any session (±25 %, meshedit); GlobeControls' own raycaster's first hit
under the press pixel is not a gizmo object; `inScene` false for both gizmos; the control sees the
helper once re-added.

## How to apply
A helper/proxy object with a live `raycast` must leave the scene graph when its session ends —
`visible = false` hides nothing from a Raycaster. Reserve alternative if ever needed: a camera
layer excluded from `controls.raycaster.layers` (three's TransformControls shares one module-level
`_raycaster` whose layers must then include it).

Related: `mem:project/wip-2026-09-02-mesh-suite-ms5b` (receipt), `mem:bugs/bldg-menu-right-release`,
`mem:project/wip-2026-09-02-mesh-suite-ms2` (the no-op raycast trap), MESH_SUITE_PLAN §11.4 + §11.5,
DECISIONS 2026-09-02l.
