# BUG (owner report 2026-09-02j) — FIXED 2026-09-02l (MS5b §11.3): the building/model context menu closed the moment the right mouse button was RELEASED; it survived only while the right button was held and dragged

## Symptom (owner, desktop FPV)
"Context menu on a mesh looks fine … but it is flaky, often unexpectedly disappears immediately after I
release right mouse button and stays on screen ONLY when I hold right mouse and drag camera around."

## Cause (code-read 2026-09-02j, CONFIRMED by the harness's real right-button legs 2026-09-02l)
`src/components/globe/StylizedTiles.ts`: the FPV pointer table had NO button guard. On macOS Chrome
`contextmenu` fires on the right button's PRESS, so: `pointerdown`(right) → `onFpvPointerDown` claimed
`fpvDragId` and sampled `bldgMenuDismiss = (menu !== null)` = false (nothing open yet) → `contextmenu`
→ `onSkyContextMenu` armed + opened the menu → `pointerup`(right, no travel) → the TAP path →
`disarmBuilding()` → `_syncArmed(null)` → `menu: null`. A held right-drag travelled past
`ORCH.clickDragPx` (6 px), so the release was not a tap and the menu lived. The model session had
the same shape. "Often", not always: with the menu ALREADY open at the press the dismiss flag
read true and the release only closed-and-reopened. Never caught because both harnesses opened the
menu with a synthetic `contextmenu` MouseEvent and no pointer pair.

## Fix (as built — `StylizedTiles.ts`)
- `onFpvPointerDown`: `if (e.button === 2) { closeMenu ×2; return; }` — a right press closes any
  open edit menu (the press invariant; `onSkyContextMenu` re-opens it where the click lands) and
  NEVER claims `fpvDragId`: no tap path on the release, no right-drag look-around (it never should).
- The orbit twin `onPointerUp`: `if (e.button === 2) return;` — a right release is never a CLICK in
  orbit (no pin open, no placing drop, no empty-map clear). A behaviour change stated to the owner.
- Belt to the braces: `menuConsumesPress()` — when `onSkyContextMenu` opens a building/model menu
  while a primary press is live (`fpvDragId !== null`, e.g. a Ctrl+click reported as button 0) it
  sets the M3c `longPressFired` flag, so the release ends nothing. `onFpvPointerEnd` now reads that
  flag ONCE per release (`pressConsumed`) whichever branch ends the gesture — a gizmo/height release
  used to leave it set for the NEXT release to swallow.
- Pinned by REAL CDP right-button legs (`Input.dispatchMouseEvent` `button: "right"`, press →
  release): `verify-meshedit` legs 7 + 14, `verify-usermodels` legs 3 + 8 — the menu must still be
  open 300 ms after the release, a left tap then closes it and keeps the session armed; the leg logs
  whether the menu was already open at the press (the platform's `contextmenu` timing).

## How to apply
Any new pointer table that opens a menu on `contextmenu` must (a) ignore non-primary buttons in its
press/tap path and (b) treat "a menu opened during this press" as a consumed gesture. Test menus
with a real press + release, never a synthetic `contextmenu` alone.

Related: `mem:project/wip-2026-09-02-mesh-suite-ms5b` (receipt), `mem:bugs/orbit-drag-after-fpv-edit`
(the same batch), MESH_SUITE_PLAN §11.3 + §11.5, DECISIONS 2026-09-02l.
