# BUG (owner report 2026-09-02j, OPEN — fix at MS5b, before MS6): after editing meshes in FPV, an ORBIT ("3D map") drag goes too slow or barely moves — nothing hangs, the drag SENSITIVITY breaks

## Symptom (owner, desktop)
"after some editing of meshes in FPV when I move back to 3D map dragging around it becomes too
slow and sometimes it just doesn't (or barely) drags around, nothing hangs but something breaks
with drag sensitivity."

## Diagnosis (code-read 2026-09-02j against the INSTALLED sources; browser-UNVERIFIED — verify first)
- `TransformControls` (three 0.185) owns a DRAG PLANE: `TransformControlsPlane`, a
  `PlaneGeometry(100000, 100000, 2, 2)` mesh (`TransformControls.js:1915`), a child of the helper
  (`tc.getHelper()`), invisible, positioned every frame at the attached object's world position
  (`worldPosition`) and oriented by the current axis/eye.
- MS2 (`scene/bldgGizmo.ts`) adds the helper to the scene at BOOT (`scene.add(helper)`) and never
  removes it; it no-ops `raycast` on the visible gizmo/helper meshes but DELIBERATELY leaves the
  plane's raycast intact (a no-op there silenced every drag — browser-caught 2026-09-02). Before
  any edit the plane sits at the Earth's centre (worldPosition 0), so the terrain is the nearer
  hit; after ANY FPV edit it sits at that building's ECEF surface position. `tc.detach()` does not
  move it back.
- `GlobeControls` (`3d-tiles-renderer` `EnvironmentControls.js`): the drag PIVOT (`:475 →
  pivotPoint.copy(hit.point)`) and the camera-height point (`_getPointBelowCamera`, `:848`) come
  from `this._raycast(raycaster)` = `raycaster.intersectObject(scene)[0]` with
  `raycaster.firstHitOnly = true` (`:268`). three's Raycaster does NOT skip invisible objects, so
  from most orbit angles over the edited city the 100 km plane is the FIRST hit, ahead of the
  terrain → the pivot lands on the plane at a wrong depth (or the height guard reads a wrong
  ground) → the drag math scales off it: slow, erratic, "barely drags", never a hang.
- MS2's note called the research trap moot ("a building can only be armed INSIDE FPV, where
  `controls.enabled` is already false") — true for the PICKERS while armed, wrong for the PLANE
  after the session ends. MS5's second gizmo instance (the model rig, `modelGizmo`) doubles the
  exposure.

## Confirm in one probe
In orbit after an FPV edit: press on the ground and read `window.__globe.controls.pivotPoint`
against `terrainHeightAt` there (a plane hit sits off the terrain); or from the console
`__globe`-reach the helper and `helper.traverse(o => o.raycast = () => {})` — if the drag
recovers at once, this is it.

## Fix (planned)
The helper leaves the scene whenever nothing is attached: `scene.remove(helper)` on
`setTarget(null, …)` / disarm and `scene.add(helper)` on attach — in BOTH `attachBldgGizmo`
instances (the building one and MS5's model one). Equivalent alternative: swap the plane's
`raycast` to a no-op while detached and restore it on attach. Reserve: a dedicated camera LAYER
for the helper excluded from GlobeControls' raycaster mask (then `tc.getRaycaster().layers` must
include it). Pin: `verify-meshedit` + `verify-usermodels` grow an ORBIT leg after the FPV edit —
a fixed-length drag moves the focus (`__cameraStore` focus/heading delta) by the same amount as a
pre-edit baseline drag (±10 %), and `controls.pivotPoint` after a press sits on the terrain
(within a metre of `terrainHeightAt`).

Related: `mem:bugs/bldg-menu-right-release` (the same batch), `mem:project/wip-2026-09-02-mesh-suite-ms5`,
MESH_SUITE_PLAN §11.4, DECISIONS 2026-09-02j.
