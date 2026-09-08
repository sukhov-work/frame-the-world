/**
 * The EMPTY-MAP CLICK rule (T127, owner ruling 2026-09-08b) — what a click / tap on the map that hit
 * nothing (no model, no pin, no marker) does to the selected state. Pure; the orchestrator's
 * `onPointerUp` (StylizedTiles.ts) calls it once it has ruled out every pick.
 *
 * Desktop keeps the owner follow-up of 2026-07: a click on empty ground clears the temp pin, and if
 * there is none, deselects a VIEWED saved pin. On the `/m` shell a stray touch must NOT clear the
 * look-from-here pin — the phone has an explicit ✕ CLEAR PIN cell (`mobile/SceneActions.tsx`), a
 * thumb brushing the glass is not a decision, and the pin is what the SCENE tab's chips hang off.
 * A double-tap still sets a new place (native `dblclick` lands AFTER both pointerups, so it never
 * depended on this clear) and a long press still drops one. The set pin STILL shadows the
 * deselect on `/m` (the branch returns "keep-pin", never "deselect") so the two shells differ
 * only in the clear itself.
 */
export type EmptyMapClickAction = "clear-pin" | "keep-pin" | "deselect" | "none";

export function emptyMapClickAction(s: {
  /** `document.body.classList.contains("m")` — the `/m` shell. */
  isMobileShell: boolean;
  /** `useCameraStore.getState().tempPin !== null`. */
  hasTempPin: boolean;
  /** An upload in `placed` phase that is a VIEWED saved pin (`viewingPinId` set). */
  viewingSavedPin: boolean;
}): EmptyMapClickAction {
  if (s.hasTempPin) return s.isMobileShell ? "keep-pin" : "clear-pin";
  return s.viewingSavedPin ? "deselect" : "none";
}
