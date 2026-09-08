/**
 * The tab row's LIVE state and the long-press decisions (owner 2026-09-08b) — pure, so the
 * DOM-less vitest pins the contract and MobileShell only wires stores to it.
 *
 * LIVE = "the feature is working right now", not "its sheet is open":
 *  · FIND is live while the frame scan is RUNNING — the store's `open` (sticky on /m once the
 *    tab has been visited), at least one body chip on, and a live FPV pose (the frame is the
 *    query; out of FPV nothing scans — `FindSheet`'s own `active` gate, and the engine draws
 *    ghosts on `find.open` alone). The moon chip is on by default, so in practice: FPV + the
 *    tab visited once.
 *  · SPOT is live while the heatmap is ARMED — exactly the engine's `bestSpotArmed()` term,
 *    `open && heatmapOn` (StylizedTiles.ts; fenced verbatim). Never `open` alone: on /m `open`
 *    is sticky and would glow forever after the first visit.
 *
 * A LONG PRESS toggles the feature WITHOUT opening the sheet when the rest of the conditions
 * already hold, and OPENS the sheet when they do not — the sheet's own copy says what is
 * missing ("ENTER LOOK-FROM-HERE", "ARMED — NO CENTRE" + ◎ CENTRE HERE), which beats a
 * gesture that silently does nothing. Turning FIND off also collapses its sheet when it is
 * the one showing: the sheet's `(findOpen || open)` scan gate would otherwise keep scanning
 * under a dark tab.
 */

import type { MobileTab } from "./TabBar";

export interface TabLiveSnapshot {
  find: { open: boolean; anyBody: boolean };
  spot: { open: boolean; heatmapOn: boolean; hasCentre: boolean };
  /** A live FPV pose (the `fpvHud` mirror) — the scan's precondition. */
  fpv: boolean;
}

/** Which tabs glow. */
export function tabLive(s: TabLiveSnapshot): Partial<Record<MobileTab, boolean>> {
  return {
    find: s.find.open && s.find.anyBody && s.fpv,
    spot: s.spot.open && s.spot.heatmapOn,
  };
}

export type TabLongPressAction =
  | { kind: "find-off"; collapse: boolean }
  | { kind: "find-on" }
  | { kind: "spot-off" }
  | { kind: "spot-on" }
  | { kind: "open-sheet"; tab: MobileTab }
  | { kind: "none" };

/**
 * What a long press on `tab` does, given the snapshot and which sheet is currently showing.
 * `spot-on` from a never-opened store must do `setOpen(true)` BEFORE `setHeatmapOn(true)` —
 * `setOpen` clears `heatmapOn` in both directions (the desktop segment's contract).
 */
export function tabLongPress(
  tab: MobileTab,
  s: TabLiveSnapshot,
  showing: MobileTab | null,
): TabLongPressAction {
  const live = tabLive(s);
  if (tab === "find") {
    if (live.find) return { kind: "find-off", collapse: showing === "find" };
    // Off → on only when the scan would actually run; otherwise the sheet explains.
    if (s.fpv && s.find.anyBody) return { kind: "find-on" };
    return { kind: "open-sheet", tab };
  }
  if (tab === "spot") {
    if (live.spot) return { kind: "spot-off" };
    // Arming without a centre is legitimate but shows nothing — arm AND open the sheet so the
    // ◎ CENTRE HERE affordance is right there; with a centre the disc just lights up.
    if (s.spot.hasCentre) return { kind: "spot-on" };
    return { kind: "open-sheet", tab };
  }
  return { kind: "none" };
}
