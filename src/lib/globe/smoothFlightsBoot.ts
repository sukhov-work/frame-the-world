import { loadViewPrefs } from "../prefs";

/**
 * SMOOTH FLIGHTS — the BOOT-TIME read of the hidden `smoothFlights` pref (owner order 2026-09-22,
 * FPV/minimap item 1: every FPV / minimap transition is an instant cut; the 2,200 ms cinematic
 * sweep survives behind a hidden toggle "if I change my mind in future").
 *
 * The `debugBoot.ts` posture: the pref is read ONCE at globe construction, there is no chip on
 * either shell (a console write to `ftw:view-prefs:v1` + reload), and the default is OFF. The
 * other two doors are `FLIGHT.smoothTransitions` (compile-time) and the DEV seam
 * `__globe.smoothFlights(true)` (the descent harnesses). SSR-safe like its sibling.
 */
export function smoothFlightsBootOn(): boolean {
  return loadViewPrefs().smoothFlights === true;
}
