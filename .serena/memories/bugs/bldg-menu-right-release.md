# BUG (owner report 2026-09-02j, OPEN — fix at MS5b, before MS6): the building/model context menu closes the moment the right mouse button is RELEASED; it survives only while the right button is held and dragged

## Symptom (owner, desktop FPV)
"Context menu on a mesh looks fine, has all options and appears correctly on right click, but it
is flaky, often unexpectedly disappears immediately after I release right mouse button and stays
on screen ONLY when I hold right mouse and drag camera around."

## Diagnosis (code-read 2026-09-02j; browser-UNVERIFIED — verify with REAL right-button events first)
`src/components/globe/StylizedTiles.ts`: the FPV pointer table has NO button guard
(`grep "e\.button"` is empty). Sequence on macOS Chrome (`contextmenu` fires on the right
button's mousedown):
1. `pointerdown` (right) → `onFpvPointerDown`: claims `fpvDragId = e.pointerId`, samples
   `bldgMenuDismiss = (useBldgEditStore.menu !== null)` = **false** (nothing open yet).
2. `contextmenu` → `onSkyContextMenu` → `armPick` + `openBldgMenu` (the menu opens).
3. `pointerup` (right, no travel) → `onFpvPointerEnd` TAP path (`e.type === "pointerup"` and
   travel ≤ `ORCH.clickDragPx`) → `if (bldgArmed) { if (bldgMenuDismiss) {…return;} disarmBuilding(); return; }`
   → `disarmBuilding()` → `_syncArmed(null)` resets `menu: null` → the menu vanishes.
A held right-drag travels past `clickDragPx`, so the release is not a tap → the menu survives —
exactly the owner's observation. The MS5 model session (`modelMenuDismiss` / `disarmModel`)
mirrors the same path and has the same bug.

## Why no harness caught it
`verify-meshedit.mjs` and `verify-usermodels.mjs` open the menu with a synthetic
`new MouseEvent('contextmenu', …)` on the canvas — no pointerdown/pointerup pair.

## Fix (planned)
`if (e.button === 2) return;` at the top of `onFpvPointerDown` (a right press never enters the
gesture table, so `fpvDragId` stays unclaimed and the release has no tap path; the `contextmenu`
handler alone opens the menu). Check the orbit twins (`notePointerDown` / `onPointerUp`) for the
same shape. Consequence: a right-drag no longer looks around (it never should have). Keep the
left-press `bldgMenuDismiss` / `modelMenuDismiss` logic (a left tap that only closes the menu
must not disarm — that path is right). Pin it: both harnesses open the menu with a REAL CDP
right-button press + release (`Input.dispatchMouseEvent` `button: "right"`, `mousePressed` →
`mouseReleased`) and assert the menu is still open 300 ms after the release, then a left tap
away closes it.

Related: `mem:project/wip-2026-09-02-mesh-suite-ms5`, MESH_SUITE_PLAN §11.3, DECISIONS 2026-09-02j.
